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
	MySQLBin string `json:"mysql_bin"` // e.g. /opt/lampp/bin/mysql
	DBName   string `json:"db_name"`
	DBUser   string `json:"db_user"`
	DBPass   string `json:"db_pass"`
}

// Config is the top-level config persisted to disk.
type Config struct {
	Production ServerConfig `json:"production"`
	Test        ServerConfig `json:"test"`
	Local       LocalConfig  `json:"local"`
}

// App is the main Wails application struct.
type App struct {
	ctx    context.Context
	config Config
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

func (a *App) GetConfig() Config {
	return a.config
}

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

func (a *App) emit(event, message string) {
	runtime.EventsEmit(a.ctx, event, message)
}

// buildSSHClientConfig builds an ssh.ClientConfig from a ServerConfig.
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

// dialSSH connects to a server using its ServerConfig.
func dialSSH(s ServerConfig) (*ssh.Client, error) {
	cfg, err := buildSSHClientConfig(s)
	if err != nil {
		return nil, err
	}
	addr := fmt.Sprintf("%s:22", s.ServerIP)
	return ssh.Dial("tcp", addr, cfg)
}

// ── SyncDatabase: prod → local ~/Downloads ───────────────────────────────────

func (a *App) SyncDatabase() error {
	prod := a.config.Production
	if prod.ServerIP == "" || prod.DBName == "" {
		return fmt.Errorf("production config is incomplete — please check Settings")
	}

	remoteFile := fmt.Sprintf("/tmp/%s_dump.sql.gz", prod.DBName)

	a.emit("sync:progress", "Connecting to production server...")
	client, err := dialSSH(prod)
	if err != nil {
		return a.fail("sync:error", "SSH connection failed: %v", err)
	}
	defer client.Close()

	a.emit("sync:progress", "Connected. Dumping database...")
	dumpCmd := fmt.Sprintf(
		"mysqldump -u %s -p%s %s --single-transaction | sed '/^.*999999.*sandbox/d' | gzip > %s",
		prod.DBUser, prod.DBPassword, prod.DBName, remoteFile,
	)
	if err := runSSHCommand(client, dumpCmd); err != nil {
		return a.fail("sync:error", "Dump failed: %v", err)
	}

	a.emit("sync:progress", "Dump complete. Downloading...")
	sftpClient, err := sftp.NewClient(client)
	if err != nil {
		return a.fail("sync:error", "SFTP session failed: %v", err)
	}
	defer sftpClient.Close()

	localPath, localFileName, err := localDumpPath(prod.DBName)
	if err != nil {
		return a.fail("sync:error", "Could not resolve local path: %v", err)
	}

	if err := downloadFile(sftpClient, remoteFile, localPath); err != nil {
		return a.fail("sync:error", "Download failed: %v", err)
	}

	a.emit("sync:progress", fmt.Sprintf("Downloaded. Cleaning up remote..."))
	if err := runSSHCommand(client, "rm "+remoteFile); err != nil {
		a.emit("sync:progress", fmt.Sprintf("Warning: remote cleanup failed: %v", err))
	}

	a.emit("sync:done", fmt.Sprintf("Done! Saved to ~/Downloads/%s", localFileName))
	return nil
}

// ── SyncToTest: prod → local → test server ───────────────────────────────────

func (a *App) SyncToTest() error {
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

	// ── Step 1: Connect to prod & dump ───────────────────────────────────────
	a.emit("test:progress", "Connecting to production server...")
	prodClient, err := dialSSH(prod)
	if err != nil {
		return a.fail("test:error", "Prod SSH failed: %v", err)
	}
	defer prodClient.Close()

	a.emit("test:progress", "Dumping production database...")
	dumpCmd := fmt.Sprintf(
		"mysqldump -u %s -p%s %s --single-transaction | sed '/^.*999999.*sandbox/d' | gzip > %s",
		prod.DBUser, prod.DBPassword, prod.DBName, prodRemoteFile,
	)
	if err := runSSHCommand(prodClient, dumpCmd); err != nil {
		return a.fail("test:error", "Dump failed: %v", err)
	}

	// ── Step 2: Download to local ─────────────────────────────────────────────
	a.emit("test:progress", "Downloading dump locally...")
	prodSFTP, err := sftp.NewClient(prodClient)
	if err != nil {
		return a.fail("test:error", "Prod SFTP session failed: %v", err)
	}
	defer prodSFTP.Close()

	localPath, localFileName, err := localDumpPath(prod.DBName)
	if err != nil {
		return a.fail("test:error", "Could not resolve local path: %v", err)
	}

	if err := downloadFile(prodSFTP, prodRemoteFile, localPath); err != nil {
		return a.fail("test:error", "Download failed: %v", err)
	}
	a.emit("test:progress", fmt.Sprintf("Downloaded to ~/Downloads/%s", localFileName))

	// ── Step 3: Cleanup prod ──────────────────────────────────────────────────
	if err := runSSHCommand(prodClient, "rm "+prodRemoteFile); err != nil {
		a.emit("test:progress", fmt.Sprintf("Warning: prod cleanup failed: %v", err))
	}

	// ── Step 4: Upload to test server ─────────────────────────────────────────
	a.emit("test:progress", "Connecting to test server...")
	testClient, err := dialSSH(test)
	if err != nil {
		return a.fail("test:error", "Test SSH failed: %v", err)
	}
	defer testClient.Close()

	a.emit("test:progress", "Uploading dump to test server...")
	testSFTP, err := sftp.NewClient(testClient)
	if err != nil {
		return a.fail("test:error", "Test SFTP session failed: %v", err)
	}
	defer testSFTP.Close()

	if err := uploadFile(testSFTP, localPath, testRemoteFile, func(pct int) {
		a.emit("test:progress", fmt.Sprintf("Uploading... %d%%", pct))
	}); err != nil {
		return a.fail("test:error", "Upload failed: %v", err)
	}

	// ── Step 5: Import into test DB ───────────────────────────────────────────
	a.emit("test:progress", fmt.Sprintf("Importing into test database '%s'...", test.DBName))
	importCmd := fmt.Sprintf(
		"gunzip < %s | mysql -u %s -p%s %s",
		testRemoteFile, test.DBUser, test.DBPassword, test.DBName,
	)
	if err := runSSHCommand(testClient, importCmd); err != nil {
		return a.fail("test:error", "Import failed: %v", err)
	}

	// ── Step 6: Cleanup test server ───────────────────────────────────────────
	if err := runSSHCommand(testClient, "rm "+testRemoteFile); err != nil {
		a.emit("test:progress", fmt.Sprintf("Warning: test server cleanup failed: %v", err))
	}

	a.emit("test:done", fmt.Sprintf("Done! '%s' imported into test server '%s'", prod.DBName, test.DBName))
	return nil
}

// ── SyncAndImportLocal: prod → ~/Downloads → local MySQL ─────────────────────

func (a *App) SyncAndImportLocal() error {
	prod  := a.config.Production
	local := a.config.Local

	if prod.ServerIP == "" || prod.DBName == "" {
		return fmt.Errorf("production config is incomplete — please check Settings")
	}
	if local.DBName == "" {
		return fmt.Errorf("local database name is not configured — please check Settings")
	}

	remoteFile := fmt.Sprintf("/tmp/%s_dump.sql.gz", prod.DBName)

	// ── Step 1: Connect & dump ────────────────────────────────────────────────
	a.emit("pull:progress", "Connecting to production server...")
	client, err := dialSSH(prod)
	if err != nil {
		return a.fail("pull:error", "SSH connection failed: %v", err)
	}
	defer client.Close()

	a.emit("pull:progress", "Dumping database...")
	dumpCmd := fmt.Sprintf(
		"mysqldump -u %s -p%s %s --single-transaction | sed '/^.*999999.*sandbox/d' | gzip > %s",
		prod.DBUser, prod.DBPassword, prod.DBName, remoteFile,
	)
	if err := runSSHCommand(client, dumpCmd); err != nil {
		return a.fail("pull:error", "Dump failed: %v", err)
	}

	// ── Step 2: Download ──────────────────────────────────────────────────────
	a.emit("pull:progress", "Downloading dump...")
	sftpClient, err := sftp.NewClient(client)
	if err != nil {
		return a.fail("pull:error", "SFTP session failed: %v", err)
	}
	defer sftpClient.Close()

	localPath, localFileName, err := localDumpPath(prod.DBName)
	if err != nil {
		return a.fail("pull:error", "Could not resolve local path: %v", err)
	}
	if err := downloadFile(sftpClient, remoteFile, localPath); err != nil {
		return a.fail("pull:error", "Download failed: %v", err)
	}
	a.emit("pull:progress", fmt.Sprintf("Downloaded to ~/Downloads/%s", localFileName))

	// ── Step 3: Remote cleanup ────────────────────────────────────────────────
	if err := runSSHCommand(client, "rm "+remoteFile); err != nil {
		a.emit("pull:progress", fmt.Sprintf("Warning: remote cleanup failed: %v", err))
	}

	// ── Step 4: Import into local MySQL ───────────────────────────────────────
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

	shellCmd := fmt.Sprintf("gunzip < %q | %s %s", localPath, mysqlBin, strings.Join(args, " "))
	cmd := exec.Command("bash", "-c", shellCmd)
	if out, err := cmd.CombinedOutput(); err != nil {
		return a.fail("pull:error", "Import failed: %v — %s", err, string(out))
	}

	a.emit("pull:done", fmt.Sprintf("Done! Production imported into local '%s'", local.DBName))
	return nil
}

// ── Local Import ─────────────────────────────────────────────────────────────

// PickFile opens a native file dialog and returns the selected path.
func (a *App) PickFile() (string, error) {
	path, err := runtime.OpenFileDialog(a.ctx, runtime.OpenDialogOptions{
		Title: "Select SQL dump file",
		Filters: []runtime.FileFilter{
			{DisplayName: "SQL dumps (*.sql, *.sql.gz)", Pattern: "*.sql;*.sql.gz"},
			{DisplayName: "All files",                   Pattern: "*"},
		},
	})
	if err != nil {
		return "", err
	}
	return path, nil
}

// ImportLocal imports a .sql or .sql.gz file into the local MySQL database.
func (a *App) ImportLocal(filePath string) error {
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

	var cmd *exec.Cmd

	// Build the mysql args
	args := []string{"-u", local.DBUser}
	if local.DBPass != "" {
		args = append(args, "-p"+local.DBPass)
	}
	args = append(args, local.DBName)

	if strings.HasSuffix(filePath, ".gz") {
		// gunzip piped into mysql via shell
		shellCmd := fmt.Sprintf("gunzip < %q | %s %s",
			filePath, mysqlBin, strings.Join(args, " "))
		cmd = exec.Command("bash", "-c", shellCmd)
	} else {
		cmd = exec.Command(mysqlBin, args...)
		f, err := os.Open(filePath)
		if err != nil {
			return a.fail("import:error", "Could not open file: %v", err)
		}
		defer f.Close()
		cmd.Stdin = f
	}

	out, err := cmd.CombinedOutput()
	if err != nil {
		return a.fail("import:error", "Import failed: %v — %s", err, string(out))
	}

	a.emit("import:done", fmt.Sprintf("Done! '%s' imported into local database '%s'", filepath.Base(filePath), local.DBName))
	return nil
}

// ── Helpers ───────────────────────────────────────────────────────────────────
// fail emits an error event and returns a formatted error.
func (a *App) fail(event, format string, args ...any) error {
	msg := fmt.Sprintf(format, args...)
	a.emit(event, msg)
	return fmt.Errorf(msg)
}

// localDumpPath returns a timestamped path inside ~/Downloads.
func localDumpPath(dbName string) (fullPath, fileName string, err error) {
	home, err := os.UserHomeDir()
	if err != nil {
		return "", "", err
	}
	fileName = fmt.Sprintf("%s_%s_dump.sql.gz", dbName, time.Now().Format("2006-01-02_150405"))
	fullPath = filepath.Join(home, "Downloads", fileName)
	return fullPath, fileName, nil
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

func downloadFile(sftpClient *sftp.Client, remotePath, localPath string) error {
	remote, err := sftpClient.Open(remotePath)
	if err != nil {
		return fmt.Errorf("could not open remote file: %w", err)
	}
	defer remote.Close()

	local, err := os.Create(localPath)
	if err != nil {
		return fmt.Errorf("could not create local file: %w", err)
	}
	defer local.Close()

	_, err = io.Copy(local, remote)
	return err
}

func uploadFile(sftpClient *sftp.Client, localPath, remotePath string, onProgress func(pct int)) error {
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
		r:          local,
		total:      info.Size(),
		onProgress: onProgress,
	})
	return err
}

type progressReader struct {
	r          io.Reader
	total      int64
	read       int64
	lastReport int64
	onProgress func(pct int)
}

func (p *progressReader) Read(buf []byte) (int, error) {
	n, err := p.r.Read(buf)
	p.read += int64(n)
	// Report every 5 MB to avoid flooding
	if p.onProgress != nil && p.read-p.lastReport >= 5*1024*1024 {
		p.lastReport = p.read
		pct := int(float64(p.read) / float64(p.total) * 100)
		p.onProgress(pct)
	}
	return n, err
}
