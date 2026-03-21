import { useEffect, useRef } from 'react'

// 5 animations, cycle through them per-run
const ANIMATIONS = [matrixRain, networkGraph, terminalTypewriter, particles, dbFill]

export default function AnimationCanvas({ animIndex, isRunning, progress }) {
  const canvasRef   = useRef(null)
  const stateRef    = useRef({})
  const rafRef      = useRef(null)
  const progressRef = useRef(progress)

  // Update progress ref without triggering re-mount
  progressRef.current = progress

  const fn = ANIMATIONS[animIndex % ANIMATIONS.length]

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')

    const resize = () => {
      canvas.width  = canvas.offsetWidth
      canvas.height = canvas.offsetHeight
      // don't reset stateRef on resize — keep animation state continuous
    }
    resize()
    const ro = new ResizeObserver(resize)
    ro.observe(canvas)

    let frame = 0
    const tick = () => {
      frame++
      fn(ctx, canvas.width, canvas.height, stateRef.current, frame, progressRef.current)
      rafRef.current = requestAnimationFrame(tick)
    }

    rafRef.current = requestAnimationFrame(tick)

    return () => {
      cancelAnimationFrame(rafRef.current)
      ro.disconnect()
    }
  // Only re-mount when the animation type changes (new operation), NOT on progress/isRunning changes
  }, [fn]) // eslint-disable-line react-hooks/exhaustive-deps

  return <canvas ref={canvasRef} className="anim-canvas" />
}

// ── 1. Matrix Rain ────────────────────────────────────────────────────────────
function matrixRain(ctx, w, h, s, frame) {
  if (!s.cols) {
    const cols = Math.floor(w / 16)
    s.cols = cols
    s.drops = Array.from({ length: cols }, () => Math.random() * -50)
    s.chars = '01アイウエオカキクケコサシスセソタチツテトナニヌネノ'
  }
  ctx.fillStyle = 'rgba(10,12,18,0.18)'
  ctx.fillRect(0, 0, w, h)
  ctx.font = '13px monospace'
  for (let i = 0; i < s.cols; i++) {
    const char = s.chars[Math.floor(Math.random() * s.chars.length)]
    const x = i * 16
    const y = s.drops[i] * 16
    // head glow
    ctx.fillStyle = '#a0d8ff'
    ctx.fillText(char, x, y)
    // trail
    ctx.fillStyle = '#1e6fa8'
    ctx.fillText(s.chars[Math.floor(Math.random() * s.chars.length)], x, y - 16)
    if (y > h && Math.random() > 0.975) s.drops[i] = 0
    s.drops[i] += 0.5
  }
}

// ── 2. Network Graph ──────────────────────────────────────────────────────────
function networkGraph(ctx, w, h, s, frame) {
  if (!s.nodes) {
    s.nodes = Array.from({ length: 18 }, () => ({
      x: Math.random() * w,
      y: Math.random() * h,
      vx: (Math.random() - 0.5) * 0.4,
      vy: (Math.random() - 0.5) * 0.4,
      r: 2 + Math.random() * 3,
    }))
    s.packets = []
  }
  // move nodes
  for (const n of s.nodes) {
    n.x += n.vx; n.y += n.vy
    if (n.x < 0 || n.x > w) n.vx *= -1
    if (n.y < 0 || n.y > h) n.vy *= -1
  }
  // spawn packets
  if (frame % 18 === 0) {
    const a = s.nodes[Math.floor(Math.random() * s.nodes.length)]
    const b = s.nodes[Math.floor(Math.random() * s.nodes.length)]
    if (a !== b) s.packets.push({ ax: a.x, ay: a.y, bx: b.x, by: b.y, t: 0 })
  }
  s.packets = s.packets.filter(p => p.t <= 1)
  for (const p of s.packets) p.t += 0.025

  ctx.clearRect(0, 0, w, h)
  // edges
  for (let i = 0; i < s.nodes.length; i++) {
    for (let j = i + 1; j < s.nodes.length; j++) {
      const dx = s.nodes[i].x - s.nodes[j].x
      const dy = s.nodes[i].y - s.nodes[j].y
      const dist = Math.sqrt(dx * dx + dy * dy)
      if (dist < 120) {
        ctx.strokeStyle = `rgba(42,100,160,${1 - dist / 120})`
        ctx.lineWidth = 0.8
        ctx.beginPath()
        ctx.moveTo(s.nodes[i].x, s.nodes[i].y)
        ctx.lineTo(s.nodes[j].x, s.nodes[j].y)
        ctx.stroke()
      }
    }
  }
  // packets
  for (const p of s.packets) {
    const x = p.ax + (p.bx - p.ax) * p.t
    const y = p.ay + (p.by - p.ay) * p.t
    ctx.beginPath()
    ctx.arc(x, y, 3, 0, Math.PI * 2)
    ctx.fillStyle = '#4db8ff'
    ctx.fill()
    ctx.shadowBlur = 8; ctx.shadowColor = '#4db8ff'
    ctx.fill()
    ctx.shadowBlur = 0
  }
  // nodes
  for (const n of s.nodes) {
    ctx.beginPath()
    ctx.arc(n.x, n.y, n.r, 0, Math.PI * 2)
    ctx.fillStyle = '#1e6fa8'
    ctx.fill()
    ctx.strokeStyle = '#4db8ff'
    ctx.lineWidth = 1
    ctx.stroke()
  }
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
function terminalTypewriter(ctx, w, h, s, frame) {
  if (!s.lines) {
    s.lines = []
    s.charIdx = 0
    s.lineIdx = 0
    s.tick = 0
  }
  s.tick++
  if (s.tick % 3 === 0) {
    const src = TERMINAL_LINES[s.lineIdx % TERMINAL_LINES.length]
    if (s.charIdx < src.length) {
      if (!s.lines[s.lines.length - 1] || s.lines[s.lines.length - 1].done) {
        s.lines.push({ text: '', done: false })
      }
      s.lines[s.lines.length - 1].text += src[s.charIdx]
      s.charIdx++
    } else {
      if (s.lines.length > 0) s.lines[s.lines.length - 1].done = true
      s.lineIdx++
      s.charIdx = 0
      if (s.lines.length > 10) s.lines.shift()
    }
  }

  ctx.clearRect(0, 0, w, h)
  ctx.font = '12px "JetBrains Mono", monospace'
  const lineH = 20
  const startY = h - s.lines.length * lineH - 10
  s.lines.forEach((line, i) => {
    const alpha = 0.3 + (i / s.lines.length) * 0.7
    ctx.fillStyle = line.text.startsWith('>') ? `rgba(74,180,255,${alpha})` : `rgba(160,220,160,${alpha})`
    ctx.fillText(line.text + (i === s.lines.length - 1 && !line.done ? '█' : ''), 16, startY + i * lineH)
  })
}

// ── 4. Particles / Constellation ─────────────────────────────────────────────
function particles(ctx, w, h, s, frame) {
  if (!s.pts) {
    s.pts = Array.from({ length: 60 }, () => ({
      x: Math.random() * w, y: Math.random() * h,
      vx: (Math.random() - 0.5) * 0.6,
      vy: (Math.random() - 0.5) * 0.6,
      r: 1 + Math.random() * 2,
      phase: Math.random() * Math.PI * 2,
    }))
  }
  ctx.clearRect(0, 0, w, h)
  for (const p of s.pts) {
    p.x += p.vx; p.y += p.vy; p.phase += 0.02
    if (p.x < 0) p.x = w; if (p.x > w) p.x = 0
    if (p.y < 0) p.y = h; if (p.y > h) p.y = 0
  }
  // connections
  for (let i = 0; i < s.pts.length; i++) {
    for (let j = i + 1; j < s.pts.length; j++) {
      const dx = s.pts[i].x - s.pts[j].x
      const dy = s.pts[i].y - s.pts[j].y
      const d = Math.sqrt(dx * dx + dy * dy)
      if (d < 90) {
        ctx.strokeStyle = `rgba(74,140,255,${(1 - d / 90) * 0.4})`
        ctx.lineWidth = 0.6
        ctx.beginPath()
        ctx.moveTo(s.pts[i].x, s.pts[i].y)
        ctx.lineTo(s.pts[j].x, s.pts[j].y)
        ctx.stroke()
      }
    }
  }
  // dots
  for (const p of s.pts) {
    const glow = 0.5 + 0.5 * Math.sin(p.phase)
    ctx.beginPath()
    ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2)
    ctx.fillStyle = `rgba(100,180,255,${0.4 + glow * 0.6})`
    ctx.fill()
  }
}

