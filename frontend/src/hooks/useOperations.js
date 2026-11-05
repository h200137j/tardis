import { useState, useEffect, useRef, useCallback } from 'react'
import { EventsOn } from '../../wailsjs/runtime/runtime'
import {
  SyncDatabase, SyncToTest, SyncAndImportLocal, PickFile, ImportLocal, Cancel,
  GetConfig, SetActiveProject, GetMobileQR, GetMobileURL, GetVersion,
} from '../../wailsjs/go/main/App'

export const STATUS = { IDLE: 'idle', RUNNING: 'running', DONE: 'done', ERROR: 'error', CANCELLED: 'cancelled' }

export const PHASES = {
  connecting:  { label: 'CONNECTING',  color: '#B79CFF' },
  dumping:     { label: 'DUMPING',     color: '#FFAA46' },
  downloading: { label: 'DOWNLOADING', color: '#35C8FF' },
  streaming:   { label: 'STREAMING',   color: '#35C8FF' },
  importing:   { label: 'IMPORTING',   color: '#3DE8A0' },
}

export function fmtMB(bytes) {
  return (bytes / 1024 / 1024).toFixed(1)
}

export function fmtDuration(ms) {
  const s = Math.floor(ms / 1000)
  const m = Math.floor(s / 60)
  if (m > 0) return `${m}m ${s % 60}s`
  return `${s}s`
}

