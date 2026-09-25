'use strict';

// Best-effort text/number extraction from an uploaded platform pay
// statement PDF -- feeds the Expenses page's "Add statement" form as a
// pre-fill, never a silent write. See 0007_expenses_and_income.sql's
// comment for why this was originally left out entirely: platform
// statement layouts aren't a stable, documented format, so a wrong
// guess here is a real risk *if it's ever trusted blindly*. The actual
// mitigation lives in the UI, not this parser: every guessed field
// lands in the exact same editable input the manual flow already uses,
// and the raw extracted text is always shown alongside it so a bad
// guess is obvious at a glance instead of just looking plausible.
//
// Text extraction is this project's own minimal PDF reader (./pdf/) --
// no third-party dependency at all. Originally used pdf-parse@1.1.4,
// which was already picked deliberately over its current major version
// to avoid a native dependency; replaced entirely once it turned out
// pdf-parse bundles its own old copy of pdf.js's parser as vendored
// source rather than an npm dependency, which meant npm audit could
// never see (or ever have flagged) CVEs in it. See ./pdf/document.js
// for what this reader does and doesn't handle -- scoped deliberately
// to well-formed, non-encrypted PDFs like real statement exports, not
// arbitrary/malformed PDF input.

const { extractText } = require('./pdf/document');

// Tries each label in order (most specific first) against "<label> ...
// $<amount>" -- not necessarily adjacent, statements often put the
// label and the number on different lines, hence the generous gap.
// Returns the first match's amount in cents, or null if nothing in the
// list matched anywhere in the document.
function findAmountCents(text, labels) {
  for (const label of labels) {
    const pattern = new RegExp(`${label}[^\\d$\\-]{0,40}\\$?\\s*([\\d,]+\\.\\d{2})`, 'i');
    const match = text.match(pattern);
    if (match) return Math.round(parseFloat(match[1].replace(/,/g, '')) * 100);
  }
  return null;
}

// A "<date> [-–to/through] <date>" pattern, tried against two common
// date shapes (MM/DD/YYYY and "Month DD, YYYY"). Statements that show
// only a single date (not a range) aren't matched here -- left for the
// human to fill in rather than guessing which single date means what.
function findDateRange(text) {
  const datePattern = '(\\d{1,2}/\\d{1,2}/\\d{2,4}|[A-Z][a-z]+ \\d{1,2},? \\d{4})';
  const rangePattern = new RegExp(`${datePattern}\\s*(?:-|–|to|through)\\s*${datePattern}`, 'i');
  const match = text.match(rangePattern);
  if (!match) return { periodStart: null, periodEnd: null };
  return { periodStart: toIsoDate(match[1]), periodEnd: toIsoDate(match[2]) };
}

function toIsoDate(dateStr) {
  const parsed = new Date(dateStr);
  if (Number.isNaN(parsed.getTime())) return null;
  const pad = (n) => String(n).padStart(2, '0');
  return `${parsed.getFullYear()}-${pad(parsed.getMonth() + 1)}-${pad(parsed.getDate())}`;
}

// A short, deliberately non-exhaustive list -- just enough that the
// Platform field doesn't sit empty for the most common cases. Anything
// not on this list is left blank for the human to type, same as today.
const KNOWN_PLATFORMS = ['OnlyFans', 'Fansly', 'JustFor.Fans', 'ManyVids', 'Fanvue', 'LoyalFans', 'Patreon'];
function findPlatform(text) {
  return KNOWN_PLATFORMS.find((p) => text.toLowerCase().includes(p.toLowerCase())) || '';
}

async function extractStatementFromPdf(buffer) {
  const text = extractText(buffer);

  const grossCents = findAmountCents(text, ['gross earnings', 'gross revenue', 'gross income', 'total earnings', 'gross']);
  const feesCents = findAmountCents(text, ['platform fee', 'service fee', 'total fees', 'fees']);
  // A statement's own stated "net" is preferred over gross-minus-fees
  // (real statements sometimes include other small adjustments) -- only
  // falls back to computing it when nothing in the text matched at all.
  let netCents = findAmountCents(text, ['net earnings', 'net revenue', 'net payout', 'total payout', 'net']);
  if (netCents === null && grossCents !== null && feesCents !== null) {
    netCents = grossCents - feesCents;
  }

  const { periodStart, periodEnd } = findDateRange(text);
  const platform = findPlatform(text);

  return { text, guessed: { periodStart, periodEnd, platform, grossCents, feesCents, netCents } };
}

module.exports = { extractStatementFromPdf };
