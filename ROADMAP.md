# Roadmap

Not commitments or a schedule — just a durable list of what's been
discussed as coming after the current feature set, so it doesn't only
live in chat history. Delete/edit freely as priorities change.

## Up next

Nothing queued at the moment -- see "Later / larger" below for
longer-term ideas.

## Later / larger

External creator feedback (2026-09-23) raised several ideas, most of
which have since shipped:
- Client value stats (lifetime/30d/90d spend, order count, average
  order, last purchase) -- personDetail.js's "Client value" card,
  people.js's "Lifetime spend" column.
- Content-library upsell matching ("content matching this client's
  interests") -- personDetail.js's "Content matches" card.
- A per-client Activity log (quick-logged notes distinct from the
  general/screening notes fields) with an optional follow-up date, plus
  a cross-client Follow-ups queue -- its own nav item, not folded into
  the Calendar -- see person_interactions
  (0018_person_interactions.sql), personDetail.js's "Activity" card,
  followUps.js.
- Cross-platform duplicate-client detection: a catch-at-entry check
  when adding a platform account already linked elsewhere, an on-demand
  "Possible duplicate clients" scan (Settings) using three signal tiers
  (exact platform account reused, same username on a different
  platform, near-identical labels), and a "Merge clients" tool that
  actually fixes a confirmed duplicate (orders/accounts/tags/activity
  all move to the survivor, including careful handling if either side
  had already been synced/exported elsewhere) -- see personDuplicates.js,
  person.js's mergeInto(), personLinkModal.js (which also offers linking
  two clients without merging -- see person_links,
  0019_person_links.sql). Always a human choice, never automatic.
- A "/" command palette in the sidebar search box (Ctrl+K/Cmd+K to
  focus it from anywhere) -- `/reminder` fires off a quick reminder
  without leaving the current page, `/add-event` opens the Calendar
  with a new event ready to edit, plus a `/command` for every other
  page in the app -- see commands.js, quickReminderModal.js. This is
  also most of what "quick notes/tags speed" below was asking for.

Follow-on gap found spot-checking the above (2026-09-24): person.js's
`mergeInto()` carefully carries over orders, platform accounts, tags,
Activity entries, person_links, and cross-instance external_id/
person_external_links from the loser to the survivor, but never touches
`persons.is_shared` (0012_shared_sync.sql). If the client being merged
away (the "loser") was marked shared for the shared-folder sync feature
but the survivor wasn't, the merge silently drops that client out of
`listShared()`'s export scope -- no error, no warning, just one fewer
client showing up in the next sync bundle. Fix is small: `is_shared:
loser.is_shared || survivor.is_shared` written onto the survivor inside
the same merge transaction, right alongside the external_id handling
already there.

What's left, still needing real design decisions before being built:

- **Custom content order workflow.** Orders already carry a free-text
  status (pending/in_progress/on_hold/completed/cancelled, editable
  as any free text -- see ORDER_STATUSES in helpers.js) and can already
  link Content items, a deadline, a price, a platform, and notes -- most
  of what the reviewer's "Requested → Awaiting payment → Paid → To
  produce → Produced → Sent → Completed" pipeline needs already has a
  field. What's missing is that specific preset pipeline (today's five
  generic statuses don't match a custom-request workflow) and a
  "content requirements" field distinct from the general description.
  Simplest version: an additional set of status presets a user can pick
  instead of the generic ones per-order (or per a new is_custom_request
  flag), rather than inventing a whole second order type.
- **Quick notes/tags speed, remaining gap.** The "/" command palette
  above covers app-wide fast actions, but logging an Activity entry for
  a *specific* client still means opening that client's full page first
  -- `/reminder` has no client context, it's a standalone calendar
  reminder. A `/note <client>` -style command, or a quick-log
  affordance right on the Clients list per row, would close that gap --
  not built yet since it needs a client-picker UX decision the simpler
  commands didn't.
- **Platform revenue analytics: fees/net/tips.** Gross revenue by
  platform already exists (Analytics page, analytics.js's
  getRevenueByPlatform()). Net-of-fees isn't a separate concept this
  app needs to invent -- the Expenses ledger already exists for exactly
  "money that isn't gross order revenue." A platform-fee line entered
  there, tagged/categorized by platform, gets net revenue "for free" by
  subtracting from the existing gross-by-platform number, without a
  schema change. Worth a small Analytics addition once there's real fee
  data being logged to show it against.
