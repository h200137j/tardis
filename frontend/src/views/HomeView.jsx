import { useState, useEffect, useRef, useCallback } from 'react'
import { EventsOn } from '../../wailsjs/runtime/runtime'
import { SyncDatabase, SyncToTest, SyncAndImportLocal, PickFile, ImportLocal, Cancel, GetMobileQR, GetMobileURL, GetConfig, SetActiveProject } from '../../wailsjs/go/main/App'
import AnimationCanvas from './AnimationCanvas'
import './HomeView.css'

const STATUS = { IDLE: 'idle', RUNNING: 'running', DONE: 'done', ERROR: 'error', CANCELLED: 'cancelled' }

function fmtMB(bytes) {
  return (bytes / 1024 / 1024).toFixed(1)
}

function fmtDuration(ms) {
  const s = Math.floor(ms / 1000)
  const m = Math.floor(s / 60)
  if (m > 0) return `${m}m ${s % 60}s`
  return `${s}s`
}

function useSync({ progressEvent, doneEvent, errorEvent, cancelledEvent, transferEvent, phaseEvent, fn, animCountRef }) {
  const [status, setStatus]       = useState(STATUS.IDLE)
  const [logs, setLogs]           = useState([])
  const [transfer, setTransfer]   = useState(null)
  const [elapsed, setElapsed]     = useState(0)
  const [totalTime, setTotalTime] = useState(null)
  const [animIndex, setAnimIndex] = useState(0)
  const [phase, setPhase]         = useState('idle')
  const logEndRef                 = useRef(null)
  const startRef                  = useRef(null)
  const timerRef                  = useRef(null)

  const addLog = useCallback((text, type = 'info') => {
    const ts = new Date().toLocaleTimeString()
    setLogs(prev => [...prev, { text, type, ts }])
  }, [])

  const startTimer = () => {
    startRef.current = Date.now()
    setElapsed(0)
    timerRef.current = setInterval(() => {
      setElapsed(Date.now() - startRef.current)
    }, 1000)
  }

  const stopTimer = () => {
    clearInterval(timerRef.current)
    if (startRef.current) setTotalTime(Date.now() - startRef.current)
  }

  useEffect(() => {
    const off1 = EventsOn(progressEvent,  msg => addLog(msg, 'info'))
    const off2 = EventsOn(doneEvent,      msg => {
      addLog(msg, 'success')
      setStatus(STATUS.DONE)
      setTransfer(null)
      stopTimer()
    })
    const off3 = EventsOn(errorEvent,     msg => {
      addLog(msg, 'error')
      setStatus(STATUS.ERROR)
      setTransfer(null)
      stopTimer()
    })
    const off4 = EventsOn(cancelledEvent, msg => {
      addLog(msg, 'warning')
      setStatus(STATUS.CANCELLED)
      setTransfer(null)
      stopTimer()
    })
    const off5 = transferEvent
      ? EventsOn(transferEvent, data => setTransfer(data))
      : () => {}
    const off6 = phaseEvent
      ? EventsOn(phaseEvent, p => setPhase(p))
      : () => {}
    return () => { off1(); off2(); off3(); off4(); off5(); off6() }
  }, [progressEvent, doneEvent, errorEvent, cancelledEvent, transferEvent, phaseEvent, addLog])

  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [logs])

  useEffect(() => () => clearInterval(timerRef.current), [])

  const run = async (overrideFn) => {
    const idx = animCountRef ? animCountRef.current++ : 0
    setAnimIndex(idx)
    setPhase('idle')
    setStatus(STATUS.RUNNING)
    setLogs([])
    setTransfer(null)
    setTotalTime(null)
    startTimer()
    addLog('Starting...', 'info')
    const callable = typeof overrideFn === 'function' ? overrideFn : fn
    try { await callable() }
    catch (err) { addLog(String(err), 'error'); setStatus(STATUS.ERROR); stopTimer() }
  }

  const clear = () => {
    setLogs([])
    setStatus(STATUS.IDLE)
    setTransfer(null)
    setTotalTime(null)
    setElapsed(0)
  }

  return { status, logs, logEndRef, transfer, elapsed, totalTime, animIndex, phase, run, clear }
}

