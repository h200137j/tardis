import { useEffect, useRef } from 'react'
import './shared.css'

export const UI_OPTIONS = [
  { id: 'vortex',  label: 'Vortex Core',  short: 'Vortex' },
  { id: 'mission', label: 'Mission Grid', short: 'Mission' },
  { id: 'classic', label: 'Classic',      short: 'Classic' },
]

// Custom buttons, not <select>: WebKitGTK draws native selects white and ignores
// the dark styling, which left the label invisible.
export function UISwitcher({ ui, onChange, className = '' }) {
  return (
    <div className={`ui-switcher ${className}`}>
      <span className="ui-switcher-label" id="ui-switcher-label">Interface</span>
      <div className="ui-switcher-options" role="group" aria-labelledby="ui-switcher-label">
        {UI_OPTIONS.map(o => (
          <button
            type="button"
            key={o.id}
            className={o.id === ui ? 'active' : ''}
            aria-pressed={o.id === ui}
            title={o.label}
            onClick={() => onChange(o.id)}
          >{o.short}</button>
        ))}
      </div>
    </div>
  )
}

export function LogList({ logs, className = '', empty }) {
  const boxRef = useRef(null)

  useEffect(() => {
    const box = boxRef.current
    if (box) box.scrollTop = box.scrollHeight
  }, [logs])

  return (
    <div ref={boxRef} className={`ui-log ${className}`} role="log" aria-live="polite">
      {logs.length === 0 && <div className="ui-log-line ui-log-empty">{empty}</div>}
      {logs.map((entry, i) => (
        <div key={i} className={`ui-log-line ui-log-${entry.type}`}>
          <span className="ui-log-ts">{entry.ts}</span>
          <span className="ui-log-msg">{entry.text}</span>
        </div>
      ))}
    </div>
  )
}

export function RemoteDialog({ ops }) {
  if (!ops.qrOpen || !ops.qrImg) return null
  return (
    <div className="ui-remote-backdrop" onClick={ops.toggleQR}>
      <div
        className="ui-remote"
        role="dialog"
        aria-modal="true"
        aria-label="TARDIS Remote"
        onClick={e => e.stopPropagation()}
      >
        <img src={ops.qrImg} alt="Scan to open TARDIS Remote" />
        <div className="ui-remote-body">
          <h2>TARDIS Remote</h2>
          <p>Scan with your phone to trigger syncs from your network.</p>
          <p className="ui-remote-url">{ops.qrUrl}</p>
          <p>Same Wi-Fi required</p>
          <button type="button" onClick={ops.toggleQR}>Close</button>
        </div>
      </div>
    </div>
  )
}
