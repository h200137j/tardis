import { useEffect, useRef } from 'react'

const ANIMATIONS = [matrixRain, networkGraph, terminalTypewriter, particles, dbFill]

export default function AnimationCanvas({ animIndex, isRunning, progress, phase }) {
  const canvasRef   = useRef(null)
  const stateRef    = useRef({})
  const rafRef      = useRef(null)
  const progressRef = useRef(progress)
  const phaseRef    = useRef(phase)

  progressRef.current = progress
  phaseRef.current    = phase

  const fn = ANIMATIONS[animIndex % ANIMATIONS.length]

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    stateRef.current = {} // reset state on new animation

    const resize = () => {
      canvas.width  = canvas.offsetWidth
      canvas.height = canvas.offsetHeight
    }
    resize()
    const ro = new ResizeObserver(resize)
    ro.observe(canvas)

    let frame = 0
    const tick = () => {
      frame++
      fn(ctx, canvas.width, canvas.height, stateRef.current, frame, progressRef.current, phaseRef.current)
      rafRef.current = requestAnimationFrame(tick)
    }
    rafRef.current = requestAnimationFrame(tick)

    return () => {
      cancelAnimationFrame(rafRef.current)
      ro.disconnect()
    }
  }, [fn])  // eslint-disable-line react-hooks/exhaustive-deps

  return <canvas ref={canvasRef} className="anim-canvas" />
}

// ── phase colour helpers ──────────────────────────────────────────────────────
function phaseAccent(phase) {
  if (phase === 'dumping')    return { r: 255, g: 160, b: 50  } // amber — server work
  if (phase === 'downloading') return { r: 77,  g: 184, b: 255 } // blue  — transfer
  if (phase === 'importing')  return { r: 63,  g: 185, b: 80  } // green — writing to DB
  return { r: 77, g: 184, b: 255 }
}
function phaseRgb(phase, a = 1) {
  const c = phaseAccent(phase)
  return `rgba(${c.r},${c.g},${c.b},${a})`
}

// ── 1. Matrix Rain — adapts colour & speed per phase ─────────────────────────
function matrixRain(ctx, w, h, s, frame, progress, phase) {
  if (!s.cols) {
    s.cols  = Math.floor(w / 16)
    s.drops = Array.from({ length: s.cols }, () => Math.random() * -50)
    s.chars = '01アイウエオカキクケコサシスセソタチツテトナニヌネノ'
  }

  const speed  = phase === 'importing' ? 0.8 : phase === 'downloading' ? 0.6 : 0.4
  const head   = phaseRgb(phase, 1)
  const trail  = phaseRgb(phase, 0.35)

  ctx.fillStyle = 'rgba(10,12,18,0.15)'
  ctx.fillRect(0, 0, w, h)
  ctx.font = '13px monospace'

  for (let i = 0; i < s.cols; i++) {
    const char = s.chars[Math.floor(Math.random() * s.chars.length)]
    const x = i * 16
    const y = s.drops[i] * 16
    ctx.fillStyle = head
    ctx.fillText(char, x, y)
    ctx.fillStyle = trail
    ctx.fillText(s.chars[Math.floor(Math.random() * s.chars.length)], x, y - 16)
    if (y > h && Math.random() > 0.975) s.drops[i] = 0
    s.drops[i] += speed
  }

  // phase label
  drawPhaseLabel(ctx, w, h, phase)
}

