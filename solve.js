// csv-reader 1.0.0 drop-in fast engine (pure JS, Node 22).
// Exports:
//   - run(input): exact drop-in for vendor/csv-reader/index.js `readCsv` on `{ text, header }`
//   - runCasesBuffer(casesBuf): single-pass UTF-8 JSON-to-JSON byte engine with per-case fallback to `run`
// Pure: no clock, no randomness, no locale, nothing kept from one call to the next.

const ENDED_COMMA = 1;
const ENDED_LINE_BREAK = 2;
const ENDED_END = 3;

/** Exact drop-in for csv-reader 1.0.0's readCsv(input). */
export function run(input) {
  const text = String(input.text);
  const header = input.header === true;
  const errors = [];
  const rows = [];
  let columns = null;
  let width = -1;
  const len = text.length;
  let pos = 0;
  let line = 1;
  if (text.charCodeAt(0) === 0xfeff) pos = 1;

  let recordLine = 1;
  let recordRow = null;

  let fv = '';
  let fe = ENDED_END;
  let fadded = 0;

  let nextQ = -2;
  let nextR = -2;

  function readUnquoted() {
    const start = pos;
    while (pos < len) {
      const c = text.charCodeAt(pos);
      if (c === 44) {
        fv = text.slice(start, pos);
        fe = ENDED_COMMA;
        pos += 1;
        return;
      }
      if (c === 10) {
        fv = text.slice(start, pos);
        fe = ENDED_LINE_BREAK;
        pos += 1;
        line += 1;
        return;
      }
      if (c === 13) {
        fv = text.slice(start, pos);
        if (text.charCodeAt(pos + 1) === 10) {
          fe = ENDED_LINE_BREAK;
          pos += 2;
          line += 1;
          return;
        }
        errors.push({ code: 'stray_cr', line: recordLine, row: recordRow });
        pos += 1;
        readUnquotedContinue();
        return;
      }
      pos += 1;
    }
    fv = text.slice(start, pos);
    fe = ENDED_END;
  }

  function readUnquotedContinue() {
    let added = 0;
    let start = pos;
    while (pos < len) {
      const c = text.charCodeAt(pos);
      if (c === 44) {
        if (pos > start) { fv += text.slice(start, pos); added += pos - start; }
        fe = ENDED_COMMA;
        pos += 1;
        fadded = added;
        return;
      }
      if (c === 10) {
        if (pos > start) { fv += text.slice(start, pos); added += pos - start; }
        fe = ENDED_LINE_BREAK;
        pos += 1;
        line += 1;
        fadded = added;
        return;
      }
      if (c === 13) {
        if (pos > start) { fv += text.slice(start, pos); added += pos - start; }
        if (text.charCodeAt(pos + 1) === 10) {
          fe = ENDED_LINE_BREAK;
          pos += 2;
          line += 1;
          fadded = added;
          return;
        }
        errors.push({ code: 'stray_cr', line: recordLine, row: recordRow });
        pos += 1;
        start = pos;
        continue;
      }
      pos += 1;
    }
    if (pos > start) { fv += text.slice(start, pos); added += pos - start; }
    fe = ENDED_END;
    fadded = added;
  }

  function readQuoted() {
    const open = pos;
    const openLine = line;
    let value = '';
    pos += 1;
    let closed = false;
    let start = pos;
    while (pos < len) {
      const c = text.charCodeAt(pos);
      if (c === 34) {
        if (text.charCodeAt(pos + 1) === 34) {
          value += text.slice(start, pos) + '"';
          pos += 2;
          start = pos;
          continue;
        }
        value += text.slice(start, pos);
        pos += 1;
        closed = true;
        break;
      }
      if (c === 13) {
        value += text.slice(start, pos) + '\n';
        line += 1;
        pos += (text.charCodeAt(pos + 1) === 10) ? 2 : 1;
        start = pos;
        continue;
      }
      if (c === 10) line += 1;
      pos += 1;
    }
    if (!closed) {
      pos = open + 1;
      line = openLine;
      errors.push({ code: 'unterminated_quote', line: recordLine, row: recordRow });
      fv = '"';
      readUnquotedContinue();
      return;
    }
    if (pos >= len) { fv = value; fe = ENDED_END; return; }
    const c = text.charCodeAt(pos);
    if (c === 44) { fv = value; fe = ENDED_COMMA; pos += 1; return; }
    if (c === 10) { fv = value; fe = ENDED_LINE_BREAK; pos += 1; line += 1; return; }
    if (c === 13 && text.charCodeAt(pos + 1) === 10) { fv = value; fe = ENDED_LINE_BREAK; pos += 2; line += 1; return; }
    fv = value;
    readUnquotedContinue();
    if (fadded > 0) errors.push({ code: 'quote_junk', line: recordLine, row: recordRow });
  }

  while (true) {
    while (pos < len) {
      const c = text.charCodeAt(pos);
      if (c === 10) { pos += 1; line += 1; }
      else if (c === 13 && text.charCodeAt(pos + 1) === 10) { pos += 2; line += 1; }
      else break;
    }
    if (pos >= len) break;

    recordLine = line;
    recordRow = (header && columns === null) ? null : rows.length;

    let fields;
    const nl = text.indexOf('\n', pos);
    const hasNl = nl !== -1;
    const lineEnd = hasNl ? nl : len;
    const crlf = hasNl && text.charCodeAt(lineEnd - 1) === 13;
    const contentEnd = crlf ? lineEnd - 1 : lineEnd;
    if (nextQ !== -1 && nextQ < pos) nextQ = text.indexOf('"', pos);
    if (nextR !== -1 && nextR < pos) nextR = text.indexOf('\r', pos);
    if ((nextQ === -1 || nextQ >= contentEnd) && (nextR === -1 || nextR >= contentEnd)) {
      fields = text.slice(pos, contentEnd).split(',');
      pos = hasNl ? lineEnd + 1 : lineEnd;
      if (hasNl) line += 1;
    } else {
      fields = [];
      let quoted;
      do {
        quoted = text.charCodeAt(pos) === 34;
        if (quoted) readQuoted();
        else readUnquoted();
        fields.push(fv);
      } while (fe === ENDED_COMMA);
      if (fields.length === 1 && fields[0] === '' && !quoted) continue;
    }

    if (width < 0) width = fields.length;
    if (header && columns === null) {
      columns = fields;
      continue;
    }
    if (fields.length < width) {
      errors.push({ code: 'short_row', line: recordLine, row: recordRow, fields: fields.length });
      while (fields.length < width) fields.push('');
    } else if (fields.length > width) {
      errors.push({ code: 'long_row', line: recordLine, row: recordRow, extra: fields.splice(width) });
    }
    rows.push(fields);
  }
  return { columns: header ? (columns ?? []) : null, rows, errors };
}

