# SWA (Sex Worker Assistant)

A local-first, encrypted desktop CRM for independent workers who manage
clients across multiple online platforms (creator platforms, marketplaces,
freelancing sites, or anything else), built with Electron (Like Discord) and an
encrypted SQLite database.

**Status: active development.** I'm developing it in my free time, and will accept feedback or suggestions. I am not planning to make this a full time job though. 

## Why this exists
Freelancers and independent content creators juggle clients across multiple platforms. Keeping track of it all is overwhelming. Most people rely on spreadsheets or notes apps that offer little protection, no reliable way to track consistent user identities, order statuses, or current workloads.

This app solves that by keeping all your data entirely on your own machine—encrypted at rest, with no account required, no cloud sync, and no telemetry.

It gives you one private place to manage:
Clients and their contact platforms
Orders (who bought what)
Payments (who paid, when, and for what)
Delivery promises and deadlines
Overall workloads outside of scheduled posts
Tags shared across clients and content, so you know who wants what and
what you have that matches
A content library — typed by hand or scanned in from a real folder on
disk — with sales stats and analytics (top spenders, revenue by
priority/platform, trends over time)

Very few tools address these specific needs. Existing options are usually built for agencies or repurposed from something else. This one is designed from the ground up to keep your work organized, private, and manageable.

## Installing (I just want to use the app)

Download the installer for your OS from the
[Releases](../../releases) page and run it — **that's it, nothing else
to install.** The installer bundles its own copy of Electron (which
includes Node.js and Chromium internally) and every dependency the app
needs, including the native database-encryption module built for your
exact OS/architecture. You do **not** need Node.js, npm, or anything
else on your machine first; the app never reaches out to anything on
your system beyond your own filesystem.

