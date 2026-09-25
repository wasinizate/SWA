'use strict';

// Minimal, dependency-free CSV parser (RFC 4180-ish: quoted fields,
// "" as an escaped quote inside a quoted field, commas/newlines inside
// quoted fields) -- hand-rolled rather than pulling in a CSV library
// for something this contained, keeping with this project's "small,
// deliberately short dependency list" (see README). Only real-world
// concession beyond strict RFC 4180: blank rows are silently dropped
// rather than becoming an all-empty-string row, since a trailing
// newline (or several) at the end of a real export is far more common
// than a genuinely blank data row meaning something.
//
// Returns { headers, rows } -- headers is the first row, rows is every
// row after it, each a plain string array. This never throws on
// malformed input; the state machine below has no branch that isn't
// reachable from ordinary characters, so a weird real-world export just
// parses into weird-looking cells instead of crashing the import --
// same "forgiving, not fatal" posture as this app's other external-file
// parsers (e.g. icsImport.js).
function parseCsvText(text) {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;

  // Normalizes line endings up front so \r\n / \r / \n all behave the
  // same in the state machine below, rather than handling all three
  // as separate cases at every newline check.
  const normalized = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');

  for (let i = 0; i < normalized.length; i++) {
    const char = normalized[i];

    if (inQuotes) {
      if (char === '"') {
        if (normalized[i + 1] === '"') {
          field += '"';
          i++; // consume both quote characters of the escaped pair
        } else {
          inQuotes = false;
        }
      } else {
        field += char;
      }
      continue;
    }

    if (char === '"') {
      inQuotes = true;
    } else if (char === ',') {
      row.push(field);
      field = '';
    } else if (char === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else {
      field += char;
    }
  }
  // Final field/row -- real-world exports don't always end with a
  // trailing newline, so whatever's left in `field`/`row` at EOF still
  // needs to be flushed the same way a `\n` mid-file would have.
  if (field !== '' || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  const nonBlankRows = rows.filter((r) => r.some((cell) => cell.trim() !== ''));
  const [headers, ...dataRows] = nonBlankRows;
  return { headers: headers || [], rows: dataRows };
}

module.exports = { parseCsvText };
