'use strict';

// Interprets a decoded page content stream (ISO 32000-1 §9.4) just far
// enough to recover displayed text in reading order: tracks the current
// font (`Tf`) so each shown string can be decoded through the right
// font's character-code mapping, and turns text-positioning operators
// into newlines/spaces so words and lines don't run together. Every
// other operator (paths, color, graphics state, clipping...) is parsed
// only enough to discard its operands -- none of it affects what text
// says, only how it would look rendered, which this app never renders.

const { Cursor, parseValue } = require('./objectParser');
const { isWhitespace } = require('./lexer');

// A run of large negative spacing inside a TJ array is how generators
// encode an inter-word gap (vs. the small kerning adjustments used
// within a word) -- -150/1000 em is a common real-world threshold.
const TJ_GAP_THRESHOLD = -150;

// A real new line moves the text position down by roughly a font's line
// height (several units); a pure horizontal Td/TD, or one with only a
// hairline vertical jitter, is generators (Chromium's print-to-PDF
// included) repositioning *within* the same line for kerning precision
// -- inserting anything there splits words/numbers that have no real
// gap. Real word gaps come through as an actual space character in the
// decoded text already, not from this positioning operator.
const NEWLINE_TY_THRESHOLD = -1;

function skipInlineImageData(buf, cursor) {
  let pos = cursor.pos;
  if (isWhitespace(buf[pos])) pos++;
  while (pos < buf.length - 1) {
    if (buf[pos] === 0x45 && buf[pos + 1] === 0x49 && (pos === 0 || isWhitespace(buf[pos - 1]))) {
      cursor.pos = pos + 2;
      return;
    }
    pos++;
  }
  cursor.pos = buf.length;
}

// ctx.getFont(resourceName) -> { decodeString(buf) -> string } | null
// ctx.onDo(resourceName) -> string (extracted text of a Form XObject, or '')
function extractTextFromContentStream(bytes, ctx) {
  const cursor = new Cursor(bytes, 0);
  let out = '';
  let operands = [];
  let currentFont = null;

  const decode = (buf) => {
    if (!Buffer.isBuffer(buf)) return '';
    if (currentFont) return currentFont.decodeString(buf);
    return buf.toString('latin1').replace(/[^\x20-\x7e]/g, '');
  };

  for (;;) {
    const peeked = cursor.peek();
    if (peeked.type === 'eof') break;

    if (peeked.type !== 'keyword') {
      operands.push(parseValue(cursor, null));
      continue;
    }

    cursor.next();
    const op = peeked.value;

    switch (op) {
      case 'BT':
        operands = [];
        break;
      case 'ET':
        out += '\n';
        operands = [];
        break;
      case 'Tf': {
        const fontName = operands[operands.length - 2];
        if (fontName && fontName.name) currentFont = ctx.getFont(fontName.name);
        operands = [];
        break;
      }
      case 'Td':
      case 'TD': {
        const ty = operands[operands.length - 1];
        if (typeof ty === 'number' && ty < NEWLINE_TY_THRESHOLD) out += '\n';
        operands = [];
        break;
      }
      case 'T*':
      case 'Tm':
        out += '\n';
        operands = [];
        break;
      case "'":
      case '"':
        out += '\n';
        out += decode(operands[operands.length - 1]);
        operands = [];
        break;
      case 'Tj':
        out += decode(operands[operands.length - 1]);
        operands = [];
        break;
      case 'TJ': {
        const arr = operands[operands.length - 1];
        if (Array.isArray(arr)) {
          for (const item of arr) {
            if (Buffer.isBuffer(item)) out += decode(item);
            else if (typeof item === 'number' && item <= TJ_GAP_THRESHOLD) out += ' ';
          }
        }
        operands = [];
        break;
      }
      case 'Do': {
        const xobjName = operands[operands.length - 1];
        if (xobjName && xobjName.name && ctx.onDo) out += ctx.onDo(xobjName.name);
        operands = [];
        break;
      }
      case 'BI': {
        for (;;) {
          const t = cursor.peek();
          if (t.type === 'eof') break;
          if (t.type === 'keyword' && t.value === 'ID') { cursor.next(); break; }
          cursor.next();
        }
        skipInlineImageData(bytes, cursor);
        operands = [];
        break;
      }
      default:
        operands = [];
        break;
    }
  }

  return out;
}

module.exports = { extractTextFromContentStream };