export default function HomeView() {
  const animCountRef = useRef(0)
  const [qrOpen, setQrOpen]             = useState(false)
  const [qrImg, setQrImg]               = useState('')
  const [qrUrl, setQrUrl]               = useState('')
  const [qrLoading, setQrLoading]       = useState(false)
  const [projects, setProjects]         = useState([])
  const [activeProjectId, setActiveProjectId] = useState('')

  useEffect(() => {
    GetConfig()
      .then(cfg => {
        const projs = cfg.projects || []
        setProjects(projs)
        setActiveProjectId(cfg.active_project_id || (projs[0]?.id ?? ''))
      })
      .catch(err => console.error('GetConfig failed:', err))
  }, [])

  const switchProject = async (id) => {
    if (anyBusy) return
    try {
      await SetActiveProject(id)
      setActiveProjectId(id)
    } catch (_) {}
  }

  const toggleQR = async () => {
    if (qrOpen) { setQrOpen(false); return }
    if (qrImg)  { setQrOpen(true);  return }
    setQrLoading(true)
    try {
      const [img, url] = await Promise.all([GetMobileQR(), GetMobileURL()])
      setQrImg(img)
      setQrUrl(url)
      setQrOpen(true)
    } catch (_) {}
    finally { setQrLoading(false) }
  }

  const prod = useSync({
    progressEvent:  'sync:progress',
    doneEvent:      'sync:done',
    errorEvent:     'sync:error',
    cancelledEvent: 'sync:cancelled',
    transferEvent:  'sync:transfer',
    fn:             SyncDatabase,
    animCountRef,
  })

  const test = useSync({
    progressEvent:  'test:progress',
    doneEvent:      'test:done',
    errorEvent:     'test:error',
    cancelledEvent: 'test:cancelled',
    transferEvent:  'test:transfer',
    fn:             SyncToTest,
    animCountRef,
  })

  const pull = useSync({
    progressEvent:  'pull:progress',
    doneEvent:      'pull:done',
    errorEvent:     'pull:error',
    cancelledEvent: 'pull:cancelled',
    transferEvent:  'pull:transfer',
    phaseEvent:     'pull:phase',
    fn:             SyncAndImportLocal,
    animCountRef,
  })

  const importSync = useSync({
    progressEvent:  'import:progress',
    doneEvent:      'import:done',
    errorEvent:     'import:error',
    cancelledEvent: 'import:cancelled',
    transferEvent:  'import:transfer',
    fn:             () => {},
    animCountRef,
  })

  const handlePickAndImport = async () => {
    try {
      const path = await PickFile()
      if (!path) return
      importSync.run(() => ImportLocal(path))
    } catch (err) {
      importSync.run(() => Promise.reject(err))
    }
  }

  const anyBusy = [prod, test, pull, importSync].some(s => s.status === STATUS.RUNNING)
  const active  = [importSync, pull, test, prod].find(s => s.status === STATUS.RUNNING)
    ?? [importSync, pull, test, prod].find(s => s.logs.length > 0)
    ?? prod

  const pullLabel = pull.status === STATUS.DONE      ? '✓ Run Again'
    : pull.status === STATUS.ERROR     ? '↺ Retry'
    : pull.status === STATUS.CANCELLED ? '↺ Try Again'
    : 'Pull & Import Local'

  const activeProject = projects.find(p => p.id === activeProjectId)
  const projectPrefix = activeProject?.name ? `${activeProject.name}: ` : ''

  return (
    <div className="home">

      {/* Header */}
      <header className="home-header">
        <h1 className="home-title">TARDISddddd</h1>
        <p className="home-tagline">Transfer And Retrieve Database In Seconds</p>
      </header>

      {/* Project selector — shown when more than one project exists */}
      {projects.length > 1 && (
        <div className="project-bar">
          <span className="project-bar-label">Project</span>
          {projects.map(p => (
            <button
              key={p.id}
              className={`project-pill ${p.id === activeProjectId ? 'active' : ''}`}
              onClick={() => switchProject(p.id)}
              disabled={anyBusy}
            >
              {p.name}
            </button>
          ))}
        </div>
      )}

      {/* Primary CTA */}
      <button
        className={`cta-btn ${pull.status === STATUS.RUNNING ? 'busy' : ''} ${pull.status === STATUS.ERROR ? 'errored' : ''}`}
        onClick={pull.run}
        disabled={anyBusy}
      >
        {pull.status === STATUS.RUNNING ? (
          <span className="cta-inner">
            <span className="spinner" />
            <span className="cta-main">Working...</span>
          </span>
        ) : (
          <span className="cta-inner">
            <span className="cta-arrow">⬇</span>
            <span className="cta-text">
              <span className="cta-main">{pullLabel}</span>
              <span className="cta-sub">{projectPrefix}production → local MySQL</span>
            </span>
          </span>
        )}
      </button>

      {/* Secondary action grid */}
      <div className="action-grid">
        <ActionCard
          icon="⬇"
          title="Pull from Production"
          sub="Dump & download only"
          busyLabel="Pulling..."
          status={prod.status}
          disabled={anyBusy}
          onClick={prod.run}
        />
        <ActionCard
          icon="⬆"
          title="Push to Test Server"
          sub="Sync prod → test DB"
          busyLabel="Pushing..."
          status={test.status}
          disabled={anyBusy}
          onClick={test.run}
        />
      </div>

      {/* Import local */}
      <div className="import-row">
        <div className="import-left">
          <span className="import-emoji">💻</span>
          <div>
            <p className="import-title">Import Local File</p>
            <p className="import-sub">Select a <code>.sql</code> or <code>.sql.gz</code> dump</p>
          </div>
        </div>
        <button
          className={`import-btn ${importSync.status === STATUS.RUNNING ? 'busy' : ''} ${importSync.status === STATUS.ERROR ? 'errored' : ''}`}
          onClick={handlePickAndImport}
          disabled={anyBusy}
        >
          {importSync.status === STATUS.RUNNING    ? <><span className="spinner" /> Importing...</>
           : importSync.status === STATUS.DONE     ? '✓ Import Another'
           : importSync.status === STATUS.ERROR    ? '↺ Retry'
           : importSync.status === STATUS.CANCELLED ? '↺ Try Again'
           : '📂 Select File'}
        </button>
      </div>

      {/* Controls row */}
      <div className="controls-row">
        {anyBusy && (
          <button className="cancel-btn" onClick={() => Cancel()}>✕ Cancel</button>
        )}
        <button
          className={`mobile-pill ${qrOpen ? 'active' : ''}`}
          onClick={toggleQR}
          disabled={qrLoading}
        >
          <span>{qrLoading ? '⏳' : '📱'}</span>
          <span>{qrOpen ? 'Hide Remote' : 'Mobile Remote'}</span>
        </button>
      </div>

      {/* QR panel */}
      {qrOpen && qrImg && (
        <div className="qr-panel">
          <div className="qr-panel-inner">
            <div className="qr-left">
              <img src={qrImg} alt="Scan to open TARDIS Remote" className="qr-img" />
            </div>
            <div className="qr-right">
              <p className="qr-title">📱 TARDIS Remote</p>
              <p className="qr-desc">Scan with your phone to trigger syncs from anywhere on your network.</p>
              <p className="qr-url">{qrUrl}</p>
              <p className="qr-hint">Same Wi-Fi required</p>
            </div>
          </div>
        </div>
      )}

      {/* Progress */}
      {active.logs.length > 0 && (
        <ProgressPanel sync={active} onClear={active.clear} />
      )}

    </div>
  )
}

