// Small shared utilities used across the renderer views. Kept
// dependency-free on purpose -- see README.md for why this project sticks
// to vanilla JS/HTML/CSS instead of a framework.

// Escapes text before it's dropped into an innerHTML template string, so a
// person's name/notes/etc. containing "<" or "&" can't break the page.
// (This isn't a security boundary against a malicious actor -- it's your
// own local data -- but it keeps the UI correct.)
// One scratch element reused across every call rather than created fresh
// each time -- this runs once per field on every list/table row render, so
// the DOM-creation cost adds up across a full re-render of e.g. the
// Clients or Orders list.
const escapeHtmlScratch = document.createElement('div');
export function escapeHtml(str) {
  escapeHtmlScratch.textContent = str ?? '';
  return escapeHtmlScratch.innerHTML;
}

// Deterministic string -> hue (0-359), so the same text always lands on
// the same color everywhere it's shown (e.g. "OnlyFans" as both a
// platform badge and a revenue chip on personDetail.js's id-card) without
// maintaining a hand-picked color list per platform/tag. Pair with the
// --chip-bg-sat/--chip-fg-sat/etc. theme tokens in main.css's .chip-color
// rule -- this only picks the hue, not how saturated/light it renders in
// the current theme.
export function hashHue(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = (hash * 31 + str.charCodeAt(i)) >>> 0;
  }
  return hash % 360;
}

// An Error thrown in a main-process IPC handler reaches the renderer as
// "Error invoking remote method 'x:y': Error: <real message>". This
// returns just the real message, for showing to the user.
export function ipcErrorMessage(err) {
  const message = (err && err.message) || String(err);
  return message.replace(/^Error invoking remote method '[^']*': (?:[A-Za-z]*Error: )?/, '');
}

// Fixed hues for well-known platforms, spread around the color wheel so
// the common ones never look alike (hashing "OnlyFans" and "Fansly" put
// both on green). X is deliberately neutral, like its own branding.
// Anything else falls back to a hash of the name, ignoring case and
// punctuation so "OnlyFans" and "only fans" always match.
const PLATFORM_HUES = {
  onlyfans: 199,
  fansly: 262,
  reddit: 18,
  instagram: 322,
  telegram: 168,
  tiktok: 350,
  snapchat: 52,
  chaturbate: 32,
  manyvids: 292,
  stripchat: 140,
  justforfans: 225,
  fanvue: 110,
  loyalfans: 240,
  patreon: 8,
  twitch: 275,
  bluesky: 210,
};
const NEUTRAL_PLATFORMS = new Set(['x', 'twitter', 'twitterx', 'xtwitter']);

// Suggestions for the "Platform" field when adding an account.
export const KNOWN_PLATFORM_NAMES = [
  'OnlyFans',
  'Fansly',
  'X',
  'Instagram',
  'Reddit',
  'TikTok',
  'Telegram',
  'Snapchat',
  'Chaturbate',
  'Stripchat',
  'ManyVids',
  'JustFor.Fans',
  'Fanvue',
  'LoyalFans',
  'Patreon',
  'Twitch',
  'Bluesky',
];

function platformKey(name) {
  return String(name || '')
    .toLowerCase()
    .replace(/\.(com|net|tv|me|app|fans)$/, '')
    .replace(/[^a-z0-9]/g, '');
}

// { hue, neutral } for a platform chip: set --hue from `hue`, and add the
// chip-neutral class when `neutral` is true.
export function platformColor(name) {
  const key = platformKey(name);
  if (NEUTRAL_PLATFORMS.has(key)) return { hue: 0, neutral: true };
  return { hue: PLATFORM_HUES[key] ?? hashHue(key), neutral: false };
}

