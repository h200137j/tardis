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

const DEFAULT = {
  production: { ...EMPTY_SERVER },
  test:       { ...EMPTY_SERVER },
  local: {
    mysql_bin: '/opt/lampp/bin/mysql',
    db_name:   '',
    db_user:   'root',
    db_pass:   '',
  },
}

export default function SettingsView() {
  const [form, setForm]       = useState(DEFAULT)
  const [saved, setSaved]     = useState(false)
  const [error, setError]     = useState('')
  const [loading, setLoading] = useState(true)
  const [qr, setQr]           = useState('')
  const [mobileUrl, setMobileUrl] = useState('')
  const [qrVisible, setQrVisible] = useState(false)

  useEffect(() => {
    GetConfig()
      .then(cfg => setForm({
        production: { ...EMPTY_SERVER, ...cfg.production },
        test:       { ...EMPTY_SERVER, ...cfg.test },
        local:      { ...DEFAULT.local, ...cfg.local },
      }))
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

  const set = (server, key, val) =>
    setForm(f => ({ ...f, [server]: { ...f[server], [key]: val } }))
  const handleSave = async e => {
    e.preventDefault()
    setError('')
    setSaved(false)
    try {
      await SaveConfig({
        production: { ...form.production },
        test:       { ...form.test },
        local:      { ...form.local },
      })
      setSaved(true)
      setTimeout(() => setSaved(false), 3000)
    } catch (err) {
      setError(String(err))
    }
  }

  if (loading) return <div className="settings-loading">Loading config...</div>

  return (
    <div className="settings">
      <h2 className="settings-title">Settings</h2>


      <form className="settings-form" onSubmit={handleSave} noValidate>

        <ServerFieldset
          legend="🟢 Production Server"
          values={form.production}
          onChange={(k, v) => set('production', k, v)}
        />

        <ServerFieldset
          legend="🧪 Test Server"
          values={form.test}
          onChange={(k, v) => set('test', k, v)}
        />

        <fieldset className="fieldset">
          <legend>💻 Local Import</legend>
          <div className="fieldset-columns">
            <div className="fieldset-col">
              <p className="col-label">MySQL</p>
              <Field label="MySQL Binary Path" hint="e.g. /opt/lampp/bin/mysql or just 'mysql'">
                <input type="text" value={form.local.mysql_bin}
                  onChange={e => set('local', 'mysql_bin', e.target.value)}
                  placeholder="/opt/lampp/bin/mysql" />
              </Field>
              <Field label="Database User">
                <input type="text" value={form.local.db_user}
                  onChange={e => set('local', 'db_user', e.target.value)}
                  placeholder="root" />
              </Field>
              <Field label="Database Password" hint="Leave blank if no password">
                <input type="password" value={form.local.db_pass}
                  onChange={e => set('local', 'db_pass', e.target.value)}
                  autoComplete="current-password" />
              </Field>
            </div>
            <div className="fieldset-col">
              <p className="col-label">Database</p>
              <Field label="Local Database Name" required>
                <input type="text" value={form.local.db_name}
                  onChange={e => set('local', 'db_name', e.target.value)}
                  placeholder="my_local_db" />
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
            <input type="password" value={values.ssh_password}
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
            <input type="password" value={values.db_password}
              onChange={e => onChange('db_password', e.target.value)}
              autoComplete="current-password" />
          </Field>
        </div>
      </div>
    </fieldset>
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