- **Budget targets** (a per-category monthly spending limit, with
  actual-vs-target shown on the Expenses tab). The expense ledger,
  slated income, and manual income-statement tracking shipped; this was
  explicitly scoped out of that round as a bigger, separate concept on
  top of the ledger itself. Revisit once the ledger's been in daily use
  for a while and it's clear what "budget" should actually mean here.
- ~~**Auto-parsing platform pay-statement PDFs.**~~ Shipped (2026-09-23),
  reversing the earlier decision noted here for a while: platform
  statement layouts still aren't a stable, documented format, and a bad
  parse could still silently produce a wrong income number if ever
  trusted blindly -- the mitigation is that it never is. Every guessed
  field (gross/fees/net/period/platform) lands in the exact same
  editable form the manual flow always used, the raw extracted text is
  shown alongside for a sanity check, and nothing is written until the
  human submits the form. Originally used `pdf-parse@1.1.4` (chosen
  deliberately over its current major version, which pulls in a native
  canvas dependency purely for page-rendering this app never needed).
  Replaced the same day with this project's own minimal PDF text
  reader -- no dependency at all -- once it turned out pdf-parse
  bundles its own old copy of pdf.js's parser as vendored source rather
  than a declared dependency, invisible to `npm audit` and to any CVE
  check against it. The reader is deliberately scoped to well-formed,
  non-encrypted PDFs (real statement exports, not arbitrary/malformed
  PDF input) -- verified against real Chromium-generated PDFs (the same
  engine `src/main/pdf/exportOrderPdf.js` already uses) plus a
  hand-built cross-reference-stream/compressed-object-stream PDF for
  the modern-format path Chromium's own output doesn't exercise. See
  `src/main/incomeImport/pdf/`.
- ~~**CSV import from platform exports.**~~ Shipped alongside the PDF
  import above (2026-09-23), scoped exactly as originally cautioned:
  one column-mapping form working with any CSV shape rather than a
  generic "import any CSV" parser or a per-platform hardcoded parser --
  a header that looks right is pre-selected, but every mapping stays
  visible and editable, with a live preview before anything is written.
  Each mapped row becomes one income statement; a row with an
  unparseable date is skipped and reported, never guessed at. Hand-rolled
  CSV parsing (no new dependency -- see
  `src/main/incomeImport/csvStatementParser.js`) rather than a library,
  small and well-understood enough to be worth writing directly.
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
- **Mandarin (Simplified Chinese) localization**, considered viable but
  a real lift (assessed 2026-09-24). There's no i18n/string-
  externalization layer in this codebase today (confirmed: no
  `i18n`/`translate` module anywhere in `src/`, `index.html` still hard-
  codes `lang="en"`) -- every screen's copy lives as inline text inside
  `src/renderer/views/*.js`'s template-string HTML, roughly 400-900
  individual strings spread across ~28 renderer files (~7,200 lines
  total). Date/money formatting is already locale-aware for free
  (`helpers.js`'s `formatDateTime`/`formatMoney` both pass `undefined`
  as the `Intl`/`Date` locale, which defers to the OS locale rather than
  hardcoding `en-US`) -- only the literal English UI strings need
  translating, not the formatting logic. FullCalendar (vendored via
  `scripts/copy-vendor-assets.js`) already ships ready-made locale
  bundles at `node_modules/fullcalendar/locales/zh-cn/global.js` and
  `.../zh-tw/global.js` in the same "global" script-tag format this
  project already vendors its theme files in -- wiring up the calendar's
  own text (day/month names, buttons) would just be one more
  `FILES_TO_COPY` entry plus a `<script>` tag and a `locale: 'zh-cn'`
  option in calendar.js, a small, self-contained piece of the work.
  Simplified vs. Traditional: default to Simplified (`zh-cn`, the more
  common convention and mainland China's standard), but the same
  mechanism supports Traditional (`zh-tw`) as a second locale option
  later at low extra cost once the string-extraction work is done once.
  The real blocker is that first extraction pass, not any technical
  wall -- **first concrete step**: pull every renderer-visible string out
  of the view files into a single lookup table (e.g. one `strings.js`
  keyed by a short id, `en` values first) and have every view read
  through it, with no translation yet -- that alone is most of the
  effort and de-risks adding a second language after, including
  Mandarin, without it being a rewrite.
