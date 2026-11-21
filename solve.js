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
// Compact single-pass UTF-8 JSON-to-JSON byte engine
// ============================================================================

const B_PREFIX_HDR_TRUE = Buffer.from('{"columns":');
const B_ROWS_MID = Buffer.from(',"rows":[');
const B_PREFIX_HDR_FALSE = Buffer.from('{"columns":null,"rows":[');
const B_EMPTY_HDR_TRUE = Buffer.from('{"columns":[],"rows":[],"errors":[');
const B_ERR_MID = Buffer.from('],"errors":[');
const B_END_OBJ = Buffer.from(']}');

const ERR_CODE_STRAY_CR = 0;
const ERR_CODE_UNTERM = 1;
const ERR_CODE_QUOTE_JUNK = 2;
const ERR_CODE_SHORT = 3;
const ERR_CODE_LONG = 4;

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

function writeAsciiInt(target, pos, n) {
  if (n === 0) {
    target[pos++] = 0x30;
    return pos;
  }
  let tmp = n;
  let digits = 0;
  while (tmp > 0) {
    digits++;
    tmp = (tmp / 10) | 0;
  }
  let idx = pos + digits - 1;
  while (n > 0) {
    target[idx--] = 0x30 + (n % 10);
    n = (n / 10) | 0;
  }
  return pos + digits;
}

function ensureOutBuf(outState, need) {
  const out = outState.buf;
  if (outState.pos + need > out.length) {
    const next = Buffer.allocUnsafe(Math.max(out.length * 2, outState.pos + need + 65536));
    out.copy(next, 0, 0, outState.pos);
    outState.buf = next;
  }
  return outState.buf;
}

