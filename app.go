package main

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/pkg/sftp"
	"github.com/wailsapp/wails/v2/pkg/runtime"
	"golang.org/x/crypto/ssh"
)

// ServerConfig holds SSH + DB credentials for a single server.
type ServerConfig struct {
	ServerIP    string `json:"server_ip"`
	SSHUser     string `json:"ssh_user"`
	SSHPassword string `json:"ssh_password"`
	PrivateKey  string `json:"private_key_path"`
	DBName      string `json:"db_name"`
	DBUser      string `json:"db_user"`
	DBPassword  string `json:"db_password"`
}

// LocalConfig holds settings for importing into the local machine's MySQL.
type LocalConfig struct {
	MySQLBin string `json:"mysql_bin"`
	DBName   string `json:"db_name"`
	DBUser   string `json:"db_user"`
	DBPass   string `json:"db_pass"`
}

// Config is the top-level config persisted to disk.
type Config struct {
	Production ServerConfig `json:"production"`
	Test       ServerConfig `json:"test"`
	Local      LocalConfig  `json:"local"`
}

// TransferProgress is emitted during uploads and downloads.
type TransferProgress struct {
	Bytes int64 `json:"bytes"`
	Total int64 `json:"total"`
}

// App is the main Wails application struct.
type App struct {
	ctx    context.Context
	config Config

	cancelMu sync.Mutex
	cancelFn context.CancelFunc
}

func NewApp() *App { return &App{} }

func (a *App) startup(ctx context.Context) {
	a.ctx = ctx
	if err := a.loadConfig(); err != nil {
		a.config = Config{
			Production: ServerConfig{},
			Test:       ServerConfig{},
			Local:      LocalConfig{MySQLBin: "/opt/lampp/bin/mysql", DBUser: "root"},
		}
	}
}

// ── Config ────────────────────────────────────────────────────────────────────

func configPath() (string, error) {
	dir, err := os.UserConfigDir()
	if err != nil {
		return "", err
	}
	return filepath.Join(dir, "dbsync", "config.json"), nil
}

func (a *App) loadConfig() error {
	path, err := configPath()
	if err != nil {
		return err
	}
	data, err := os.ReadFile(path)
	if err != nil {
		return err
	}
	return json.Unmarshal(data, &a.config)
}

func (a *App) GetConfig() Config { return a.config }

func (a *App) SaveConfig(cfg Config) error {
	path, err := configPath()
	if err != nil {
		return fmt.Errorf("could not resolve config path: %w", err)
	}
	if err := os.MkdirAll(filepath.Dir(path), 0700); err != nil {
		return fmt.Errorf("could not create config directory: %w", err)
	}
	data, err := json.MarshalIndent(cfg, "", "  ")
	if err != nil {
		return fmt.Errorf("could not marshal config: %w", err)
	}
	if err := os.WriteFile(path, data, 0600); err != nil {
		return fmt.Errorf("could not write config file: %w", err)
	}
	a.config = cfg
	return nil
}

// ── Cancellation ──────────────────────────────────────────────────────────────

func (a *App) newOpCtx() context.Context {
	a.cancelMu.Lock()
	defer a.cancelMu.Unlock()
	ctx, cancel := context.WithCancel(a.ctx)
	a.cancelFn = cancel
	return ctx
}

func (a *App) Cancel() {
	a.cancelMu.Lock()
	defer a.cancelMu.Unlock()
	if a.cancelFn != nil {
		a.cancelFn()
		a.cancelFn = nil
	}
}

// ── Events ────────────────────────────────────────────────────────────────────

func (a *App) emit(event string, data any) {
	runtime.EventsEmit(a.ctx, event, data)
}

func (a *App) fail(errEvent, progressEvent, format string, args ...any) error {
	msg := fmt.Sprintf(format, args...)
	a.emit(errEvent, msg)
	return fmt.Errorf("%s", msg)
}

// ── SSH helpers ───────────────────────────────────────────────────────────────

