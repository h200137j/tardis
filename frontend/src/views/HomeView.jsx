import { useState, useEffect, useRef } from 'react'
import { EventsOn } from '../../wailsjs/runtime/runtime'
import { SyncDatabase, SyncToTest, SyncAndImportLocal, PickFile, ImportLocal, Cancel } from '../../wailsjs/go/main/App'
import './HomeView.css'

const STATUS = { IDLE: 'idle', RUNNING: 'running', DONE: 'done', ERROR: 'error', CANCELLED: 'cancelled' }

function useSync({ progressEvent, doneEvent, errorEvent, cancelledEvent, fn }) {
  const [status, setStatus] = useState(STATUS.IDLE)
  const [logs, setLogs]     = useState([])
  const logEndRef           = useRef(null)

  const addLog = (text, type = 'info') => {
    const ts = new Date().toLocaleTimeString()
    setLogs(prev => [...prev, { text, type, ts }])
  }

  useEffect(() => {
    const off1 = EventsOn(progressEvent,  msg => addLog(msg, 'info'))
    const off2 = EventsOn(doneEvent,      msg => { addLog(msg, 'success'); setStatus(STATUS.DONE) })
    const off3 = EventsOn(errorEvent,     msg => { addLog(msg, 'error');   setStatus(STATUS.ERROR) })
    const off4 = EventsOn(cancelledEvent, msg => { addLog(msg, 'warning'); setStatus(STATUS.CANCELLED) })
    return () => { off1(); off2(); off3(); off4() }
  }, [progressEvent, doneEvent, errorEvent, cancelledEvent])

  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [logs])

  const run = async (overrideFn) => {
    setStatus(STATUS.RUNNING)
    setLogs([])
    addLog('Starting...', 'info')
    const callable = typeof overrideFn === 'function' ? overrideFn : fn
    try { await callable() }
    catch (err) { addLog(String(err), 'error'); setStatus(STATUS.ERROR) }
  }

  const clear = () => { setLogs([]); setStatus(STATUS.IDLE) }

  return { status, logs, logEndRef, run, clear }
}

export default function HomeView() {
  const prod = useSync({
    progressEvent:  'sync:progress',
    doneEvent:      'sync:done',
    errorEvent:     'sync:error',
    cancelledEvent: 'sync:cancelled',
    fn:             SyncDatabase,
  })

  const test = useSync({
    progressEvent:  'test:progress',
    doneEvent:      'test:done',
    errorEvent:     'test:error',
    cancelledEvent: 'test:cancelled',
    fn:             SyncToTest,
  })

  const pull = useSync({
    progressEvent:  'pull:progress',
    doneEvent:      'pull:done',
    errorEvent:     'pull:error',
    cancelledEvent: 'pull:cancelled',
    fn:             SyncAndImportLocal,
  })

  const importSync = useSync({
    progressEvent:  'import:progress',
    doneEvent:      'import:done',
    errorEvent:     'import:error',
    cancelledEvent: 'import:cancelled',
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

  const handleCancel = () => Cancel()

  const anyBusy = [prod, test, pull, importSync].some(s => s.status === STATUS.RUNNING)

  // Active log: whichever is running or most recently ran
  const ordered   = [importSync, pull, test, prod]
  const active    = ordered.find(s => s.logs.length > 0) ?? prod

  return (
    <div className="home">
      <div className="hero">
        <div className="hero-icon">🗄️</div>
        <h1 className="hero-title">Database Sync</h1>
        <p className="hero-desc">
          Pull production to <code>~/Downloads</code>, push it to your test server, or pull and import straight into your local database.
        </p>

        <div className="btn-row">
          <SyncButton label="⬇ Pull from Production" busyLabel="Pulling..."  status={prod.status} disabled={anyBusy} onClick={prod.run} variant="primary" />
          <SyncButton label="⬆ Push to Test Server"  busyLabel="Pushing..."  status={test.status} disabled={anyBusy} onClick={test.run} variant="purple" />
          <SyncButton label="⬇ Pull & Import Local"  busyLabel="Working..."  status={pull.status} disabled={anyBusy} onClick={pull.run} variant="teal" />
        </div>

        {anyBusy && (
          <button className="cancel-btn" onClick={handleCancel}>
            ✕ Cancel
          </button>
        )}
      </div>

      {/* ── Local import ── */}
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
          {importSync.status === STATUS.RUNNING ? <><span className="spinner" aria-hidden="true" />Importing...</>
           : importSync.status === STATUS.DONE      ? '✓ Import Another'
           : importSync.status === STATUS.ERROR     ? '↺ Retry'
           : importSync.status === STATUS.CANCELLED ? '↺ Try Again'
           : '📂 Select & Import'}
        </button>
      </div>

      {active.logs.length > 0 && (
        <div className="log-panel" role="log" aria-live="polite">
          <div className="log-header">
            <span>Progress</span>
            <button className="log-clear" onClick={active.clear}>Clear</button>
          </div>
          <div className="log-body">
            {active.logs.map((entry, i) => (
              <div key={i} className={`log-line log-${entry.type}`}>
                <span className="log-ts">{entry.ts}</span>
                <span className="log-msg">{entry.text}</span>
              </div>
            ))}
            <div ref={active.logEndRef} />
          </div>
        </div>
      )}
    </div>
  )
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
