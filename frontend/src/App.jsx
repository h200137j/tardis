import { useState, useEffect } from 'react'
import HomeView from './views/HomeView'
import SettingsView from './views/SettingsView'
import { GetVersion, CheckForUpdate, OpenURL } from '../wailsjs/go/main/App'
import './App.css'

export default function App() {
  const [view, setView]           = useState('home')
  const [version, setVersion]     = useState('')
  const [update, setUpdate]       = useState(null)
  const [dismissed, setDismissed] = useState(false)

  useEffect(() => {
    GetVersion().then(setVersion).catch(() => {})
    CheckForUpdate().then(info => {
      if (info.has_update) setUpdate(info)
    }).catch(() => {})
  }, [])

  return (
    <div className="app-shell">
      <nav className="nav">
        <div className="nav-brand">
          <span className="nav-logo">⏱</span>
          <span className="nav-title">TARDIS</span>
        </div>
        <div className="nav-sep" />
        <div className="nav-links">
          <button
            className={`nav-btn ${view === 'home' ? 'active' : ''}`}
            onClick={() => setView('home')}
          >Sync</button>
          <button
            className={`nav-btn ${view === 'settings' ? 'active' : ''}`}
            onClick={() => setView('settings')}
          >Settings</button>
        </div>
        {version && <span className="nav-version">{version}</span>}
      </nav>

      {update && !dismissed && (
        <div className="update-banner">
          <span>🚀</span>
          <span className="update-banner-text">
            <strong>{update.latest}</strong> is out
          </span>
          <button className="update-banner-btn" onClick={() => OpenURL(update.download_url)}>
            Download
          </button>
          <button
            className="update-banner-dismiss"
            onClick={() => setDismissed(true)}
            aria-label="Dismiss"
          >✕</button>
        </div>
      )}

      <main className="main-content">
        {view === 'home' ? <HomeView /> : <SettingsView />}
      </main>
    </div>
  )
}
