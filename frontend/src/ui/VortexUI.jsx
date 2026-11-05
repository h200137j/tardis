import SettingsView from '../views/SettingsView'
import { STATUS, describeRun, fmtClock } from '../hooks/useOperations'
import { UISwitcher, LogList, RemoteDialog } from './shared'
import './VortexUI.css'

const STATE_COLORS = { done: '#3DE8A0', error: '#FF6B7A', cancelled: '#FFAA46', idle: '#7B4DFF' }

function heroState(run) {
  if (run.running) {
    return {
      color: run.phase.color,
      label: run.phase.label,
      main:  run.pct != null ? `${run.pct}%` : fmtClock(run.time),
      sub:   run.pct != null ? fmtClock(run.time) : (run.tables != null ? `${run.tables} tables` : 'Running'),
    }
  }
  if (run.status === STATUS.DONE)      return { color: STATE_COLORS.done,      label: 'COMPLETE',  main: fmtClock(run.time), sub: 'Finished' }
  if (run.status === STATUS.ERROR)     return { color: STATE_COLORS.error,     label: 'FAILED',    main: fmtClock(run.time), sub: 'See activity' }
  if (run.status === STATUS.CANCELLED) return { color: STATE_COLORS.cancelled, label: 'CANCELLED', main: fmtClock(run.time), sub: 'Stopped' }
  return { color: STATE_COLORS.idle, label: 'STANDBY', main: 'READY', sub: null }
}

function actionNote(action, ops) {
  if (action.sync !== ops.active) return action.sub
  if (action.sync.status === STATUS.RUNNING)   return 'Running'
  if (action.sync.status === STATUS.DONE)      return 'Done. Run again'
  if (action.sync.status === STATUS.ERROR)     return 'Failed. Retry'
  if (action.sync.status === STATUS.CANCELLED) return 'Cancelled. Try again'
  return action.sub
}

function Home({ ops }) {
  const run  = describeRun(ops.active)
  const hero = heroState(run)
  const title = run.status === STATUS.IDLE ? 'Time vortex' : ops.activeAction.title

  return (
    <div className="vx-home">
      <section className={`vx-hero ${run.running ? 'vx-live' : ''}`} style={{ '--c': hero.color }} aria-live="polite">
        <div className="vx-hero-top">
          <span>{title}</span>
          {run.running && <button type="button" className="vx-pill vx-pill--cancel" onClick={ops.cancel}>Cancel</button>}
          {!run.running && run.status !== STATUS.IDLE && (
            <button type="button" className="vx-pill" onClick={ops.active.clear}>Clear</button>
          )}
        </div>
        <div className="vx-stage">
          <div className="vx-glow" aria-hidden="true" />
          <div className="vx-ring vx-a" aria-hidden="true" />
          <div className="vx-ring vx-b" aria-hidden="true" />
          <div className="vx-ring vx-c" aria-hidden="true" />
          <div className="vx-ring vx-d" aria-hidden="true" />
          <div className="vx-core">
            <span className="vx-core-label">{hero.label}</span>
            <span className="vx-core-main">{hero.main}</span>
            <span className="vx-core-sub">{hero.sub ?? ops.activeProject?.name ?? ''}</span>
          </div>
        </div>
        {run.size && <div className="vx-size">{run.size}</div>}
      </section>

      <section className="vx-actions" aria-label="Actions">
        {ops.actions.map(action => (
          <button
            type="button"
            key={action.key}
            className={`vx-card ${action.sync === ops.active && run.running ? 'vx-card--active' : ''}`}
            onClick={action.start}
            disabled={ops.anyBusy}
          >
            <span className="vx-card-title">{action.title}</span>
            <span className="vx-card-sub">{actionNote(action, ops)}</span>
          </button>
        ))}
      </section>

      <section className="vx-activity" aria-label="Activity">
        <LogList logs={ops.active.logs} empty="Ready. Pick an action." />
      </section>
    </div>
  )
}

export default function VortexUI({ ops, view, setView, ui, setUi, banner }) {
  return (
    <div className="vx-shell">
      <aside className="vx-side">
        <div className="vx-brand">TARDIS</div>
        <nav className="vx-group" aria-label="Views">
          <button type="button" className={`vx-nav ${view === 'home' ? 'active' : ''}`} onClick={() => setView('home')}>Sync</button>
          <button type="button" className={`vx-nav ${view === 'settings' ? 'active' : ''}`} onClick={() => setView('settings')}>Settings</button>
        </nav>
        <div className="vx-group">
          <div className="vx-group-label">Projects</div>
          {ops.projects.map(p => (
            <button
              type="button"
              key={p.id}
              className={`vx-nav ${p.id === ops.activeProjectId ? 'active' : ''}`}
              onClick={() => ops.switchProject(p.id)}
              disabled={ops.anyBusy}
            >{p.name}</button>
          ))}
        </div>
        <div className="vx-side-foot">
          <button type="button" className="vx-nav" onClick={ops.toggleQR} disabled={ops.qrLoading}>
            {ops.qrLoading ? 'Loading...' : 'Mobile remote'}
          </button>
          <UISwitcher ui={ui} onChange={setUi} className="vx-switcher" />
          <span className="vx-version">{ops.version}</span>
        </div>
      </aside>

      <main className="vx-main">
        {banner}
        <div className="vx-view" style={{ display: view === 'home' ? undefined : 'none' }}><Home ops={ops} /></div>
        <div className="vx-view vx-settings" style={{ display: view === 'settings' ? undefined : 'none' }}><SettingsView /></div>
      </main>
      <RemoteDialog ops={ops} />
    </div>
  )
}
