'use strict';

// Locates and parses a PDF's cross-reference information -- either the
// classic plain-text `xref` table (Chromium's own printToPDF, used
// elsewhere in this app for order-receipt export, writes exactly this)
// or a compressed cross-reference *stream* (PDF 1.5+, what some other
// generators write instead), including objects packed into compressed
// object streams (`/Type /ObjStm`) rather than having their own file
// offset. Follows `/Prev` chains for incrementally updated files and
// `/XRefStm` for hybrid-reference files.

const { nextToken, skipInert } = require('./lexer');
const { Cursor, parseValue, parseIndirectObjectAt } = require('./objectParser');
const { decodeStream } = require('./filters');

function findStartXrefOffset(buf) {
  const tailStart = Math.max(0, buf.length - 2048);
  const tail = buf.subarray(tailStart);
  const idx = tail.lastIndexOf('startxref');
  if (idx === -1) throw new Error('No startxref marker found -- not a well-formed PDF.');
  let pos = tailStart + idx + 'startxref'.length;
  const { token, end } = nextToken(buf, pos);
  if (token.type !== 'num') throw new Error('Malformed startxref offset.');
  pos = end;
  return token.value;
}

function readBigEndianUint(buf, offset, width) {
  let value = 0;
  for (let i = 0; i < width; i++) value = value * 256 + buf[offset + i];
  return value;
}

function parseClassicTable(buf, offset) {
  const cursor = new Cursor(buf, offset);
  cursor.next(); // 'xref' keyword

  const entries = new Map();
  for (;;) {
    const p = cursor.peek();
    if (p.type !== 'num') break; // reached 'trailer'
    const startTok = cursor.next();
    const countTok = cursor.next();
    const start = startTok.value;
    const count = countTok.value;
    for (let i = 0; i < count; i++) {
      const offsetTok = cursor.next();
      const genTok = cursor.next();
      const typeTok = cursor.next();
      const objNum = start + i;
      if (typeTok.value === 'n') {
        entries.set(objNum, { type: 1, offset: offsetTok.value, gen: genTok.value });
      } else {
        entries.set(objNum, { type: 0 });
      }
    }
  }

  const trailerKeyword = cursor.next(); // 'trailer'
  const trailer = trailerKeyword.type === 'keyword' && trailerKeyword.value === 'trailer'
    ? parseValue(cursor, null)
    : {};
  return { entries, trailer };
}

function parseXrefStream(buf, offset) {
  const obj = parseIndirectObjectAt(buf, offset, null);
  if (!obj || !obj.dict) throw new Error('Expected a cross-reference stream object.');

  const dict = obj.dict;
  const decoded = decodeStream(dict, obj.rawBytes);
  const widths = (dict.W || [1, 1, 1]).map((n) => n);
  const size = dict.Size || 0;
  const index = dict.Index || [0, size];

  const entries = new Map();
  let pos = 0;
  const rowWidth = widths[0] + widths[1] + widths[2];
  for (let i = 0; i < index.length; i += 2) {
    const start = index[i];
    const count = index[i + 1];
    for (let n = 0; n < count; n++) {
      const objNum = start + n;
      const type = widths[0] === 0 ? 1 : readBigEndianUint(decoded, pos, widths[0]);
      const field2 = readBigEndianUint(decoded, pos + widths[0], widths[1]);
      const field3 = readBigEndianUint(decoded, pos + widths[0] + widths[1], widths[2]);
      pos += rowWidth;
      if (type === 0) entries.set(objNum, { type: 0 });
      else if (type === 1) entries.set(objNum, { type: 1, offset: field2, gen: field3 });
      else if (type === 2) entries.set(objNum, { type: 2, streamNum: field2, indexInStream: field3 });
    }
  }
  return { entries, trailer: dict };
}

function looksLikeXrefStream(buf, offset) {
  const cursor = new Cursor(buf, offset);
  const t1 = cursor.next();
  if (t1.type !== 'num') return false;
  const t2 = cursor.next();
  if (t2.type !== 'num') return false;
  const t3 = cursor.next();
  return t3.type === 'keyword' && t3.value === 'obj';
}

function mergeEntries(target, source) {
  for (const [num, entry] of source) {
    if (!target.has(num)) target.set(num, entry);
  }
}

function mergeTrailer(target, source) {
  for (const key of Object.keys(source)) {
    if (!(key in target)) target[key] = source[key];
  }
}

// Returns { entries: Map<objNum, entry>, trailer: dict }.
function readXref(buf) {
  const startOffset = findStartXrefOffset(buf);
  const entries = new Map();
  const trailer = {};
  const visited = new Set();

  let nextOffset = startOffset;
  while (typeof nextOffset === 'number' && !visited.has(nextOffset)) {
    visited.add(nextOffset);
    const pos = skipInert(buf, nextOffset);
    const isStream = looksLikeXrefStream(buf, pos);
    const section = isStream ? parseXrefStream(buf, pos) : parseClassicTable(buf, pos);

    mergeEntries(entries, section.entries);
    mergeTrailer(trailer, section.trailer);

    if (!isStream && section.trailer.XRefStm && !visited.has(section.trailer.XRefStm)) {
      visited.add(section.trailer.XRefStm);
      const hybrid = parseXrefStream(buf, section.trailer.XRefStm);
      mergeEntries(entries, hybrid.entries);
    }
    nextOffset = section.trailer.Prev;
  }

  if (!trailer.Root) throw new Error('No document catalog (/Root) found in trailer.');
  return { entries, trailer };
}

module.exports = { readXref };