// ── 2. Network Graph — download phase shows a beam sweeping left→right ────────
function networkGraph(ctx, w, h, s, frame, progress, phase) {
  if (!s.nodes) {
    s.nodes = Array.from({ length: 18 }, () => ({
      x: Math.random() * w, y: Math.random() * h,
      vx: (Math.random() - 0.5) * 0.4,
      vy: (Math.random() - 0.5) * 0.4,
      r: 2 + Math.random() * 3,
    }))
    s.packets = []
  }

  const spawnRate = phase === 'downloading' ? 8 : phase === 'importing' ? 12 : 20

  for (const n of s.nodes) {
    n.x += n.vx; n.y += n.vy
    if (n.x < 0 || n.x > w) n.vx *= -1
    if (n.y < 0 || n.y > h) n.vy *= -1
  }
  if (frame % spawnRate === 0) {
    const a = s.nodes[Math.floor(Math.random() * s.nodes.length)]
    const b = s.nodes[Math.floor(Math.random() * s.nodes.length)]
    if (a !== b) s.packets.push({ ax: a.x, ay: a.y, bx: b.x, by: b.y, t: 0 })
  }
  s.packets = s.packets.filter(p => p.t <= 1)
  for (const p of s.packets) p.t += phase === 'downloading' ? 0.04 : 0.025

  ctx.clearRect(0, 0, w, h)

  // download phase: progress beam
  if (phase === 'downloading' && progress > 0) {
    const beamX = w * progress
    const grad = ctx.createLinearGradient(0, 0, beamX, 0)
    grad.addColorStop(0, 'rgba(77,184,255,0.04)')
    grad.addColorStop(1, 'rgba(77,184,255,0.12)')
    ctx.fillStyle = grad
    ctx.fillRect(0, 0, beamX, h)
    ctx.strokeStyle = 'rgba(77,184,255,0.4)'
    ctx.lineWidth = 1.5
    ctx.beginPath(); ctx.moveTo(beamX, 0); ctx.lineTo(beamX, h); ctx.stroke()
  }

  const ac = phaseAccent(phase)
  // edges
  for (let i = 0; i < s.nodes.length; i++) {
    for (let j = i + 1; j < s.nodes.length; j++) {
      const dx = s.nodes[i].x - s.nodes[j].x
      const dy = s.nodes[i].y - s.nodes[j].y
      const dist = Math.sqrt(dx * dx + dy * dy)
      if (dist < 120) {
        ctx.strokeStyle = `rgba(${ac.r},${ac.g},${ac.b},${(1 - dist / 120) * 0.35})`
        ctx.lineWidth = 0.8
        ctx.beginPath()
        ctx.moveTo(s.nodes[i].x, s.nodes[i].y)
        ctx.lineTo(s.nodes[j].x, s.nodes[j].y)
        ctx.stroke()
      }
    }
  }
  for (const p of s.packets) {
    const x = p.ax + (p.bx - p.ax) * p.t
    const y = p.ay + (p.by - p.ay) * p.t
    ctx.beginPath(); ctx.arc(x, y, 3, 0, Math.PI * 2)
    ctx.fillStyle = phaseRgb(phase)
    ctx.shadowBlur = 8; ctx.shadowColor = phaseRgb(phase); ctx.fill(); ctx.shadowBlur = 0
  }
  for (const n of s.nodes) {
    ctx.beginPath(); ctx.arc(n.x, n.y, n.r, 0, Math.PI * 2)
    ctx.fillStyle = `rgba(${ac.r},${ac.g},${ac.b},0.5)`
    ctx.fill()
    ctx.strokeStyle = phaseRgb(phase, 0.8); ctx.lineWidth = 1; ctx.stroke()
  }

  drawPhaseLabel(ctx, w, h, phase)
}

// ── 3. Terminal Typewriter ────────────────────────────────────────────────────
const TERMINAL_LINES = [
  '> bribing the database with coffee...',
  '> asking rows to move voluntarily...',
  '> untangling foreign keys...',
  '> convincing MySQL this is fine...',
  '> teaching tables to pack light...',
  '> negotiating with the server...',
  '> applying percussive maintenance...',
  '> have you tried turning it off and on?',
  '> summoning the data spirits...',
  '> rows: "do we have to?" us: "yes"',
  '> compressing your problems away...',
  '> this is fine. everything is fine.',
  '> counting to a million... 1... 2...',
  '> asking nicely: please export',
  '> the database said "hold on"',
  '> reticulating splines...',
  '> downloading more RAM...',
  '> blaming the intern...',
  '> it works on my machine ¯\\_(ツ)_/¯',
  '> have you considered a spreadsheet?',
  '> rows filing out in an orderly fashion',
  '> gzip: squishing data like a stress ball',
  '> ssh tunnel: "I am the law"',
  '> mysqldump: "this is my moment"',
  '> tables: "we barely knew each other"',
  '> indexes: "nobody appreciates us"',
  '> foreign keys: "we have trust issues"',
  '> NULL values: "we exist and yet..."',
  '> auto_increment: "and another one"',
  '> asking data to sit still...',
  '> the bits are moving, we promise',
  '> caffeinating the transfer process...',
  '> rows boarding the SFTP express...',
  '> no data was harmed in this transfer',
  '> ctrl+z is not available right now',
  '> your patience is appreciated (really)',
  '> loading loading loading...',
  '> almost there (we think)',
  '> the hamsters are running faster',
  '> sending data via carrier pigeon...',
  '> pigeon arrived. unpacking...',
  '> SELECT * FROM patience WHERE remaining > 0',
  '> UPDATE mood SET value = "hopeful"',
  '> DROP TABLE fears -- just kidding',
  '> INSERT INTO progress VALUES (almost_done)',
  '> WHERE is the end? LIMIT 1',
  '> JOIN us in waiting...',
  '> ORDER BY speed DESC -- not working',
  '> COMMIT; -- fingers crossed',
  '> done? not yet. soon. maybe. yes.',
]