// ============================================================================
// Split-row single-pass UTF-8 JSON-to-JSON byte engine
// ============================================================================

const B_PREFIX_HDR_TRUE = Buffer.from('{"columns":');
const B_ROWS_MID = Buffer.from(',"rows":[');
const B_PREFIX_HDR_FALSE = Buffer.from('{"columns":null,"rows":[');
const B_EMPTY_HDR_TRUE = Buffer.from('{"columns":[],"rows":[],"errors":[');
const B_ERR_MID = Buffer.from('],"errors":[');
const B_END_OBJ = Buffer.from(']}');

const ERR_PREFIXES = [
  Buffer.from('{"code":"stray_cr","line":'),
  Buffer.from('{"code":"unterminated_quote","line":'),
  Buffer.from('{"code":"quote_junk","line":'),
  Buffer.from('{"code":"short_row","line":'),
  Buffer.from('{"code":"long_row","line":'),
];
const ERR_ROW_KEY = Buffer.from(',"row":');
const ERR_NULL = Buffer.from('null');
const ERR_FIELDS_KEY = Buffer.from(',"fields":');
const ERR_EXTRA_KEY = Buffer.from(',"extra":[');

// Scalar module state used only inside one synchronous runCasesBuffer() call (reset per call/case).
// Use `var` so V8 skips module TDZ hole checks in hot parser loops.
var gOut = null;
var gExtraBuf = null;
var gP = 0;
var gOutPos = 0;
var gExtraBufPos = 0;
var gLine = 1;
var gWidth = -1;
var gRowCount = 0;
var gRow0End = -1;
var gRowEnded = false;
var gTextClosed = false;

