// Small shared utilities used across the renderer views. Kept
// dependency-free on purpose -- see README.md for why this project sticks
// to vanilla JS/HTML/CSS instead of a framework.

// Escapes text before it's dropped into an innerHTML template string, so a
// person's name/notes/etc. containing "<" or "&" can't break the page.
// (This isn't a security boundary against a malicious actor -- it's your
// own local data -- but it keeps the UI correct.)
export function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str ?? '';
  return div.innerHTML;
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
export function formatMoney(cents, currency = 'USD') {
  const dollars = (cents ?? 0) / 100;
  try {
    return new Intl.NumberFormat(undefined, { style: 'currency', currency }).format(dollars);
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

export function orderStatusLabel(value) {
  const match = ORDER_STATUSES.find((s) => s.value === value);
  return match ? match.label : value;
}

// Builds <option> HTML for a status <select>, including the current value
// as an extra "(legacy)" option if it predates the fixed list (e.g. free
// text typed before this dropdown existed) -- so old data is never
// silently changed out from under the user.
export function buildStatusOptions(currentValue) {
  const isKnown = ORDER_STATUSES.some((s) => s.value === currentValue);
  const legacyOption =
    currentValue && !isKnown ? `<option value="${escapeHtml(currentValue)}">${escapeHtml(currentValue)} (legacy)</option>` : '';
  const knownOptions = ORDER_STATUSES.map((s) => `<option value="${s.value}">${s.label}</option>`).join('');
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

// Collapses whitespace/newlines and truncates for a table-row preview of a
// long description. The full text is always still available by opening
// the order for editing.
export function previewText(text, maxLength = 80) {
  const collapsed = (text ?? '').replace(/\s+/g, ' ').trim();
  if (collapsed.length <= maxLength) return collapsed;
  return `${collapsed.slice(0, maxLength - 1)}…`;
}
