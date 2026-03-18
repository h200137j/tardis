import { useState, useEffect, useRef } from 'react'
import { EventsOn } from '../../wailsjs/runtime/runtime'
import { SyncDatabase, SyncToTest } from '../../wailsjs/go/main/App'
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

  const run = async () => {
    setStatus(STATUS.RUNNING)
    setLogs([])
    addLog('Starting...', 'info')
    try { await fn() }
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

  const anyBusy = prod.status === STATUS.RUNNING || test.status === STATUS.RUNNING

  // Show whichever log has entries; test takes priority if both somehow have logs
  const activeLogs    = test.logs.length > 0 ? test.logs    : prod.logs
  const activeLogEnd  = test.logs.length > 0 ? test.logEndRef : prod.logEndRef
  const activeClear   = test.logs.length > 0 ? test.clear   : prod.clear

  return (
    <div className="home">
      <div className="hero">
        <div className="hero-icon">🗄️</div>
        <h1 className="hero-title">Database Sync</h1>
        <p className="hero-desc">
          Pull production to <code>~/Downloads</code>, or push it straight into your test server.
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
        </div>
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