const gErrCodes = [];
const gErrLines = [];
const gErrRows = [];
const gErrExtraA = [];
const gErrExtraB = [];

function ensureOut(need) {
  if (gOutPos + need <= gOut.length) return gOut;
  const nb = Buffer.allocUnsafe(Math.max(gOut.length * 2, gOutPos + need + 65536));
  const next = new Uint8Array(nb.buffer, nb.byteOffset, nb.byteLength);
  next.set(gOut.subarray(0, gOutPos));
  gOut = next;
  return next;
}

function growExtra(need) {
  const nb = Buffer.allocUnsafe(Math.max(gExtraBuf.length * 2, need + 4096));
  const next = new Uint8Array(nb.buffer, nb.byteOffset, nb.byteLength);
  next.set(gExtraBuf.subarray(0, gExtraBufPos));
  gExtraBuf = next;
  return next;
}

function writeAsciiInt(out, pos, n) {
  if (n === 0) { out[pos++] = 0x30; return pos; }
  let tmp = n;
  let digits = 0;
  while (tmp > 0) { digits++; tmp = (tmp / 10) | 0; }
  let idx = pos + digits - 1;
  while (n > 0) { out[idx--] = 0x30 + (n % 10); n = (n / 10) | 0; }
  return pos + digits;
}

function skipWs(buf, p, end) {
  while (p < end) {
    const b = buf[p];
    if (b === 0x20 || b === 0x09 || b === 0x0a || b === 0x0d) p++;
    else break;
  }
  return p;
}

function findJsonStringEnd(buf, p, end) {
  while (p < end) {
    const b = buf[p++];
    if (b === 0x22) return p - 1;
    if (b === 0x5c) p++;
  }
  return -1;
}

function skipJsonValue(buf, p, end) {
  p = skipWs(buf, p, end);
  if (p >= end) return -1;
  const b = buf[p];
  if (b === 0x22) {
    const q = findJsonStringEnd(buf, p + 1, end);
    return q === -1 ? -1 : q + 1;
  }
  if (b === 0x7b || b === 0x5b) {
    const open = b;
    const close = b === 0x7b ? 0x7d : 0x5d;
    let depth = 1;
    p++;
    while (p < end && depth > 0) {
      const c = buf[p++];
      if (c === 0x22) {
        const q = findJsonStringEnd(buf, p, end);
        if (q === -1) return -1;
        p = q + 1;
      } else if (c === open) {
        depth++;
      } else if (c === close) {
        depth--;
      }
    }
    return depth === 0 ? p : -1;
  }
  while (p < end) {
    const c = buf[p];
    if (c === 0x2c || c === 0x7d || c === 0x5d || c === 0x20 || c === 0x09 || c === 0x0a || c === 0x0d) break;
    p++;
  }
  return p;
}

function handleTail(buf, p, len, out, outPos, recordLine, recordRowIdx, isUnterm) {
  let added = 0;
  let line = gLine;
  let rowEnded = false;
  let textClosed = false;
  while (p < len) {
    const b = buf[p];
    if (b === 0x2c) { p++; break; }
    if (b === 0x22) { textClosed = true; rowEnded = true; break; }
    if (b === 0x5c) {
      if (p + 1 >= len) return -1;
      const nx = buf[p + 1];
      if (nx === 0x6e) { p += 2; line++; rowEnded = true; break; }
      if (nx === 0x72) {
        if (p + 3 < len && buf[p + 2] === 0x5c && buf[p + 3] === 0x6e) { p += 4; line++; rowEnded = true; break; }
        gErrCodes.push(0); gErrLines.push(recordLine); gErrRows.push(recordRowIdx); gErrExtraA.push(0); gErrExtraB.push(0);
        p += 2;
        continue;
      }
      if (nx === 0x75) return -1;
      if (nx === 0x2f) { out[outPos++] = 0x2f; added++; p += 2; continue; }
      out[outPos++] = 0x5c;
      out[outPos++] = nx;
      added++;
      p += 2;
      continue;
    }
    out[outPos++] = b;
    added++;
    p++;
  }
  if (p >= len) return -1;
  out[outPos++] = 0x22;
  if (!isUnterm && added > 0) {
    gErrCodes.push(2); gErrLines.push(recordLine); gErrRows.push(recordRowIdx); gErrExtraA.push(0); gErrExtraB.push(0);
  }
  gP = p;
  gOutPos = outPos;
  gLine = line;
  gRowEnded = rowEnded;
  gTextClosed = textClosed;
  return 0;
}