function ActionCard({ icon, title, sub, busyLabel, status, disabled, onClick }) {
  const isBusy = status === STATUS.RUNNING
  const label = isBusy          ? busyLabel
    : status === STATUS.DONE    ? '✓ Done'
    : status === STATUS.ERROR   ? '↺ Retry'
    : status === STATUS.CANCELLED ? '↺ Try Again'
    : title

  return (
    <button
      className={`action-card ${isBusy ? 'busy' : ''} ${status === STATUS.ERROR ? 'errored' : ''}`}
      onClick={onClick}
      disabled={disabled}
    >
      <span className="action-card-icon">
        {isBusy ? <span className="spinner" /> : icon}
      </span>
      <span className="action-card-body">
        <span className="action-card-title">{label}</span>
        <span className="action-card-sub">{sub}</span>
      </span>
    </button>
  )
}

function ProgressPanel({ sync, onClear }) {
  const { status, logs, logEndRef, transfer, elapsed, totalTime, animIndex, phase } = sync
  const isRunning = status === STATUS.RUNNING
  const pct = transfer && transfer.total > 0
    ? Math.min(100, Math.round((transfer.bytes / transfer.total) * 100))
    : null

  const isTableProgress = transfer && transfer.total === 0 && transfer.bytes > 0
  const animProgress = isTableProgress
    ? (transfer.bytes / transfer.total)
    : pct != null ? pct / 100 : 0

  const lastLog = logs[logs.length - 1]

  return (
    <div className="progress-panel">
      <div className="progress-panel-header">
        <div className="progress-status-row">
          <StatusDot status={status} />
          <span className="progress-current-step">{lastLog?.text ?? ''}</span>
        </div>
        <div className="progress-meta">
          {isRunning && (
            <span className="progress-timer">⏱ {fmtDuration(elapsed)}</span>
          )}
          {!isRunning && totalTime != null && (
            <span className="progress-timer muted">Completed in {fmtDuration(totalTime)}</span>
          )}
          <button className="log-clear" onClick={onClear}>Clear</button>
        </div>
      </div>

      {isRunning && (
        <AnimationCanvas
          animIndex={animIndex}
          isRunning={isRunning}
          progress={animProgress}
          phase={phase}
        />
      )}

      {transfer && (transfer.total > 0 || transfer.bytes > 0) && (
        <div className="transfer-section">
          <div className="transfer-info">
            <span className="transfer-label">
              {isTableProgress
                ? 'Importing tables'
                : (pct < 100 ? 'Transferring' : 'Transfer complete')}
            </span>
            <span className="transfer-bytes">
              {isTableProgress
                ? `${transfer.bytes} tables imported`
                : `${fmtMB(transfer.bytes)} MB / ${fmtMB(transfer.total)} MB`}
              {!isTableProgress && <span className="transfer-pct"> — {pct}%</span>}
            </span>
          </div>
          {!isTableProgress && (
            <div className="progress-bar-track">
              <div
                className={`progress-bar-fill ${pct >= 100 ? 'complete' : ''}`}
                style={{ width: `${pct}%` }}
              />
            </div>
          )}
        </div>
      )}

      {isRunning && !transfer && (
        <div className="progress-bar-track">
          <div className="progress-bar-indeterminate" />
        </div>
      )}

      <div className="log-body" role="log" aria-live="polite">
        {logs.map((entry, i) => (
          <div key={i} className={`log-line log-${entry.type}`}>
            <span className="log-ts">{entry.ts}</span>
            <span className="log-msg">{entry.text}</span>
          </div>
        ))}
        <div ref={logEndRef} />
      </div>
    </div>
  )
}

function StatusDot({ status }) {
  return <span className={`status-dot status-dot--${status}`} aria-hidden="true" />
}
