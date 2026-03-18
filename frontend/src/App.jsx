import { useState } from 'react'
import HomeView from './views/HomeView'
import SettingsView from './views/SettingsView'
import './App.css'

export default function App() {
  const [view, setView] = useState('home')

  return (
    <div className="app-shell">
      <nav className="nav">
        <div className="nav-brand">
          <span className="nav-logo">⏱</span>
          <span className="nav-title">TARDIS</span>
          <span className="nav-sub">Transfer And Retrieve Database In Seconds</span>
        </div>
        <div className="nav-links">
          <button
            className={`nav-btn ${view === 'home' ? 'active' : ''}`}
            onClick={() => setView('home')}
          >
            Sync
          </button>
          <button
            className={`nav-btn ${view === 'settings' ? 'active' : ''}`}
            onClick={() => setView('settings')}
          >
            Settings
          </button>
        </div>
      </nav>

      <main className="main-content">
        {view === 'home' ? <HomeView /> : <SettingsView />}
      </main>

      <footer className="footer">
        made with ❤️ by uriel
      </footer>
    </div>
  )
}
