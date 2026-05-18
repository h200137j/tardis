package main

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
	"time"

	pgzip "github.com/klauspost/pgzip"
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
	MySQLBin        string   `json:"mysql_bin"`
	DBName          string   `json:"db_name"`
	DBUser          string   `json:"db_user"`
	DBPass          string   `json:"db_pass"`
	SaveDump   bool     `json:"save_dump"`
	SkipTables []string `json:"skip_tables"`
}

// Project groups production/test/local configs under a user-defined name.
type Project struct {
	ID         string       `json:"id"`
	Name       string       `json:"name"`
	Production ServerConfig `json:"production"`
	Test       ServerConfig `json:"test"`
	Local      LocalConfig  `json:"local"`
}

// Config is the top-level config persisted to disk.
type Config struct {
	Projects        []Project `json:"projects"`
	ActiveProjectID string    `json:"active_project_id"`
}

// TransferProgress is emitted during uploads and downloads.
type TransferProgress struct {
	Bytes int64 `json:"bytes"`
	Total int64 `json:"total"`
}

// App is the main Wails application struct.
type App struct {
	ctx          context.Context
	config       Config
	mobileServer *MobileServer

	cancelMu sync.Mutex
	cancelFn context.CancelFunc
}

func NewApp() *App { return &App{} }

func (a *App) startup(ctx context.Context) {
	a.ctx = ctx
	if err := a.loadConfig(); err != nil {
		p := Project{
			ID:         "default",
			Name:       "Default",
			Production: ServerConfig{},
			Test:       ServerConfig{},
			Local:      LocalConfig{MySQLBin: "/opt/lampp/bin/mysql", DBUser: "root"},
		}
		a.config = Config{Projects: []Project{p}, ActiveProjectID: "default"}
	}
	a.mobileServer = newMobileServer(a)
	a.mobileServer.Start()
}

// ── Version & Updates ─────────────────────────────────────────────────────────

func (a *App) GetVersion() string { return version }

// UpdateInfo is returned by CheckForUpdate.
type UpdateInfo struct {
	HasUpdate  bool   `json:"has_update"`
	Latest     string `json:"latest"`
	Current    string `json:"current"`
	DownloadURL string `json:"download_url"`
}