func buildSSHClientConfig(s ServerConfig) (*ssh.ClientConfig, error) {
	var authMethods []ssh.AuthMethod

	if s.PrivateKey != "" {
		keyPath := s.PrivateKey
		if len(keyPath) > 1 && keyPath[:2] == "~/" {
			home, err := os.UserHomeDir()
			if err != nil {
				return nil, fmt.Errorf("could not resolve home dir: %w", err)
			}
			keyPath = filepath.Join(home, keyPath[2:])
		}
		keyBytes, err := os.ReadFile(keyPath)
		if err != nil {
			return nil, fmt.Errorf("could not read private key: %w", err)
		}
		signer, err := ssh.ParsePrivateKey(keyBytes)
		if err != nil {
			return nil, fmt.Errorf("could not parse private key: %w", err)
		}
		authMethods = append(authMethods, ssh.PublicKeys(signer))
	}

	if s.SSHPassword != "" {
		authMethods = append(authMethods, ssh.Password(s.SSHPassword))
	}

	if len(authMethods) == 0 {
		return nil, fmt.Errorf("no SSH authentication method configured")
	}

	return &ssh.ClientConfig{
		User:            s.SSHUser,
		Auth:            authMethods,
		HostKeyCallback: ssh.InsecureIgnoreHostKey(),
		Timeout:         30 * time.Second,
	}, nil
}

func dialSSH(s ServerConfig) (*ssh.Client, error) {
	cfg, err := buildSSHClientConfig(s)
	if err != nil {
		return nil, err
	}
	return ssh.Dial("tcp", fmt.Sprintf("%s:22", s.ServerIP), cfg)
}

func runSSHCommand(client *ssh.Client, cmd string) error {
	session, err := client.NewSession()
	if err != nil {
		return fmt.Errorf("could not open SSH session: %w", err)
	}
	defer session.Close()
	output, err := session.CombinedOutput(cmd)
	if err != nil {
		return fmt.Errorf("command error: %w — output: %s", err, string(output))
	}
	return nil
}

func runSSHCommandBestEffort(s ServerConfig, cmd string) {
	client, err := dialSSH(s)
	if err != nil {
		return
	}
	defer client.Close()
	runSSHCommand(client, cmd)
}

// ── Transfer helpers ──────────────────────────────────────────────────────────

func downloadFile(ctx context.Context, sftpClient *sftp.Client, remotePath, localPath string, onBytes func(bytes, total int64)) error {
	remote, err := sftpClient.Open(remotePath)
	if err != nil {
		return fmt.Errorf("could not open remote file: %w", err)
	}
	defer remote.Close()

	info, err := remote.Stat()
	if err != nil {
		return fmt.Errorf("could not stat remote file: %w", err)
	}

	local, err := os.Create(localPath)
	if err != nil {
		return fmt.Errorf("could not create local file: %w", err)
	}
	defer local.Close()

	_, err = io.Copy(local, &progressReader{
		r:       &ctxReader{r: remote, ctx: ctx},
		total:   info.Size(),
		onBytes: onBytes,
	})
	return err
}

func uploadFile(ctx context.Context, sftpClient *sftp.Client, localPath, remotePath string, onBytes func(bytes, total int64)) error {
	local, err := os.Open(localPath)
	if err != nil {
		return fmt.Errorf("could not open local file: %w", err)
	}
	defer local.Close()

	info, err := local.Stat()
	if err != nil {
		return fmt.Errorf("could not stat local file: %w", err)
	}

	remote, err := sftpClient.Create(remotePath)
	if err != nil {
		return fmt.Errorf("could not create remote file: %w", err)
	}
	defer remote.Close()

	_, err = io.Copy(remote, &progressReader{
		r:       &ctxReader{r: local, ctx: ctx},
		total:   info.Size(),
		onBytes: onBytes,
	})
	return err
}

type ctxReader struct {
	r   io.Reader
	ctx context.Context
}

func (c *ctxReader) Read(p []byte) (int, error) {
	select {
	case <-c.ctx.Done():
		return 0, fmt.Errorf("cancelled")
	default:
		return c.r.Read(p)
	}
}

type progressReader struct {
	r          io.Reader
	total      int64
	read       int64
	lastReport int64
	onBytes    func(bytes, total int64)
}

func (p *progressReader) Read(buf []byte) (int, error) {
	n, err := p.r.Read(buf)
	p.read += int64(n)
	// Report every 256 KB for smooth UI
	if p.onBytes != nil && p.read-p.lastReport >= 256*1024 {
		p.lastReport = p.read
		p.onBytes(p.read, p.total)
	}
	return n, err
}

func localDumpPath(dbName string) (fullPath, fileName string, err error) {
	home, err := os.UserHomeDir()
	if err != nil {
		return "", "", err
	}
	fileName = fmt.Sprintf("%s_%s_dump.sql.gz", dbName, time.Now().Format("2006-01-02_150405"))
	fullPath = filepath.Join(home, "Downloads", fileName)
	return fullPath, fileName, nil
}

