# Roadmap

Not commitments or a schedule — just a durable list of what's been
discussed as coming after the current feature set, so it doesn't only
live in chat history. Delete/edit freely as priorities change.

## Up next

- **Search** across People and Orders. Deferred until the Calendar was
  working since it'll likely need to hook into it (e.g. jumping from a
  search result straight to a calendar entry).
- **"New order" button on the global Orders page.** Needs a client
  picker, since that page (unlike a person's own page) has no person
  context to create an order against.
- **Expenses / Budget tab.** The other major piece from the original
  MVP plan, not started.

## Later / larger

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