function parseQuotedField(buf, p, len, out, outPos, recordLine, recordRowIdx, fieldOutStart) {
  const openP = p;
  const openLine = gLine;
  let line = openLine;
  p += 2;
  let closed = false;
  while (p < len) {
    const b = buf[p];
    if (b === 0x5c) {
      if (p + 1 >= len) return -1;
      const nx = buf[p + 1];
      if (nx === 0x22) {
        if (p + 3 < len && buf[p + 2] === 0x5c && buf[p + 3] === 0x22) {
          out[outPos++] = 0x5c;
          out[outPos++] = 0x22;
          p += 4;
          continue;
        }
        p += 2;
        closed = true;
        break;
      }
      if (nx === 0x72) {
        out[outPos++] = 0x5c;
        out[outPos++] = 0x6e;
        line++;
        p += (p + 3 < len && buf[p + 2] === 0x5c && buf[p + 3] === 0x6e) ? 4 : 2;
        continue;
      }
      if (nx === 0x6e) {
        out[outPos++] = 0x5c;
        out[outPos++] = 0x6e;
        line++;
        p += 2;
        continue;
      }
      if (nx === 0x75) return -1;
      if (nx === 0x2f) { out[outPos++] = 0x2f; p += 2; continue; }
      out[outPos++] = 0x5c;
      out[outPos++] = nx;
      p += 2;
      continue;
    }
    if (b === 0x22) break;
    out[outPos++] = b;
    p++;
  }
  if (!closed) {
    p = openP + 2;
    line = openLine;
    outPos = fieldOutStart;
    gErrCodes.push(1); gErrLines.push(recordLine); gErrRows.push(recordRowIdx); gErrExtraA.push(0); gErrExtraB.push(0);
    out[outPos++] = 0x22;
    out[outPos++] = 0x5c;
    out[outPos++] = 0x22;
    gLine = line;
    return handleTail(buf, p, len, out, outPos, recordLine, recordRowIdx, true);
  }
  if (p >= len) return -1;
  const nb = buf[p];
  if (nb === 0x2c) { gP = p + 1; out[outPos++] = 0x22; gOutPos = outPos; gLine = line; gRowEnded = false; return 0; }
  if (nb === 0x22) { gP = p; out[outPos++] = 0x22; gOutPos = outPos; gLine = line; gRowEnded = true; gTextClosed = true; return 0; }
  if (nb === 0x5c && p + 1 < len && buf[p + 1] === 0x6e) { gP = p + 2; out[outPos++] = 0x22; gOutPos = outPos; gLine = line + 1; gRowEnded = true; return 0; }
  if (nb === 0x5c && p + 3 < len && buf[p + 1] === 0x72 && buf[p + 2] === 0x5c && buf[p + 3] === 0x6e) { gP = p + 4; out[outPos++] = 0x22; gOutPos = outPos; gLine = line + 1; gRowEnded = true; return 0; }
  gLine = line;
  return handleTail(buf, p, len, out, outPos, recordLine, recordRowIdx, false);
}

