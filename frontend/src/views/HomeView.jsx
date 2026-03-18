import { useState, useEffect, useRef } from 'react'
import { EventsOn } from '../../wailsjs/runtime/runtime'
import { SyncDatabase, SyncToTest, SyncAndImportLocal, PickFile, ImportLocal } from '../../wailsjs/go/main/App'
import './HomeView.css'

const STATUS = { IDLE: 'idle', RUNNING: 'running', DONE: 'done', ERROR: 'error' }

function useSync({ progressEvent, doneEvent, errorEvent, fn }) {
  const [status, setStatus] = useState(STATUS.IDLE)
  const [logs, setLogs]     = useState([])
  const logEndRef           = useRef(null)

  const addLog = (text, type = 'info') => {
    const ts = new Date().toLocaleTimeString()
    setLogs(prev => [...prev, { text, type, ts }])
  }

  useEffect(() => {
    const off1 = EventsOn(progressEvent, msg => addLog(msg, 'info'))
    const off2 = EventsOn(doneEvent,     msg => { addLog(msg, 'success'); setStatus(STATUS.DONE) })
    const off3 = EventsOn(errorEvent,    msg => { addLog(msg, 'error');   setStatus(STATUS.ERROR) })
    return () => { off1(); off2(); off3() }
  }, [progressEvent, doneEvent, errorEvent])

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
    progressEvent: 'sync:progress',
    doneEvent:     'sync:done',
    errorEvent:    'sync:error',
    fn:            SyncDatabase,
  })

  const test = useSync({
    progressEvent: 'test:progress',
    doneEvent:     'test:done',
    errorEvent:    'test:error',
    fn:            SyncToTest,
  })

  const importSync = useSync({
    progressEvent: 'import:progress',
    doneEvent:     'import:done',
    errorEvent:    'import:error',
    fn:            () => {}, // overridden below
  })

  const [selectedFile, setSelectedFile] = useState('')

  const handlePickAndImport = async () => {
    try {
      const path = await PickFile()
      if (!path) return
      setSelectedFile(path)
      importSync.run(() => ImportLocal(path))
    } catch (err) {
      importSync.run(() => Promise.reject(err))
    }
  }

  const pull = useSync({
    progressEvent: 'pull:progress',
    doneEvent:     'pull:done',
    errorEvent:    'pull:error',
    fn:            SyncAndImportLocal,
  })

  const anyBusy = prod.status === STATUS.RUNNING || test.status === STATUS.RUNNING || importSync.status === STATUS.RUNNING || pull.status === STATUS.RUNNING

  // Show whichever log has entries; priority: import > pull > test > prod
  const activeLogs    = importSync.logs.length > 0 ? importSync.logs
                      : pull.logs.length > 0        ? pull.logs
                      : test.logs.length > 0        ? test.logs
                      : prod.logs
  const activeLogEnd  = importSync.logs.length > 0 ? importSync.logEndRef
                      : pull.logs.length > 0        ? pull.logEndRef
                      : test.logs.length > 0        ? test.logEndRef
                      : prod.logEndRef
  const activeClear   = importSync.logs.length > 0 ? importSync.clear
                      : pull.logs.length > 0        ? pull.clear
                      : test.logs.length > 0        ? test.clear
                      : prod.clear

  return (
    <div className="home">
      <div className="hero">
        <div className="hero-icon">🗄️</div>
        <h1 className="hero-title">Database Sync</h1>
        <p className="hero-desc">
          Pull production to <code>~/Downloads</code>, push it to your test server, or pull and import straight into your local database.
        </p>

        <div className="btn-row">
          <SyncButton
            label="⬇ Pull from Production"
            busyLabel="Pulling..."
            status={prod.status}
            disabled={anyBusy}
            onClick={prod.run}
            variant="primary"
          />
          <SyncButton
            label="⬆ Push to Test Server"
            busyLabel="Pushing..."
            status={test.status}
            disabled={anyBusy}
            onClick={test.run}
            variant="purple"
          />
          <SyncButton
            label="⬇ Pull & Import Local"
            busyLabel="Working..."
            status={pull.status}
            disabled={anyBusy}
            onClick={pull.run}
            variant="teal"
          />
        </div>
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
           : importSync.status === STATUS.DONE  ? '✓ Import Another'
           : importSync.status === STATUS.ERROR ? '↺ Retry'
           : '📂 Select & Import'}
        </button>
      </div>

      {activeLogs.length > 0 && (
        <div className="log-panel" role="log" aria-live="polite" aria-label="Sync progress">
          <div className="log-header">
            <span>Progress</span>
            <button className="log-clear" onClick={activeClear}>Clear</button>
          </div>
          <div className="log-body">
            {activeLogs.map((entry, i) => (
              <div key={i} className={`log-line log-${entry.type}`}>
                <span className="log-ts">{entry.ts}</span>
                <span className="log-msg">{entry.text}</span>
              </div>
            ))}
            <div ref={activeLogEnd} />
          </div>
        </div>
      )}
    </div>
  )
}

function SyncButton({ label, busyLabel, status, disabled, onClick, variant }) {
  const isBusy = status === STATUS.RUNNING
  const btnLabel = isBusy          ? <><span className="spinner" aria-hidden="true" />{busyLabel}</>
                 : status === STATUS.DONE  ? '✓ Run Again'
                 : status === STATUS.ERROR ? '↺ Retry'
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
