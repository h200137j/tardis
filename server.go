package main

import (
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"net"
	"net/http"
	"strings"
	"sync"
	"time"

	qrcode "github.com/skip2/go-qrcode"
)

const mobilePort = 7438

// MobileServer runs a local HTTP server for the mobile companion app.
type MobileServer struct {
	app      *App
	token    string
	mu       sync.RWMutex
	clients  map[chan string]struct{}
	clientMu sync.Mutex
}

func newMobileServer(app *App) *MobileServer {
	return &MobileServer{
		app:     app,
		clients: make(map[chan string]struct{}),
	}
}

// generateToken creates a short random token for auth.
func generateToken() string {
	b := make([]byte, 9)
	rand.Read(b)
	return base64.RawURLEncoding.EncodeToString(b)
}

// Start launches the HTTP server and returns the token.
func (ms *MobileServer) Start() error {
	ms.mu.Lock()
	if ms.token == "" {
		ms.token = generateToken()
	}
	ms.mu.Unlock()

	mux := http.NewServeMux()
	mux.HandleFunc("/", ms.handleMobileApp)
	mux.HandleFunc("/api/status", ms.withAuth(ms.handleStatus))
	mux.HandleFunc("/api/trigger", ms.withAuth(ms.handleTrigger))
	mux.HandleFunc("/api/cancel", ms.withAuth(ms.handleCancel))
	mux.HandleFunc("/api/events", ms.withAuth(ms.handleSSE))

	srv := &http.Server{
		Addr:    fmt.Sprintf(":%d", mobilePort),
		Handler: mux,
	}

	go srv.ListenAndServe()
	return nil
}

// BroadcastLog sends a log line to all connected SSE clients.
func (ms *MobileServer) BroadcastLog(op, msg, level string) {
	data, _ := json.Marshal(map[string]string{"op": op, "msg": msg, "level": level})
	ms.clientMu.Lock()
	defer ms.clientMu.Unlock()
	for ch := range ms.clients {
		select {
		case ch <- string(data):
		default:
		}
	}
}

// BroadcastProgress sends a progress update to all SSE clients.
func (ms *MobileServer) BroadcastProgress(op string, bytes, total int64) {
	data, _ := json.Marshal(map[string]interface{}{"op": op, "bytes": bytes, "total": total, "type": "progress"})
	ms.clientMu.Lock()
	defer ms.clientMu.Unlock()
	for ch := range ms.clients {
		select {
		case ch <- string(data):
		default:
		}
	}
}

func (ms *MobileServer) withAuth(h http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		ms.mu.RLock()
		tok := ms.token
		ms.mu.RUnlock()
		if r.URL.Query().Get("token") != tok {
			http.Error(w, "unauthorized", http.StatusUnauthorized)
			return
		}
		h(w, r)
	}
}

func (ms *MobileServer) handleStatus(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{"status": "ok", "version": version})
}

func (ms *MobileServer) handleTrigger(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	var body struct {
		Op string `json:"op"`
	}
	json.NewDecoder(r.Body).Decode(&body)

	go func() {
		switch body.Op {
		case "pull":
			ms.app.SyncAndImportLocal()
		case "sync":
			ms.app.SyncDatabase()
		case "test":
			ms.app.SyncToTest()
		}
	}()

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{"ok": "true", "op": body.Op})
}

func (ms *MobileServer) handleCancel(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	ms.app.Cancel()
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{"ok": "true"})
}

func (ms *MobileServer) handleSSE(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")
	w.Header().Set("Access-Control-Allow-Origin", "*")

	ch := make(chan string, 32)
	ms.clientMu.Lock()
	ms.clients[ch] = struct{}{}
	ms.clientMu.Unlock()

	defer func() {
		ms.clientMu.Lock()
		delete(ms.clients, ch)
		ms.clientMu.Unlock()
	}()

	flusher, ok := w.(http.Flusher)
	if !ok {
		http.Error(w, "streaming not supported", http.StatusInternalServerError)
		return
	}

	ticker := time.NewTicker(15 * time.Second)
	defer ticker.Stop()

	for {
		select {
		case <-r.Context().Done():
			return
		case msg := <-ch:
			fmt.Fprintf(w, "data: %s\n\n", msg)
			flusher.Flush()
		case <-ticker.C:
			fmt.Fprintf(w, ": ping\n\n")
			flusher.Flush()
		}
	}
}