function terminalTypewriter(ctx, w, h, s, frame, progress, phase) {
  if (!s.lines) { s.lines = []; s.charIdx = 0; s.lineIdx = 0; s.tick = 0 }
  // faster typing during import (more activity)
  const tickRate = phase === 'importing' ? 2 : phase === 'downloading' ? 3 : 4
  s.tick++
  if (s.tick % tickRate === 0) {
    const src = TERMINAL_LINES[s.lineIdx % TERMINAL_LINES.length]
    if (s.charIdx < src.length) {
      if (!s.lines[s.lines.length - 1] || s.lines[s.lines.length - 1].done)
        s.lines.push({ text: '', done: false })
      s.lines[s.lines.length - 1].text += src[s.charIdx]
      s.charIdx++
    } else {
      if (s.lines.length > 0) s.lines[s.lines.length - 1].done = true
      s.lineIdx++; s.charIdx = 0
      if (s.lines.length > 12) s.lines.shift()
    }
  }

  ctx.clearRect(0, 0, w, h)
  ctx.font = '12px "JetBrains Mono", monospace'
  const lineH = 20
  const startY = h - s.lines.length * lineH - 10
  s.lines.forEach((line, i) => {
    const alpha = 0.3 + (i / s.lines.length) * 0.7
    ctx.fillStyle = phaseRgb(phase, alpha)
    ctx.fillText(line.text + (i === s.lines.length - 1 && !line.done ? '█' : ''), 16, startY + i * lineH)
  })

  drawPhaseLabel(ctx, w, h, phase)
}

// ── 4. Particles — density and speed vary by phase ────────────────────────────
function particles(ctx, w, h, s, frame, progress, phase) {
  if (!s.pts) {
    s.pts = Array.from({ length: 70 }, () => ({
      x: Math.random() * w, y: Math.random() * h,
      vx: (Math.random() - 0.5) * 0.6,
      vy: (Math.random() - 0.5) * 0.6,
      r: 1 + Math.random() * 2,
      phase: Math.random() * Math.PI * 2,
    }))
  }
  const speed = phase === 'importing' ? 1.4 : phase === 'downloading' ? 1.0 : 0.6
  ctx.clearRect(0, 0, w, h)
  for (const p of s.pts) {
    p.x += p.vx * speed; p.y += p.vy * speed; p.phase += 0.02
    if (p.x < 0) p.x = w; if (p.x > w) p.x = 0
    if (p.y < 0) p.y = h; if (p.y > h) p.y = 0
  }
  const ac = phaseAccent(phase)
  for (let i = 0; i < s.pts.length; i++) {
    for (let j = i + 1; j < s.pts.length; j++) {
      const dx = s.pts[i].x - s.pts[j].x
      const dy = s.pts[i].y - s.pts[j].y
      const d = Math.sqrt(dx * dx + dy * dy)
      if (d < 90) {
        ctx.strokeStyle = `rgba(${ac.r},${ac.g},${ac.b},${(1 - d / 90) * 0.35})`
        ctx.lineWidth = 0.6
        ctx.beginPath()
        ctx.moveTo(s.pts[i].x, s.pts[i].y)
        ctx.lineTo(s.pts[j].x, s.pts[j].y)
        ctx.stroke()
      }
    }
  }
  for (const p of s.pts) {
    const glow = 0.5 + 0.5 * Math.sin(p.phase)
    ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2)
    ctx.fillStyle = `rgba(${ac.r},${ac.g},${ac.b},${0.4 + glow * 0.6})`
    ctx.fill()
  }
  drawPhaseLabel(ctx, w, h, phase)
}

