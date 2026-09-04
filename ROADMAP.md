# Roadmap

Not commitments or a schedule — just a durable list of what's been
discussed as coming after the current feature set, so it doesn't only
live in chat history. Delete/edit freely as priorities change.

## Up next

Nothing queued at the moment -- see "Later / larger" below for
longer-term ideas.

## Later / larger

- **Budget targets** (a per-category monthly spending limit, with
  actual-vs-target shown on the Expenses tab). The expense ledger,
  slated income, and manual income-statement tracking shipped; this was
  explicitly scoped out of that round as a bigger, separate concept on
  top of the ledger itself. Revisit once the ledger's been in daily use
  for a while and it's clear what "budget" should actually mean here.
- **Auto-parsing platform pay-statement PDFs** (as opposed to the manual
  entry that shipped). Considered and intentionally not built: platform
  statement layouts aren't a stable, documented format, a bad parse
  could silently produce a wrong income number, and it would pull in a
  new PDF-parsing dependency this project has otherwise avoided (see
  README's "small, deliberately short dependency list"). The source PDF
  can still be attached to a manually-entered statement as backup.
- **Embedded in-app browser (login + manage a platform account without
  leaving SWA) -- considered and declined.** The underlying want (less
  tab-switching between SWA and a platform's site) is reasonable, but an
  embedded browser with live logged-in sessions breaks this app's core
  "the only network call is the opt-in update check" promise (see
  CLAUDE.md/README's threat model) in a much bigger way than anything
  else on this list: it means new sensitive session/cookie data living
  outside the encrypted vault, a real new attack surface (this app's CSP
  currently locks out all external script execution), and platforms that
  actively detect/block non-standard browser embeds. **If this itch
  comes back, build instead:** a simple "Open OnlyFans" / "Open Fansly"
  button next to a PlatformAccount that calls Electron's
  `shell.openExternal()` to hand off to the user's own, already-logged-in
  default browser -- gets most of the convenience with none of the above
  risk, and doesn't add a network code path to this app's own process.
- **Google Calendar / Apple Calendar sync.** In real tension with this
  app's "no network calls, fully offline" non-negotiable (see README's
  threat model), so if built, it must be:
  - **Opt-in only**, off by default.
  - Gated behind an explicit in-app warning before enabling, along the
    lines of: *"This will give this app some degree of network access.
    That isn't inherently insecure, but it does mean some of this data
    is exposed to a source outside this computer."*
  - Documented in the README's threat model once it exists, so the
    "does NOT protect against" list stays honest.
  - Apple Calendar via CalDAV is more approachable (can stay
    local/self-hosted); Google Calendar needs OAuth + the Google API,
    which is a harder fit for a local-first app and should be scoped
    carefully if it happens at all.
- **Sync between this desktop app and a future mobile version.** Not
  designed yet. Whatever shape this takes needs the same "opt-in,
  clearly-flagged network access" treatment as calendar sync above,
  since by definition it means this device's data leaving this device.