func (a *App) CheckForUpdate() UpdateInfo {
	current := version
	info := UpdateInfo{Current: current}

	client := &http.Client{Timeout: 8 * time.Second}
	req, err := http.NewRequest("GET", "https://api.github.com/repos/h200137j/tardis/releases/latest", nil)
	if err != nil {
		return info
	}
	req.Header.Set("Accept", "application/vnd.github+json")
	resp, err := client.Do(req)
	if err != nil || resp.StatusCode != 200 {
		return info
	}
	defer resp.Body.Close()

	var release struct {
		TagName string `json:"tag_name"`
		Assets  []struct {
			Name               string `json:"name"`
			BrowserDownloadURL string `json:"browser_download_url"`
		} `json:"assets"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&release); err != nil {
		return info
	}

	info.Latest = release.TagName
	// find .deb asset
	for _, a := range release.Assets {
		if strings.HasSuffix(a.Name, ".deb") {
			info.DownloadURL = a.BrowserDownloadURL
			break
		}
	}
	if info.DownloadURL == "" {
		// fallback to release page
		info.DownloadURL = "https://github.com/h200137j/tardis/releases/latest"
	}

	// compare: strip leading 'v' for comparison
	latest  := strings.TrimPrefix(release.TagName, "v")
	cur     := strings.TrimPrefix(current, "v")
	info.HasUpdate = latest != "" && cur != "dev" && latest != cur
	return info
}

// OpenURL opens a URL in the default browser.
func (a *App) OpenURL(url string) {
	exec.Command("xdg-open", url).Start()
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
	if err := json.Unmarshal(data, &a.config); err != nil {
		return err
	}
	// Migrate old flat format (production/test/local at top level) → project list
	if len(a.config.Projects) == 0 {
		var old struct {
			Production ServerConfig `json:"production"`
			Test       ServerConfig `json:"test"`
			Local      LocalConfig  `json:"local"`
		}
		if json.Unmarshal(data, &old) == nil {
			p := Project{
				ID:         "default",
				Name:       "Default",
				Production: old.Production,
				Test:       old.Test,
				Local:      old.Local,
			}
			a.config.Projects = []Project{p}
			a.config.ActiveProjectID = "default"
		}
	}
	if a.config.ActiveProjectID == "" && len(a.config.Projects) > 0 {
		a.config.ActiveProjectID = a.config.Projects[0].ID
	}
	return nil
}

func (a *App) GetConfig() Config { return a.config }

func (a *App) persistConfig() error {
	path, err := configPath()
	if err != nil {
		return fmt.Errorf("could not resolve config path: %w", err)
	}
	if err := os.MkdirAll(filepath.Dir(path), 0700); err != nil {
		return fmt.Errorf("could not create config directory: %w", err)
	}
	data, err := json.MarshalIndent(a.config, "", "  ")
	if err != nil {
		return fmt.Errorf("could not marshal config: %w", err)
	}
	if err := os.WriteFile(path, data, 0600); err != nil {
		return fmt.Errorf("could not write config file: %w", err)
	}
	return nil
}

func (a *App) SaveConfig(cfg Config) error {
	a.config = cfg
	return a.persistConfig()
}

// SetActiveProject switches the active project and persists to disk.
func (a *App) SetActiveProject(id string) error {
	for _, p := range a.config.Projects {
		if p.ID == id {
			a.config.ActiveProjectID = id
			return a.persistConfig()
		}
	}
	return fmt.Errorf("project not found: %s", id)
}

// activeProject returns the currently active project, falling back to the first.
func (a *App) activeProject() Project {
	for _, p := range a.config.Projects {
		if p.ID == a.config.ActiveProjectID {
			return p
		}
	}
	if len(a.config.Projects) > 0 {
		return a.config.Projects[0]
	}
	return Project{}
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

// opFromEvent maps event prefixes to op names for mobile broadcast.
func opFromEvent(event string) string {
	switch {
	case strings.HasPrefix(event, "sync:"):
		return "sync"
	case strings.HasPrefix(event, "test:"):
		return "test"
	case strings.HasPrefix(event, "pull:"):
		return "pull"
	case strings.HasPrefix(event, "import:"):
		return "import"
	}
	return ""
}

// levelFromEvent maps event suffixes to log levels.
func levelFromEvent(event string) string {
	switch {
	case strings.HasSuffix(event, ":done"):
		return "success"
	case strings.HasSuffix(event, ":error"):
		return "error"
	case strings.HasSuffix(event, ":cancelled"):
		return "warning"
	}
	return "info"
}

func (a *App) emit(event string, data any) {
	runtime.EventsEmit(a.ctx, event, data)
	// Mirror log events to mobile clients
	if a.mobileServer != nil {
		if msg, ok := data.(string); ok {
			a.mobileServer.BroadcastLog(opFromEvent(event), msg, levelFromEvent(event))
		}
	}
}

func (a *App) emitTransfer(event string, tp TransferProgress) {
	runtime.EventsEmit(a.ctx, event, tp)
	if a.mobileServer != nil {
		a.mobileServer.BroadcastProgress(opFromEvent(event), tp.Bytes, tp.Total)
	}
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

// runSSHCommandOutput runs cmd and returns its combined stdout+stderr as a string.
func runSSHCommandOutput(client *ssh.Client, cmd string) (string, error) {
	session, err := client.NewSession()
	if err != nil {
		return "", fmt.Errorf("could not open SSH session: %w", err)
	}
	defer session.Close()
	out, err := session.CombinedOutput(cmd)
	if err != nil {
		return "", fmt.Errorf("command error: %w — output: %s", err, string(out))
	}
	return string(out), nil
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

	// WriteTo uses concurrent SFTP read requests internally — much faster than io.Copy on high-latency links.
	// Wrap the local file in a progress writer so we still get byte tracking.
	pw := &progressWriter{w: local, total: info.Size(), onBytes: onBytes, ctx: ctx}
	_, err = remote.WriteTo(pw)
	if err != nil && ctx.Err() != nil {
		return ctx.Err()
	}
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

type progressWriter struct {
	w          io.Writer
	total      int64
	written    int64
	lastReport int64
	onBytes    func(bytes, total int64)
	ctx        context.Context
}

func (p *progressWriter) Write(buf []byte) (int, error) {
	if p.ctx.Err() != nil {
		return 0, p.ctx.Err()
	}
	n, err := p.w.Write(buf)
	p.written += int64(n)
	if p.onBytes != nil && p.written-p.lastReport >= 256*1024 {
		p.lastReport = p.written
		p.onBytes(p.written, p.total)
	}
	return n, err
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

// ImportProgress is emitted during local MySQL imports.
type ImportProgress struct {
	Table   string `json:"table"`
	Current int    `json:"current"`
	Total   int    `json:"total"`
}

// extractTableName returns the backtick-quoted name from a mysqldump comment line.
func extractTableName(s string) string {
	i := strings.Index(s, "`")
	if i < 0 {
		return ""
	}
	j := strings.Index(s[i+1:], "`")
	if j < 0 {
		return ""
	}
	return s[i+1 : i+1+j]
}

// streamingImport decompresses filePath and pipes it into mysql.
// skipTables lists table names to exclude from the import.
// onTable fires once per detected table (for log messages).
// onBytes fires every 256 KB of compressed input read (for the progress bar).
func streamingImport(ctx context.Context, filePath, mysqlBin string, args []string, skipTables []string, onTable func(ImportProgress), onBytes func(int64, int64)) error {
	// ── 1. Validate binary path early so the error is actionable ──────────
	resolvedBin, err := exec.LookPath(mysqlBin)
	if err != nil {
		return fmt.Errorf("mysql binary not found at %q — check Settings > MySQL Binary Path", mysqlBin)
	}

	// ── 2. Extract auth flags before modifying args (reused for global cmds) ─
	var authArgs []string
	for i, a := range args {
		if a == "-u" && i+1 < len(args) {
			authArgs = append(authArgs, "-u", args[i+1])
		} else if strings.HasPrefix(a, "-p") && a != "-p" {
			authArgs = append(authArgs, a)
		}
	}

	// ── 3. Raise server limits + disable InnoDB redo sync ─────────────────
	globalSQL := "SET GLOBAL max_allowed_packet=536870912; SET GLOBAL wait_timeout=28800; SET GLOBAL interactive_timeout=28800; SET GLOBAL innodb_flush_log_at_trx_commit=0;"
	exec.CommandContext(ctx, resolvedBin, append(authArgs, "-e", globalSQL)...).Run() // best-effort

	// ── 4. Always restore innodb_flush_log_at_trx_commit on exit ──────────
	defer exec.Command(resolvedBin, append(authArgs, "-e", "SET GLOBAL innodb_flush_log_at_trx_commit=1;")...).Run()

	// ── 5. Session-level speed flags ──────────────────────────────────────
	args = append([]string{
		"--init-command=SET SESSION foreign_key_checks=0; SET SESSION unique_checks=0; SET SESSION sql_log_bin=0;",
	}, args...)

	// ── 6. Open file; wrap in progress reader for real % bar ──────────────
	f, err := os.Open(filePath)
	if err != nil {
		return fmt.Errorf("could not open file: %w", err)
	}
	defer f.Close()

	var r io.Reader = f
	if onBytes != nil {
		if fi, statErr := f.Stat(); statErr == nil && fi.Size() > 0 {
			r = &progressReader{r: f, total: fi.Size(), onBytes: onBytes}
		}
	}

	if strings.HasSuffix(filePath, ".gz") {
		gz, err := pgzip.NewReader(r)
		if err != nil {
			return fmt.Errorf("could not decompress file: %w", err)
		}
		defer gz.Close()
		r = gz
	}

	// ── 7. Spawn mysql; capture stderr for useful error messages ──────────
	cmd := exec.CommandContext(ctx, resolvedBin, args...)
	stdin, err := cmd.StdinPipe()
	if err != nil {
		return fmt.Errorf("could not open mysql stdin: %w", err)
	}
	var stderrBuf bytes.Buffer
	cmd.Stderr = &stderrBuf

	if err := cmd.Start(); err != nil {
		return fmt.Errorf("could not start mysql: %w", err)
	}

	// ── 8. 32 MB write buffer; wrap entire import in one transaction ───────
	bw := bufio.NewWriterSize(stdin, 32*1024*1024)
	bw.WriteString("SET autocommit=0;\n")

	skipSet := make(map[string]bool, len(skipTables))
	for _, t := range skipTables {
		if s := strings.TrimSpace(t); s != "" {
			skipSet[s] = true
		}
	}
	skipping := false

	current := 0
	scanner := bufio.NewScanner(r)
	scanner.Buffer(make([]byte, 8*1024*1024), 8*1024*1024)

	for scanner.Scan() {
		if ctx.Err() != nil {
			stdin.Close()
			cmd.Wait()
			return ctx.Err()
		}

		line := scanner.Bytes()

		// Only allocate a string on comment lines to detect table boundaries
		if len(line) > 28 && line[0] == '-' && line[1] == '-' {
			isStructure := bytes.HasPrefix(line, []byte("-- Table structure for table"))
			isData := bytes.HasPrefix(line, []byte("-- Dumping data for table"))
			if isStructure || isData {
				tableName := extractTableName(string(line))
				skipping = skipSet[tableName]
				if isStructure && !skipping {
					current++
					if onTable != nil {
						onTable(ImportProgress{Table: tableName, Current: current})
					}
				}
			}
		}

		if !skipping {
			bw.Write(line)
			bw.WriteByte('\n')
		}
	}

	if err := scanner.Err(); err != nil {
		stdin.Close()
		cmd.Wait()
		return fmt.Errorf("read error: %w", err)
	}

	// ── 9. Commit, flush, close ────────────────────────────────────────────
	bw.WriteString("COMMIT;\n")
	bw.Flush()
	stdin.Close()

	if err := cmd.Wait(); err != nil {
		if ctx.Err() != nil {
			return ctx.Err()
		}
		if msg := strings.TrimSpace(stderrBuf.String()); msg != "" {
			return fmt.Errorf("mysql: %s", msg)
		}
		return fmt.Errorf("mysql exited with error: %w", err)
	}
	return nil
}


// ── SyncDatabase: prod → ~/Downloads ─────────────────────────────────────────

func (a *App) SyncDatabase() error {
	ctx := a.newOpCtx()
	prod := a.activeProject().Production

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
	sftpClient, err := sftp.NewClient(client, sftp.MaxConcurrentRequestsPerFile(200))
	if err != nil {
		return a.fail("sync:error", "sync:progress", "SFTP session failed: %v", err)
	}
	defer sftpClient.Close()

	localPath, localFileName, err := localDumpPath(prod.DBName)
	if err != nil {
		return a.fail("sync:error", "sync:progress", "Could not resolve local path: %v", err)
	}

	if err := downloadFile(ctx, sftpClient, remoteFile, localPath, func(bytes, total int64) {
		a.emitTransfer("sync:transfer", TransferProgress{Bytes: bytes, Total: total})
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

// ── SyncToTest: test server SSHes into prod over LAN and pipes directly ─────────
//
// Data path: prod (mysqldump|gzip) ──LAN──▶ test (gunzip|mysql)
// The local machine only orchestrates — no data touches it.
// A small shell script is written to the test server to avoid nested-quote hell.

func (a *App) SyncToTest() error {
	ctx := a.newOpCtx()
	proj := a.activeProject()
	prod := proj.Production
	test := proj.Test

	if prod.ServerIP == "" || prod.DBName == "" {
		return fmt.Errorf("production config is incomplete — please check Settings")
	}
	if test.ServerIP == "" || test.DBName == "" {
		return fmt.Errorf("test server config is incomplete — please check Settings")
	}

	stamp := time.Now().UnixNano()
	tmpKey    := fmt.Sprintf("/tmp/.tardis_pk_%d",     stamp)
	tmpScript := fmt.Sprintf("/tmp/.tardis_sync_%d.sh", stamp)

	// ── Step 1: Connect to test server and upload credentials ────────────────
	a.emit("test:progress", "Connecting to test server...")
	testClient, err := dialSSH(test)
	if err != nil {
		return a.fail("test:error", "test:progress", "Test SSH failed: %v", err)
	}
	defer testClient.Close()

	if ctx.Err() != nil {
		a.emit("test:cancelled", "Operation cancelled.")
		return nil
	}

	testSFTP, err := sftp.NewClient(testClient)
	if err != nil {
		return a.fail("test:error", "test:progress", "Test SFTP failed: %v", err)
	}

	// Build the inner SSH leg: test server → production
	// Key auth: upload the private key temporarily to the test server.
	// Password auth: rely on sshpass (must be installed on test server).
	var innerSSH string
	if prod.PrivateKey != "" {
		keyPath := prod.PrivateKey
		if len(keyPath) > 1 && keyPath[:2] == "~/" {
			home, _ := os.UserHomeDir()
			keyPath = filepath.Join(home, keyPath[2:])
		}
		keyData, err := os.ReadFile(keyPath)
		if err != nil {
			testSFTP.Close()
			return a.fail("test:error", "test:progress", "Could not read private key: %v", err)
		}
		a.emit("test:progress", "Uploading SSH key to test server...")
		kf, err := testSFTP.Create(tmpKey)
		if err != nil {
			testSFTP.Close()
			return a.fail("test:error", "test:progress", "Could not create temp key on test: %v", err)
		}
		kf.Chmod(0600)
		kf.Write(keyData)
		kf.Close()
		defer runSSHCommandBestEffort(test, "rm -f "+tmpKey)

		innerSSH = fmt.Sprintf(
			"ssh -i %s -o StrictHostKeyChecking=no -o BatchMode=yes %s@%s",
			tmpKey, prod.SSHUser, prod.ServerIP,
		)
	} else {
		// Password auth — generate a throwaway keypair on the test server,
		// authorize it on prod (TARDIS has prod's password), use it, then clean up.
		// No sshpass or extra software needed.
		a.emit("test:progress", "Setting up temporary SSH key (test → prod)...")

		// 1. Generate a temp ed25519 key on the test server
		genCmd := fmt.Sprintf("ssh-keygen -t ed25519 -N '' -f %s -C tardis_temp_sync", tmpKey)
		if err := runSSHCommand(testClient, genCmd); err != nil {
			testSFTP.Close()
			return a.fail("test:error", "test:progress", "Could not generate temp key on test: %v", err)
		}
		defer runSSHCommandBestEffort(test, fmt.Sprintf("rm -f %s %s.pub", tmpKey, tmpKey))

		// 2. Read the public key back from the test server
		pubKey, err := runSSHCommandOutput(testClient, "cat "+tmpKey+".pub")
		if err != nil {
			testSFTP.Close()
			return a.fail("test:error", "test:progress", "Could not read temp public key: %v", err)
		}

		// 3. Connect to prod and authorize the temp public key
		prodClient, err := dialSSH(prod)
		if err != nil {
			testSFTP.Close()
			return a.fail("test:error", "test:progress", "Prod SSH failed: %v", err)
		}
		defer prodClient.Close()
		authorizeCmd := fmt.Sprintf(
			"mkdir -p ~/.ssh && chmod 700 ~/.ssh && echo %s >> ~/.ssh/authorized_keys",
			shellescape(strings.TrimSpace(pubKey)),
		)
		if err := runSSHCommand(prodClient, authorizeCmd); err != nil {
			testSFTP.Close()
			return a.fail("test:error", "test:progress", "Could not authorize temp key on prod: %v", err)
		}
		// Always clean up the temp key from prod's authorized_keys
		defer runSSHCommandBestEffort(prod, "sed -i '/tardis_temp_sync/d' ~/.ssh/authorized_keys")

		innerSSH = fmt.Sprintf(
			"ssh -i %s -o StrictHostKeyChecking=no -o BatchMode=yes %s@%s",
			tmpKey, prod.SSHUser, prod.ServerIP,
		)
	}

	// Build the remote dump command (runs on production via the inner SSH)
	dbPassFlag := ""
	if prod.DBPassword != "" {
		dbPassFlag = "-p" + prod.DBPassword
	}
	remoteDump := fmt.Sprintf(
		"mysqldump -u %s %s %s --single-transaction --quick --no-tablespaces --skip-add-locks | sed '/^.*999999.*sandbox/d' | gzip",
		prod.DBUser, dbPassFlag, prod.DBName,
	)

	// Build the local import command (runs on test server)
	testPassFlag := ""
	if test.DBPassword != "" {
		testPassFlag = "-p" + test.DBPassword
	}

	// Write a shell script to the test server to avoid nested-SSH quoting problems.
	// The script: SSH into prod, stream dump, pipe straight into mysql — LAN only.
	// Uses bash + pipefail so a failure anywhere in the pipe (SSH auth, mysqldump)
	// is NOT silently swallowed by mysql exiting 0 on empty input.
	script := fmt.Sprintf(
		"#!/bin/bash\nset -euo pipefail\n%s %s | gunzip | sed -e 's|/\\*!50017 DEFINER=`[^`]*`@`[^`]*`\\*/ ||g' -e 's|DEFINER=`[^`]*`@`[^`]*`||g' | mysql -u %s %s %s\n",
		innerSSH,
		shellescape(remoteDump),
		test.DBUser,
		testPassFlag,
		test.DBName,
	)

	sf, err := testSFTP.Create(tmpScript)
	if err != nil {
		testSFTP.Close()
		return a.fail("test:error", "test:progress", "Could not write sync script: %v", err)
	}
	sf.Chmod(0700)
	sf.Write([]byte(script))
	sf.Close()
	testSFTP.Close()
	defer runSSHCommandBestEffort(test, "rm -f "+tmpScript)

	// ── Step 2: Run the script — data flows prod → test entirely over LAN ────
	a.emit("test:progress", fmt.Sprintf(
		"Streaming %s → %s directly over LAN (no local machine involved)...",
		prod.ServerIP, test.ServerIP,
	))

	errCh := make(chan error, 1)
	go func() { errCh <- runSSHCommand(testClient, "/bin/sh "+tmpScript) }()

	select {
	case err := <-errCh:
		if err != nil {
			return a.fail("test:error", "test:progress", "Sync failed: %v", err)
		}
	case <-ctx.Done():
		testClient.Close() // force-abort the blocking SSH session
		a.emit("test:cancelled", "Operation cancelled.")
		return nil
	}

	a.emit("test:done", fmt.Sprintf(
		"Done! '%s' streamed from %s into test '%s' — LAN speed, zero local data.",
		prod.DBName, prod.ServerIP, test.DBName,
	))
	return nil
}

// shellescape wraps s in single quotes and escapes any embedded single quotes,
// making it safe to interpolate into a POSIX shell command.
func shellescape(s string) string {
	return "'" + strings.ReplaceAll(s, "'", `'\''`) + "'"
}

// ── SyncAndImportLocal: prod → ~/Downloads → local MySQL ─────────────────────

func (a *App) SyncAndImportLocal() error {
	ctx := a.newOpCtx()
	proj := a.activeProject()
	prod := proj.Production
	local := proj.Local

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
			if !local.SaveDump {
				cleanupLocal(localPath)
			}
			a.emit("pull:cancelled", "Operation cancelled.")
		}
	}()

	a.emit("pull:progress", "Connecting to production server...")
	client, err := dialSSH(prod)
	if err != nil {
		return a.fail("pull:error", "pull:progress", "SSH connection failed: %v", err)
	}
	defer client.Close()

	a.emit("pull:phase", "dumping")
	a.emit("pull:progress", "Dumping database on server...")

	var skipFlags string
	for _, t := range local.SkipTables {
		if s := strings.TrimSpace(t); s != "" {
			skipFlags += fmt.Sprintf(" --ignore-table=%s.%s", prod.DBName, s)
		}
	}
	dumpCmd := fmt.Sprintf(
		"mysqldump -u %s -p%s %s --single-transaction --quick --no-tablespaces --skip-add-locks%s | sed '/^.*999999.*sandbox/d' | gzip > %s",
		prod.DBUser, prod.DBPassword, prod.DBName, skipFlags, remoteFile,
	)

	if err := runSSHCommand(client, dumpCmd); err != nil {
		return a.fail("pull:error", "pull:progress", "Dump failed: %v", err)
	}
	if ctx.Err() != nil {
		return nil
	}

	a.emit("pull:phase", "downloading")
	a.emit("pull:progress", "Downloading dump...")
	sftpClient, err := sftp.NewClient(client, sftp.MaxConcurrentRequestsPerFile(200))
	if err != nil {
		return a.fail("pull:error", "pull:progress", "SFTP session failed: %v", err)
	}
	defer sftpClient.Close()

	localPath, localFileName, err := localDumpPath(prod.DBName)
	if err != nil {
		return a.fail("pull:error", "pull:progress", "Could not resolve local path: %v", err)
	}

	if err := downloadFile(ctx, sftpClient, remoteFile, localPath, func(bytes, total int64) {
		a.emitTransfer("pull:transfer", TransferProgress{Bytes: bytes, Total: total})
	}); err != nil {
		if ctx.Err() != nil {
			return nil
		}
		return a.fail("pull:error", "pull:progress", "Download failed: %v", err)
	}
	a.emit("pull:progress", fmt.Sprintf("Downloaded to ~/Downloads/%s", localFileName))
	runSSHCommand(client, "rm -f "+remoteFile)

	if ctx.Err() != nil {
		return nil
	}

	a.emit("pull:phase", "importing")
	a.emit("pull:progress", fmt.Sprintf("Importing into local database '%s'...", local.DBName))

	mysqlBin := local.MySQLBin
	if mysqlBin == "" {
		mysqlBin = "mysql"
	}
	mysqlArgs := []string{"-u", local.DBUser}
	if local.DBPass != "" {
		mysqlArgs = append(mysqlArgs, "-p"+local.DBPass)
	}
	mysqlArgs = append(mysqlArgs, local.DBName)

	if err := streamingImport(ctx, localPath, mysqlBin, mysqlArgs, local.SkipTables,
		func(p ImportProgress) {
			a.emit("pull:progress", fmt.Sprintf("Importing table %s (%d)...", p.Table, p.Current))
		},
		func(read, total int64) {
			a.emitTransfer("pull:transfer", TransferProgress{Bytes: read, Total: total})
		},
	); err != nil {
		if ctx.Err() != nil {
			return nil
		}
		return a.fail("pull:error", "pull:progress", "Import failed: %v", err)
	}

	// clean up local dump unless user wants to keep it
	if !local.SaveDump {
		cleanupLocal(localPath)
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
	local := a.activeProject().Local

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

	if err := streamingImport(ctx, filePath, mysqlBin, args, local.SkipTables,
		func(p ImportProgress) {
			a.emit("import:progress", fmt.Sprintf("Importing table %s (%d)...", p.Table, p.Current))
		},
		func(read, total int64) {
			a.emitTransfer("import:transfer", TransferProgress{Bytes: read, Total: total})
		},
	); err != nil {
		if ctx.Err() != nil {
			a.emit("import:cancelled", "Import cancelled.")
			return nil
		}
		return a.fail("import:error", "import:progress", "Import failed: %v", err)
	}

	a.emit("import:done", fmt.Sprintf("Done! '%s' imported into '%s'", filepath.Base(filePath), local.DBName))
	return nil
}