export function fmtClock(ms) {
  const s = Math.floor(ms / 1000)
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`
}

function useSync({ progressEvent, doneEvent, errorEvent, cancelledEvent, transferEvent, phaseEvent, fn }) {
  const [status, setStatus]       = useState(STATUS.IDLE)
  const [logs, setLogs]           = useState([])
  const [transfer, setTransfer]   = useState(null)
  const [elapsed, setElapsed]     = useState(0)
  const [totalTime, setTotalTime] = useState(null)
  const [phase, setPhase]         = useState('idle')
  const logEndRef                 = useRef(null)
  const startRef                  = useRef(null)
  const timerRef                  = useRef(null)

  const addLog = useCallback((text, type = 'info') => {
    const ts = new Date().toLocaleTimeString()
    setLogs(prev => [...prev, { text, type, ts }])
  }, [])

  const startTimer = () => {
    startRef.current = Date.now()
    setElapsed(0)
    timerRef.current = setInterval(() => {
      setElapsed(Date.now() - startRef.current)
    }, 1000)
  }

  const stopTimer = () => {
    clearInterval(timerRef.current)
    if (startRef.current) setTotalTime(Date.now() - startRef.current)
  }

  useEffect(() => {
    const off1 = EventsOn(progressEvent,  msg => addLog(msg, 'info'))
    const off2 = EventsOn(doneEvent,      msg => {
      addLog(msg, 'success')
      setStatus(STATUS.DONE)
      setTransfer(null)
      stopTimer()
    })
    const off3 = EventsOn(errorEvent,     msg => {
      addLog(msg, 'error')
      setStatus(STATUS.ERROR)
      setTransfer(null)
      stopTimer()
    })
    const off4 = EventsOn(cancelledEvent, msg => {
      addLog(msg, 'warning')
      setStatus(STATUS.CANCELLED)
      setTransfer(null)
      stopTimer()
    })
    const off5 = transferEvent
      ? EventsOn(transferEvent, data => setTransfer(data))
      : () => {}
    const off6 = phaseEvent
      ? EventsOn(phaseEvent, p => setPhase(p))
      : () => {}
    return () => { off1(); off2(); off3(); off4(); off5(); off6() }
  }, [progressEvent, doneEvent, errorEvent, cancelledEvent, transferEvent, phaseEvent, addLog])

  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [logs])

  useEffect(() => () => clearInterval(timerRef.current), [])

  const run = async (overrideFn) => {
    setPhase('idle')
    setStatus(STATUS.RUNNING)
    setLogs([])
    setTransfer(null)
    setTotalTime(null)
    startTimer()
    addLog('Starting...', 'info')
    const callable = typeof overrideFn === 'function' ? overrideFn : fn
    try { await callable() }
    catch (err) { addLog(String(err), 'error'); setStatus(STATUS.ERROR); stopTimer() }
  }

  const clear = () => {
    setLogs([])
    setStatus(STATUS.IDLE)
    setTransfer(null)
    setTotalTime(null)
    setElapsed(0)
  }

  return { status, logs, logEndRef, transfer, elapsed, totalTime, phase, run, clear }
}

function phaseFor(sync, lastText) {
  if (sync.phase && sync.phase !== 'idle') return sync.phase
  const text = lastText.toLowerCase()
  if (text.includes('stream'))   return 'streaming'
  if (text.includes('dump'))     return 'dumping'
  if (text.includes('download')) return 'downloading'
  if (text.includes('import'))   return 'importing'
  return 'connecting'
}

// Plain-values view of a sync for the Vortex and Mission layouts. `pct` stays
// null when the backend reports no size, so no percentage is ever invented.
export function describeRun(sync) {
  const { status, logs, transfer, elapsed, totalTime } = sync
  const lastText = logs[logs.length - 1]?.text ?? ''
  const running  = status === STATUS.RUNNING
  const pct = transfer && transfer.total > 0
    ? Math.min(100, Math.round((transfer.bytes / transfer.total) * 100))
    : null
  const tables   = transfer && transfer.total === 0 && transfer.bytes > 0 ? transfer.bytes : null
  const phaseKey = phaseFor(sync, lastText)
  const size     = pct != null ? `${fmtMB(transfer.bytes)} MB / ${fmtMB(transfer.total)} MB` : null

  return {
    status, running, lastText, pct, tables, size,
    phase: PHASES[phaseKey] ?? PHASES.connecting,
    time: running ? elapsed : (totalTime ?? elapsed),
  }
}

// Owns every operation at App level, so a run survives switching interface.
export function useOperations() {
  const [projects, setProjects]               = useState([])
  const [activeProjectId, setActiveProjectId] = useState('')
  const [version, setVersion]                 = useState('')
  const [qrOpen, setQrOpen]                   = useState(false)
  const [qrImg, setQrImg]                     = useState('')
  const [qrUrl, setQrUrl]                     = useState('')
  const [qrLoading, setQrLoading]             = useState(false)

  const reloadConfig = useCallback(() => {
    GetConfig()
      .then(cfg => {
        const projs = cfg.projects || []
        setProjects(projs)
        setActiveProjectId(cfg.active_project_id || (projs[0]?.id ?? ''))
      })
      .catch(err => console.error('GetConfig failed:', err))
  }, [])

  useEffect(() => {
    reloadConfig()
    GetVersion().then(setVersion).catch(() => {})
  }, [reloadConfig])

  const prod = useSync({
    progressEvent:  'sync:progress',
    doneEvent:      'sync:done',
    errorEvent:     'sync:error',
    cancelledEvent: 'sync:cancelled',
    transferEvent:  'sync:transfer',
    fn:             SyncDatabase,
  })

  const test = useSync({
    progressEvent:  'test:progress',
    doneEvent:      'test:done',
    errorEvent:     'test:error',
    cancelledEvent: 'test:cancelled',
    transferEvent:  'test:transfer',
    fn:             SyncToTest,
  })

  const pull = useSync({
    progressEvent:  'pull:progress',
    doneEvent:      'pull:done',
    errorEvent:     'pull:error',
    cancelledEvent: 'pull:cancelled',
    transferEvent:  'pull:transfer',
    phaseEvent:     'pull:phase',
    fn:             SyncAndImportLocal,
  })

  const importSync = useSync({
    progressEvent:  'import:progress',
    doneEvent:      'import:done',
    errorEvent:     'import:error',
    cancelledEvent: 'import:cancelled',
    transferEvent:  'import:transfer',
    fn:             () => {},
  })

  const anyBusy = [prod, test, pull, importSync].some(s => s.status === STATUS.RUNNING)
  const active  = [importSync, pull, test, prod].find(s => s.status === STATUS.RUNNING)
    ?? [importSync, pull, test, prod].find(s => s.logs.length > 0)
    ?? prod

  const switchProject = async (id) => {
    if (anyBusy) return
    try {
      await SetActiveProject(id)
      setActiveProjectId(id)
    } catch (_) {}
  }

  const pickAndImport = async () => {
    try {
      const path = await PickFile()
      if (!path) return
      importSync.run(() => ImportLocal(path))
    } catch (err) {
      importSync.run(() => Promise.reject(err))
    }
  }

  const toggleQR = async () => {
    if (qrOpen) { setQrOpen(false); return }
    if (qrImg)  { setQrOpen(true);  return }
    setQrLoading(true)
    try {
      const [img, url] = await Promise.all([GetMobileQR(), GetMobileURL()])
      setQrImg(img)
      setQrUrl(url)
      setQrOpen(true)
    } catch (_) {}
    finally { setQrLoading(false) }
  }

  const actions = [
    { key: 'pull',   title: 'Pull',            sub: 'Production to Downloads',        sync: prod,       start: prod.run },
    { key: 'push',   title: 'Push to test',    sub: 'Replaces the test database',     sync: test,       start: test.run },
    { key: 'import', title: 'Pull and import', sub: 'Production to local MySQL',      sync: pull,       start: pull.run },
    { key: 'file',   title: 'Import file',     sub: '.sql or .sql.gz to local MySQL', sync: importSync, start: pickAndImport },
  ]

  return {
    projects, activeProjectId, version, reloadConfig, switchProject,
    prod, test, pull, importSync, anyBusy, active, actions,
    activeAction: actions.find(a => a.sync === active),
    activeProject: projects.find(p => p.id === activeProjectId),
    pickAndImport, cancel: () => Cancel(),
    qrOpen, qrImg, qrUrl, qrLoading, toggleQR,
  }
}