// ── 5. Database Cylinder Fill ─────────────────────────────────────────────────
function dbFill(ctx, w, h, s, frame, progress) {
  if (!s.init) { s.init = true; s.wave = 0 }
  s.wave += 0.04

  const cx = w / 2
  const cy = h / 2
  const rx = Math.min(w, h) * 0.28
  const ry = rx * 0.28
  const cylH = Math.min(w, h) * 0.55
  const top = cy - cylH / 2
  const bot = cy + cylH / 2
  const pct = Math.max(0, Math.min(1, progress))
  const fillY = bot - cylH * pct

  ctx.clearRect(0, 0, w, h)

  // cylinder body clip
  ctx.save()
  ctx.beginPath()
  ctx.ellipse(cx, bot, rx, ry, 0, 0, Math.PI)
  ctx.ellipse(cx, top, rx, ry, 0, Math.PI, 0)
  ctx.closePath()
  ctx.clip()

  // background
  ctx.fillStyle = '#0d1520'
  ctx.fillRect(cx - rx, top - ry, rx * 2, cylH + ry * 2)

  // liquid fill with wave
  ctx.beginPath()
  ctx.moveTo(cx - rx, fillY)
  for (let x = cx - rx; x <= cx + rx; x += 2) {
    const wave = Math.sin((x * 0.05) + s.wave) * 4
    ctx.lineTo(x, fillY + wave)
  }
  ctx.lineTo(cx + rx, bot + ry)
  ctx.lineTo(cx - rx, bot + ry)
  ctx.closePath()
  const grad = ctx.createLinearGradient(cx, fillY, cx, bot)
  grad.addColorStop(0, '#1a6fa8')
  grad.addColorStop(1, '#0a2a40')
  ctx.fillStyle = grad
  ctx.fill()

  ctx.restore()

  // cylinder outline
  ctx.strokeStyle = '#2a6090'
  ctx.lineWidth = 1.5
  // left side
  ctx.beginPath()
  ctx.moveTo(cx - rx, top)
  ctx.lineTo(cx - rx, bot)
  ctx.stroke()
  // right side
  ctx.beginPath()
  ctx.moveTo(cx + rx, top)
  ctx.lineTo(cx + rx, bot)
  ctx.stroke()
  // bottom ellipse
  ctx.beginPath()
  ctx.ellipse(cx, bot, rx, ry, 0, 0, Math.PI * 2)
  ctx.stroke()
  // top ellipse
  ctx.beginPath()
  ctx.ellipse(cx, top, rx, ry, 0, 0, Math.PI * 2)
  ctx.stroke()

  // percentage text
  ctx.fillStyle = '#a0d8ff'
  ctx.font = `bold ${Math.round(rx * 0.45)}px sans-serif`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText(`${Math.round(pct * 100)}%`, cx, cy)
  ctx.textAlign = 'left'
  ctx.textBaseline = 'alphabetic'
}
