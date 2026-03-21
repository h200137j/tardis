# Tailscale Remote Access Plan

## Goal
Make TARDIS Remote accessible from any network (not just local Wi-Fi),
without installing Tailscale as a system daemon on the desktop.

## Approach: tsnet (embedded Tailscale)

Use `tailscale.com/tsnet` — a Go package that embeds a Tailscale node
directly inside the TARDIS binary. No system install, no sudo, no daemon.
TARDIS itself becomes a Tailscale node when it runs.

## How it works

- TARDIS starts a `tsnet.Server` internally on startup (if auth key is set)
- The mobile HTTP server (port 7438) runs over that tsnet node
- The node gets a stable Tailscale IP and hostname (e.g. `tardis`)
- Phone connects via Tailscale app from any network, including mobile data
- QR code shows the Tailscale URL instead of the LAN IP when tsnet is active

## Per-user setup (one time)

1. Create a free Tailscale account at tailscale.com
2. Go to Settings → Keys → Generate auth key (tick "Reusable")
3. Paste the key into TARDIS Settings → "Tailscale Auth Key"
4. Install Tailscale app on phone, log in with the same account
5. Done — works from anywhere forever

## Key decision: do NOT embed a shared key in the binary

Each person uses their own Tailscale account and their own auth key.
- Their TARDIS node joins their own tailnet
- Their phone logs into their own account
- Fully isolated — no shared accounts, no one sees each other's devices
- If a key expires, only that person is affected

Embedding a shared key would put everyone on one person's tailnet,
which means shared admin access and no isolation. Not worth it.

## Implementation plan

### 1. Add dependency
```
go get tailscale.com/tsnet
```

### 2. server.go changes
- If `config.TailscaleKey != ""`, start a `tsnet.Server` with that key
- Name the node `"tardis"` (shows up as `tardis` in Tailscale admin)
- Run the mobile HTTP server on the tsnet listener instead of plain TCP
- Fall back to LAN-only mode if no key is configured

### 3. app.go / config changes
- Add `TailscaleKey string` to `Config` struct
- Add `TailscaleEnabled bool` to track active state

### 4. GetMobileQR / GetMobileURL changes
- If tsnet is active, return `http://tardis:7438/?token=...`
- Otherwise return current LAN IP URL (no change for LAN-only users)

### 5. Settings UI
- Add "Tailscale Auth Key" password field under a new "Remote Access" fieldset
- Show a status indicator: connected / not configured
- Save alongside existing config

### 6. QR panel in HomeView
- Show a small "🌐 Remote" vs "📶 LAN only" badge so user knows which mode is active

## Files to touch
- `server.go` — tsnet integration
- `app.go` — config struct, startup
- `frontend/src/views/SettingsView.jsx` — auth key field
- `frontend/src/views/HomeView.jsx` — mode badge on QR panel
- `go.mod` / `go.sum` — new dependency

## Notes
- tsnet stores its state (certs, node identity) in a directory; we can use
  `os.UserConfigDir()/dbsync/tsnet` so it persists across restarts
- First connection takes a few seconds while the node authenticates;
  subsequent starts are instant
- The Tailscale free tier supports up to 100 devices — more than enough
