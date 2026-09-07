# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

SWA (Sex Worker Assistant) — a local-first, encrypted desktop CRM for
independent workers managing clients across multiple online platforms.
Electron + encrypted SQLite (`better-sqlite3-multiple-ciphers`) + vanilla
JS/HTML/CSS (no framework, no bundler) + FullCalendar. See `README.md`
for the full feature list and, importantly, the **threat model** section
— read that before touching anything security-related (vault lifecycle,
auto-lock, quick-unlock). See `ROADMAP.md` for what's planned but not
built yet.

**Non-negotiables carried through every change:** no cloud sync, no
telemetry/analytics/crash-reporting, database encrypted at rest, the
vault passphrase is never stored in plaintext. The *only* network call
anywhere in the codebase is the manual, opt-in "Check for updates"
button (`src/main/updates/checkForUpdates.js`) — anything that adds
another one (e.g. calendar sync, mobile sync — see ROADMAP.md) needs an
explicit in-app warning and a README threat-model update, not a silent
addition.

## Commands

```bash
npm install       # also runs postinstall -> scripts/copy-vendor-assets.js
npm start          # run the app in dev mode (electron .)
npm run package    # build a distributable installer via electron-builder -> dist/
```

There is no lint command and no committed automated test suite. The
de facto verification approach used throughout this project: write a
throwaway `*.tmp.js` script, run it with plain `node` (not the app) to
exercise repository/business logic directly against a disposable
encrypted test database built from the real migration files, assert
results, then delete the script. Search recent git history/PR
descriptions for examples of this pattern before writing new logic that
touches the database or date/timezone math — both have produced real
bugs here that this pattern caught before they shipped.

After any change to `src/main/**` or `src/renderer/**`, the running app
needs a full restart (no hot reload) — kill the `electron`/`SWA`
process(es) and re-run `npm start`.

## Architecture

### Process split (standard Electron security posture)

- `src/main/` — Node.js side. Owns the database connection, the vault
  passphrase lifecycle, all filesystem access, and every IPC handler.
  Nothing outside this directory ever touches SQLite directly.
- `src/preload/index.js` — the *only* bridge between main and renderer,
  via `contextBridge.exposeInMainWorld('api', {...})`. `contextIsolation`,
  no `nodeIntegration`, `sandbox: true` (see `src/main/window.js`). When
  adding a new IPC call: register the handler in the relevant
  `src/main/ipc/*Ipc.js` file, then add the matching method here —
  both sides, always. Never expose `ipcRenderer` itself.
- `src/renderer/` — vanilla JS/HTML/CSS, one file per screen under
  `views/`, all DOM manipulation via template strings + `innerHTML` +
  manually-attached listeners (no virtual DOM, no reactive framework).
  `views/shell.js` is the router — a plain `if/else` chain over a
  `viewName` string, not a library.

### Database

- `src/main/db/connection.js` owns the single shared `Database` handle;
  opens/closes are driven entirely by vault lock state
  (`src/main/security/passphrase.js`), never called directly elsewhere.
- `src/main/db/migrations/*.sql` — numbered, applied in order by
  `migrate.js` on every unlock (idempotent, tracked in a `_migrations`
  table). Add a new numbered file for schema changes; never edit an
  already-shipped migration.
- `src/main/db/repositories/*.js` — the only place raw SQL is written.
  IPC handlers call these, never construct SQL themselves. A repository
  with no table of its own is fine when it composes queries across
  others (e.g. `search.js`, `analytics.js`).
- Business logic that mixes filesystem/OS access with app logic lives
  outside `db/repositories/` in its own top-level `src/main/*/` folder
  instead — e.g. `src/main/sync/` (shared-folder sync) and
  `src/main/scanner/` (content library media folder scanner). These
  still call into `db/repositories/*.js` for any actual SQL rather than
  querying the database directly.
- Money is always stored as integer cents (never floats). Timestamps are
  ISO-8601 UTC strings; the renderer converts to/from the browser's local
  time only at the form boundary (`toDatetimeLocalValue`/
  `fromDatetimeLocalValue`/`toDateInputValue`/`fromDateInputValue` in
  `src/renderer/helpers.js`) — get this wrong and dates silently shift by
  a day depending on the user's timezone offset direction, which has
  happened before in this codebase.

### Naming: "Person" vs "Client"

The UI shows "Client" (see `people.js`, `personDetail.js`), but the
table, every repository/IPC/file name, and every `person`/`personId`
identifier in the code stays "Person" — deliberate, not an oversight.
Don't rename code identifiers to match UI copy.

### Encrypted vault lifecycle

`src/main/security/passphrase.js` is the only module that ever handles
a raw passphrase. No plaintext passphrase is ever written to disk. The
opt-in "quick unlock" feature wraps it via Electron's `safeStorage`
(OS keychain) — off by default, documented trade-off in README. Auto-lock
(`src/main/security/idleLock.js`) and the reminder scheduler
(`src/main/reminders/reminderScheduler.js`) both poll on `setInterval`,
gated on `passphrase.isUnlocked()`, and are started/stopped together from
the `notifyUnlocked`/`notifyLocked` hooks in `src/main/index.js` — follow
that same start/stop-pair pattern for any new background poller.

### FullCalendar — no bundler, so no `npm import`

`fullcalendar`'s v7 "global" script-tag build doesn't self-inject CSS
(despite what its own release notes imply) — it needs `skeleton.css` +
a theme's `theme.css`/`palette.css`/theme `global.js` all linked
explicitly (currently the "classic" theme). `scripts/copy-vendor-assets.js`
copies exactly these files from `node_modules/fullcalendar/` into
`src/renderer/vendor/` (gitignored, regenerated by the `postinstall`
npm script) so the strict CSP (`script-src 'self'`) and asar packaging
both stay happy. If FullCalendar ever needs a different theme or more
plugins, update the `FILES_TO_COPY` list in that script and the
`<link>`/`<script>` tags in `src/renderer/index.html` together.

### Packaging

`electron-builder.yml` bundles the full `node_modules/**/*` (including
prebuilt native binaries for every platform, not just the current
target — deliberate, since a macOS build is planned) and unpacks `*.node`
files out of the asar archive, since native modules can't load from
inside one. Version bumps: `package.json`'s `version`, then
`npm run package`, then a matching git tag (`vX.Y.Z`) — the opt-in
update-checker compares against GitHub release tags in exactly that
format.
