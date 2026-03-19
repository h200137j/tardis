import { useState, useEffect, useRef, useCallback } from 'react'
import { EventsOn } from '../../wailsjs/runtime/runtime'
import { SyncDatabase, SyncToTest, SyncAndImportLocal, PickFile, ImportLocal, Cancel } from '../../wailsjs/go/main/App'
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

function useSync({ progressEvent, doneEvent, errorEvent, cancelledEvent, transferEvent, fn }) {
  const [status, setStatus]     = useState(STATUS.IDLE)
  const [logs, setLogs]         = useState([])
  const [transfer, setTransfer] = useState(null)   // { bytes, total }
  const [elapsed, setElapsed]   = useState(0)      // ms
  const [totalTime, setTotalTime] = useState(null) // ms, set on done/error
  const logEndRef               = useRef(null)
  const startRef                = useRef(null)
  const timerRef                = useRef(null)

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
    return () => { off1(); off2(); off3(); off4(); off5() }
  }, [progressEvent, doneEvent, errorEvent, cancelledEvent, transferEvent, addLog])

  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [logs])

  useEffect(() => () => clearInterval(timerRef.current), [])

  const run = async (overrideFn) => {
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

  return { status, logs, logEndRef, transfer, elapsed, totalTime, run, clear }
}

export default function HomeView() {
  const prod = useSync({
    progressEvent:  'sync:progress',
    doneEvent:      'sync:done',
    errorEvent:     'sync:error',
    cancelledEvent: 'sync:cancelled',
    transferEvent:  'sync:transfer',
    fn:             SyncDatabase,
  })

  const test = useSync({
    progressEvent:  'test:progress',
    doneEvent:      'test:done',
    errorEvent:     'test:error',
    cancelledEvent: 'test:cancelled',
    transferEvent:  'test:transfer',
    fn:             SyncToTest,
  })

  const pull = useSync({
    progressEvent:  'pull:progress',
    doneEvent:      'pull:done',
    errorEvent:     'pull:error',
    cancelledEvent: 'pull:cancelled',
    transferEvent:  'pull:transfer',
    fn:             SyncAndImportLocal,
  })

  const importSync = useSync({
    progressEvent:  'import:progress',
    doneEvent:      'import:done',
    errorEvent:     'import:error',
    cancelledEvent: 'import:cancelled',
    transferEvent:  'import:transfer',
    fn:             () => {},
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

  return (
    <div className="home">
      <div className="hero">
        <div className="hero-icon">🗄️</div>
        <h1 className="hero-title">Database Sync</h1>
        <p className="hero-desc">
          Pull production to <code>~/Downloads</code>, push to your test server, or import straight into local MySQL.
        </p>

        <div className="btn-row">
          <SyncButton label="⬇ Pull from Production" busyLabel="Pulling..."  status={prod.status} disabled={anyBusy} onClick={prod.run} variant="primary" />
          <SyncButton label="⬆ Push to Test Server"  busyLabel="Pushing..."  status={test.status} disabled={anyBusy} onClick={test.run} variant="purple" />
          <SyncButton label="⬇ Pull & Import Local"  busyLabel="Working..."  status={pull.status} disabled={anyBusy} onClick={pull.run} variant="teal" />
        </div>

        {anyBusy && (
          <button className="cancel-btn" onClick={() => Cancel()}>✕ Cancel</button>
        )}
      </div>

      {/* ── Import card ── */}
      <div className="import-card">
        <div className="import-card-left">
          <span className="import-icon">💻</span>
          <div>
            <p className="import-title">Import to Local</p>
            <p className="import-desc">Select a <code>.sql</code> or <code>.sql.gz</code> file to import into your local database.</p>
          </div>
        </div>
        <button
          className={`sync-btn sync-btn--green ${importSync.status === STATUS.RUNNING ? 'busy' : ''} ${importSync.status === STATUS.ERROR ? 'errored' : ''}`}
          onClick={handlePickAndImport}
          disabled={anyBusy}
        >
          {importSync.status === STATUS.RUNNING    ? <><span className="spinner" />Importing...</>
           : importSync.status === STATUS.DONE      ? '✓ Import Another'
           : importSync.status === STATUS.ERROR     ? '↺ Retry'
           : importSync.status === STATUS.CANCELLED ? '↺ Try Again'
           : '📂 Select & Import'}
        </button>
      </div>

      {/* ── Progress panel ── */}
      {active.logs.length > 0 && (
        <ProgressPanel sync={active} onClear={active.clear} />
      )}
    </div>
  )
}

function ProgressPanel({ sync, onClear }) {
  const { status, logs, logEndRef, transfer, elapsed, totalTime } = sync
  const isRunning = status === STATUS.RUNNING
  const pct = transfer && transfer.total > 0
    ? Math.min(100, Math.round((transfer.bytes / transfer.total) * 100))
    : null

  // Distinguish table progress (small numbers) from byte transfer (large numbers)
  const isTableProgress = transfer && transfer.total > 0 && transfer.total < 100000

  const lastLog = logs[logs.length - 1]

  return (
    <div className="progress-panel">
      <div className="progress-panel-header">
        <div className="progress-status-row">
          <StatusDot status={status} />
          <span className="progress-current-step">
            {lastLog?.text ?? ''}
          </span>
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

      {/* Transfer / import progress bar */}
      {transfer && transfer.total > 0 && (
        <div className="transfer-section">
          <div className="transfer-info">
            <span className="transfer-label">
              {isTableProgress
                ? (pct < 100 ? 'Importing tables' : 'Import complete')
                : (pct < 100 ? 'Transferring' : 'Transfer complete')}
            </span>
            <span className="transfer-bytes">
              {isTableProgress
                ? `${transfer.bytes} / ${transfer.total} tables`
                : `${fmtMB(transfer.bytes)} MB / ${fmtMB(transfer.total)} MB`}
              <span className="transfer-pct"> — {pct}%</span>
            </span>
          </div>
          <div className="progress-bar-track">
            <div
              className={`progress-bar-fill ${pct >= 100 ? 'complete' : ''}`}
              style={{ width: `${pct}%` }}
            />
          </div>
        </div>
      )}

      {/* Indeterminate bar when running but no transfer yet */}
      {isRunning && !transfer && (
        <div className="progress-bar-track">
          <div className="progress-bar-indeterminate" />
        </div>
      )}

      {/* Log */}
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

function SyncButton({ label, busyLabel, status, disabled, onClick, variant }) {
  const isBusy = status === STATUS.RUNNING
  const btnLabel = isBusy
    ? <><span className="spinner" aria-hidden="true" />{busyLabel}</>
    : status === STATUS.DONE      ? '✓ Run Again'
    : status === STATUS.ERROR     ? '↺ Retry'
    : status === STATUS.CANCELLED ? '↺ Try Again'
    : label

  return (
    <button
      className={`sync-btn sync-btn--${variant} ${isBusy ? 'busy' : ''} ${status === STATUS.ERROR ? 'errored' : ''}`}
      onClick={onClick}
      disabled={disabled}
    >
      {btnLabel}
    </button>
  )
}