function parseRow(buf, len) {
  let out = gOut;
  let extraBuf = gExtraBuf;
  let p = gP;
  let outPos = gOutPos;
  let line = gLine;
  const width = gWidth;
  const limitW = width < 0 ? 0x7fffffff : width;
  const recordLine = line;
  const recordRowIdx = gRowCount;
  const rowOutStart = outPos;
  if (recordRowIdx > 0) out[outPos++] = 0x2c;
  out[outPos++] = 0x5b;

  let fieldCount = 0;
  let firstQuoted = false;
  let firstFieldEmpty = false;
  const extraRowStart = gExtraBufPos;
  let rowEnded = false;

  while (!rowEnded) {
    if (p >= len) return -1;
    const inExtra = fieldCount >= limitW;
    const isQuoted = (buf[p] === 0x5c && p + 1 < len && buf[p + 1] === 0x22);
    if (fieldCount === 0) firstQuoted = isQuoted;
    if (!inExtra && fieldCount > 0) out[outPos++] = 0x2c;
    let fieldOutStart = outPos;
    out[outPos++] = 0x22;

    if (isQuoted) {
      gLine = line;
      if (parseQuotedField(buf, p, len, out, outPos, recordLine, recordRowIdx, fieldOutStart) === -1) return -1;
      p = gP; outPos = gOutPos; line = gLine; rowEnded = gRowEnded;
    } else {
      while (true) {
        if (p >= len) return -1;
        const b = buf[p];
        if (b === 0x2c) {
          p++;
          if (fieldCount + 1 < limitW && !(buf[p] === 0x5c && p + 1 < len && buf[p + 1] === 0x22)) {
            out[outPos] = 0x22;
            out[outPos + 1] = 0x2c;
            out[outPos + 2] = 0x22;
            outPos += 3;
            fieldCount++;
            fieldOutStart = outPos - 1;
            continue;
          }
          break;
        }
        if (b === 0x5c) {
          if (p + 1 >= len) return -1;
          const nx = buf[p + 1];
          if (nx === 0x6e) { p += 2; line++; rowEnded = true; break; }
          if (nx === 0x72) {
            if (p + 3 < len && buf[p + 2] === 0x5c && buf[p + 3] === 0x6e) { p += 4; line++; rowEnded = true; break; }
            gErrCodes.push(0); gErrLines.push(recordLine); gErrRows.push(recordRowIdx); gErrExtraA.push(0); gErrExtraB.push(0);
            p += 2;
            continue;
          }
          if (nx === 0x75) return -1;
          if (nx === 0x2f) { out[outPos++] = 0x2f; p += 2; continue; }
          out[outPos++] = 0x5c;
          out[outPos++] = nx;
          p += 2;
          continue;
        }
        if (b === 0x22) { gTextClosed = true; rowEnded = true; break; }
        out[outPos++] = b;
        p++;
      }
      if (fieldCount === 0 && !inExtra) firstFieldEmpty = (outPos === fieldOutStart + 1);
      out[outPos++] = 0x22;
    }

    if (inExtra) {
      const fJsonLen = outPos - fieldOutStart;
      let ep = gExtraBufPos;
      if (ep + fJsonLen + 16 > extraBuf.length) extraBuf = growExtra(ep + fJsonLen + 16);
      if (ep > extraRowStart) extraBuf[ep++] = 0x2c;
      for (let i = 0; i < fJsonLen; i++) extraBuf[ep++] = out[fieldOutStart + i];
      gExtraBufPos = ep;
      outPos = fieldOutStart;
    }
    fieldCount++;
  }

  gP = p;
  gLine = line;
  if (fieldCount === 1 && firstFieldEmpty && !firstQuoted) {
    gOutPos = rowOutStart;
    return 0;
  }

  if (width < 0) gWidth = fieldCount;
  else if (fieldCount < width) {
    gErrCodes.push(3); gErrLines.push(recordLine); gErrRows.push(recordRowIdx); gErrExtraA.push(fieldCount); gErrExtraB.push(0);
    const padCount = width - fieldCount;
    gOutPos = outPos;
    out = ensureOut(padCount * 3 + (len - p) * 3 + 65536);
    for (let k = 0; k < padCount; k++) {
      out[outPos++] = 0x2c;
      out[outPos++] = 0x22;
      out[outPos++] = 0x22;
    }
  } else if (fieldCount > width) {
    gErrCodes.push(4); gErrLines.push(recordLine); gErrRows.push(recordRowIdx); gErrExtraA.push(extraRowStart); gErrExtraB.push(gExtraBufPos - extraRowStart);
  }

  out[outPos++] = 0x5d;
  if (recordRowIdx === 0) gRow0End = outPos;
  gRowCount = recordRowIdx + 1;
  gOutPos = outPos;
  return 0;
}