func cleanupLocal(path string) {
	if path != "" {
		os.Remove(path)
	}
}

// ── SyncDatabase: prod → ~/Downloads ─────────────────────────────────────────

func (a *App) SyncDatabase() error {
	ctx := a.newOpCtx()
	prod := a.config.Production

	if prod.ServerIP == "" || prod.DBName == "" {
		return fmt.Errorf("production config is incomplete — please check Settings")
	}

	remoteFile := fmt.Sprintf("/tmp/%s_dump.sql.gz", prod.DBName)
	var localPath string

	defer func() {
		if ctx.Err() != nil {
			a.emit("sync:progress", "Cancelling — cleaning up...")
			runSSHCommandBestEffort(prod, "rm -f "+remoteFile)
			cleanupLocal(localPath)
			a.emit("sync:cancelled", "Operation cancelled.")
		}
	}()

	a.emit("sync:progress", "Connecting to production server...")
	client, err := dialSSH(prod)
	if err != nil {
		return a.fail("sync:error", "sync:progress", "SSH connection failed: %v", err)
	}
	defer client.Close()

	if ctx.Err() != nil {
		return nil
	}

	a.emit("sync:progress", "Dumping database...")
	dumpCmd := fmt.Sprintf(
		"mysqldump -u %s -p%s %s --single-transaction | sed '/^.*999999.*sandbox/d' | gzip > %s",
		prod.DBUser, prod.DBPassword, prod.DBName, remoteFile,
	)
	if err := runSSHCommand(client, dumpCmd); err != nil {
		return a.fail("sync:error", "sync:progress", "Dump failed: %v", err)
	}

	a.emit("sync:progress", "Downloading...")
	sftpClient, err := sftp.NewClient(client)
	if err != nil {
		return a.fail("sync:error", "sync:progress", "SFTP session failed: %v", err)
	}
	defer sftpClient.Close()

	localPath, localFileName, err := localDumpPath(prod.DBName)
	if err != nil {
		return a.fail("sync:error", "sync:progress", "Could not resolve local path: %v", err)
	}

	if err := downloadFile(ctx, sftpClient, remoteFile, localPath, func(bytes, total int64) {
		a.emit("sync:transfer", TransferProgress{Bytes: bytes, Total: total})
	}); err != nil {
		if ctx.Err() != nil {
			return nil
		}
		return a.fail("sync:error", "sync:progress", "Download failed: %v", err)
	}

	a.emit("sync:progress", "Cleaning up remote...")
	runSSHCommand(client, "rm "+remoteFile)

	a.emit("sync:done", fmt.Sprintf("Done! Saved to ~/Downloads/%s", localFileName))
	return nil
}

// ── SyncToTest: prod → local → test server ───────────────────────────────────

