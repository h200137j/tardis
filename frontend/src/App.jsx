import { useState, useEffect } from 'react'
import HomeView from './views/HomeView'
import SettingsView from './views/SettingsView'
import { GetVersion, CheckForUpdate, OpenURL } from '../wailsjs/go/main/App'
import './App.css'

export default function App() {
  const [view, setView]       = useState('home')
  const [version, setVersion] = useState('')
  const [update, setUpdate]   = useState(null)   // UpdateInfo | null
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
          <span className="nav-sub">Transfer And Retrieve Database In Seconds</span>
        </div>
        <div className="nav-links">
          <button className={`nav-btn ${view === 'home' ? 'active' : ''}`} onClick={() => setView('home')}>Sync</button>
          <button className={`nav-btn ${view === 'settings' ? 'active' : ''}`} onClick={() => setView('settings')}>Settings</button>
        </div>
      </nav>

      {update && !dismissed && (
        <div className="update-banner">
          <span className="update-banner-icon">🚀</span>
          <span className="update-banner-text">
            Update available — <strong>{update.latest}</strong> is out
          </span>
          <button className="update-banner-btn" onClick={() => OpenURL(update.download_url)}>
            Download
          </button>
          <button className="update-banner-dismiss" onClick={() => setDismissed(true)} aria-label="Dismiss">✕</button>
        </div>
      )}

      <main className="main-content">
        {view === 'home' ? <HomeView /> : <SettingsView />}
      </main>

      <footer className="footer">
        <span>made with ❤️ by uriel</span>
        {version && <span className="footer-version">{version}</span>}
      </footer>
    </div>
  )
}
