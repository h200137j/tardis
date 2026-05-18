import { useState, useEffect } from 'react'
import HomeView from './views/HomeView'
import SettingsView from './views/SettingsView'
import { GetVersion, CheckForUpdate, OpenURL } from '../wailsjs/go/main/App'
import './App.css'

function getInitialDark() {
  const stored = localStorage.getItem('theme')
  if (stored) return stored === 'dark'
  return window.matchMedia('(prefers-color-scheme: dark)').matches
}

export default function App() {
  const [view, setView]           = useState('home')
  const [version, setVersion]     = useState('')
  const [update, setUpdate]       = useState(null)
  const [dismissed, setDismissed] = useState(false)
  const [dark, setDark]           = useState(getInitialDark)

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light')
    localStorage.setItem('theme', dark ? 'dark' : 'light')
  }, [dark])

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
        <button
          className="nav-theme-btn"
          onClick={() => setDark(d => !d)}
          aria-label="Toggle dark mode"
          title={dark ? 'Switch to light mode' : 'Switch to dark mode'}
        >
          {dark ? '☀︎' : '◑'}
        </button>
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
        <div style={{ display: view === 'home' ? undefined : 'none' }}><HomeView /></div>
        <div style={{ display: view === 'settings' ? undefined : 'none' }}><SettingsView /></div>
      </main>

      <footer className="app-footer">made with ❤️ by uriel</footer>
    </div>
  )
}
