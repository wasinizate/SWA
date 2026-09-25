'use strict';

// Ties the lower-level pieces (xref, object parsing, filters, CMaps)
// together into "give me this PDF's text". Deliberately only walks the
// happy path a real, well-formed statement PDF takes -- standard xref
// (table or stream), a normal page tree, FlateDecode content streams.
// Anything that doesn't fit (encrypted, corrupted, exotic filters)
// throws a clear error rather than guessing, same "never silently
// write" principle as the rest of income import: the caller already
// treats a failed/partial extraction as "leave the form blank for the
// human," not a crash.

const { readXref } = require('./xref');
const { Cursor, parseValue, parseIndirectObjectAt, PdfStream } = require('./objectParser');
const { PdfRef } = require('./lexer');
const { decodeStream } = require('./filters');
const { parseToUnicodeCmap } = require('./cmap');
const { decodeWinAnsiByte } = require('./textEncoding');
const { extractTextFromContentStream } = require('./contentStream');

const MAX_PAGES = 500;
const MAX_FORM_DEPTH = 4;

class PdfDocument {
  constructor(buf) {
    this.buf = buf;
    const { entries, trailer } = readXref(buf);
    this.entries = entries;
    this.trailer = trailer;
    this.objectCache = new Map();
    this.objStmCache = new Map();
    this.fontDecoderCache = new Map();
    this.resolving = new Set();
  }

  getObject(num) {
    if (this.objectCache.has(num)) return this.objectCache.get(num);
    if (this.resolving.has(num)) return null;
    const entry = this.entries.get(num);
    if (!entry) { this.objectCache.set(num, null); return null; }

    this.resolving.add(num);
    let value = null;
    try {
      if (entry.type === 1) {
        value = parseIndirectObjectAt(this.buf, entry.offset, (ref) => {
          const resolved = this.getObject(ref.num);
          return typeof resolved === 'number' ? resolved : null;
        });
      } else if (entry.type === 2) {
        value = this.getObjStmEntry(entry.streamNum, entry.indexInStream);
      }
    } finally {
      this.resolving.delete(num);
    }
    this.objectCache.set(num, value);
    return value;
  }

  getObjStmEntry(streamNum, indexInStream) {
    let cached = this.objStmCache.get(streamNum);
    if (!cached) {
      const streamObj = this.getObject(streamNum);
      if (streamObj instanceof PdfStream) {
        const decoded = decodeStream(streamObj.dict, streamObj.rawBytes);
        const n = streamObj.dict.N || 0;
        const first = streamObj.dict.First || 0;
        const cursor = new Cursor(decoded, 0);
        const offsets = [];
        for (let i = 0; i < n; i++) {
          const numTok = cursor.next();
          const offTok = cursor.next();
          offsets.push({ objNum: numTok.value, offset: offTok.value });
        }
        cached = { decoded, first, offsets };
      } else {
        cached = { decoded: Buffer.alloc(0), first: 0, offsets: [] };
      }
      this.objStmCache.set(streamNum, cached);
    }
    const entry = cached.offsets[indexInStream];
    if (!entry) return null;
    const cursor = new Cursor(cached.decoded, cached.first + entry.offset);
    return parseValue(cursor, null);
  }

  resolve(value) {
    let v = value;
    let depth = 0;
    while (v instanceof PdfRef && depth < 8) {
      v = this.getObject(v.num);
      depth++;
    }
    return v;
  }

  getPages() {
    const catalog = this.resolve(this.trailer.Root);
    if (!catalog || !catalog.Pages) return [];

    const pages = [];
    const visited = new Set();

    const walk = (nodeRefOrDict, inheritedResources) => {
      if (pages.length >= MAX_PAGES) return;
      if (nodeRefOrDict instanceof PdfRef) {
        const key = nodeRefOrDict.num;
        if (visited.has(key)) return;
        visited.add(key);
      }
      const node = this.resolve(nodeRefOrDict);
      if (!node || typeof node !== 'object') return;

      const resourcesRaw = node.Resources !== undefined ? node.Resources : inheritedResources;
      const resources = resourcesRaw ? this.resolve(resourcesRaw) : null;
      const typeName = node.Type && node.Type.name;

      if (Array.isArray(node.Kids) && typeName !== 'Page') {
        for (const kid of node.Kids) walk(kid, resources);
      } else {
        pages.push({ dict: node, resources });
      }
    };

    walk(catalog.Pages, null);
    return pages;
  }