function parseTextCase(buf, textStart, len, savedOutPos) {
  let p = textStart;
  if (p + 3 <= len && buf[p] === 0xef && buf[p + 1] === 0xbb && buf[p + 2] === 0xbf) p += 3;
  gP = p;
  gOutPos = savedOutPos + 24;
  gExtraBufPos = 0;
  gErrCodes.length = 0;
  gErrLines.length = 0;
  gErrRows.length = 0;
  gErrExtraA.length = 0;
  gErrExtraB.length = 0;
  gWidth = -1;
  gRowCount = 0;
  gRow0End = -1;
  gLine = 1;
  gTextClosed = false;

  while (gP < len) {
    p = gP;
    while (p < len && buf[p] === 0x5c) {
      if (p + 1 >= len) return -1;
      const nx = buf[p + 1];
      if (nx === 0x6e) { p += 2; gLine++; continue; }
      if (nx === 0x72 && p + 3 < len && buf[p + 2] === 0x5c && buf[p + 3] === 0x6e) { p += 4; gLine++; continue; }
      if (nx === 0x75) return -1;
      break;
    }
    if (p >= len) return -1;
    gP = p;
    if (buf[p] === 0x22) { gTextClosed = true; break; }
    if (parseRow(buf, len) === -1) return -1;
    if (gTextClosed) break;
  }
  return gP;
}

function finalizeCase(header, savedOutPos, remainingInputBytes) {
  let outPos = gOutPos;
  const rowCount = gRowCount;
  const row0End = gRow0End;
  let out = ensureOut(remainingInputBytes * 3 + 65536);

  if (rowCount === 0) {
    outPos = savedOutPos;
    const pref = header ? B_EMPTY_HDR_TRUE : B_PREFIX_HDR_FALSE;
    out.set(pref, outPos);
    outPos += pref.length;
    if (!header) {
      out.set(B_ERR_MID, outPos);
      outPos += B_ERR_MID.length;
    }
  } else if (!header) {
    out.set(B_PREFIX_HDR_FALSE, savedOutPos);
    out.set(B_ERR_MID, outPos);
    outPos += B_ERR_MID.length;
  } else {
    const row0Start = savedOutPos + 24;
    const row0Len = row0End - row0Start;
    out.set(B_PREFIX_HDR_TRUE, savedOutPos);
    out.copyWithin(savedOutPos + 11, row0Start, row0End);
    const midPos = savedOutPos + 11 + row0Len;
    out.set(B_ROWS_MID, midPos);
    if (rowCount === 1) {
      outPos = midPos + B_ROWS_MID.length;
    } else {
      for (let k = midPos + B_ROWS_MID.length; k <= row0End; k++) out[k] = 0x20;
    }
    out.set(B_ERR_MID, outPos);
    outPos += B_ERR_MID.length;
  }

  for (let i = 0; i < gErrCodes.length; i++) {
    const code = gErrCodes[i];
    const extraLen = code === 4 ? gErrExtraB[i] : 0;
    gOutPos = outPos;
    out = ensureOut(128 + extraLen + remainingInputBytes * 3 + 65536);
    if (i > 0) out[outPos++] = 0x2c;
    const pref = ERR_PREFIXES[code];
    out.set(pref, outPos);
    outPos += pref.length;
    outPos = writeAsciiInt(out, outPos, gErrLines[i]);
    out.set(ERR_ROW_KEY, outPos);
    outPos += ERR_ROW_KEY.length;
    const rawRow = gErrRows[i];
    if (header && rawRow === 0) {
      out.set(ERR_NULL, outPos);
      outPos += ERR_NULL.length;
    } else {
      outPos = writeAsciiInt(out, outPos, header ? rawRow - 1 : rawRow);
    }
    if (code === 3) {
      out.set(ERR_FIELDS_KEY, outPos);
      outPos += ERR_FIELDS_KEY.length;
      outPos = writeAsciiInt(out, outPos, gErrExtraA[i]);
    } else if (code === 4) {
      out.set(ERR_EXTRA_KEY, outPos);
      outPos += ERR_EXTRA_KEY.length;
      if (extraLen > 0) {
        out.set(gExtraBuf.subarray(gErrExtraA[i], gErrExtraA[i] + extraLen), outPos);
        outPos += extraLen;
      }
      out[outPos++] = 0x5d;
    }
    out[outPos++] = 0x7d;
  }

  out.set(B_END_OBJ, outPos);
  gOutPos = outPos + B_END_OBJ.length;
}

