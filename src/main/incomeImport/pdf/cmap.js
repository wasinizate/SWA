'use strict';

// Parses a font's embedded `/ToUnicode` CMap stream (ISO 32000-1 §9.10.3)
// -- the mapping every modern PDF generator embeds for subset/embedded
// fonts (Chromium print-to-PDF included) specifically so text can be
// recovered from the arbitrary internal glyph codes it actually writes
// into content streams. Without this, extracted "text" for such fonts
// would just be meaningless byte values. Only `bfchar`/`bfrange`
// sections are needed -- the CMap format also supports `cidchar`/
// `cidrange` (glyph->CID, not ->Unicode) and custom PostScript
// procedures, neither relevant to recovering displayed text.

const { Cursor, parseValue } = require('./objectParser');

function bytesToCodeNumber(buf) {
  let n = 0;
  for (const b of buf) n = n * 256 + b;
  return n;
}

function incrementBytes(buf, offset) {
  const out = Buffer.from(buf);
  let carry = offset;
  for (let i = out.length - 1; i >= 0 && carry > 0; i--) {
    const sum = out[i] + (carry % 256);
    out[i] = sum & 0xff;
    carry = Math.floor(carry / 256) + (sum > 255 ? 1 : 0);
  }
  return out;
}

function hexBytesToUtf16String(buf) {
  let out = '';
  for (let i = 0; i + 1 < buf.length; i += 2) {
    out += String.fromCharCode((buf[i] << 8) | buf[i + 1]);
  }
  return out;
}

function decodeDst(value) {
  return Buffer.isBuffer(value) ? hexBytesToUtf16String(value) : '';
}

function skipUntilKeyword(cursor, keyword) {
  for (;;) {
    const p = cursor.peek();
    if (p.type === 'eof') return;
    if (p.type === 'keyword' && p.value === keyword) { cursor.next(); return; }
    cursor.next();
  }
}

// Returns { map: Map<codeNumber, string>, codeByteLength }. codeByteLength
// (from /codespacerange, typically 2 for embedded/subset fonts) tells the
// content-stream reader how many bytes make up one character code for
// this font.
function parseToUnicodeCmap(bytes) {
  const cursor = new Cursor(bytes, 0);
  const map = new Map();
  let codeByteLength = 2;

  for (;;) {
    const tok = cursor.peek();
    if (tok.type === 'eof') break;
    if (tok.type !== 'keyword') { cursor.next(); continue; }
    const kw = tok.value;
    cursor.next();

    if (kw === 'begincodespacerange') {
      const first = parseValue(cursor, null);
      if (Buffer.isBuffer(first) && first.length > 0) codeByteLength = first.length;
      skipUntilKeyword(cursor, 'endcodespacerange');
      continue;
    }

    if (kw === 'beginbfchar') {
      for (;;) {
        const p = cursor.peek();
        if (p.type === 'keyword' && p.value === 'endbfchar') { cursor.next(); break; }
        if (p.type === 'eof') break;
        const src = parseValue(cursor, null);
        const dst = parseValue(cursor, null);
        if (Buffer.isBuffer(src)) map.set(bytesToCodeNumber(src), decodeDst(dst));
      }
      continue;
    }

    if (kw === 'beginbfrange') {
      for (;;) {
        const p = cursor.peek();
        if (p.type === 'keyword' && p.value === 'endbfrange') { cursor.next(); break; }
        if (p.type === 'eof') break;
        const loBuf = parseValue(cursor, null);
        const hiBuf = parseValue(cursor, null);
        const dst = parseValue(cursor, null);
        if (!Buffer.isBuffer(loBuf) || !Buffer.isBuffer(hiBuf)) continue;
        const lo = bytesToCodeNumber(loBuf);
        const hi = bytesToCodeNumber(hiBuf);
        if (Array.isArray(dst)) {
          for (let code = lo; code <= hi; code++) {
            const item = dst[code - lo];
            if (Buffer.isBuffer(item)) map.set(code, decodeDst(item));
          }
        } else if (Buffer.isBuffer(dst)) {
          for (let code = lo; code <= hi; code++) {
            map.set(code, decodeDst(incrementBytes(dst, code - lo)));
          }
        }
      }
    }
  }

  return { map, codeByteLength };
}

module.exports = { parseToUnicodeCmap };