func (a *App) SyncToTest() error {
	ctx := a.newOpCtx()
	prod := a.config.Production
	test := a.config.Test

	if prod.ServerIP == "" || prod.DBName == "" {
		return fmt.Errorf("production config is incomplete — please check Settings")
	}
	if test.ServerIP == "" || test.DBName == "" {
		return fmt.Errorf("test server config is incomplete — please check Settings")
	}

	prodRemoteFile := fmt.Sprintf("/tmp/%s_dump.sql.gz", prod.DBName)
	testRemoteFile := fmt.Sprintf("/tmp/%s_dump.sql.gz", prod.DBName)
	var localPath string

	defer func() {
		if ctx.Err() != nil {
			a.emit("test:progress", "Cancelling — cleaning up...")
			runSSHCommandBestEffort(prod, "rm -f "+prodRemoteFile)
			runSSHCommandBestEffort(test, "rm -f "+testRemoteFile)
			cleanupLocal(localPath)
			a.emit("test:cancelled", "Operation cancelled.")
		}
	}()

	a.emit("test:progress", "Connecting to production server...")
	prodClient, err := dialSSH(prod)
	if err != nil {
		return a.fail("test:error", "test:progress", "Prod SSH failed: %v", err)
	}
	defer prodClient.Close()

	a.emit("test:progress", "Dumping production database...")
	dumpCmd := fmt.Sprintf(
		"mysqldump -u %s -p%s %s --single-transaction | sed '/^.*999999.*sandbox/d' | gzip > %s",
		prod.DBUser, prod.DBPassword, prod.DBName, prodRemoteFile,
	)
	if err := runSSHCommand(prodClient, dumpCmd); err != nil {
		return a.fail("test:error", "test:progress", "Dump failed: %v", err)
	}

	if ctx.Err() != nil {
		return nil
	}

	a.emit("test:progress", "Downloading dump locally...")
	prodSFTP, err := sftp.NewClient(prodClient)
	if err != nil {
		return a.fail("test:error", "test:progress", "Prod SFTP session failed: %v", err)
	}
	defer prodSFTP.Close()

	localPath, localFileName, err := localDumpPath(prod.DBName)
	if err != nil {
		return a.fail("test:error", "test:progress", "Could not resolve local path: %v", err)
	}

	if err := downloadFile(ctx, prodSFTP, prodRemoteFile, localPath, func(bytes, total int64) {
		a.emit("test:transfer", TransferProgress{Bytes: bytes, Total: total})
	}); err != nil {
		if ctx.Err() != nil {
			return nil
		}
		return a.fail("test:error", "test:progress", "Download failed: %v", err)
	}
	a.emit("test:progress", fmt.Sprintf("Downloaded to ~/Downloads/%s", localFileName))
	runSSHCommand(prodClient, "rm "+prodRemoteFile)

	if ctx.Err() != nil {
		return nil
	}

	a.emit("test:progress", "Connecting to test server...")
	testClient, err := dialSSH(test)
	if err != nil {
		return a.fail("test:error", "test:progress", "Test SSH failed: %v", err)
	}
	defer testClient.Close()

	a.emit("test:progress", "Uploading dump to test server...")
	testSFTP, err := sftp.NewClient(testClient)
	if err != nil {
		return a.fail("test:error", "test:progress", "Test SFTP session failed: %v", err)
	}
	defer testSFTP.Close()

	if err := uploadFile(ctx, testSFTP, localPath, testRemoteFile, func(bytes, total int64) {
		a.emit("test:transfer", TransferProgress{Bytes: bytes, Total: total})
	}); err != nil {
		if ctx.Err() != nil {
			return nil
		}
		return a.fail("test:error", "test:progress", "Upload failed: %v", err)
	}

	if ctx.Err() != nil {
		return nil
	}

	a.emit("test:progress", fmt.Sprintf("Importing into '%s'...", test.DBName))
	importCmd := fmt.Sprintf(
		"gunzip < %s | mysql -u %s -p%s %s",
		testRemoteFile, test.DBUser, test.DBPassword, test.DBName,
	)
	if err := runSSHCommand(testClient, importCmd); err != nil {
		return a.fail("test:error", "test:progress", "Import failed: %v", err)
	}

	runSSHCommand(testClient, "rm "+testRemoteFile)
	a.emit("test:done", fmt.Sprintf("Done! '%s' imported into test server '%s'", prod.DBName, test.DBName))
	return nil
}

// ── SyncAndImportLocal: prod → ~/Downloads → local MySQL ─────────────────────

