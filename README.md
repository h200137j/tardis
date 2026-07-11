# 🌀 TARDIS
### Transfer And Retrieve Database In Seconds

![Latest Release](https://img.shields.io/github/v/release/h200137j/tardis?label=latest&style=flat-square)
![License](https://img.shields.io/github/license/h200137j/tardis?style=flat-square)

Your production database is *over there*. You need it *right here*. Normally that means SSH, `mysqldump`, `gzip`, `scp`, `gunzip`, `mysql`, and at least one typo that ruins your afternoon.

TARDIS is a desktop app for Ubuntu Linux that does the whole trip in one click — pull from production, push to a test server, or import locally — while you watch the bytes fly through a small time vortex. Like its namesake, it's bigger on the inside.

Built with [Wails v2](https://wails.io), Go, and React.

---

## What it does

- 🕳️ **Pull from Production** — SSH into prod, dump & compress the database, land it in `~/Downloads` with a timestamp
- 🚀 **Push to Test Server** — dump prod → download → upload to test → import into MySQL → cleanup both servers. Five hops, zero typing.
- ⚡ **Pull & Import Local** — prod straight into your local MySQL in one step. The big blue button.
- 📦 **Import from File** — any `.sql` or `.sql.gz` file, into your local database
- 🧳 **Multiple projects** — separate credentials per project, switch with one click
- 🙅 **Cancel anytime** — bail mid-flight; temp files on both servers get cleaned up automatically
- 🌀 **Time vortex progress** — live warp-tunnel animation that changes color per phase (amber = dumping, blue = downloading, green = importing), plus elapsed timer, MB transferred, and per-step log
- 📱 **Mobile remote** — scan a QR code, trigger syncs from your phone on the same Wi-Fi
- 🔐 **Secure config** — credentials stored at `~/.config/dbsync/config.json` with `0600` permissions
- 🗝️ **Flexible auth** — SSH password or private key
- 🧹 **Clean dumps** — strips the MariaDB sandbox-mode comment automatically, skips tables you tell it to
- 🌗 **Two themes** — deep-space dark and blueprint light

---

## Install

👉 **[Download latest release](https://github.com/h200137j/tardis/releases/latest)** — no sonic screwdriver required:

```bash
sudo dpkg -i tardis_*.deb
sudo apt-get install -f
```

---

## Build from Source

**Requirements:** Go 1.22+, Node.js 18+, `libwebkit2gtk-4.1-dev`, Wails CLI v2.11+

```bash
go install github.com/wailsapp/wails/v2/cmd/wails@latest

git clone https://github.com/h200137j/tardis.git
cd tardis

# Dev mode with hot reload
~/go/bin/wails dev -tags webkit2_41

# Production build
~/go/bin/wails build -tags webkit2_41
./build/bin/tardis
```

---

## Configuration

First launch → **Settings** tab. Each server (Production, Test) gets its own credentials, plus a Local section for your machine's MySQL. Add as many projects as you have clients, jobs, or questionable side quests.

| Field | Description |
|---|---|
| Server IP | IP address or hostname |
| SSH Username | The user you SSH in as |
| SSH Password | Leave blank if using a private key |
| Private Key Path | e.g. `~/.ssh/id_rsa` |
| Database Name | MySQL database name |
| Database User | MySQL user |
| Database Password | MySQL password |
| MySQL Binary Path | Local only — e.g. `/opt/lampp/bin/mysql` |
| Skip Tables | Local only — tables to leave behind (`sessions, logs, cache`) |

Settings save automatically and load on every launch.

---

## How it works

No time travel, just well-behaved plumbing:

### Pull from Production
```
SSH → mysqldump | sed | gzip → SFTP download → ~/Downloads/db_YYYY-MM-DD_dump.sql.gz → remote cleanup
```

### Push to Test Server
```
SSH prod → dump → SFTP download locally → SSH test → SFTP upload → gunzip | mysql import → cleanup both
```

### Pull & Import Local
```
SSH prod → dump → SFTP download → gunzip | mysql → done
```

### Import from File
```
Pick .sql / .sql.gz → gunzip | mysql → imported into local DB
```

---

## Tech Stack

| Layer | Tech |
|---|---|
| Framework | [Wails v2](https://wails.io) |
| Backend | Go + `golang.org/x/crypto/ssh` + `github.com/pkg/sftp` |
| Frontend | React 18 + Vite |
| Styling | Plain CSS — the "Time Vortex" design system (see `design.md`) |

---

## FAQ

**Is it actually bigger on the inside?**
The `.deb` is a few MB. The databases it moves are not. So yes.

**Does it work on Windows/macOS?**
It's built for Ubuntu Linux. It might compile elsewhere. So might a lot of things.

**What if I cancel halfway?**
Temp files on both servers get cleaned up. No orphaned dumps drifting through space.

---

## License

MIT

---

made with ❤️ by uriel
