'use strict';

// Fallback single-byte code -> Unicode table for simple (non-embedded,
// no /ToUnicode) fonts -- the base-14 fonts like Helvetica/Arial that
// some simpler PDF generators reference directly instead of embedding.
// Codes 0x20-0x7E are plain ASCII. Only WinAnsiEncoding's most common
// high-byte punctuation is mapped beyond that; a statement PDF has no
// real use for the rest of the table (accented letters, ligatures,
// etc.), and an unmapped code just falls back to '?' rather than
// silently emitting the wrong character.
const WIN_ANSI_HIGH = {
  0x80: '€', 0x82: '‚', 0x83: 'ƒ', 0x84: '„',
  0x85: '…', 0x86: '†', 0x87: '‡', 0x88: 'ˆ',
  0x89: '‰', 0x8a: 'Š', 0x8b: '‹', 0x8c: 'Œ',
  0x8e: 'Ž', 0x91: '‘', 0x92: '’', 0x93: '“',
  0x94: '”', 0x95: '•', 0x96: '–', 0x97: '—',
  0x98: '˜', 0x99: '™', 0x9a: 'š', 0x9b: '›',
  0x9c: 'œ', 0x9e: 'ž', 0x9f: 'Ÿ', 0xa0: ' ',
  0xa9: '©', 0xae: '®', 0xb0: '°',
};

function decodeWinAnsiByte(code) {
  if (code >= 0x20 && code <= 0x7e) return String.fromCharCode(code);
  if (code >= 0xa0 && code <= 0xff) return String.fromCharCode(code); // Latin-1 supplement match
  return WIN_ANSI_HIGH[code] || '';
}

module.exports = { decodeWinAnsiByte };
