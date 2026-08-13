'use strict';

// Builds a minimal RFC 5545 (iCalendar) file from calendar events and/or
// order due dates. Hand-rolled rather than a dependency -- the subset we
// need (VEVENT with a summary, description, and start/end) is small
// enough that a library would be more code to learn than to write, same
// reasoning as using Electron's built-in printToPDF instead of a PDF
// library for order receipts.

// RFC 5545 escaping: backslash, semicolon, and comma are escaped with a
// backslash; newlines become a literal "\n" (two characters).
function escapeIcsText(text) {
  return String(text ?? '')
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\n/g, '\\n');
}

// RFC 5545 line folding: lines over 75 octets should be split, with each
// continuation line starting with a single space.
function foldLine(line) {
  if (line.length <= 75) return line;
  const chunks = [line.slice(0, 75)];
  let rest = line.slice(75);
  while (rest.length > 0) {
    chunks.push(` ${rest.slice(0, 74)}`);
    rest = rest.slice(74);
  }
  return chunks.join('\r\n');
}

// A DTSTART/DTEND with a trailing "Z" represents a real UTC instant --
// correct for timed events, since every calendar app converts it to the
// viewer's own local time for display.
function formatIcsDateTime(isoUtc) {
  const d = new Date(isoUtc);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`;
}

// All-day dates have no time/timezone component, so they need different
// handling depending on what's being formatted:
//  - A plain "YYYY-MM-DD" (order delivery_due_date) needs no conversion
//    at all -- just strip the dashes.
//  - A full ISO datetime representing local midnight (an all-day
//    calendar_events row -- see fromDatetimeLocalValue in helpers.js)
//    must use *local* date getters, not UTC ones, or the date could
//    shift by a day depending on the timezone offset's sign.
function formatIcsDateOnly(value) {
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return value.replace(/-/g, '');
  }
  const d = new Date(value);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`;
}

// items: [{ uid, title, notes, start, end, allDay }]
function buildIcs(items) {
  const stamp = formatIcsDateTime(new Date().toISOString());
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//SWA//EN', 'CALSCALE:GREGORIAN'];

  for (const item of items) {
    lines.push('BEGIN:VEVENT');
    lines.push(`UID:${item.uid}`);
    lines.push(`DTSTAMP:${stamp}`);

    if (item.allDay) {
      lines.push(`DTSTART;VALUE=DATE:${formatIcsDateOnly(item.start)}`);
      if (item.end) lines.push(`DTEND;VALUE=DATE:${formatIcsDateOnly(item.end)}`);
    } else {
      lines.push(`DTSTART:${formatIcsDateTime(item.start)}`);
      if (item.end) lines.push(`DTEND:${formatIcsDateTime(item.end)}`);
    }

    lines.push(`SUMMARY:${escapeIcsText(item.title)}`);
    if (item.notes) lines.push(`DESCRIPTION:${escapeIcsText(item.notes)}`);
    lines.push('END:VEVENT');
  }

  lines.push('END:VCALENDAR');
  return `${lines.map(foldLine).join('\r\n')}\r\n`;
}

module.exports = { buildIcs };
