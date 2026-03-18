# ⏱ TARDIS
### Transfer And Retrieve Database In Seconds

A desktop app for Ubuntu Linux that automates pulling a production MySQL database to your local machine — or pushing it straight into a test server — in a single click.

Built with [Wails v2](https://wails.io), Go, and React.

---

## Features

- **Pull from Production** — SSH into your prod server, dump & compress the database, download it to `~/Downloads` with a timestamp
- **Push to Test Server** — Full pipeline: dump prod → download locally → upload to test server → import into MySQL → cleanup both servers
- **Secure config** — Credentials stored at `~/.config/dbsync/config.json` with `0600` permissions
- **Private key or password auth** — Supports both SSH auth methods
- **Clean dumps** — Strips the MariaDB sandbox mode comment automatically
- **Live progress log** — Real-time status updates for every step of the pipeline

---

## Screenshots

> _Coming soon_

---

## Requirements

- Ubuntu Linux
- Go 1.22+
- Node.js 18+
- `libwebkit2gtk-4.1-dev`
- `mysql-client` on the remote servers
- Wails CLI v2.11+

Install Wails:
```bash
go install github.com/wailsapp/wails/v2/cmd/wails@latest
```

---

## Getting Started

```bash
# Clone the repo
git clone https://github.com/yourname/tardis.git
cd tardis

# Install frontend deps
cd frontend && npm install && cd ..

# Run in dev mode (hot reload)
~/go/bin/wails dev -tags webkit2_41

# Build production binary
~/go/bin/wails build -tags webkit2_41
./build/bin/tardis
```

---

## Configuration

On first launch, go to the **Settings** tab and fill in your server details.

| Field | Description |
|---|---|
| Server IP | IP address or hostname of the server |
| SSH Username | The user you SSH in as |
| SSH Password | Password auth (leave blank if using a key) |
| Private Key Path | Path to your key, e.g. `~/.ssh/id_rsa` |
| Database Name | Name of the MySQL database |
| Database User | MySQL user |
| Database Password | MySQL password |

Settings are saved automatically and loaded on every launch.

---

## How It Works

### Pull from Production
```
SSH → mysqldump | sed (strip sandbox line) | gzip → SFTP download → ~/Downloads/dbname_YYYY-MM-DD_HHMMSS_dump.sql.gz → remote cleanup
```

### Push to Test Server
```
SSH prod → dump & compress → SFTP download locally → SSH test → SFTP upload → gunzip | mysql import → cleanup both servers
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
