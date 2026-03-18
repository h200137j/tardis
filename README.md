# ⏱ TARDIS
### Transfer And Retrieve Database In Seconds

![Latest Release](https://img.shields.io/github/v/release/h200137j/tardis?label=latest&style=flat-square)
![License](https://img.shields.io/github/license/h200137j/tardis?style=flat-square)

A desktop app for Ubuntu Linux that automates MySQL database workflows in one click — pull from production, push to a test server, or import locally.

Built with [Wails v2](https://wails.io), Go, and React.

---

## Features

- **Pull from Production** — SSH into prod, dump & compress the database, download to `~/Downloads` with a timestamp
- **Push to Test Server** — Dump prod → download locally → upload to test server → import into MySQL → cleanup both servers
- **Pull & Import Local** — Dump prod → download → import straight into your local MySQL in one step
- **Import from File** — Pick any `.sql` or `.sql.gz` file and import it into your local database
- **Cancel anytime** — Cancel mid-flight with automatic cleanup of temp files on both servers
- **Live progress panel** — Elapsed timer, MB transferred, smooth progress bar, and per-step status
- **Secure config** — Credentials stored at `~/.config/dbsync/config.json` with `0600` permissions
- **Flexible auth** — Supports SSH password and private key authentication
- **Clean dumps** — Strips the MariaDB sandbox mode comment automatically

---

## Install

👉 **[Download latest release](https://github.com/h200137j/tardis/releases/latest)**

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

On first launch go to the **Settings** tab. Each server (Production, Test) has its own credentials, plus a Local section for your machine's MySQL.

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

Settings are saved automatically and loaded on every launch.

---

## How It Works

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
SSH prod → dump → SFTP download → gunzip | /opt/lampp/bin/mysql → done
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
| Styling | Plain CSS, dark mode |

---

## License

MIT

---

made with ❤️ by uriel