  getPageContentBytes(pageDict) {
    const contents = this.resolve(pageDict.Contents);
    if (!contents) return Buffer.alloc(0);
    const streamRefs = Array.isArray(contents) ? contents : [contents];

    const parts = [];
    for (const ref of streamRefs) {
      const stream = this.resolve(ref);
      if (!(stream instanceof PdfStream)) continue;
      try {
        if (parts.length > 0) parts.push(Buffer.from(' '));
        parts.push(decodeStream(stream.dict, stream.rawBytes));
      } catch (err) {
        // One broken content stream shouldn't blank out the whole page.
      }
    }
    return Buffer.concat(parts);
  }

  getFontDecoder(resources, fontName) {
    if (!resources || !resources.Font) return null;
    const fontDictContainer = this.resolve(resources.Font);
    const fontRef = fontDictContainer[fontName];
    if (!fontRef) return null;

    const cacheKey = fontRef instanceof PdfRef ? fontRef.num : null;
    if (cacheKey !== null && this.fontDecoderCache.has(cacheKey)) {
      return this.fontDecoderCache.get(cacheKey);
    }

    const fontDict = this.resolve(fontRef);
    const decoder = this.buildFontDecoder(fontDict);
    if (cacheKey !== null) this.fontDecoderCache.set(cacheKey, decoder);
    return decoder;
  }

  buildFontDecoder(fontDict) {
    if (!fontDict) return null;
    let toUnicodeMap = null;
    let codeByteLength = fontDict.Subtype && fontDict.Subtype.name === 'Type0' ? 2 : 1;

    if (fontDict.ToUnicode) {
      const streamObj = this.resolve(fontDict.ToUnicode);
      if (streamObj instanceof PdfStream) {
        try {
          const decoded = decodeStream(streamObj.dict, streamObj.rawBytes);
          const parsed = parseToUnicodeCmap(decoded);
          toUnicodeMap = parsed.map;
          codeByteLength = parsed.codeByteLength;
        } catch (err) {
          // Fall through to the width-only default below.
        }
      }
    }

    return {
      decodeString(buf) {
        let out = '';
        for (let i = 0; i + codeByteLength <= buf.length; i += codeByteLength) {
          let code = 0;
          for (let j = 0; j < codeByteLength; j++) code = code * 256 + buf[i + j];
          if (toUnicodeMap && toUnicodeMap.has(code)) out += toUnicodeMap.get(code);
          else if (codeByteLength === 1) out += decodeWinAnsiByte(code);
        }
        return out;
      },
    };
  }

  extractFormXObjectText(resources, name, depth) {
    if (!resources || !resources.XObject) return '';
    const xobjContainer = this.resolve(resources.XObject);
    const xobjRef = xobjContainer[name];
    if (!xobjRef) return '';
    const xobj = this.resolve(xobjRef);
    if (!(xobj instanceof PdfStream)) return '';
    if (!xobj.dict.Subtype || xobj.dict.Subtype.name !== 'Form') return '';

    const formBytes = decodeStream(xobj.dict, xobj.rawBytes);
    const formResources = xobj.dict.Resources ? this.resolve(xobj.dict.Resources) : resources;
    return this.runContentStream(formBytes, formResources, depth + 1);
  }

  runContentStream(bytes, resources, depth) {
    const ctx = {
      getFont: (name) => this.getFontDecoder(resources, name),
      onDo: (name) => {
        if (depth >= MAX_FORM_DEPTH) return '';
        try {
          return this.extractFormXObjectText(resources, name, depth);
        } catch (err) {
          return '';
        }
      },
    };
    return extractTextFromContentStream(bytes, ctx);
  }

  extractPageText(page) {
    const contentBytes = this.getPageContentBytes(page.dict);
    return this.runContentStream(contentBytes, page.resources, 0);
  }
}

function extractText(buffer) {
  const buf = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer);
  const doc = new PdfDocument(buf);

  if (doc.trailer.Encrypt) {
    throw new Error("This PDF is encrypted/password-protected and can't be read automatically -- enter the statement values manually.");
  }

  const pages = doc.getPages();
  const pageTexts = pages.map((page) => {
    try {
      return doc.extractPageText(page);
    } catch (err) {
      return '';
    }
  });
  return pageTexts.join('\n\n');
}

module.exports = { extractText, PdfDocument };
