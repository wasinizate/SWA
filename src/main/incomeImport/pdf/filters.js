'use strict';

// Stream-data decoding. Only FlateDecode is implemented -- the only
// filter any modern PDF generator (Chromium/Skia printToPDF, wkhtmltopdf,
// PDFKit, etc.) uses for content streams and xref streams. A statement
// PDF using anything else (LZW, CCITT, DCT/JPEG image data we don't care
// about anyway) is outside this app's real-world target and throws
// rather than guessing.
const zlib = require('zlib');

function flateDecode(bytes) {
  try {
    return zlib.inflateSync(Buffer.from(bytes));
  } catch (err) {
    // Some encoders omit the zlib header and write raw deflate data.
    return zlib.inflateRawSync(Buffer.from(bytes));
  }
}

// PNG-style predictors (Predictor >= 10), the only kind any encoder in
// practice pairs with FlateDecode for xref streams. Predictor 2 (TIFF)
// is not implemented -- not used for xref streams in the wild.
function undoPngPredictor(bytes, columns, colors, bitsPerComponent) {
  const bytesPerPixel = Math.max(1, Math.ceil((colors * bitsPerComponent) / 8));
  const rowBytes = Math.ceil((columns * colors * bitsPerComponent) / 8);
  const rowCount = Math.floor(bytes.length / (rowBytes + 1));
  const out = Buffer.alloc(rowCount * rowBytes);
  let prevRow = Buffer.alloc(rowBytes);

  for (let row = 0; row < rowCount; row++) {
    const srcStart = row * (rowBytes + 1);
    const filterType = bytes[srcStart];
    const src = bytes.subarray(srcStart + 1, srcStart + 1 + rowBytes);
    const dst = out.subarray(row * rowBytes, (row + 1) * rowBytes);

    for (let i = 0; i < rowBytes; i++) {
      const a = i >= bytesPerPixel ? dst[i - bytesPerPixel] : 0;
      const b = prevRow[i];
      const c = i >= bytesPerPixel ? prevRow[i - bytesPerPixel] : 0;
      let value = src[i];
      switch (filterType) {
        case 0: break; // None
        case 1: value = (value + a) & 0xff; break; // Sub
        case 2: value = (value + b) & 0xff; break; // Up
        case 3: value = (value + Math.floor((a + b) / 2)) & 0xff; break; // Average
        case 4: { // Paeth
          const p = a + b - c;
          const pa = Math.abs(p - a);
          const pb = Math.abs(p - b);
          const pc = Math.abs(p - c);
          const predictor = pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
          value = (value + predictor) & 0xff;
          break;
        }
        default: throw new Error(`Unsupported PNG predictor filter type ${filterType}`);
      }
      dst[i] = value;
    }
    prevRow = dst;
  }
  return out;
}

// dict is the stream's own PDF dictionary (already resolved, no refs).
function decodeStream(dict, rawBytes) {
  const filterValue = dict.Filter;
  if (!filterValue) return Buffer.from(rawBytes);

  const filters = Array.isArray(filterValue) ? filterValue : [filterValue];
  const paramsValue = dict.DecodeParms || dict.DP;
  const paramsList = Array.isArray(paramsValue) ? paramsValue : [paramsValue];

  let out = Buffer.from(rawBytes);
  filters.forEach((filter, i) => {
    const name = filter && filter.name;
    if (name !== 'FlateDecode' && name !== 'Fl') {
      throw new Error(`Unsupported stream filter: ${name || filter}`);
    }
    out = flateDecode(out);
    const params = paramsList[i];
    if (params && params.Predictor && params.Predictor > 1) {
      const columns = params.Columns || 1;
      const colors = params.Colors || 1;
      const bpc = params.BitsPerComponent || 8;
      if (params.Predictor >= 10) {
        out = undoPngPredictor(out, columns, colors, bpc);
      } else {
        throw new Error(`Unsupported predictor: ${params.Predictor}`);
      }
    }
  });
  return out;
}

module.exports = { decodeStream, flateDecode };
