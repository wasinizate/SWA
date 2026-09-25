'use strict';

// Parses PDF "objects" (ISO 32000-1 §7.3) -- dictionaries, arrays,
// numbers, names, strings, indirect references, and streams -- out of
// raw bytes using lexer.js's tokenizer. This is the shared grammar used
// both for top-level `N G obj ... endobj` objects (found via the xref
// table) and for the bodies of decompressed object streams.

const { nextToken, skipInert, PdfRef } = require('./lexer');

class PdfStream {
  constructor(dict, rawBytes) {
    this.dict = dict;
    this.rawBytes = rawBytes;
  }
}

class Cursor {
  constructor(buf, pos) { this.buf = buf; this.pos = pos; }
  peek() { return nextToken(this.buf, this.pos).token; }
  next() {
    const { token, end } = nextToken(this.buf, this.pos);
    this.pos = end;
    return token;
  }
}

function findEndstream(buf, from) {
  const needle = Buffer.from('endstream');
  const idx = buf.indexOf(needle, from);
  const dataEnd = idx === -1 ? buf.length : idx;
  // Trim the single EOL that's supposed to precede "endstream".
  let trimmed = dataEnd;
  if (trimmed > from && buf[trimmed - 1] === 0x0a) trimmed--;
  if (trimmed > from && buf[trimmed - 1] === 0x0d) trimmed--;
  return trimmed;
}

// `resolveLength(ref)` resolves an indirect /Length value to a number;
// only needed for the rare stream whose Length is itself an indirect
// reference. Pass null when that isn't available yet (bootstrap parses
// of xref streams) -- falls back to scanning for the "endstream" marker.
function parseValue(cursor, resolveLength) {
  const tok = cursor.next();

  if (tok.type === 'num') {
    const savedAfterFirst = cursor.pos;
    const t2 = cursor.next();
    if (t2.type === 'num') {
      const savedAfterSecond = cursor.pos;
      const t3 = cursor.next();
      if (t3.type === 'keyword' && t3.value === 'R') {
        return new PdfRef(tok.value, t2.value);
      }
      cursor.pos = savedAfterSecond;
    }
    cursor.pos = savedAfterFirst;
    return tok.value;
  }

  if (tok.type === 'name') return tok.value;
  if (tok.type === 'string') return tok.value;

  if (tok.type === 'arrayStart') {
    const arr = [];
    for (;;) {
      const p = cursor.peek();
      if (p.type === 'arrayEnd') { cursor.next(); break; }
      if (p.type === 'eof') break;
      arr.push(parseValue(cursor, resolveLength));
    }
    return arr;
  }

  if (tok.type === 'dictStart') {
    const dict = {};
    for (;;) {
      const p = cursor.peek();
      if (p.type === 'dictEnd') { cursor.next(); break; }
      if (p.type === 'eof') break;
      const keyTok = cursor.next();
      if (keyTok.type !== 'name') continue; // malformed entry, skip forward
      dict[keyTok.value.name] = parseValue(cursor, resolveLength);
    }

    const afterDict = cursor.pos;
    const maybeStream = cursor.peek();
    if (maybeStream.type === 'keyword' && maybeStream.value === 'stream') {
      cursor.next();
      let dataStart = cursor.pos;
      if (cursor.buf[dataStart] === 0x0d && cursor.buf[dataStart + 1] === 0x0a) dataStart += 2;
      else if (cursor.buf[dataStart] === 0x0a || cursor.buf[dataStart] === 0x0d) dataStart += 1;

      let length = dict.Length;
      if (length instanceof PdfRef) length = resolveLength ? resolveLength(length) : null;

      let dataEnd = null;
      if (typeof length === 'number' && Number.isFinite(length) && length >= 0) {
        const candidateEnd = dataStart + length;
        let checkPos = skipInert(cursor.buf, candidateEnd);
        const tail = cursor.buf.subarray(checkPos, checkPos + 9).toString('latin1');
        if (tail === 'endstream') dataEnd = candidateEnd;
      }
      if (dataEnd === null) dataEnd = findEndstream(cursor.buf, dataStart);

      const rawBytes = cursor.buf.subarray(dataStart, dataEnd);
      const afterData = skipInert(cursor.buf, dataEnd);
      const endTok = nextToken(cursor.buf, afterData);
      cursor.pos = (endTok.token.type === 'keyword' && endTok.token.value === 'endstream')
        ? endTok.end
        : dataEnd;
      return new PdfStream(dict, rawBytes);
    }
    cursor.pos = afterDict;
    return dict;
  }

  if (tok.type === 'keyword') {
    if (tok.value === 'true') return true;
    if (tok.value === 'false') return false;
    if (tok.value === 'null') return null;
    return tok.value; // bare keyword, meaningful only to content-stream interpreter
  }

  return null; // eof or unrecognized
}

// Parses `N G obj <value> [stream...endstream] endobj` starting at
// `offset`. Tolerant of a missing/odd `endobj` -- best-effort, since a
// single malformed object shouldn't abort extraction of the rest of a
// real-world statement PDF.
function parseIndirectObjectAt(buf, offset, resolveLength) {
  const cursor = new Cursor(buf, offset);
  cursor.next(); // object number
  cursor.next(); // generation number
  cursor.next(); // 'obj' keyword
  return parseValue(cursor, resolveLength);
}

module.exports = { parseValue, parseIndirectObjectAt, Cursor, PdfStream };