// ── 5. DB Cylinder Fill — fills up during import, pulses during other phases ──
function dbFill(ctx, w, h, s, frame, progress, phase) {
  if (!s.init) { s.init = true; s.wave = 0; s.pulse = 0 }
  s.wave  += 0.04
  s.pulse += 0.03

  const cx   = w / 2
  const cy   = h / 2
  const rx   = Math.min(w, h) * 0.28
  const ry   = rx * 0.28
  const cylH = Math.min(w, h) * 0.55
  const top  = cy - cylH / 2
  const bot  = cy + cylH / 2

  // during non-import phases, animate a slow idle fill
  let pct
  if (phase === 'importing') {
    pct = Math.max(0.05, Math.min(1, progress))
  } else if (phase === 'downloading') {
    pct = 0.15 + 0.1 * Math.sin(s.pulse) // gentle pulse
  } else {
    pct = 0.08 + 0.05 * Math.sin(s.pulse)
  }

  const fillY = bot - cylH * pct
  const ac = phaseAccent(phase)

  ctx.clearRect(0, 0, w, h)

  // cylinder clip
  ctx.save()
  ctx.beginPath()
  ctx.ellipse(cx, bot, rx, ry, 0, 0, Math.PI)
  ctx.ellipse(cx, top, rx, ry, 0, Math.PI, 0)
  ctx.closePath()
  ctx.clip()

  ctx.fillStyle = '#0d1520'
  ctx.fillRect(cx - rx, top - ry, rx * 2, cylH + ry * 2)

  ctx.beginPath()
  ctx.moveTo(cx - rx, fillY)
  for (let x = cx - rx; x <= cx + rx; x += 2) {
    ctx.lineTo(x, fillY + Math.sin((x * 0.05) + s.wave) * 4)
  }
  ctx.lineTo(cx + rx, bot + ry)
  ctx.lineTo(cx - rx, bot + ry)
  ctx.closePath()
  const grad = ctx.createLinearGradient(cx, fillY, cx, bot)
  grad.addColorStop(0, `rgba(${ac.r},${ac.g},${ac.b},0.9)`)
  grad.addColorStop(1, `rgba(${Math.round(ac.r*0.3)},${Math.round(ac.g*0.3)},${Math.round(ac.b*0.3)},0.9)`)
  ctx.fillStyle = grad
  ctx.fill()
  ctx.restore()

  // outline
  ctx.strokeStyle = `rgba(${ac.r},${ac.g},${ac.b},0.5)`
  ctx.lineWidth = 1.5
  ctx.beginPath(); ctx.moveTo(cx - rx, top); ctx.lineTo(cx - rx, bot); ctx.stroke()
  ctx.beginPath(); ctx.moveTo(cx + rx, top); ctx.lineTo(cx + rx, bot); ctx.stroke()
  ctx.beginPath(); ctx.ellipse(cx, bot, rx, ry, 0, 0, Math.PI * 2); ctx.stroke()
  ctx.beginPath(); ctx.ellipse(cx, top, rx, ry, 0, 0, Math.PI * 2); ctx.stroke()

  // label
  ctx.fillStyle = `rgba(${ac.r},${ac.g},${ac.b},0.9)`
  ctx.font = `bold ${Math.round(rx * 0.45)}px sans-serif`
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
  ctx.fillText(
    phase === 'importing' ? `${Math.round(pct * 100)}%`
    : phase === 'downloading' ? '↓'
    : '⏳',
    cx, cy
  )
  ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic'

  drawPhaseLabel(ctx, w, h, phase)
}

// ── shared phase label ────────────────────────────────────────────────────────
function drawPhaseLabel(ctx, w, h, phase) {
  if (!phase || phase === 'idle') return
  const labels = { dumping: '⚙ Dumping on server', downloading: '⬇ Downloading', importing: '💾 Importing' }
  const label = labels[phase] || ''
  ctx.font = '11px sans-serif'
  ctx.fillStyle = phaseRgb(phase, 0.6)
  ctx.textAlign = 'right'
  ctx.fillText(label, w - 12, h - 10)
  ctx.textAlign = 'left'
}