(Windows and macOS builds are available, see
[Cross-platform status](#cross-platform-status). **On macOS, pick the
right file**: `-arm64` is for Apple Silicon (M1/M2/M3 — almost every Mac
sold since late 2020), `-x64` is for older Intel Macs. The wrong one
will fail to open with no useful error at all.

Neither build is code-signed yet, so you'll hit a first-run warning
either way:
- **Windows**: SmartScreen warns but lets you click through
  ("More info" → "Run anyway").
- **macOS**: since the app isn't signed at all (not even ad-hoc), recent
  macOS versions usually block it outright with no override in the
  normal right-click menu. Two ways around it: open **System Settings →
  Privacy & Security**, scroll down, and click **"Open Anyway"** next to
  the SWA mention (only appears after a first blocked attempt); or run
  `xattr -cr /Applications/SWA.app` in Terminal to clear the quarantine
  flag, then open it normally.

Both are expected for an early release without a paid signing
certificate, not a sign anything is wrong.)

The first launch will ask you to set a passphrase — this encrypts the
database file. Write your passphrase down somewhere safe outside the
app; Settings also lets you generate a one-time recovery phrase as a
backup way in if you forget it (see the Security model section below).

<img width="1331" height="845" alt="Screenshot 2026-08-15 210835" src="https://github.com/user-attachments/assets/7d0400f2-f917-4278-ace7-c8f5147df1bf" />
<img width="1086" height="743" alt="Screenshot 2026-08-15 210815" src="https://github.com/user-attachments/assets/a1e9aabe-0d0f-4dae-bef7-e5e6f6aa81c7" />
<img width="1084" height="741" alt="Screenshot 2026-08-15 210748" src="https://github.com/user-attachments/assets/f76eb2f3-5cb3-4d95-819c-cf0fc445c93d" />

## Building from source (for development/contributing)

This is only needed if you want to modify the code, not to run the app.

**Requirements:** [Node.js](https://nodejs.org/) 18 or later, and npm.

```bash
npm install
npm start
```

To produce your own installer (same thing the Releases page ships):

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
│   ├── scanner/         # Content library media folder scanner (filesystem walk)
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
  real name), plus general and screening notes, and a priority flag
  (Low priority / Normal / VIP).
- **PlatformAccount** — a platform + username/handle belonging to a
  Person, with a verified flag. Platform names are free text so any
  platform works, not just a fixed list.
- **Order** — a transaction tied to a Person (and optionally a specific
  PlatformAccount): amount, currency, dates, payment method, status,
  description, file attachments, feedback/reflection notes, and any
  ContentItems that were part of the sale.
- **Tag** — a single shared label vocabulary used by both Persons (what
  a client is into) and ContentItems (what a piece of content is), so
  the same tag connects "who wants this" to "what matches it" — visible
  in search results, not just each entity's own tag list.
- **ContentItem** — a catalog entry for something you've made (a video,
  a picture set, etc.): title, type, description, a location (a folder
  path, drive label, or link — never the media file itself), a
  suggested price, tags, and sales stats derived from the Orders it's
  attached to. Either typed in by hand or discovered by the content
  library's media folder scanner (Content library → choose a folder →
  Scan now), which indexes file names/sizes/dates only, never file
  contents. A scanned item's individual files can each carry their own
  suggested price too (e.g. one video priced separately from the set
  it's bundled in), and attaching an item to an Order can record a
  "price paid" override for that specific sale — useful when an order
  bundles several items together or sells at a discount, so per-item
  revenue isn't just the whole order's amount double-counted across
  everything attached to it. Content items themselves are never part of
  a client/order export or shared-folder sync (there's no media file to
  send, and the whole point of this app is that it never leaves your
  machine) — but the *fact* that an order included one does travel: a
  portable id lets the receiving install match an already-cataloged
  item by that id or by an exact title match, and falls back to adding
  a title-only placeholder rather than silently dropping the link.
- **CalendarEvent** — a date/time on the calendar, optionally linked to
  an Order (e.g. its delivery due date).
- **Expense** — a business cost (date, amount, free-text category,
  description), independent of any Person/Order.
- **IncomeStatement** — a manually-entered total from a platform's
  periodic pay statement (period, platform, gross/fees/net, and
  attachments for the source PDF) — an approximation tool, not parsed
  automatically from the PDF (see the Expenses tab in-app for why).

See [`src/main/db/migrations/0001_init.sql`](src/main/db/migrations/0001_init.sql)
for the full schema and comments on specific choices (e.g. money is
stored as integer cents to avoid floating-point rounding errors).

## Security model

- The database file is encrypted at rest using
  [`better-sqlite3-multiple-ciphers`](https://github.com/m4heshd/better-sqlite3-multiple-ciphers),
  a SQLCipher-compatible (AES-256) fork of `better-sqlite3`.
- Settings → "Backup & restore" saves a byte-for-byte copy of that same
  encrypted database file — a backup carries the exact same encryption
  and passphrase as the live vault, so a backup file is exactly as
  sensitive as `data.db` itself and should be stored/protected the same
  way. Restoring one is a full, destructive replace of everything
  currently in the vault (not a merge), so it requires re-entering your
  passphrase to confirm and always keeps an untouched, never-auto-deleted
  copy of the pre-restore data alongside `data.db` first, in case the
  restore itself was a mistake.
- Settings → "Recovery phrase" can generate 6 random words (from the
  standard BIP-39 word list) that let you back into the vault if you
  forget your passphrase — shown once, never stored anywhere in
  plaintext. It's opt-in and off by default, and it's functionally a
  second master key: anyone with the words and no passphrase at all can
  still unlock the vault, so treat them with the same care as the
  passphrase itself (not taped to the laptop). Changing your passphrase
  invalidates any existing recovery phrase, since it only unlocks back
  to the passphrase it was created against — the app tells you when
  this happens so you can generate a new one.
- Content library → the media folder scanner reads only folder and file
  **names**, extensions, sizes, and modified dates from a folder you
  point it at — it never opens, copies, or reads the contents of any
  media file, and (like everything else in this app) never sends
  anything over the network.
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
- No automatic or background network requests are made by this app's own
  code: no account creation, no sync, no analytics, no crash reporting.
  Network access itself is a locked-by-default toggle in Settings →
  Privacy (see
  [`src/main/security/networkGuard.js`](src/main/security/networkGuard.js))
  — every network-capable feature checks it first, so the app is
  provably offline until you deliberately turn it on. Today the only
  feature that toggle unlocks is a manual "Check for updates" button in
  Settings — nothing happens unless you click it, and all it does is ask
  GitHub's public API for this project's latest release tag to compare
  against your current version (see
  [`src/main/updates/checkForUpdates.js`](src/main/updates/checkForUpdates.js)).
  No usage data, telemetry, or identifying information is sent. `npm
  install` pulls a small, deliberately short dependency list — check
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
- The app ever making a network request you didn't explicitly opt into
  — "Network access" (Settings → Privacy) is locked by default, and
  every network-capable feature is required to check it before making a
  request, not just hide its button in the UI.

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
- Setting up a **recovery phrase**: whoever finds the 6 written-down
  words can unlock the vault with no passphrase at all — the same
  trade-off as quick-unlock, except the secret lives on paper instead of
  your OS keychain, so it's on you to store it somewhere as secure as
  the passphrase itself.
- Forensic recovery of data from RAM, swap/pagefile, or a "cold boot"
  style attack — the decrypted database and cached in-memory query
  results are ordinary process memory, not specially hardened.
- Using **Check for updates**: this reveals to GitHub (and anyone
  positioned to observe your network traffic) that this app, and
  therefore this project's software, is running on your network at that
  moment — no client data is sent, but that request itself is metadata.
  It only ever fires when you click the button.
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
for Windows, macOS, and Linux. Windows builds are made and tested
locally by the maintainer. macOS builds are produced by
[`.github/workflows/build-macos.yml`](.github/workflows/build-macos.yml)
on GitHub's own macOS runners (this project has no Mac hardware of its
own) — they're not manually tested beyond that build succeeding, so if
you hit a macOS-specific issue, please report it. Linux isn't built or
tested yet at all; contributions documenting or fixing platform-specific
issues there are welcome.

## Contributing

Issues and PRs welcome. Please don't commit any real or sample client
data — `.gitignore` already excludes database and vault files, but double
-check before pushing.

## License

GNU General Public License v3.0 — see [LICENSE](LICENSE).
