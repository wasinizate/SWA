'use strict';

// Hand-rolled RFC 5545 (iCalendar) parser -- the counterpart to
// icsExport.js's hand-rolled builder, same "small enough not to need a
// dependency" reasoning documented there. Deliberately forgiving: a
// VEVENT it can't make sense of is skipped and counted, not fatal to the
// rest of the file.

// Reverses icsExport.js's escapeIcsText().
function unescapeIcsText(text) {
  return String(text ?? '')
    .replace(/\\n/g, '\n')
    .replace(/\\,/g, ',')
    .replace(/\\;/g, ';')
    .replace(/\\\\/g, '\\');
}

// RFC 5545 line folding: a continuation line starts with a single space
// or tab and should be joined back onto the previous line with that
// leading whitespace character stripped. Reverses icsExport.js's
// foldLine().
function unfoldLines(text) {
  const rawLines = text.split(/\r\n|\r|\n/);
  const lines = [];
  for (const line of rawLines) {
    if ((line.startsWith(' ') || line.startsWith('\t')) && lines.length > 0) {
      lines[lines.length - 1] += line.slice(1);
    } else {
      lines.push(line);
    }
  }
  return lines;
}

// Splits "PROPERTY;PARAM=X;PARAM2=Y:VALUE" into { name, params, value }.
// Only the *first* unescaped ':' separates params from value -- a value
// (e.g. a URL) could itself contain ':', so this can't just split on
// every colon.
function parseLine(line) {
  const colonIndex = line.indexOf(':');
  if (colonIndex === -1) return null;

  const head = line.slice(0, colonIndex);
  const value = line.slice(colonIndex + 1);
  const [name, ...paramParts] = head.split(';');

  const params = {};
  for (const part of paramParts) {
    const eq = part.indexOf('=');
    if (eq === -1) continue;
    params[part.slice(0, eq).toUpperCase()] = part.slice(eq + 1);
  }

  return { name: name.toUpperCase(), params, value };
}

// A DTSTART/DTEND field becomes { iso, allDay } -- null if unparseable.
// Three shapes handled:
//  - ;VALUE=DATE:YYYYMMDD -- all-day, no time component at all.
//  - ...Z (trailing Z) -- a real UTC instant, straightforward.
//  - bare local YYYYMMDDTHHMMSS (optionally with a TZID= param) -- read
//    as wall-clock time on *this* machine, ignoring the source TZID.
//    Full IANA timezone conversion needs a real tz database, which this
//    project deliberately avoids pulling in as a dependency (see
//    README's dependency-list stance) -- good enough for same-timezone
//    round-tripping and all-day events, the common case for
//    order-related bookings.
function parseDateField(field) {
  if (!field) return null;
  const { params, value } = field;

  if (params.VALUE === 'DATE' || /^\d{8}$/.test(value)) {
    const y = value.slice(0, 4);
    const m = value.slice(4, 6);
    const d = value.slice(6, 8);
    // Local midnight -> ISO UTC, same convention
    // src/renderer/helpers.js's fromDateInputValue() uses for every
    // other all-day date in this app.
    const local = new Date(`${y}-${m}-${d}T00:00:00`);
    if (Number.isNaN(local.getTime())) return null;
    return { iso: local.toISOString(), allDay: true };
  }

  const match = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z)?$/.exec(value);
  if (!match) return null;
  const [, y, mo, d, h, mi, s, utcMarker] = match;
  const date = utcMarker
    ? new Date(Date.UTC(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi), Number(s)))
    : new Date(`${y}-${mo}-${d}T${h}:${mi}:${s}`);
  if (Number.isNaN(date.getTime())) return null;
  return { iso: date.toISOString(), allDay: false };
}

// Returns { items, skipped }. items: [{ title, notes, start, end, allDay }].
// Never throws on a single bad VEVENT -- only a SUMMARY+DTSTART-less one
// is dropped (and counted in `skipped`), matching
// calendarEventRepo.create()'s own required fields.
function parseIcs(icsText) {
  const lines = unfoldLines(icsText);
  const items = [];
  let skipped = 0;
  let current = null;

  for (const rawLine of lines) {
    if (rawLine === 'BEGIN:VEVENT') {
      current = {};
      continue;
    }

    if (rawLine === 'END:VEVENT') {
      if (current) {
        const start = parseDateField(current.dtstart);
        if (current.summary && start) {
          const end = current.dtend ? parseDateField(current.dtend) : null;
          items.push({
            title: unescapeIcsText(current.summary),
            notes: current.description ? unescapeIcsText(current.description) : '',
            start: start.iso,
            end: end ? end.iso : null,
            allDay: start.allDay,
          });
        } else {
          skipped += 1;
        }
      }
      current = null;
      continue;
    }

    if (!current) continue; // outside any VEVENT (VCALENDAR/VTIMEZONE headers, etc.) -- ignore

    const field = parseLine(rawLine);
    if (!field) continue;

    if (field.name === 'SUMMARY') current.summary = field.value;
    else if (field.name === 'DESCRIPTION') current.description = field.value;
    else if (field.name === 'DTSTART') current.dtstart = field;
    else if (field.name === 'DTEND') current.dtend = field;
  }

  return { items, skipped };
}

module.exports = { parseIcs };