/**
 * Processes an entire `/input/cases.json` UTF-8 Buffer directly to an output JSON Buffer.
 * Falls back cleanly per-case to `JSON.parse` + `run(c.input)` + `JSON.stringify` if any
 * unexpected JSON formatting or `\uXXXX` escape appears.
 */
export function runCasesBuffer(casesBuf) {
  const len = casesBuf.length;
  const buf = new Uint8Array(casesBuf.buffer, casesBuf.byteOffset, len);
  let p = skipWs(buf, 0, len);
  if (p >= len || buf[p] !== 0x5b) {
    const cases = JSON.parse(casesBuf.toString('utf8'));
    return Buffer.from(JSON.stringify(cases.map((c) => run(c.input))));
  }
  p++;

  const outRaw = Buffer.allocUnsafe(Math.max(262144, len * 3 + 1048576));
  gOut = new Uint8Array(outRaw.buffer, outRaw.byteOffset, outRaw.byteLength);
  const extraRaw = Buffer.allocUnsafe(65536);
  gExtraBuf = new Uint8Array(extraRaw.buffer, extraRaw.byteOffset, extraRaw.byteLength);
  gOutPos = 0;
  gOut[gOutPos++] = 0x5b;

  let caseIdx = 0;
  p = skipWs(buf, p, len);
  if (p < len && buf[p] !== 0x5d) {
    while (p < len) {
      p = skipWs(buf, p, len);
      const caseStart = p;
      if (buf[p] !== 0x7b) {
        const cases = JSON.parse(casesBuf.toString('utf8'));
        gOut = null; gExtraBuf = null;
        return Buffer.from(JSON.stringify(cases.map((c) => run(c.input))));
      }
      p++;

      ensureOut((len - p) * 3 + 65536);
      if (caseIdx > 0) gOut[gOutPos++] = 0x2c;
      caseIdx++;

      const savedOutPos = gOutPos;
      let headerVal = undefined;
      let textParsed = false;
      let malformed = false;
      let needFallback = false;

      while (p < len) {
        p = skipWs(buf, p, len);
        if (buf[p] === 0x7d) { p++; break; }
        if (buf[p] === 0x2c) { p++; p = skipWs(buf, p, len); }
        if (buf[p] !== 0x22) { malformed = true; break; }
        const kEnd = findJsonStringEnd(buf, p + 1, len);
        if (kEnd === -1) { malformed = true; break; }
        const isInputKey = (kEnd - (p + 1) === 5 &&
          buf[p + 1] === 0x69 && buf[p + 2] === 0x6e &&
          buf[p + 3] === 0x70 && buf[p + 4] === 0x75 && buf[p + 5] === 0x74);
        p = skipWs(buf, kEnd + 1, len);
        if (buf[p] !== 0x3a) { malformed = true; break; }
        p = skipWs(buf, p + 1, len);

        if (!isInputKey) {
          p = skipJsonValue(buf, p, len);
          if (p === -1) { malformed = true; break; }
          continue;
        }
        if (buf[p] !== 0x7b) { malformed = true; break; }
        p++;
        while (p < len) {
          p = skipWs(buf, p, len);
          if (buf[p] === 0x7d) { p++; break; }
          if (buf[p] === 0x2c) { p++; p = skipWs(buf, p, len); }
          if (buf[p] !== 0x22) { malformed = true; break; }
          const ikEnd = findJsonStringEnd(buf, p + 1, len);
          if (ikEnd === -1) { malformed = true; break; }
          const ikLen = ikEnd - (p + 1);
          const isTextKey = (ikLen === 4 &&
            buf[p + 1] === 0x74 && buf[p + 2] === 0x65 &&
            buf[p + 3] === 0x78 && buf[p + 4] === 0x74);
          const isHeaderKey = (ikLen === 6 &&
            buf[p + 1] === 0x68 && buf[p + 2] === 0x65 &&
            buf[p + 3] === 0x61 && buf[p + 4] === 0x64 &&
            buf[p + 5] === 0x65 && buf[p + 6] === 0x72);
          p = skipWs(buf, ikEnd + 1, len);
          if (buf[p] !== 0x3a) { malformed = true; break; }
          p = skipWs(buf, p + 1, len);
          if (isTextKey && buf[p] === 0x22 && !textParsed && !needFallback) {
            const endQ = parseTextCase(buf, p + 1, len, savedOutPos);
            if (endQ === -1) {
              const qEnd = findJsonStringEnd(buf, p + 1, len);
              if (qEnd === -1) { malformed = true; break; }
              p = qEnd + 1;
              needFallback = true;
            } else {
              p = endQ + 1;
              textParsed = true;
            }
          } else if (isHeaderKey) {
            if (p + 4 <= len && buf[p] === 0x74 && buf[p + 1] === 0x72 && buf[p + 2] === 0x75 && buf[p + 3] === 0x65) {
              headerVal = true;
              p += 4;
            } else if (p + 5 <= len && buf[p] === 0x66 && buf[p + 1] === 0x61 && buf[p + 2] === 0x6c && buf[p + 3] === 0x73 && buf[p + 4] === 0x65) {
              headerVal = false;
              p += 5;
            } else {
              p = skipJsonValue(buf, p, len);
              if (p === -1) { malformed = true; break; }
              headerVal = null;
              needFallback = true;
            }
          } else {
            p = skipJsonValue(buf, p, len);
            if (p === -1) { malformed = true; break; }
          }
        }
        if (malformed) break;
      }

      if (malformed) {
        const cases = JSON.parse(casesBuf.toString('utf8'));
        gOut = null; gExtraBuf = null;
        return Buffer.from(JSON.stringify(cases.map((c) => run(c.input))));
      }
      const caseEnd = p;

      if (textParsed && !needFallback && (headerVal === true || headerVal === false)) {
        finalizeCase(headerVal, savedOutPos, len - p);
      } else {
        gOutPos = savedOutPos;
        const parsed = JSON.parse(casesBuf.subarray(caseStart, caseEnd).toString('utf8'));
        const fb = Buffer.from(JSON.stringify(run(parsed.input)));
        const out = ensureOut(fb.length + (len - p) * 3 + 65536);
        out.set(fb, gOutPos);
        gOutPos += fb.length;
      }

      p = skipWs(buf, p, len);
      if (p < len && buf[p] === 0x2c) { p++; continue; }
      if (p < len && buf[p] === 0x5d) { p++; break; }
      const cases = JSON.parse(casesBuf.toString('utf8'));
      gOut = null; gExtraBuf = null;
      return Buffer.from(JSON.stringify(cases.map((c) => run(c.input))));
    }
  }

  ensureOut(16);
  gOut[gOutPos++] = 0x5d;
  const finalLen = gOutPos;
  const result = Buffer.from(gOut.buffer, gOut.byteOffset, finalLen);
  gOut = null;
  gExtraBuf = null;
  return result;
}

// Pre-warm V8 JIT type feedback on tiny synthetic data (all branches covered -> zero deopt, no case data retained).
{
  const r1 = 'a,b,c\n';
  const r2 = '"q1,q2""q3\r\n\n/\t\r",plain/x\t,"q"junk,x\ry\r\n';
  const r3 = '"q1","qnl"\n"q2","qcrlf"\r\n\n1\n1,2,3,4,5\n';
  const body = (r1 + r2 + r3).repeat(12);
  const wb = Buffer.from(JSON.stringify([
    { id: 'w1', input: { text: '\uFEFF' + body + '"unterm\r\n', header: true } },
    { id: 'w2', input: { text: body + '"end"junk', header: false } },
    { id: 'w3', input: { text: 'h1,h2\n"qend"', header: true } },
    { id: 'w4', input: { text: '', header: true } },
  ]).replaceAll('/', '\\/'));
  for (let i = 0; i < 6; i++) runCasesBuffer(wb);
}
