# SWA (Sex Worker Assistant)

A local-first, encrypted desktop CRM for independent workers who manage
clients across multiple online platforms (creator platforms, marketplaces,
freelancing sites, or anything else) — built with Electron and an
encrypted SQLite database.

**Status: active development.** Electron shell, encrypted DB layer, full
CRUD for People/Platform Accounts/Orders (with attachments, a price
calculator, purchase totals, and PDF export), and a FullCalendar-based
Calendar are implemented. Desktop reminders, .ics export, an Expenses/
Budget tab, and search are planned next (Expenses still shows as a
disabled "Coming in a later phase" nav item).

## Why this exists

Freelancers and independent creators who deal with many clients across
many platforms end up tracking sensitive information — real names,
screening notes, payment history — in spreadsheets or notes apps with no
real protection. This app keeps that data **entirely on your own machine**,
encrypted at rest, with no account, no cloud sync, and no telemetry.

## Requirements

- [Node.js](https://nodejs.org/) 18 or later, and npm
- Windows, macOS, or Linux (only Windows has been built/tested so far —
  see [Cross-platform status](#cross-platform-status))

## Getting started

```bash
npm install
npm start
```

The first launch will ask you to set a passphrase — this encrypts the
database file. **There is no password reset.** Write your passphrase down
somewhere safe outside the app.

## Building a distributable

```bash
npm run package
```

This uses [electron-builder](https://www.electron.build/) and
`electron-builder.yml` to produce an installer/package in `dist/`.

## Project structure

```
src/
├── main/            # Electron main process (Node.js side)
│   ├── db/            # SQLite connection, migrations, repositories (SQL)
│   ├── security/       # Passphrase/vault lifecycle, auto-lock
│   ├── ipc/            # ipcMain.handle() registrations, grouped by domain
│   ├── index.js         # App entry point / lifecycle
│   └── window.js         # BrowserWindow factory (secure webPreferences)
├── preload/          # contextBridge API surface exposed to the renderer
└── renderer/         # Vanilla JS/HTML/CSS UI (no framework, no bundler)
    └── views/           # One file per screen
```

All SQLite access happens in the main process only. The renderer never
gets direct Node.js or filesystem access — it talks to the main process
through a narrow `window.api.*` surface defined in
[`src/preload/index.js`](src/preload/index.js). This is a standard
Electron security pattern (`contextIsolation`, no `nodeIntegration`,
sandboxed preload); see
[`src/main/window.js`](src/main/window.js).

## Data model

- **Person** — shown as **"Client"** in the UI (the more common term for
  this kind of app), but kept as "Person" in the schema, code, and IPC
  channel names throughout -- a display-label choice, not a data-model
  one. Identified by a private label you choose (not necessarily their
  real name), plus general and screening notes.
- **PlatformAccount** — a platform + username/handle belonging to a
  Person, with a verified flag. Platform names are free text so any
  platform works, not just a fixed list.
- **Order** — a transaction tied to a Person (and optionally a specific
  PlatformAccount): amount, currency, dates, payment method, status,
  description, file attachments, feedback/reflection notes.
- **CalendarEvent** — a date/time on the calendar, optionally linked to
  an Order (e.g. its delivery due date).
- *(Planned)* **Expense** — not yet implemented.

See [`src/main/db/migrations/0001_init.sql`](src/main/db/migrations/0001_init.sql)
for the full schema and comments on specific choices (e.g. money is
stored as integer cents to avoid floating-point rounding errors).

## Security model

- The database file is encrypted at rest using
  [`better-sqlite3-multiple-ciphers`](https://github.com/m4heshd/better-sqlite3-multiple-ciphers),
  a SQLCipher-compatible (AES-256) fork of `better-sqlite3`.
- Your passphrase is **never stored in plaintext**. By default it isn't
  stored anywhere at all — you re-enter it every time you unlock,
  including after auto-lock. There's an *opt-in* "quick unlock" setting
  that wraps the passphrase using your OS's secure storage (Keychain on
  macOS, Credential Manager/DPAPI on Windows, libsecret on Linux) via
  Electron's `safeStorage` API; it's off by default and its trade-offs
  are spelled out below.
- The app auto-locks after a configurable period of inactivity (default
  10 minutes), closing the database connection and requiring the
  passphrase again.
- No network requests are made by this app's own code: no account
  creation, no sync, no analytics, no crash reporting. `npm install`
  pulls a small, deliberately short dependency list — check
  `package.json` yourself. Runtime dependencies:
  [`better-sqlite3-multiple-ciphers`](https://github.com/m4heshd/better-sqlite3-multiple-ciphers)
  (database encryption) and [FullCalendar](https://fullcalendar.io/)
  (MIT-licensed; its "global" build is vendored locally at install time
  by `scripts/copy-vendor-assets.js` rather than loaded from a CDN, to
  keep the app fully offline — see that file's comments). Electron and
  electron-builder are dev tooling.

### Threat model

**This protects against:**
- Someone else picking up your laptop/computer while the app is locked
  or not running, and trying to read your client data.
- Casual inspection of the raw database file (e.g. copying `data.db` to
  another machine) — without the passphrase, its contents are
  ciphertext.
- Data being exposed via clipboard/cloud-sync tools you might have
  running, since nothing is written outside the app's own local data
  folder.

**This does NOT protect against:**
- Malware, a keylogger, or another user process running on your machine
  while you're logged into your OS session — anything that can read
  memory or capture keystrokes can capture your passphrase or the
  unlocked data.
- Someone with access to your computer while the app is **unlocked**, or
  before the auto-lock timer fires.
- Enabling **quick unlock**: this stores an OS-keychain-wrapped copy of
  your passphrase. Anyone who can act as your logged-in OS user (not
  just someone who knows your app passphrase) could have the app decrypt
  the vault, bypassing the "you must retype your passphrase" guarantee.
  Leave this off if that's not an acceptable trade-off for your setup.
- Forensic recovery of data from RAM, swap/pagefile, or a "cold boot"
  style attack — the decrypted database and cached in-memory query
  results are ordinary process memory, not specially hardened.
- A compromised or malicious npm dependency. This project has a small,
  auditable dependency tree by design, but it hasn't been through an
  independent security audit.
- Physical file recovery of *deleted* records — SQLite's default deletes
  don't securely wipe disk sectors, and this app does not run `VACUUM`
  or secure-delete after every change.

If your threat model includes any of the "does NOT protect against"
items above (e.g. a shared or potentially compromised computer),
additional protection — full-disk encryption, a dedicated user account,
not enabling quick unlock — is on you to add.

## Cross-platform status

The code and packaging config are written to be platform-agnostic
(`app.getPath('userData')`, Electron's `safeStorage`/`powerMonitor` APIs
all behave correctly per-OS), and `electron-builder.yml` defines targets
for Windows, macOS, and Linux. So far this has only actually been run and
packaged on Windows — if you build/test it on macOS or Linux, contributions
documenting or fixing any platform-specific issues are welcome.

## Contributing

Issues and PRs welcome. Please don't commit any real or sample client
data — `.gitignore` already excludes database and vault files, but double
-check before pushing.

## License

MIT — see [LICENSE](LICENSE).