func (a *App) SyncAndImportLocal() error {
	ctx := a.newOpCtx()
	prod := a.config.Production
	local := a.config.Local

	if prod.ServerIP == "" || prod.DBName == "" {
		return fmt.Errorf("production config is incomplete — please check Settings")
	}
	if local.DBName == "" {
		return fmt.Errorf("local database name is not configured — please check Settings")
	}

	remoteFile := fmt.Sprintf("/tmp/%s_dump.sql.gz", prod.DBName)
	var localPath string

	defer func() {
		if ctx.Err() != nil {
			a.emit("pull:progress", "Cancelling — cleaning up...")
			runSSHCommandBestEffort(prod, "rm -f "+remoteFile)
			cleanupLocal(localPath)
			a.emit("pull:cancelled", "Operation cancelled.")
		}
	}()

	a.emit("pull:progress", "Connecting to production server...")
	client, err := dialSSH(prod)
	if err != nil {
		return a.fail("pull:error", "pull:progress", "SSH connection failed: %v", err)
	}
	defer client.Close()

	a.emit("pull:progress", "Dumping database...")
	dumpCmd := fmt.Sprintf(
		"mysqldump -u %s -p%s %s --single-transaction | sed '/^.*999999.*sandbox/d' | gzip > %s",
		prod.DBUser, prod.DBPassword, prod.DBName, remoteFile,
	)
	if err := runSSHCommand(client, dumpCmd); err != nil {
		return a.fail("pull:error", "pull:progress", "Dump failed: %v", err)
	}

	if ctx.Err() != nil {
		return nil
	}

	a.emit("pull:progress", "Downloading dump...")
	sftpClient, err := sftp.NewClient(client)
	if err != nil {
		return a.fail("pull:error", "pull:progress", "SFTP session failed: %v", err)
	}
	defer sftpClient.Close()

	localPath, localFileName, err := localDumpPath(prod.DBName)
	if err != nil {
		return a.fail("pull:error", "pull:progress", "Could not resolve local path: %v", err)
	}

	if err := downloadFile(ctx, sftpClient, remoteFile, localPath, func(bytes, total int64) {
		a.emit("pull:transfer", TransferProgress{Bytes: bytes, Total: total})
	}); err != nil {
		if ctx.Err() != nil {
			return nil
		}
		return a.fail("pull:error", "pull:progress", "Download failed: %v", err)
	}
	a.emit("pull:progress", fmt.Sprintf("Downloaded to ~/Downloads/%s", localFileName))
	runSSHCommand(client, "rm "+remoteFile)

	if ctx.Err() != nil {
		return nil
	}

	a.emit("pull:progress", fmt.Sprintf("Importing into local database '%s'...", local.DBName))

	mysqlBin := local.MySQLBin
	if mysqlBin == "" {
		mysqlBin = "mysql"
	}
	args := []string{"-u", local.DBUser}
	if local.DBPass != "" {
		args = append(args, "-p"+local.DBPass)
	}
	args = append(args, local.DBName)

	cmd := exec.CommandContext(ctx, "bash", "-c",
		fmt.Sprintf("gunzip < %q | %s %s", localPath, mysqlBin, strings.Join(args, " ")))
	if out, err := cmd.CombinedOutput(); err != nil {
		if ctx.Err() != nil {
			return nil
		}
		return a.fail("pull:error", "pull:progress", "Import failed: %v — %s", err, string(out))
	}

	a.emit("pull:done", fmt.Sprintf("Done! Production imported into local '%s'", local.DBName))
	return nil
}

// ── Local Import ──────────────────────────────────────────────────────────────

func (a *App) PickFile() (string, error) {
	return runtime.OpenFileDialog(a.ctx, runtime.OpenDialogOptions{
		Title: "Select SQL dump file",
		Filters: []runtime.FileFilter{
			{DisplayName: "SQL dumps (*.sql, *.sql.gz)", Pattern: "*.sql;*.sql.gz"},
			{DisplayName: "All files", Pattern: "*"},
		},
	})
}

func (a *App) ImportLocal(filePath string) error {
	ctx := a.newOpCtx()
	local := a.config.Local

	if filePath == "" {
		return fmt.Errorf("no file selected")
	}
	if local.DBName == "" {
		return fmt.Errorf("local database name is not configured — please check Settings")
	}

	mysqlBin := local.MySQLBin
	if mysqlBin == "" {
		mysqlBin = "mysql"
	}

	a.emit("import:progress", fmt.Sprintf("Importing %s into '%s'...", filepath.Base(filePath), local.DBName))

	args := []string{"-u", local.DBUser}
	if local.DBPass != "" {
		args = append(args, "-p"+local.DBPass)
	}
	args = append(args, local.DBName)

	var cmd *exec.Cmd
	if strings.HasSuffix(filePath, ".gz") {
		cmd = exec.CommandContext(ctx, "bash", "-c",
			fmt.Sprintf("gunzip < %q | %s %s", filePath, mysqlBin, strings.Join(args, " ")))
	} else {
		cmd = exec.CommandContext(ctx, mysqlBin, args...)
		f, err := os.Open(filePath)
		if err != nil {
			return a.fail("import:error", "import:progress", "Could not open file: %v", err)
		}
		defer f.Close()
		cmd.Stdin = f
	}

	out, err := cmd.CombinedOutput()
	if err != nil {
		if ctx.Err() != nil {
			a.emit("import:cancelled", "Import cancelled.")
			return nil
		}
		return a.fail("import:error", "import:progress", "Import failed: %v — %s", err, string(out))
	}

	a.emit("import:done", fmt.Sprintf("Done! '%s' imported into '%s'", filepath.Base(filePath), local.DBName))
	return nil
}