/** Cold helper: reads unquoted tail after an unterminated quote or closing quote (for quote_junk / stray_cr). */
function readTailIntoOut(buf, len, outState, recordLine, recordRowIdx, isUnterminated) {
  let p = outState.p;
  let outPos = outState.pos;
  let out = outState.buf;
  let safeLimit = out.length - 8192;
  let line = outState.line;
  let added = 0;
  let rowEnded = false;
  let textClosed = false;
  let nextChk = p + 4096;

  while (p < len) {
    if (p >= nextChk) {
      if (outPos >= safeLimit) {
        outState.pos = outPos;
        out = ensureOutBuf(outState, 65536);
        safeLimit = out.length - 8192;
      }
      nextChk = p + 4096;
    }
    const b = buf[p];
    if (b === 0x2c) { p++; break; }
    if (b === 0x22) { textClosed = true; rowEnded = true; break; }
    if (b === 0x5c) {
      if (p + 1 >= len) return -1;
      const nx = buf[p + 1];
      if (nx === 0x6e) { p += 2; line++; rowEnded = true; break; }
      if (nx === 0x72) {
        if (p + 3 < len && buf[p + 2] === 0x5c && buf[p + 3] === 0x6e) {
          p += 4; line++; rowEnded = true; break;
        }
        outState.errCodes.push(ERR_CODE_STRAY_CR);
        outState.errLines.push(recordLine);
        outState.errRows.push(recordRowIdx);
        outState.errExtraA.push(0);
        outState.errExtraB.push(0);
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
  if (!isUnterminated && added > 0) {
    outState.errCodes.push(ERR_CODE_QUOTE_JUNK);
    outState.errLines.push(recordLine);
    outState.errRows.push(recordRowIdx);
    outState.errExtraA.push(0);
    outState.errExtraB.push(0);
  }
  outState.p = p;
  outState.pos = outPos;
  outState.line = line;
  outState.rowEnded = rowEnded;
  outState.textClosed = textClosed;
  return 0;
}

/**
 * Compact single-pass CSV parser directly from JSON-escaped UTF-8 bytes `buf[textStart..len)`.
 * Returns `textEnd` (index of closing `"`) on success, or `-1` on `\uXXXX`/malformed JSON.
 */
function parseJsonTextSinglePass(buf, textStart, outState) {
  const len = buf.length;
  let p = textStart;
  if (p + 3 <= len && buf[p] === 0xef && buf[p + 1] === 0xbb && buf[p + 2] === 0xbf) {
    p += 3;
  }

  let out = outState.buf;
  let safeLimit = out.length - 8192;
  const savedOutPos = outState.pos;
  let outPos = savedOutPos + 24;
  if (outPos >= safeLimit) {
    outState.pos = savedOutPos;
    out = ensureOutBuf(outState, 65536);
    safeLimit = out.length - 8192;
  }

  let extraBuf = outState.extraBuf;
  let extraBufPos = 0;

  const errCodes = [];
  const errLines = [];
  const errRows = [];
  const errExtraA = [];
  const errExtraB = [];
  outState.errCodes = errCodes;
  outState.errLines = errLines;
  outState.errRows = errRows;
  outState.errExtraA = errExtraA;
  outState.errExtraB = errExtraB;

  let width = -1;
  let rowCount = 0;
  let row0End = -1;
  let line = 1;
  let textClosed = false;

  while (p < len) {
    while (p < len) {
      const b = buf[p];
      if (b === 0x5c) {
        if (p + 1 >= len) { outState.pos = savedOutPos; return -1; }
        const nx = buf[p + 1];
        if (nx === 0x6e) { p += 2; line++; continue; }
        if (nx === 0x72 && p + 3 < len && buf[p + 2] === 0x5c && buf[p + 3] === 0x6e) { p += 4; line++; continue; }
        if (nx === 0x75) { outState.pos = savedOutPos; return -1; }
      }
      break;
    }
    if (p >= len) { outState.pos = savedOutPos; return -1; }
    if (buf[p] === 0x22) { textClosed = true; break; }

    if (outPos >= safeLimit) {
      outState.pos = outPos;
      out = ensureOutBuf(outState, 65536);
      safeLimit = out.length - 8192;
    }

    const recordLine = line;
    const recordRowIdx = rowCount;
    const rowOutStart = outPos;

    if (rowCount > 0) out[outPos++] = 0x2c;
    out[outPos++] = 0x5b;

    let fieldCount = 0;
    const limitW = width < 0 ? 0x7fffffff : width;
    let firstQuoted = false;
    let firstFieldEmpty = false;
    const extraRowStart = extraBufPos;
    let rowEnded = false;

    while (!rowEnded) {
      if (p >= len) { outState.pos = savedOutPos; return -1; }
      if (outPos >= safeLimit) {
        outState.pos = outPos;
        out = ensureOutBuf(outState, 65536);
        safeLimit = out.length - 8192;
      }

      const inExtra = fieldCount >= limitW;
      const isQuoted = (buf[p] === 0x5c && p + 1 < len && buf[p + 1] === 0x22);
      if (fieldCount === 0) firstQuoted = isQuoted;
      if (!inExtra && fieldCount > 0) out[outPos++] = 0x2c;

      const fieldOutStart = outPos;
      out[outPos++] = 0x22;

      if (isQuoted) {
        const openP = p;
        const openLine = line;
        p += 2;
        let closed = false;
        let nextChk = p + 4096;

        while (p < len) {
          if (p >= nextChk) {
            if (outPos >= safeLimit) {
              outState.pos = outPos;
              out = ensureOutBuf(outState, 65536);
              safeLimit = out.length - 8192;
            }
            nextChk = p + 4096;
          }
          const b = buf[p];
          if (b === 0x5c) {
            if (p + 1 >= len) { outState.pos = savedOutPos; return -1; }
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
            if (nx === 0x75) { outState.pos = savedOutPos; return -1; }
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
          errCodes.push(ERR_CODE_UNTERM);
          errLines.push(recordLine);
          errRows.push(recordRowIdx);
          errExtraA.push(0);
          errExtraB.push(0);
          out[outPos++] = 0x22;
          out[outPos++] = 0x5c;
          out[outPos++] = 0x22;
          outState.p = p;
          outState.pos = outPos;
          outState.line = line;
          if (readTailIntoOut(buf, len, outState, recordLine, recordRowIdx, true) === -1) {
            outState.pos = savedOutPos;
            return -1;
          }
          p = outState.p;
          outPos = outState.pos;
          out = outState.buf;
          safeLimit = out.length - 8192;
          line = outState.line;
          rowEnded = outState.rowEnded;
          textClosed = outState.textClosed;
        } else {
          if (p >= len) { outState.pos = savedOutPos; return -1; }
          const nb = buf[p];
          if (nb === 0x2c) {
            p++;
            out[outPos++] = 0x22;
          } else if (nb === 0x22) {
            textClosed = true;
            rowEnded = true;
            out[outPos++] = 0x22;
          } else if (nb === 0x5c && p + 1 < len && buf[p + 1] === 0x6e) {
            p += 2;
            line++;
            rowEnded = true;
            out[outPos++] = 0x22;
          } else if (nb === 0x5c && p + 3 < len && buf[p + 1] === 0x72 && buf[p + 2] === 0x5c && buf[p + 3] === 0x6e) {
            p += 4;
            line++;
            rowEnded = true;
            out[outPos++] = 0x22;
          } else {
            outState.p = p;
            outState.pos = outPos;
            outState.line = line;
            if (readTailIntoOut(buf, len, outState, recordLine, recordRowIdx, false) === -1) {
              outState.pos = savedOutPos;
              return -1;
            }
            p = outState.p;
            outPos = outState.pos;
            out = outState.buf;
            safeLimit = out.length - 8192;
            line = outState.line;
            rowEnded = outState.rowEnded;
            textClosed = outState.textClosed;
          }
        }
      } else {
        let nextChk = p + 4096;
        while (true) {
          if (p >= nextChk) {
            if (outPos >= safeLimit) {
              outState.pos = outPos;
              out = ensureOutBuf(outState, 65536);
              safeLimit = out.length - 8192;
            }
            nextChk = p + 4096;
          }
          if (p >= len) { outState.pos = savedOutPos; return -1; }
          const b = buf[p];
          if (b === 0x2c) { p++; break; }
          if (b === 0x5c) {
            if (p + 1 >= len) { outState.pos = savedOutPos; return -1; }
            const nx = buf[p + 1];
            if (nx === 0x6e) { p += 2; line++; rowEnded = true; break; }
            if (nx === 0x72) {
              if (p + 3 < len && buf[p + 2] === 0x5c && buf[p + 3] === 0x6e) {
                p += 4; line++; rowEnded = true; break;
              }
              errCodes.push(ERR_CODE_STRAY_CR);
              errLines.push(recordLine);
              errRows.push(recordRowIdx);
              errExtraA.push(0);
              errExtraB.push(0);
              p += 2;
              continue;
            }
            if (nx === 0x75) { outState.pos = savedOutPos; return -1; }
            if (nx === 0x2f) { out[outPos++] = 0x2f; p += 2; continue; }
            out[outPos++] = 0x5c;
            out[outPos++] = nx;
            p += 2;
            continue;
          }
          if (b === 0x22) { textClosed = true; rowEnded = true; break; }
          out[outPos++] = b;
          p++;
        }
        if (fieldCount === 0 && !inExtra) firstFieldEmpty = (outPos === fieldOutStart + 1);
        out[outPos++] = 0x22;
      }

      if (inExtra) {
        const fJsonLen = outPos - fieldOutStart;
        const needComma = extraBufPos > extraRowStart ? 1 : 0;
        if (extraBufPos + fJsonLen + needComma + 16 > extraBuf.length) {
          const next = Buffer.allocUnsafe(Math.max(extraBuf.length * 2, extraBufPos + fJsonLen + 4096));
          extraBuf.copy(next, 0, 0, extraBufPos);
          extraBuf = next;
          outState.extraBuf = extraBuf;
        }
        if (needComma) extraBuf[extraBufPos++] = 0x2c;
        out.copy(extraBuf, extraBufPos, fieldOutStart, outPos);
        extraBufPos += fJsonLen;
        outPos = fieldOutStart;
      }
      fieldCount++;
    }

    if (fieldCount === 1 && firstFieldEmpty && !firstQuoted) {
      outPos = rowOutStart;
      if (textClosed) break;
      continue;
    }

    if (width < 0) width = fieldCount;

    if (fieldCount < width) {
      errCodes.push(ERR_CODE_SHORT);
      errLines.push(recordLine);
      errRows.push(recordRowIdx);
      errExtraA.push(fieldCount);
      errExtraB.push(0);
      const padCount = width - fieldCount;
      if (outPos + padCount * 3 + 16 > out.length) {
        outState.pos = outPos;
        out = ensureOutBuf(outState, padCount * 3 + 64);
        safeLimit = out.length - 8192;
      }
      for (let k = 0; k < padCount; k++) {
        out[outPos++] = 0x2c;
        out[outPos++] = 0x22;
        out[outPos++] = 0x22;
      }
    } else if (fieldCount > width) {
      errCodes.push(ERR_CODE_LONG);
      errLines.push(recordLine);
      errRows.push(recordRowIdx);
      errExtraA.push(extraRowStart);
      errExtraB.push(extraBufPos - extraRowStart);
    }

    out[outPos++] = 0x5d;
    if (rowCount === 0) row0End = outPos;
    rowCount++;
    if (textClosed) break;
  }

  outState.pos = outPos;
  outState.savedOutPos = savedOutPos;
  outState.rowCount = rowCount;
  outState.row0End = row0End;
  return p;
}

function finalizeCaseOutput(header, outState) {
  let out = outState.buf;
  let outPos = outState.pos;
  const savedOutPos = outState.savedOutPos;
  const rowCount = outState.rowCount;
  const row0End = outState.row0End;
  const errCodes = outState.errCodes;
  const errLines = outState.errLines;
  const errRows = outState.errRows;
  const errExtraA = outState.errExtraA;
  const errExtraB = outState.errExtraB;
  const extraBuf = outState.extraBuf;

  if (rowCount === 0) {
    outPos = savedOutPos;
    const pref = header ? B_EMPTY_HDR_TRUE : B_PREFIX_HDR_FALSE;
    outState.pos = outPos;
    out = ensureOutBuf(outState, pref.length + B_ERR_MID.length + 16);
    pref.copy(out, outPos);
    outPos += pref.length;
    if (!header) {
      B_ERR_MID.copy(out, outPos);
      outPos += B_ERR_MID.length;
    }
  } else if (!header) {
    B_PREFIX_HDR_FALSE.copy(out, savedOutPos);
    outState.pos = outPos;
    out = ensureOutBuf(outState, B_ERR_MID.length + 16);
    B_ERR_MID.copy(out, outPos);
    outPos += B_ERR_MID.length;
  } else {
    const row0Start = savedOutPos + 24;
    const row0Len = row0End - row0Start;
    B_PREFIX_HDR_TRUE.copy(out, savedOutPos);
    out.copyWithin(savedOutPos + 11, row0Start, row0End);
    const midPos = savedOutPos + 11 + row0Len;
    B_ROWS_MID.copy(out, midPos);
    if (rowCount === 1) {
      outPos = midPos + B_ROWS_MID.length;
    } else {
      for (let k = midPos + B_ROWS_MID.length; k <= row0End; k++) out[k] = 0x20;
    }
    outState.pos = outPos;
    out = ensureOutBuf(outState, B_ERR_MID.length + 16);
    B_ERR_MID.copy(out, outPos);
    outPos += B_ERR_MID.length;
  }

  for (let i = 0; i < errCodes.length; i++) {
    const code = errCodes[i];
    const extraLen = code === ERR_CODE_LONG ? errExtraB[i] : 0;
    outState.pos = outPos;
    out = ensureOutBuf(outState, 128 + extraLen);
    if (i > 0) out[outPos++] = 0x2c;
    const pref = ERR_PREFIXES[code];
    pref.copy(out, outPos);
    outPos += pref.length;
    outPos = writeAsciiInt(out, outPos, errLines[i]);
    ERR_ROW_KEY.copy(out, outPos);
    outPos += ERR_ROW_KEY.length;
    const rawRow = errRows[i];
    if (header) {
      if (rawRow === 0) {
        ERR_NULL.copy(out, outPos);
        outPos += ERR_NULL.length;
      } else {
        outPos = writeAsciiInt(out, outPos, rawRow - 1);
      }
    } else {
      outPos = writeAsciiInt(out, outPos, rawRow);
    }
    if (code === ERR_CODE_SHORT) {
      ERR_FIELDS_KEY.copy(out, outPos);
      outPos += ERR_FIELDS_KEY.length;
      outPos = writeAsciiInt(out, outPos, errExtraA[i]);
    } else if (code === ERR_CODE_LONG) {
      ERR_EXTRA_KEY.copy(out, outPos);
      outPos += ERR_EXTRA_KEY.length;
      if (extraLen > 0) {
        extraBuf.copy(out, outPos, errExtraA[i], errExtraA[i] + extraLen);
        outPos += extraLen;
      }
      out[outPos++] = 0x5d;
    }
    out[outPos++] = 0x7d;
  }

  outState.pos = outPos;
  out = ensureOutBuf(outState, B_END_OBJ.length);
  B_END_OBJ.copy(out, outPos);
  outState.pos = outPos + B_END_OBJ.length;
}

/**
 * Processes an entire `/input/cases.json` UTF-8 Buffer directly to an output JSON Buffer.
 * Falls back cleanly per-case to `JSON.parse` + `run(c.input)` + `JSON.stringify` if any
 * unexpected JSON formatting or `\uXXXX` escape appears.
 */
export function runCasesBuffer(casesBuf) {
  const len = casesBuf.length;
  let p = skipWs(casesBuf, 0, len);
  if (p >= len || casesBuf[p] !== 0x5b) {
    const cases = JSON.parse(casesBuf.toString('utf8'));
    return Buffer.from(JSON.stringify(cases.map((c) => run(c.input))));
  }
  p++;

  const outState = {
    buf: Buffer.allocUnsafe(Math.max(131072, Math.ceil(len * 1.25))),
    pos: 1,
    extraBuf: Buffer.allocUnsafe(16384),
    savedOutPos: 0,
    rowCount: 0,
    row0End: -1,
    p: 0,
    line: 1,
    rowEnded: false,
    textClosed: false,
    errCodes: null,
    errLines: null,
    errRows: null,
    errExtraA: null,
    errExtraB: null,
  };
  outState.buf[0] = 0x5b;

  function appendOutBytes(b) {
    const out = ensureOutBuf(outState, b.length);
    b.copy(out, outState.pos);
    outState.pos += b.length;
  }

  let caseIdx = 0;
  p = skipWs(casesBuf, p, len);
  if (p < len && casesBuf[p] !== 0x5d) {
    while (p < len) {
      p = skipWs(casesBuf, p, len);
      const caseStart = p;
      if (casesBuf[p] !== 0x7b) {
        const cases = JSON.parse(casesBuf.toString('utf8'));
        return Buffer.from(JSON.stringify(cases.map((c) => run(c.input))));
      }
      p++;

      if (caseIdx > 0) {
        const out = ensureOutBuf(outState, 1);
        out[outState.pos++] = 0x2c;
      }
      caseIdx++;

      let headerVal = undefined;
      let textParsed = false;
      let malformed = false;
      let needFallback = false;

      while (p < len) {
        p = skipWs(casesBuf, p, len);
        if (casesBuf[p] === 0x7d) { p++; break; }
        if (casesBuf[p] === 0x2c) { p++; p = skipWs(casesBuf, p, len); }
        if (casesBuf[p] !== 0x22) { malformed = true; break; }
        const kEnd = findJsonStringEnd(casesBuf, p + 1, len);
        if (kEnd === -1) { malformed = true; break; }
        const isInputKey = (kEnd - (p + 1) === 5 &&
          casesBuf[p + 1] === 0x69 && casesBuf[p + 2] === 0x6e &&
          casesBuf[p + 3] === 0x70 && casesBuf[p + 4] === 0x75 && casesBuf[p + 5] === 0x74);
        p = skipWs(casesBuf, kEnd + 1, len);
        if (casesBuf[p] !== 0x3a) { malformed = true; break; }
        p = skipWs(casesBuf, p + 1, len);

        if (!isInputKey) {
          p = skipJsonValue(casesBuf, p, len);
          if (p === -1) { malformed = true; break; }
          continue;
        }
        if (casesBuf[p] !== 0x7b) { malformed = true; break; }
        p++;
        while (p < len) {
          p = skipWs(casesBuf, p, len);
          if (casesBuf[p] === 0x7d) { p++; break; }
          if (casesBuf[p] === 0x2c) { p++; p = skipWs(casesBuf, p, len); }
          if (casesBuf[p] !== 0x22) { malformed = true; break; }
          const ikEnd = findJsonStringEnd(casesBuf, p + 1, len);
          if (ikEnd === -1) { malformed = true; break; }
          const ikLen = ikEnd - (p + 1);
          const isTextKey = (ikLen === 4 &&
            casesBuf[p + 1] === 0x74 && casesBuf[p + 2] === 0x65 &&
            casesBuf[p + 3] === 0x78 && casesBuf[p + 4] === 0x74);
          const isHeaderKey = (ikLen === 6 &&
            casesBuf[p + 1] === 0x68 && casesBuf[p + 2] === 0x65 &&
            casesBuf[p + 3] === 0x61 && casesBuf[p + 4] === 0x64 &&
            casesBuf[p + 5] === 0x65 && casesBuf[p + 6] === 0x72);
          p = skipWs(casesBuf, ikEnd + 1, len);
          if (casesBuf[p] !== 0x3a) { malformed = true; break; }
          p = skipWs(casesBuf, p + 1, len);
          if (isTextKey && casesBuf[p] === 0x22 && !textParsed) {
            const endQuote = parseJsonTextSinglePass(casesBuf, p + 1, outState);
            if (endQuote === -1) {
              const qEnd = findJsonStringEnd(casesBuf, p + 1, len);
              if (qEnd === -1) { malformed = true; break; }
              p = qEnd + 1;
              needFallback = true;
            } else {
              p = endQuote + 1;
              textParsed = true;
            }
          } else if (isHeaderKey) {
            if (p + 4 <= len && casesBuf[p] === 0x74 && casesBuf[p + 1] === 0x72 && casesBuf[p + 2] === 0x75 && casesBuf[p + 3] === 0x65) {
              headerVal = true;
              p += 4;
            } else if (p + 5 <= len && casesBuf[p] === 0x66 && casesBuf[p + 1] === 0x61 && casesBuf[p + 2] === 0x6c && casesBuf[p + 3] === 0x73 && casesBuf[p + 4] === 0x65) {
              headerVal = false;
              p += 5;
            } else {
              p = skipJsonValue(casesBuf, p, len);
              if (p === -1) { malformed = true; break; }
              headerVal = null;
              needFallback = true;
            }
          } else {
            p = skipJsonValue(casesBuf, p, len);
            if (p === -1) { malformed = true; break; }
          }
        }
        if (malformed) break;
      }

      if (malformed) {
        const cases = JSON.parse(casesBuf.toString('utf8'));
        return Buffer.from(JSON.stringify(cases.map((c) => run(c.input))));
      }
      const caseEnd = p;

      if (textParsed && !needFallback && (headerVal === true || headerVal === false)) {
        finalizeCaseOutput(headerVal, outState);
      } else {
        if (textParsed) outState.pos = outState.savedOutPos;
        const parsed = JSON.parse(casesBuf.subarray(caseStart, caseEnd).toString('utf8'));
        appendOutBytes(Buffer.from(JSON.stringify(run(parsed.input))));
      }

      p = skipWs(casesBuf, p, len);
      if (p < len && casesBuf[p] === 0x2c) {
        p++;
        continue;
      }
      if (p < len && casesBuf[p] === 0x5d) {
        p++;
        break;
      }
      const cases = JSON.parse(casesBuf.toString('utf8'));
      return Buffer.from(JSON.stringify(cases.map((c) => run(c.input))));
    }
  }

  appendOutBytes(Buffer.from(']'));
  return outState.buf.subarray(0, outState.pos);
}