// handleMobileApp serves the mobile PWA HTML.
func (ms *MobileServer) handleMobileApp(w http.ResponseWriter, r *http.Request) {
	ms.mu.RLock()
	tok := ms.token
	ms.mu.RUnlock()
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.Write([]byte(strings.ReplaceAll(mobileAppHTML, "{{TOKEN}}", tok)))
}

// GetMobileQR returns a base64-encoded PNG QR code for the mobile URL.
func (a *App) GetMobileQR() (string, error) {
	ip, err := localIP()
	if err != nil {
		return "", fmt.Errorf("could not detect local IP: %w", err)
	}
	a.mobileServer.mu.RLock()
	tok := a.mobileServer.token
	a.mobileServer.mu.RUnlock()

	url := fmt.Sprintf("http://%s:%d/?token=%s", ip, mobilePort, tok)
	png, err := qrcode.Encode(url, qrcode.Medium, 256)
	if err != nil {
		return "", err
	}
	return "data:image/png;base64," + base64.StdEncoding.EncodeToString(png), nil
}

// GetMobileURL returns the plain URL for display.
func (a *App) GetMobileURL() (string, error) {
	ip, err := localIP()
	if err != nil {
		return "", fmt.Errorf("could not detect local IP: %w", err)
	}
	a.mobileServer.mu.RLock()
	tok := a.mobileServer.token
	a.mobileServer.mu.RUnlock()
	return fmt.Sprintf("http://%s:%d/?token=%s", ip, mobilePort, tok), nil
}

func localIP() (string, error) {
	ifaces, err := net.Interfaces()
	if err != nil {
		return "", err
	}
	for _, iface := range ifaces {
		if iface.Flags&net.FlagUp == 0 || iface.Flags&net.FlagLoopback != 0 {
			continue
		}
		addrs, _ := iface.Addrs()
		for _, addr := range addrs {
			var ip net.IP
			switch v := addr.(type) {
			case *net.IPNet:
				ip = v.IP
			case *net.IPAddr:
				ip = v.IP
			}
			if ip == nil || ip.IsLoopback() {
				continue
			}
			if ip4 := ip.To4(); ip4 != nil {
				return ip4.String(), nil
			}
		}
	}
	return "127.0.0.1", nil
}

const mobileAppHTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
<meta name="theme-color" content="#0d1117">
<title>TARDIS Remote</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
:root{
  --bg:#0d1117;--surface:#161b22;--surface2:#1c2333;--border:#30363d;
  --accent:#4db8ff;--accent2:#7c3aed;--green:#3fb950;--red:#f85149;
  --text:#e6edf3;--muted:#8b949e;--radius:12px;
}
body{background:var(--bg);color:var(--text);font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;min-height:100dvh;display:flex;flex-direction:column}
header{padding:20px 20px 0;display:flex;align-items:center;gap:10px}
.logo{font-size:28px}
.brand{display:flex;flex-direction:column}
.brand-name{font-size:18px;font-weight:700;letter-spacing:.05em}
.brand-sub{font-size:11px;color:var(--muted)}
main{flex:1;padding:20px;display:flex;flex-direction:column;gap:16px}
.card{background:var(--surface);border:1px solid var(--border);border-radius:var(--radius);padding:18px;display:flex;flex-direction:column;gap:12px}
.card-title{font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.08em;color:var(--muted)}
.ops{display:flex;flex-direction:column;gap:10px}
.op-btn{display:flex;align-items:center;gap:14px;background:var(--surface2);border:1px solid var(--border);border-radius:10px;padding:14px 16px;color:var(--text);font-size:15px;font-weight:600;cursor:pointer;transition:all .15s;text-align:left;width:100%}
.op-btn:active{transform:scale(.97)}
.op-btn.primary{border-color:var(--accent);background:rgba(77,184,255,.08)}
.op-btn.purple{border-color:var(--accent2);background:rgba(124,58,237,.08)}
.op-btn:disabled{opacity:.45;cursor:not-allowed;transform:none}
.cancel-btn{background:rgba(248,81,73,.1);border:1px solid var(--red);border-radius:10px;color:var(--red);font-size:14px;font-weight:600;padding:12px;cursor:pointer;display:none;width:100%}
.cancel-btn.visible{display:block}
.status-row{display:flex;align-items:center;gap:8px;font-size:13px;color:var(--muted)}
.dot{width:8px;height:8px;border-radius:50%;background:var(--muted);flex-shrink:0;transition:background .3s}
.dot.running{background:var(--accent);box-shadow:0 0 6px var(--accent);animation:pulse 1s infinite}
.dot.done{background:var(--green)}
.dot.error{background:var(--red)}
@keyframes pulse{0%,100%{opacity:1}50%{opacity:.4}}
.progress-wrap{display:none;flex-direction:column;gap:6px}
.progress-wrap.visible{display:flex}
.progress-track{height:4px;background:var(--surface2);border-radius:2px;overflow:hidden}
.progress-fill{height:100%;background:linear-gradient(90deg,var(--accent),#7c3aed);border-radius:2px;transition:width .3s;width:0%}
.progress-label{font-size:12px;color:var(--muted);display:flex;justify-content:space-between}
.log-box{background:var(--surface2);border:1px solid var(--border);border-radius:8px;padding:12px;max-height:240px;overflow-y:auto;font-family:'JetBrains Mono',monospace;font-size:11.5px;display:flex;flex-direction:column;gap:3px}
.log-line{display:flex;gap:8px;line-height:1.5}
.log-ts{color:var(--muted);flex-shrink:0;font-size:10px}
.log-info{color:var(--text)}
.log-success{color:var(--green)}
.log-error{color:var(--red)}
.log-warning{color:#e3b341}
.empty-log{color:var(--muted);font-size:12px;text-align:center;padding:20px 0}
footer{padding:16px 20px;text-align:center;font-size:11px;color:var(--muted)}
</style>
</head>
<body>
<header>
  <div class="logo">⏱</div>
  <div class="brand">
    <span class="brand-name">TARDIS Remote</span>
    <span class="brand-sub">Transfer And Retrieve Database In Seconds</span>
  </div>
</header>
<main>
  <div class="card">
    <div class="card-title">Operations</div>
    <div class="ops">
      <button class="op-btn primary" id="btn-pull" onclick="trigger('pull')">
        <span style="font-size:22px;flex-shrink:0">⬇</span>
        <span style="display:flex;flex-direction:column;gap:2px">
          <span style="font-size:15px;font-weight:600">Pull &amp; Import Local</span>
          <span style="font-size:12px;color:var(--muted);font-weight:400">production → local MySQL</span>
        </span>
      </button>
      <button class="op-btn" id="btn-sync" onclick="trigger('sync')">
        <span style="font-size:22px;flex-shrink:0">💾</span>
        <span style="display:flex;flex-direction:column;gap:2px">
          <span style="font-size:15px;font-weight:600">Pull from Production</span>
          <span style="font-size:12px;color:var(--muted);font-weight:400">download dump to ~/Downloads</span>
        </span>
      </button>
      <button class="op-btn purple" id="btn-test" onclick="trigger('test')">
        <span style="font-size:22px;flex-shrink:0">⬆</span>
        <span style="display:flex;flex-direction:column;gap:2px">
          <span style="font-size:15px;font-weight:600">Push to Test Server</span>
          <span style="font-size:12px;color:var(--muted);font-weight:400">production → test server</span>
        </span>
      </button>
    </div>
    <button class="cancel-btn" id="cancel-btn" onclick="cancelOp()">✕ Cancel</button>
  </div>

  <div class="card">
    <div class="card-title">Status</div>
    <div class="status-row">
      <div class="dot" id="status-dot"></div>
      <span id="status-text">Idle — waiting for operation</span>
    </div>
    <div class="progress-wrap" id="progress-wrap">
      <div class="progress-track"><div class="progress-fill" id="progress-fill"></div></div>
      <div class="progress-label">
        <span id="progress-label-left">Transferring...</span>
        <span id="progress-pct">0%</span>
      </div>
    </div>
  </div>

  <div class="card">
    <div class="card-title">Live Log</div>
    <div class="log-box" id="log-box">
      <div class="empty-log" id="log-empty">No activity yet</div>
    </div>
  </div>
</main>
<footer>made with ❤️ by uriel &nbsp;·&nbsp; TARDIS Remote</footer>

<script>
const TOKEN = '{{TOKEN}}'
const base  = window.location.origin
let running = false
let es = null

function api(path, opts) {
  return fetch(base + path + '?token=' + TOKEN, opts)
}

function setRunning(val) {
  running = val
  document.querySelectorAll('.op-btn').forEach(b => b.disabled = val)
  document.getElementById('cancel-btn').classList.toggle('visible', val)
  if (!val) document.getElementById('status-dot').classList.remove('running')
}

function setStatus(text, dotClass) {
  document.getElementById('status-text').textContent = text
  if (dotClass) {
    const dot = document.getElementById('status-dot')
    dot.className = 'dot ' + dotClass
  }
}

function addLog(msg, level, ts) {
  const box = document.getElementById('log-box')
  const empty = document.getElementById('log-empty')
  if (empty) empty.remove()
  const line = document.createElement('div')
  line.className = 'log-line'
  line.innerHTML = '<span class="log-ts">' + (ts||now()) + '</span><span class="log-' + (level||'info') + '">' + esc(msg) + '</span>'
  box.appendChild(line)
  box.scrollTop = box.scrollHeight
}

function now() { return new Date().toLocaleTimeString() }
function esc(s) { return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;') }

function setProgress(bytes, total) {
  const wrap = document.getElementById('progress-wrap')
  if (!total) { wrap.classList.remove('visible'); return }
  wrap.classList.add('visible')
  const pct = Math.min(100, Math.round(bytes / total * 100))
  document.getElementById('progress-fill').style.width = pct + '%'
  document.getElementById('progress-pct').textContent = pct + '%'
  const isTable = total < 100000
  document.getElementById('progress-label-left').textContent = isTable
    ? bytes + ' / ' + total + ' tables'
    : (bytes/1024/1024).toFixed(1) + ' MB / ' + (total/1024/1024).toFixed(1) + ' MB'
}

function connectSSE() {
  if (es) { es.close(); es = null }
  es = new EventSource(base + '/api/events?token=' + TOKEN)
  es.onmessage = e => {
    try {
      const d = JSON.parse(e.data)
      if (d.type === 'progress') { setProgress(d.bytes, d.total); return }
      addLog(d.msg, d.level)
      setStatus(d.msg, running ? 'running' : '')
      if (d.level === 'success') { setRunning(false); setStatus(d.msg, 'done'); setProgress(0,0) }
      if (d.level === 'error')   { setRunning(false); setStatus(d.msg, 'error'); setProgress(0,0) }
      if (d.level === 'warning') { setRunning(false); setStatus(d.msg, ''); setProgress(0,0) }
    } catch(_) {}
  }
  es.onerror = () => setTimeout(connectSSE, 3000)
}

async function trigger(op) {
  if (running) return
  running = true
  setRunning(true)
  setStatus('Starting ' + op + '...', 'running')
  document.getElementById('log-box').innerHTML = ''
  setProgress(0, 0)
  addLog('Triggering ' + op + '...', 'info')
  try {
    const r = await api('/api/trigger', {
      method: 'POST',
      headers: {'Content-Type':'application/json'},
      body: JSON.stringify({op})
    })
    if (!r.ok) { addLog('Failed to trigger: ' + r.status, 'error'); setRunning(false) }
  } catch(err) {
    addLog('Network error: ' + err.message, 'error')
    setRunning(false)
  }
}

async function cancelOp() {
  await api('/api/cancel', {method:'POST'})
  addLog('Cancel requested...', 'warning')
}

connectSSE()
</script>
</body>
</html>`
