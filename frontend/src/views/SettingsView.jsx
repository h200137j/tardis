import { useState, useEffect } from 'react'
import { GetConfig, SaveConfig, GetMobileQR, GetMobileURL } from '../../wailsjs/go/main/App'
import './SettingsView.css'

const EMPTY_SERVER = {
  server_ip: '',
  ssh_user: '',
  ssh_password: '',
  private_key_path: '',
  db_name: '',
  db_user: '',
  db_password: '',
}

const DEFAULT_LOCAL = {
  mysql_bin:        '/opt/lampp/bin/mysql',
  db_name:          '',
  db_user:          'root',
  db_pass:          '',
  save_dump:   false,
  skip_tables: [],
}

const newProject = (id, name = 'New Project') => ({
  id,
  name,
  production: { ...EMPTY_SERVER },
  test:       { ...EMPTY_SERVER },
  local:      { ...DEFAULT_LOCAL },
})

const DEFAULT_FORM = {
  projects: [newProject('default', 'Default')],
  active_project_id: 'default',
}

export default function SettingsView() {
  const [form, setForm]           = useState(DEFAULT_FORM)
  const [selectedIdx, setSelectedIdx] = useState(0)
  const [saved, setSaved]         = useState(false)
  const [error, setError]         = useState('')
  const [loading, setLoading]     = useState(true)
  const [qr, setQr]               = useState('')
  const [mobileUrl, setMobileUrl] = useState('')
  const [qrVisible, setQrVisible] = useState(false)

  useEffect(() => {
    GetConfig()
      .then(cfg => {
        if (cfg.projects && cfg.projects.length > 0) {
          const projects = cfg.projects.map(p => ({
            id:         p.id || Date.now().toString(36),
            name:       p.name || 'Unnamed',
            production: { ...EMPTY_SERVER, ...(p.production || {}) },
            test:       { ...EMPTY_SERVER, ...(p.test || {}) },
            local:      { ...DEFAULT_LOCAL, ...(p.local || {}) },
          }))
          const active_project_id = cfg.active_project_id || projects[0].id
          setForm({ projects, active_project_id })
          const idx = projects.findIndex(p => p.id === active_project_id)
          setSelectedIdx(idx >= 0 ? idx : 0)
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  const showQR = async () => {
    if (qrVisible) { setQrVisible(false); return }
    try {
      const [qrData, url] = await Promise.all([GetMobileQR(), GetMobileURL()])
      setQr(qrData)
      setMobileUrl(url)
      setQrVisible(true)
    } catch (err) {
      setError('Could not generate QR: ' + String(err))
    }
  }

  // Edit a field in the selected project's section (production / test / local)
  const set = (section, key, val) =>
    setForm(f => ({
      ...f,
      projects: f.projects.map((p, i) =>
        i === selectedIdx ? { ...p, [section]: { ...p[section], [key]: val } } : p
      ),
    }))

  const setProjectName = (name) =>
    setForm(f => ({
      ...f,
      projects: f.projects.map((p, i) => i === selectedIdx ? { ...p, name } : p),
    }))

  const addProject = () => {
    const id  = Date.now().toString(36)
    const idx = form.projects.length
    setForm(f => ({ ...f, projects: [...f.projects, newProject(id)] }))
    setSelectedIdx(idx)
  }

  const deleteProject = () => {
    if (form.projects.length <= 1) return
    const deletedId = form.projects[selectedIdx].id
    setForm(f => {
      const projects = f.projects.filter((_, i) => i !== selectedIdx)
      const active_project_id = f.active_project_id === deletedId
        ? projects[0].id
        : f.active_project_id
      return { ...f, projects, active_project_id }
    })
    setSelectedIdx(prev => Math.max(0, prev - 1))
  }

  const handleSave = async e => {
    e.preventDefault()
    setError('')
    setSaved(false)
    try {
      await SaveConfig(form)
      setSaved(true)
      setTimeout(() => setSaved(false), 3000)
    } catch (err) {
      setError(String(err))
    }
  }

  if (loading) return <div className="settings-loading">Loading config...</div>

  const proj = form.projects[selectedIdx] ?? form.projects[0]

  return (
    <div className="settings">
      <h2 className="settings-title">Settings</h2>

      <form className="settings-form" onSubmit={handleSave} noValidate>

        {/* Project tabs */}
        <div className="project-tabs-row">
          <div className="project-tabs">
            {form.projects.map((p, i) => (
              <button
                key={p.id}
                type="button"
                className={`project-tab ${i === selectedIdx ? 'active' : ''}`}
                onClick={() => setSelectedIdx(i)}
              >
                {p.name}
              </button>
            ))}
            <button type="button" className="project-tab-add" onClick={addProject} title="Add project">+</button>
          </div>
        </div>

        {/* Selected project name + delete */}
        <div className="project-name-row">
          <input
            className="project-name-input"
            type="text"
            value={proj.name}
            onChange={e => setProjectName(e.target.value)}
            placeholder="Project name"
          />
          <button
            type="button"
            className="btn-delete-project"
            onClick={deleteProject}
            disabled={form.projects.length <= 1}
            title="Delete project"
          >
            Delete
          </button>
        </div>

        <ServerFieldset
          legend="🟢 Production Server"
          values={proj.production}
          onChange={(k, v) => set('production', k, v)}
        />

        <ServerFieldset
          legend="🧪 Test Server"
          values={proj.test}
          onChange={(k, v) => set('test', k, v)}
        />

        <fieldset className="fieldset">
          <legend>💻 Local Import</legend>
          <div className="fieldset-columns">
            <div className="fieldset-col">
              <p className="col-label">MySQL</p>
              <Field label="MySQL Binary Path" hint="e.g. /opt/lampp/bin/mysql or just 'mysql'">
                <input type="text" value={proj.local.mysql_bin}
                  onChange={e => set('local', 'mysql_bin', e.target.value)}
                  placeholder="/opt/lampp/bin/mysql" />
              </Field>
              <Field label="Database User">
                <input type="text" value={proj.local.db_user}
                  onChange={e => set('local', 'db_user', e.target.value)}
                  placeholder="root" />
              </Field>
              <Field label="Database Password" hint="Leave blank if no password">
                <PasswordInput value={proj.local.db_pass}
                  onChange={e => set('local', 'db_pass', e.target.value)}
                  autoComplete="current-password" />
              </Field>
            </div>
            <div className="fieldset-col">
              <p className="col-label">Database</p>
              <Field label="Local Database Name" required>
                <input type="text" value={proj.local.db_name}
                  onChange={e => set('local', 'db_name', e.target.value)}
                  placeholder="my_local_db" />
              </Field>
              <Field label="Save dump to ~/Downloads" hint="Keep a .sql.gz copy after import">
                <label className="toggle">
                  <input type="checkbox" checked={!!proj.local.save_dump}
                    onChange={e => set('local', 'save_dump', e.target.checked)} />
                  <span className="toggle-track"><span className="toggle-thumb" /></span>
                </label>
              </Field>
              <Field label="Skip tables" hint="Comma-separated table names to exclude from import (e.g. sessions, logs, cache)">
                <input type="text"
                  value={(proj.local.skip_tables || []).join(', ')}
                  onChange={e => set('local', 'skip_tables', e.target.value.split(',').map(s => s.trim()).filter(Boolean))}
                  placeholder="sessions, logs, cache" />
              </Field>
            </div>
          </div>
        </fieldset>

        {error && <p className="form-error" role="alert">{error}</p>}

        {/* Mobile Companion */}
        <fieldset className="fieldset fieldset--mobile">
          <legend>📱 Mobile Companion</legend>
          <p className="mobile-desc">
            Scan the QR code with your phone to open the TARDIS Remote web app.
            Both devices must be on the same network.
          </p>
          <button type="button" className="btn-qr" onClick={showQR}>
            {qrVisible ? '✕ Hide QR Code' : '📱 Show QR Code'}
          </button>
          {qrVisible && qr && (
            <div className="qr-block">
              <img src={qr} alt="QR code for TARDIS Remote" className="qr-img" />
              <p className="qr-url">{mobileUrl}</p>
            </div>
          )}
        </fieldset>

        <div className="form-actions">
          <button type="submit" className="btn-save">
            {saved ? '✓ Saved' : 'Save Settings'}
          </button>
        </div>

      </form>
    </div>
  )
}

function ServerFieldset({ legend, values, onChange }) {
  return (
    <fieldset className="fieldset">
      <legend>{legend}</legend>

      <div className="fieldset-columns">
        <div className="fieldset-col">
          <p className="col-label">SSH</p>

          <Field label="Server IP / Hostname" required>
            <input type="text" value={values.server_ip}
              onChange={e => onChange('server_ip', e.target.value)}
              placeholder="192.168.1.100" />
          </Field>

          <Field label="SSH Username" required>
            <input type="text" value={values.ssh_user}
              onChange={e => onChange('ssh_user', e.target.value)}
              placeholder="ubuntu" />
          </Field>

          <Field label="SSH Password" hint="Leave blank if using a private key">
            <PasswordInput value={values.ssh_password}
              onChange={e => onChange('ssh_password', e.target.value)}
              autoComplete="current-password" />
          </Field>

          <Field label="Private Key Path" hint="e.g. ~/.ssh/id_rsa">
            <input type="text" value={values.private_key_path}
              onChange={e => onChange('private_key_path', e.target.value)}
              placeholder="~/.ssh/id_rsa" />
          </Field>
        </div>

        <div className="fieldset-col">
          <p className="col-label">Database</p>

          <Field label="Database Name" required>
            <input type="text" value={values.db_name}
              onChange={e => onChange('db_name', e.target.value)}
              placeholder="my_database" />
          </Field>

          <Field label="Database User" required>
            <input type="text" value={values.db_user}
              onChange={e => onChange('db_user', e.target.value)}
              placeholder="root" />
          </Field>

          <Field label="Database Password">
            <PasswordInput value={values.db_password}
              onChange={e => onChange('db_password', e.target.value)}
              autoComplete="current-password" />
          </Field>
        </div>
      </div>
    </fieldset>
  )
}

function PasswordInput({ value, onChange, autoComplete }) {
  const [show, setShow] = useState(false)
  return (
    <div className="pw-wrap">
      <input
        type={show ? 'text' : 'password'}
        value={value}
        onChange={onChange}
        autoComplete={autoComplete}
      />
      <button
        type="button"
        className="pw-toggle"
        onClick={() => setShow(s => !s)}
        aria-label={show ? 'Hide password' : 'Show password'}
      >
        {show ? (
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M17.94 17.94A10.07 10.07 0 0112 20c-7 0-11-8-11-8a18.45 18.45 0 015.06-5.94"/>
            <path d="M9.9 4.24A9.12 9.12 0 0112 4c7 0 11 8 11 8a18.5 18.5 0 01-2.16 3.19"/>
            <line x1="1" y1="1" x2="23" y2="23"/>
          </svg>
        ) : (
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
            <circle cx="12" cy="12" r="3"/>
          </svg>
        )}
      </button>
    </div>
  )
}

function Field({ label, hint, required, children }) {
  return (
    <div className="field">
      <label className="field-label">
        {label}
        {required && <span className="required" aria-hidden="true"> *</span>}
      </label>
      {children}
      {hint && <span className="field-hint">{hint}</span>}
    </div>
  )
}
