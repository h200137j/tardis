# TARDIS — Ideas & Improvements

## Reliability
- [ ] Resume interrupted downloads — if SFTP drops mid-transfer, reconnect and continue from byte offset
- [ ] Verify gz integrity before importing (check gzip header/footer, not just file size)
- [ ] Retry logic — auto-retry failed SSH connections up to 3 times with backoff
- [ ] Dry run mode — connect, check credentials, report DB size and table count before committing
- [ ] Checksum comparison — compare MD5/SHA of remote and local file after download to confirm integrity
- [ ] Atomic imports — import into a temp DB first, then rename, so a failed import never corrupts the target

## UX & Feedback
- [ ] Sync history — local log of every operation: timestamp, duration, file size, success/fail, rows imported
- [ ] Desktop notifications — system tray notification when a long sync completes so you can walk away
- [ ] Estimated time remaining — calculate MB/s during download and show ETA
- [ ] Sound effects — subtle completion chime or error buzz (toggleable)
- [ ] Confetti explosion on successful import — you earned it
- [ ] Dark/light mode toggle
- [ ] Keyboard shortcuts — Space to start the primary action, Escape to cancel
- [ ] Drag and drop — drag a .sql.gz file onto the window to import it
- [ ] Recent files — remember last 5 imported files for quick re-import

## Safety
- [ ] Auto-backup local DB before importing — dump the existing local DB to ~/Downloads first
- [ ] Confirmation dialog before destructive imports with DB name typed to confirm
- [ ] Sensitive data masking — never show passwords in logs or UI, replace with ••••••
- [ ] Read-only mode — option to connect with a read-only user and refuse write operations

## Power Features
- [ ] Scheduled syncs — cron-style scheduler to auto-pull production every night at a set time
- [ ] Multiple profiles — support more than one production/test environment (e.g. project A, project B)
- [ ] SSH key file picker — replace the text field with a proper file browser
- [ ] SSH agent support — use the system SSH agent instead of storing passwords
- [ ] Table filter — choose which tables to include/exclude from the dump
- [ ] Data anonymisation — replace PII columns (emails, phones, names) with fake data on import
- [ ] Diff view — show what changed between the last two dumps (table counts, row counts per table)
- [ ] Compression level setting — let the user choose gzip level 1-9 (speed vs size tradeoff)
- [ ] Bandwidth throttle — limit transfer speed so it doesn't saturate the connection during work hours

## Wild Ideas
- [ ] AI query assistant — after importing, open a chat window to ask questions about the data
- [ ] Visual schema browser — show an ER diagram of the imported database
- [ ] Time machine — keep N snapshots of the DB and let you roll back to any of them
- [ ] Cloud backup — optionally upload dumps to S3/Backblaze/Dropbox after pulling
- [ ] Team mode — share config (without passwords) with teammates via a URL or QR code
- [x] Mobile companion app — trigger a sync from your phone when you're away from your desk
- [ ] Slack/Discord webhook — post a message to a channel when a sync completes or fails
- [ ] Database comparison — connect to two databases and show a side-by-side diff of schema and row counts
- [ ] Auto-detect .env files — scan the project directory for .env and pre-fill settings from DB_HOST, DB_PORT etc.
- [ ] Plugin system — let users write Go plugins to add custom pre/post sync hooks
- [ ] TARDIS CLI — a headless CLI version of the app for use in CI/CD pipelines
- [ ] Windows SSH agent integration — use PuTTY/Pageant keys on Windows
- [ ] Sync over Tailscale/WireGuard — detect VPN and warn if not connected before attempting
- [ ] Voice announcements — text-to-speech reads out "sync complete" or "error on table users"
- [ ] Easter egg — type the Konami code to unlock a secret animation

## Infrastructure
- [ ] macOS build in GitHub Actions — add a macOS runner to produce a .dmg
- [ ] Auto-update installer — instead of just showing a banner, download and install the update in-app
- [ ] Crash reporting — optional anonymous crash reports sent to a server
- [ ] Telemetry opt-in — track which features are used most to guide development
- [ ] Homebrew formula — publish to Homebrew so macOS users can `brew install tardis`
- [ ] AUR package — publish to Arch User Repository
- [ ] Snap/Flatpak packaging — distribute via Snap Store or Flathub
