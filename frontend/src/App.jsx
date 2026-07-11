import { useState, useEffect, useRef } from 'react'
import HomeView from './views/HomeView'
import SettingsView from './views/SettingsView'
import { GetVersion, CheckForUpdate, OpenURL } from '../wailsjs/go/main/App'
import './App.css'

function getInitialDark() {
  const stored = localStorage.getItem('theme')
  if (stored) return stored === 'dark'
  return window.matchMedia('(prefers-color-scheme: dark)').matches
}

function Starfield() {
  const canvasRef = useRef(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    const dpr = window.devicePixelRatio || 1
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    let w = 0, h = 0
    let raf

    const resize = () => {
      w = window.innerWidth
      h = window.innerHeight
      canvas.width = w * dpr
      canvas.height = h * dpr
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    }
    resize()
    window.addEventListener('resize', resize)

    const stars = Array.from({ length: 110 }, () => ({
      x: Math.random(),
      y: Math.random(),
      r: 0.4 + Math.random() * 1.3,
      tw: Math.random() * Math.PI * 2,
      ts: 0.008 + Math.random() * 0.02,
      vy: 0.008 + Math.random() * 0.02,
    }))

    let streak = null
    let streakCooldown = 400

    const draw = () => {
      const dark = document.documentElement.getAttribute('data-theme') === 'dark'
      ctx.clearRect(0, 0, w, h)

      for (const s of stars) {
        s.tw += s.ts
        if (!reduced) {
          s.y += s.vy / h
          if (s.y > 1.02) { s.y = -0.02; s.x = Math.random() }
        }
        const twinkle = 0.5 + 0.5 * Math.sin(s.tw)
        const alpha = dark ? 0.12 + twinkle * 0.3 : 0.05 + twinkle * 0.12
        ctx.beginPath()
        ctx.arc(s.x * w, s.y * h, s.r, 0, Math.PI * 2)
        ctx.fillStyle = dark
          ? `rgba(170, 200, 255, ${alpha})`
          : `rgba(29, 80, 180, ${alpha})`
        ctx.fill()
      }

      if (!reduced) {
        if (!streak && --streakCooldown <= 0) {
          streak = {
            x: Math.random() * w * 0.7 + w * 0.15,
            y: Math.random() * h * 0.3,
            vx: 4 + Math.random() * 3,
            vy: 2 + Math.random() * 1.5,
            life: 1,
          }
          streakCooldown = 500 + Math.random() * 700
        }
        if (streak) {
          streak.x += streak.vx
          streak.y += streak.vy
          streak.life -= 0.02
          if (streak.life <= 0) streak = null
          else {
            const a = streak.life * (dark ? 0.5 : 0.25)
            const grad = ctx.createLinearGradient(
              streak.x, streak.y,
              streak.x - streak.vx * 10, streak.y - streak.vy * 10
            )
            grad.addColorStop(0, dark ? `rgba(200, 220, 255, ${a})` : `rgba(29, 80, 180, ${a})`)
            grad.addColorStop(1, 'rgba(0,0,0,0)')
            ctx.strokeStyle = grad
            ctx.lineWidth = 1.4
            ctx.lineCap = 'round'
            ctx.beginPath()
            ctx.moveTo(streak.x, streak.y)
            ctx.lineTo(streak.x - streak.vx * 10, streak.y - streak.vy * 10)
            ctx.stroke()
          }
        }
      }

      raf = requestAnimationFrame(draw)
    }
    raf = requestAnimationFrame(draw)

    return () => {
      cancelAnimationFrame(raf)
      window.removeEventListener('resize', resize)
    }
  }, [])

  return <canvas ref={canvasRef} className="starfield" aria-hidden="true" />
}

function BoxLogo() {
  return (
    <svg width="13" height="15" viewBox="0 0 13 15" fill="none" aria-hidden="true">
      <rect x="1.5" y="3.5" width="10" height="10.5" rx="1.2" stroke="currentColor" strokeWidth="1.4" />
      <line x1="6.5" y1="3.5" x2="6.5" y2="14" stroke="currentColor" strokeWidth="1" opacity="0.6" />
      <line x1="1.5" y1="8.75" x2="11.5" y2="8.75" stroke="currentColor" strokeWidth="1" opacity="0.6" />
      <circle cx="6.5" cy="1.4" r="1.15" fill="currentColor" />
    </svg>
  )
}

function SunIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
    </svg>
  )
}

function MoonIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z" />
    </svg>
  )
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
    <>
      <Starfield />
      <div className="app-shell">
        <nav className="nav">
          <div className="nav-brand">
            <span className="nav-logo"><BoxLogo /></span>
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
            {dark ? <SunIcon /> : <MoonIcon />}
          </button>
          {version && <span className="nav-version">{version}</span>}
        </nav>

        {update && !dismissed && (
          <div className="update-banner">
            <span className="update-banner-lamp" />
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
          <div
            className={view === 'home' ? 'view-active' : ''}
            style={{ display: view === 'home' ? undefined : 'none' }}
          ><HomeView /></div>
          <div
            className={view === 'settings' ? 'view-active' : ''}
            style={{ display: view === 'settings' ? undefined : 'none' }}
          ><SettingsView /></div>
        </main>

        <footer className="app-footer">made with ❤️ by uriel</footer>
      </div>
    </>
  )
}
