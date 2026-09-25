'use strict';

// Byte-level PDF tokenizer (ISO 32000-1 §7.2). Deliberately operates on
// raw bytes throughout, never a decoded JS string -- a PDF file mixes
// ASCII syntax with arbitrary binary stream data, and converting the
// whole file to a string up front (even 'latin1') risks corrupting
// offsets used later to slice out that binary data verbatim.

const WHITESPACE = new Set([0x00, 0x09, 0x0a, 0x0c, 0x0d, 0x20]);
const DELIMITERS = new Set([0x28, 0x29, 0x3c, 0x3e, 0x5b, 0x5d, 0x7b, 0x7d, 0x2f, 0x25]);

function isWhitespace(b) { return WHITESPACE.has(b); }
function isDelimiter(b) { return DELIMITERS.has(b); }
function isRegular(b) { return b !== undefined && !isWhitespace(b) && !isDelimiter(b); }

class PdfName {
  constructor(name) { this.name = name; }
}
class PdfRef {
  constructor(num, gen) { this.num = num; this.gen = gen; }
}

// Skips whitespace and `%...` comments (which run to end-of-line).
function skipInert(buf, pos) {
  while (pos < buf.length) {
    const b = buf[pos];
    if (isWhitespace(b)) { pos++; continue; }
    if (b === 0x25) { // '%'
      while (pos < buf.length && buf[pos] !== 0x0a && buf[pos] !== 0x0d) pos++;
      continue;
    }
    break;
  }
  return pos;
}

function readName(buf, pos) {
  let end = pos + 1; // skip leading '/'
  let out = '';
  let runStart = end; // start of the current run of plain (non-escaped) bytes
  while (isRegular(buf[end])) {
    if (buf[end] === 0x23 && end + 2 < buf.length) { // '#' hex escape
      const hex = String.fromCharCode(buf[end + 1], buf[end + 2]);
      const code = parseInt(hex, 16);
      if (!Number.isNaN(code)) {
        if (end > runStart) out += buf.toString('latin1', runStart, end);
        out += String.fromCharCode(code);
        end += 3;
        runStart = end;
        continue;
      }
    }
    end++;
  }
  if (end > runStart) out += buf.toString('latin1', runStart, end);
  return { token: { type: 'name', value: new PdfName(out) }, end };
}

function readNumberOrKeyword(buf, pos) {
  let end = pos;
  let sawDigitOrDot = false;
  if (buf[end] === 0x2b || buf[end] === 0x2d) end++; // + or -
  const start = end;
  while (end < buf.length) {
    const b = buf[end];
    if ((b >= 0x30 && b <= 0x39) || b === 0x2e) { sawDigitOrDot = true; end++; continue; }
    break;
  }
  if (sawDigitOrDot && end > pos) {
    const value = parseFloat(buf.toString('latin1', pos, end));
    if (!Number.isNaN(value)) return { token: { type: 'num', value }, end };
  }
  return readKeyword(buf, pos);
}

function readKeyword(buf, pos) {
  let end = pos;
  while (isRegular(buf[end])) end++;
  if (end === pos) end = pos + 1; // stray delimiter byte, avoid an infinite loop
  return { token: { type: 'keyword', value: buf.toString('latin1', pos, end) }, end };
}

function readLiteralString(buf, pos) {
  let end = pos + 1; // skip '('
  let depth = 1;
  const bytes = [];
  while (end < buf.length && depth > 0) {
    const b = buf[end];
    if (b === 0x5c) { // backslash escape
      const next = buf[end + 1];
      switch (next) {
        case 0x6e: bytes.push(0x0a); end += 2; break; // \n
        case 0x72: bytes.push(0x0d); end += 2; break; // \r
        case 0x74: bytes.push(0x09); end += 2; break; // \t
        case 0x62: bytes.push(0x08); end += 2; break; // \b
        case 0x66: bytes.push(0x0c); end += 2; break; // \f
        case 0x28: bytes.push(0x28); end += 2; break;
        case 0x29: bytes.push(0x29); end += 2; break;
        case 0x5c: bytes.push(0x5c); end += 2; break;
        case 0x0d: end += (buf[end + 2] === 0x0a) ? 3 : 2; break; // line continuation
        case 0x0a: end += 2; break;
        default:
          if (next >= 0x30 && next <= 0x37) { // up to 3 octal digits
            let oct = '';
            let p = end + 1;
            while (oct.length < 3 && buf[p] >= 0x30 && buf[p] <= 0x37) { oct += String.fromCharCode(buf[p]); p++; }
            bytes.push(parseInt(oct, 8) & 0xff);
            end = p;
          } else {
            bytes.push(next);
            end += 2;
          }
      }
      continue;
    }
    if (b === 0x28) { depth++; bytes.push(b); end++; continue; }
    if (b === 0x29) { depth--; end++; if (depth === 0) break; bytes.push(b); continue; }
    bytes.push(b);
    end++;
  }
  return { token: { type: 'string', value: Buffer.from(bytes) }, end };
}

function readHexStringOrDictStart(buf, pos) {
  if (buf[pos + 1] === 0x3c) return { token: { type: 'dictStart' }, end: pos + 2 };
  let end = pos + 1;
  let hex = '';
  while (end < buf.length && buf[end] !== 0x3e) {
    const b = buf[end];
    if (!isWhitespace(b)) hex += String.fromCharCode(b);
    end++;
  }
  if (hex.length % 2 === 1) hex += '0';
  const bytes = Buffer.from(hex, 'hex');
  return { token: { type: 'string', value: bytes }, end: end + 1 };
}

// Returns { type, value, end } for the next token starting at `pos`
// (after skipping whitespace/comments), or { type: 'eof' } at EOF.
function nextToken(buf, pos) {
  pos = skipInert(buf, pos);
  if (pos >= buf.length) return { token: { type: 'eof' }, end: pos };

  const b = buf[pos];
  if (b === 0x2f) return { ...readName(buf, pos) };
  if (b === 0x28) return { ...readLiteralString(buf, pos) };
  if (b === 0x3c) return { ...readHexStringOrDictStart(buf, pos) };
  if (b === 0x3e && buf[pos + 1] === 0x3e) return { token: { type: 'dictEnd' }, end: pos + 2 };
  if (b === 0x5b) return { token: { type: 'arrayStart' }, end: pos + 1 };
  if (b === 0x5d) return { token: { type: 'arrayEnd' }, end: pos + 1 };
  if ((b >= 0x30 && b <= 0x39) || b === 0x2b || b === 0x2d || b === 0x2e) {
    return { ...readNumberOrKeyword(buf, pos) };
  }
  if (isRegular(b)) return { ...readKeyword(buf, pos) };
  // Unrecognized delimiter byte ({ } etc.) -- skip it as its own token.
  return { token: { type: 'keyword', value: String.fromCharCode(b) }, end: pos + 1 };
}

module.exports = { nextToken, skipInert, isWhitespace, PdfName, PdfRef };
