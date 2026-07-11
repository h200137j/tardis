import { useEffect, useRef } from 'react'

// Single "time vortex" animation: a warp tunnel of star streaks spiralling out
// from a glowing core, with a progress ring. Colour shifts with the sync phase.

const PHASE_COLORS = {
  dumping:     [255, 170, 70],   // amber — server working
  downloading: [91, 157, 255],   // TARDIS blue — in transit
  importing:   [61, 220, 151],   // green — writing to DB
  idle:        [122, 144, 255],  // indigo — spinning up
}

const PHASE_LABELS = {
  dumping:     'DUMPING ON SERVER',
  downloading: 'DOWNLOADING',
  importing:   'IMPORTING',
}

export default function AnimationCanvas({ isRunning, progress, phase }) {
  const canvasRef   = useRef(null)
  const progressRef = useRef(progress)
  const phaseRef    = useRef(phase)

  progressRef.current = progress
  phaseRef.current    = phase

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    const dpr = window.devicePixelRatio || 1
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    let w = 0, h = 0
    let raf

    const resize = () => {
      w = canvas.offsetWidth
      h = canvas.offsetHeight
      canvas.width  = w * dpr
      canvas.height = h * dpr
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      ctx.fillStyle = '#030712'
      ctx.fillRect(0, 0, w, h)
    }
    resize()
    const ro = new ResizeObserver(resize)
    ro.observe(canvas)

    const spawn = scattered => ({
      a:  Math.random() * Math.PI * 2,           // angle
      d:  scattered ? Math.random() : 0.02 + Math.random() * 0.1, // normalized distance
      v:  0.0012 + Math.random() * 0.0028,       // base speed
      lw: 0.5 + Math.random() * 1.5,
    })
    const parts = Array.from({ length: 150 }, () => spawn(true))

    const col = [...PHASE_COLORS.idle]
    let pulse = 0

    const frame = () => {
      const cx = w / 2, cy = h / 2
      const maxR = Math.hypot(w, h) / 2

      // ease colour toward the current phase
      const target = PHASE_COLORS[phaseRef.current] || PHASE_COLORS.idle
      for (let i = 0; i < 3; i++) col[i] += (target[i] - col[i]) * 0.045
      const r = Math.round(col[0]), g = Math.round(col[1]), b = Math.round(col[2])

      // fading trail
      ctx.fillStyle = 'rgba(3, 7, 18, 0.28)'
      ctx.fillRect(0, 0, w, h)

      pulse += 0.045

      // star streaks — accelerate outward with a slight spiral
      ctx.lineCap = 'round'
      for (const p of parts) {
        const px = cx + Math.cos(p.a) * p.d * maxR
        const py = cy + Math.sin(p.a) * p.d * maxR * 0.75
        p.d += p.v * (0.35 + p.d * 3.4)
        p.a += 0.006 * (1.35 - p.d)
        const nx = cx + Math.cos(p.a) * p.d * maxR
        const ny = cy + Math.sin(p.a) * p.d * maxR * 0.75
        const alpha = Math.min(1, p.d * 2.4) * 0.8
        ctx.strokeStyle = `rgba(${r},${g},${b},${alpha})`
        ctx.lineWidth = p.lw * (0.35 + p.d)
        ctx.beginPath()
        ctx.moveTo(px, py)
        ctx.lineTo(nx, ny)
        ctx.stroke()
        if (p.d > 1.08) Object.assign(p, spawn(false))
      }

      // core glow
      const orbR = 26 + Math.sin(pulse) * 2.2
      const halo = ctx.createRadialGradient(cx, cy, 0, cx, cy, orbR * 3.2)
      halo.addColorStop(0, `rgba(${r},${g},${b},0.30)`)
      halo.addColorStop(1, 'rgba(0,0,0,0)')
      ctx.fillStyle = halo
      ctx.fillRect(cx - orbR * 3.2, cy - orbR * 3.2, orbR * 6.4, orbR * 6.4)

      const core = ctx.createRadialGradient(cx, cy, 0, cx, cy, orbR)
      core.addColorStop(0, 'rgba(255,255,255,0.95)')
      core.addColorStop(0.4, `rgba(${r},${g},${b},0.8)`)
      core.addColorStop(1, `rgba(${r},${g},${b},0)`)
      ctx.fillStyle = core
      ctx.beginPath()
      ctx.arc(cx, cy, orbR, 0, Math.PI * 2)
      ctx.fill()

      // progress ring
      const ringR = orbR + 15
      const raw = progressRef.current
      const pct = Number.isFinite(raw) ? Math.max(0, Math.min(1, raw)) : 0

      ctx.lineWidth = 3
      ctx.strokeStyle = `rgba(${r},${g},${b},0.18)`
      ctx.beginPath()
      ctx.arc(cx, cy, ringR, 0, Math.PI * 2)
      ctx.stroke()

      ctx.shadowBlur = 12
      ctx.shadowColor = `rgba(${r},${g},${b},0.8)`
      ctx.strokeStyle = `rgba(${r},${g},${b},0.95)`
      ctx.beginPath()
      if (pct > 0) {
        ctx.arc(cx, cy, ringR, -Math.PI / 2, -Math.PI / 2 + pct * Math.PI * 2)
      } else {
        const s = pulse * 1.5
        ctx.arc(cx, cy, ringR, s, s + Math.PI * 0.55)
      }
      ctx.stroke()
      ctx.shadowBlur = 0

      if (pct > 0) {
        ctx.font = '600 12px "JetBrains Mono", monospace'
        ctx.textAlign = 'center'
        ctx.textBaseline = 'middle'
        ctx.fillStyle = 'rgba(4, 14, 30, 0.85)'
        ctx.fillText(`${Math.round(pct * 100)}%`, cx, cy)
      }

      // phase label
      const label = PHASE_LABELS[phaseRef.current]
      if (label) {
        ctx.font = '10px "JetBrains Mono", monospace'
        ctx.textAlign = 'right'
        ctx.textBaseline = 'alphabetic'
        ctx.fillStyle = `rgba(${r},${g},${b},0.7)`
        ctx.fillText(label, w - 14, h - 12)
      }

      if (!reduced) raf = requestAnimationFrame(frame)
    }
    raf = requestAnimationFrame(frame)

    return () => {
      cancelAnimationFrame(raf)
      ro.disconnect()
    }
  }, [])

  return <canvas ref={canvasRef} className="anim-canvas" />
}