export function formatDateTime(isoString) {
  if (!isoString) return '';
  // toLocaleString() with no options includes seconds in most locales --
  // more precision than anyone needs for "when was this added".
  return new Date(isoString).toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

// Money is stored in the database as an integer number of cents (see the
// comments in src/main/db/migrations/0001_init.sql) to avoid
// floating-point rounding errors. These two functions are the only place
// that convert to/from the human-friendly dollars-and-cents values shown
// in forms and tables.
// Formatters are cached per currency code rather than constructed fresh on
// every call -- this runs once per money value on every order/expense/
// income row in a list render, and Intl.NumberFormat construction is
// noticeably more expensive than reusing an already-built instance.
const moneyFormatters = new Map();
function getMoneyFormatter(currency) {
  let formatter = moneyFormatters.get(currency);
  if (!formatter) {
    formatter = new Intl.NumberFormat(undefined, { style: 'currency', currency });
    moneyFormatters.set(currency, formatter);
  }
  return formatter;
}

export function formatMoney(cents, currency = 'USD') {
  const dollars = (cents ?? 0) / 100;
  try {
    return getMoneyFormatter(currency).format(dollars);
  } catch (err) {
    // Intl throws on an unrecognized currency code -- fall back gracefully
    // instead of breaking the whole row.
    return `${dollars.toFixed(2)} ${currency}`;
  }
}

export function parseMoneyToCents(input) {
  const value = Number.parseFloat(input);
  if (Number.isNaN(value)) return 0;
  return Math.round(value * 100);
}

// Suggested values for the payment-method field, shown via an
// <input list> + <datalist> combo (see views/personDetail.js) so users can
// pick a common one or type anything custom. Stored as free TEXT in the
// database -- same "free text, not an enum" approach as platform_name --
// since payment methods vary a lot from person to person.
export const PAYMENT_METHOD_PRESETS = [
  'PayPal',
  'CashApp',
  'Venmo',
  'Zelle',
  'Bank Transfer',
  'Cash',
  'Amazon Gift Card',
  'Other Gift Card',
  'BTC',
  'Other Crypto',
  'OnlyFans Tip',
  'Fansly Tip',
  'Other',
];

// Suggested values for the expense category field (see views/expenses.js),
// shown via an <input list> + <datalist> combo -- same "free text, not an
// enum" approach as PAYMENT_METHOD_PRESETS above, since costs vary a lot
// from person to person.
export const EXPENSE_CATEGORY_PRESETS = ['Supplies', 'Software/Subscriptions', 'Marketing', 'Travel', 'Fees', 'Other'];

// Suggested values for a content item's type field (see
// views/contentLibrary.js), same "free text, not an enum" approach as
// PAYMENT_METHOD_PRESETS/EXPENSE_CATEGORY_PRESETS above.
export const CONTENT_TYPE_PRESETS = ['Video', 'Picture set', 'Custom request', 'Other'];

// The fixed set of order statuses. Stored as free TEXT in the database
// (see 0001_init.sql's comments), but the renderer only ever writes one
// of these five values via <select> elements built from this list.
export const ORDER_STATUSES = [
  { value: 'pending', label: 'Pending' },
  { value: 'in_progress', label: 'In Progress' },
  { value: 'on_hold', label: 'On Hold' },
  { value: 'completed', label: 'Completed' },
  { value: 'cancelled', label: 'Cancelled' },
];

// The quick-status <select> on orders.js's and personDetail.js's order
// tables lets status flip to Completed in one click, with no visibility
// into the order's own `date_paid` field (that only lives on the order's
// full page -- see orderDetail.js). Every revenue figure in this app
// (Client value, Client totals, Analytics, platform-revenue-by-year)
// requires date_paid to be set, so marking Completed is meant to CLOSE
// the order out -- see closeOrderModal.js, which both call sites open
// when this returns true instead of applying the status change directly.
export function needsPaymentDateBeforeClosing(order, newStatus) {
  return newStatus === 'completed' && !order.date_paid;
}

// The fixed set of client priority levels (see 0013_person_priority.sql)
// -- same "free text with a small fixed set" convention as
// ORDER_STATUSES above, and as calendar.js's own PRIORITY_OPTIONS for
// calendar events (a separate, unrelated field).
export const PRIORITY_OPTIONS = [
  { value: 'low', label: 'Low priority' },
  { value: 'normal', label: 'Normal' },
  { value: 'vip', label: 'VIP' },
];

// '' for 'normal' -- the common case shouldn't add visual noise to every
// row of the Clients list -- else a small colored badge. Shared between
// people.js (list) and personDetail.js (the client's own page) so both
// render the same badge the same way.
export function priorityBadgeHtml(priority) {
  if (!priority || priority === 'normal') return '';
  const match = PRIORITY_OPTIONS.find((p) => p.value === priority);
  const label = match ? match.label : priority;
  return `<span class="priority-badge priority-${escapeHtml(priority)}">${escapeHtml(label)}</span>`;
}

// The fixed set of person_interactions.type presets (see
// 0018_person_interactions.sql) -- same "free text with a small fixed
// set" convention as ORDER_STATUSES/PRIORITY_OPTIONS above: the schema
// doesn't enforce these, this is just what the quick-add form on a
// client's page offers.
export const INTERACTION_TYPE_OPTIONS = [
  { value: 'note', label: 'Note' },
  { value: 'custom_request', label: 'Custom request' },
  { value: 'payment_promise', label: 'Payment promise' },
  { value: 'risk_flag', label: 'Risk flag' },
];

export function interactionTypeLabel(value) {
  const match = INTERACTION_TYPE_OPTIONS.find((t) => t.value === value);
  return match ? match.label : value;
}

export function orderStatusLabel(value) {
  const match = ORDER_STATUSES.find((s) => s.value === value);
  return match ? match.label : value;
}

// Builds <option> HTML for a status <select>, including the current value
// as an extra "(legacy)" option if it predates the fixed list (e.g. free
// text typed before this dropdown existed) -- so old data is never
// silently changed out from under the user.
//
// The current value is marked `selected`. Without that the <select> shows
// its first option (Pending), and saving an order's own page -- even just
// to fix its description -- silently reset a Completed order to Pending.
export function buildStatusOptions(currentValue) {
  const isKnown = ORDER_STATUSES.some((s) => s.value === currentValue);
  const legacyOption =
    currentValue && !isKnown
      ? `<option value="${escapeHtml(currentValue)}" selected>${escapeHtml(currentValue)} (legacy)</option>`
      : '';
  const knownOptions = ORDER_STATUSES.map(
    (s) => `<option value="${s.value}"${s.value === currentValue ? ' selected' : ''}>${s.label}</option>`
  ).join('');
  return legacyOption + knownOptions;
}

// Human-friendly file size for attachment listings, e.g. 842 bytes,
// 1.3 KB, 4.7 MB.
export function formatBytes(bytes) {
  if (!bytes || bytes < 1024) return `${bytes ?? 0} bytes`;
  const units = ['KB', 'MB', 'GB'];
  let value = bytes / 1024;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  return `${value.toFixed(1)} ${units[unitIndex]}`;
}

// <input type="datetime-local"> works in timezone-less local strings like
// "2026-08-15T14:30", but the database stores proper UTC ISO-8601
// strings (e.g. "2026-08-15T18:30:00.000Z"), same convention as every
// other timestamp in this app. These two functions are the only place
// that convert between the two, right at the form boundary.
//
// A date-time string with no timezone offset is parsed as *local* time
// by JavaScript's Date (per spec) -- that's what makes both directions
// work without any manual offset math.
export function toDatetimeLocalValue(isoUtc) {
  if (!isoUtc) return '';
  const date = new Date(isoUtc);
  if (Number.isNaN(date.getTime())) return '';
  const pad = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function fromDatetimeLocalValue(localValue) {
  if (!localValue) return null;
  const date = new Date(localValue);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString();
}

// Same idea, for plain <input type="date"> (all-day events, which have
// no time component to lose). Reuses fromDatetimeLocalValue by treating
// the date as local midnight, the same convention already used for
// order delivery_due_date and all-day calendar events.
export function toDateInputValue(isoUtc) {
  return toDatetimeLocalValue(isoUtc).slice(0, 10);
}

export function fromDateInputValue(dateString) {
  if (!dateString) return null;
  return fromDatetimeLocalValue(`${dateString}T00:00`);
}

// Local-calendar YYYY-MM-DD `days` from today, for the quick follow-up
// presets (1 day / 3 days / 1 week) -- same plain date-string format as
// person_interactions.follow_up_date.
export function followUpDateInDays(days) {
  const target = new Date();
  target.setDate(target.getDate() + days);
  return toDateInputValue(target.toISOString());
}

// The quick follow-up choices offered wherever a note can be logged
// without opening the full Activity form.
export const FOLLOW_UP_PRESETS = [
  { days: 1, label: '1 day' },
  { days: 3, label: '3 days' },
  { days: 7, label: '1 week' },
];

// Collapses whitespace/newlines and truncates for a table-row preview of a
// long description. The full text is always still available by opening
// the order for editing.
export function previewText(text, maxLength = 80) {
  const collapsed = (text ?? '').replace(/\s+/g, ' ').trim();
  if (collapsed.length <= maxLength) return collapsed;
  return `${collapsed.slice(0, maxLength - 1)}…`;
}

// Shared between the sidebar quick-search (shell.js) and the full
// results page (search.js) -- both need to agree on when a query is
// long enough to actually fire, rather than each hardcoding its own
// copy. The main-process search repo has its own separate floor
// (src/main/db/repositories/search.js) -- that one's the real
// server-side minimum regardless of what the renderer sends, so it's
// intentionally not shared across the process boundary.
export const SEARCH_MIN_QUERY_LENGTH = 2;

// Small pulsing placeholder shown while a view's initial data is still
// loading (see .loading-state in main.css) -- one shared treatment
// instead of each view rolling its own "Loading..." text.
export function loadingHtml(label = 'Loading…') {
  return `<p class="loading-state">${escapeHtml(label)}</p>`;
}

// Whole days since an ISO-8601 timestamp (plain elapsed time), or, for a
// date-only "YYYY-MM-DD" value like date_paid, whole calendar days since
// that local date. The date-only case needs its own path: new Date() reads
// "2026-09-24" as UTC midnight, which in US time zones is the previous
// evening, so a payment made today showed as "1 day ago" late in the day.
// Returns null for a missing value (e.g. a client with no orders yet) so
// callers can tell "never" apart from "today" (0).
export function daysSince(isoString) {
  if (!isoString) return null;
  const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoString);
  if (dateOnly) {
    const then = new Date(Number(dateOnly[1]), Number(dateOnly[2]) - 1, Number(dateOnly[3]));
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    // round, not floor: a span crossing a DST change is 23 or 25 hours.
    return Math.max(0, Math.round((today.getTime() - then.getTime()) / (1000 * 60 * 60 * 24)));
  }
  const then = new Date(isoString).getTime();
  if (Number.isNaN(then)) return null;
  return Math.max(0, Math.floor((Date.now() - then) / (1000 * 60 * 60 * 24)));
}

// Shared by people.js's "Last order" column and dashboard.js's "Quiet
// clients" stat, so both describe the same gap the same way.
export function formatDaysSince(days) {
  if (days === null || days === undefined) return 'Never';
  if (days === 0) return 'Today';
  if (days === 1) return '1 day ago';
  return `${days} days ago`;
}
