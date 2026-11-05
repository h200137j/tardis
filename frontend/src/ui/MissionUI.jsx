import { useEffect, useRef, useState } from 'react'
import SettingsView from '../views/SettingsView'
import { STATUS, describeRun, fmtClock } from '../hooks/useOperations'
import { UISwitcher, LogList, RemoteDialog } from './shared'
import './MissionUI.css'

const SAMPLE_COUNT = 24

// Samples real transfer speed once a second. Stays empty for runs that report
// no byte counts, such as a direct prod-to-test stream.
function useTransferRate(sync) {
  const [samples, setSamples] = useState([])
  const lastRef = useRef(null)
  const syncRef = useRef(sync)
  syncRef.current = sync

  const running = sync.status === STATUS.RUNNING

  useEffect(() => {
    if (!running) return undefined
    setSamples([])
    lastRef.current = null
    const timer = setInterval(() => {
      const transfer = syncRef.current.transfer
      if (!transfer || transfer.total <= 0) return
      const last = lastRef.current
      lastRef.current = transfer.bytes
      if (last == null || transfer.bytes < last) return
      const rate = (transfer.bytes - last) / 1048576
      setSamples(prev => [...prev, rate].slice(-SAMPLE_COUNT))
    }, 1000)
    return () => clearInterval(timer)
  }, [running])

  return samples
}

function Ring({ run, ops }) {
  let label = 'Standing by'
  let main  = 'Idle'
  if (run.running) {
    label = run.phase.label
    main  = run.pct != null ? `${run.pct}%` : fmtClock(run.time)
  } else if (run.status === STATUS.DONE) {
    label = 'Complete'
    main  = fmtClock(run.time)
  } else if (run.status === STATUS.ERROR) {
    label = 'Failed'
    main  = fmtClock(run.time)
  } else if (run.status === STATUS.CANCELLED) {
    label = 'Cancelled'
    main  = fmtClock(run.time)
  }

  const determinate = run.pct != null
  const showTime = run.running && determinate
  const pending = run.running && !determinate
  const fill = run.status === STATUS.DONE ? 100 : (determinate ? run.pct : 0)

  return (
    <section className={`mg-tile mg-run ${run.running ? 'mg-live' : ''}`} aria-live="polite">
      <div className="mg-scan" aria-hidden="true" />
      <div className={`mg-ring ${pending ? 'mg-ring--pending' : ''} ${run.status === STATUS.ERROR ? 'mg-ring--error' : ''}`} style={{ '--p': `${fill}%`, '--c': run.phase.color }}>
        <div className="mg-ring-core">
          <span className="mg-ring-main">{main}</span>
          <span className="mg-ring-label">{label}</span>
          {showTime && <span className="mg-ring-time">{fmtClock(run.time)}</span>}
        </div>
      </div>
      <div className="mg-run-title">
        {run.status === STATUS.IDLE ? 'No run active' : ops.activeAction.title}
      </div>
      {run.size && <div className="mg-run-size">{run.size}</div>}
      {run.running && <button type="button" className="mg-stop" onClick={ops.cancel}>Cancel</button>}
      {!run.running && run.status !== STATUS.IDLE && (
        <button type="button" className="mg-stop mg-stop--plain" onClick={ops.active.clear}>Clear</button>
      )}
    </section>
  )
}

function Servers({ project }) {
  const rows = [
    { name: 'Production', host: project?.production?.server_ip, db: project?.production?.db_name },
    { name: 'Test server', host: project?.test?.server_ip, db: project?.test?.db_name },
    { name: 'Local MySQL', host: 'This computer', db: project?.local?.db_name },
  ]
  return (
    <section className="mg-tile mg-servers">
      <h2>Targets</h2>
      {rows.map(r => {
        const ready = Boolean(r.host && r.db)
        return (
          <div className="mg-server" key={r.name}>
            <span className={`mg-mark ${ready ? '' : 'mg-mark--off'}`} aria-hidden="true" />
            <div>
              <div>{r.name}</div>
              <div className="mg-server-sub">{ready ? `${r.host} · ${r.db}` : 'Not configured'}</div>
            </div>
          </div>
        )
      })}
    </section>
  )
}

function Activity({ ops, run }) {
  const samples = useTransferRate(ops.active)
  const peak    = Math.max(...samples, 0.1)
  const current = samples[samples.length - 1]
  const streaming = run.running && !run.size

  return (
    <section className="mg-tile mg-activity">
      <div className="mg-tile-head">
        <h2>Transfer speed</h2>
        <span className="mg-rate">{run.running && current != null ? `${current.toFixed(1)} MB/s` : 'No transfer'}</span>
      </div>
      {samples.length > 0 ? (
        <div className="mg-bars" aria-hidden="true">
          {samples.map((rate, i) => (
            <div key={i} className="mg-bar" style={{ height: `${Math.max(4, (rate / peak) * 100)}%` }} />
          ))}
        </div>
      ) : (
        <p className="mg-activity-note">
          {streaming ? 'Waiting for transfer data. Direct server-to-server streams report none.' : 'Speed appears during downloads and imports.'}
        </p>
      )}
    </section>
  )
}

function Home({ ops }) {
  const run = describeRun(ops.active)
  return (
    <div className="mg-grid">
      <Ring run={run} ops={ops} />
      <section className="mg-tile mg-actions" aria-label="Actions">
        {ops.actions.map(action => (
          <button type="button" key={action.key} className="mg-key" onClick={action.start} disabled={ops.anyBusy}>
            <span className="mg-key-title">{action.title}</span>
            <span className="mg-key-sub">{action.sub}</span>
          </button>
        ))}
      </section>
      <Servers project={ops.activeProject} />
      <Activity ops={ops} run={run} />
      <section className="mg-tile mg-feed">
        <h2>Run feed</h2>
        <LogList logs={ops.active.logs} empty={`Ready for ${ops.activeProject?.name ?? 'your project'}.`} />
      </section>
    </div>
  )
}

export default function MissionUI({ ops, view, setView, ui, setUi, banner }) {
  return (
    <div className="mg-shell">
      <header className="mg-head">
        <div className="mg-brand">TARDIS</div>
        <div className="mg-projects">
          {ops.projects.map(p => (
            <button
              type="button"
              key={p.id}
              className={`mg-chip ${p.id === ops.activeProjectId ? 'active' : ''}`}
              onClick={() => ops.switchProject(p.id)}
              disabled={ops.anyBusy}
            >{p.name}</button>
          ))}
        </div>
        <div className="mg-tools">
          <button type="button" className={`mg-tool ${view === 'home' ? 'active' : ''}`} onClick={() => setView('home')}>Sync</button>
          <button type="button" className={`mg-tool ${view === 'settings' ? 'active' : ''}`} onClick={() => setView('settings')}>Settings</button>
          <button type="button" className="mg-tool" onClick={ops.toggleQR} disabled={ops.qrLoading}>Remote</button>
          <UISwitcher ui={ui} onChange={setUi} />
          <span className="mg-version">{ops.version}</span>
        </div>
      </header>
      {banner}
      <main className="mg-main">
        <div className="mg-view" style={{ display: view === 'home' ? undefined : 'none' }}><Home ops={ops} /></div>
        <div className="mg-view mg-settings" style={{ display: view === 'settings' ? undefined : 'none' }}><SettingsView /></div>
      </main>
      <RemoteDialog ops={ops} />
    </div>
  )
}
