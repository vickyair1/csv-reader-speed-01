// Fast drop-in for csv-reader 1.0.0 (make.fun's own CSV reader).
// Same answers on every case, much less CPU: bulk indexOf scans instead of
// one-character-at-a-time reads, slice() fields instead of char-by-char
// concatenation, and a lazy forward pointer for CR positions so a stray-CR
// check never scans past the current field.
//
// Semantics mirror vendor/csv-reader/index.js exactly:
//  - U+FEFF at the very start is dropped.
//  - A record ends at LF or CRLF; a line left with no characters is no record.
//  - Outside quotes a CR not followed by LF is dropped (stray_cr).
//  - A field opening with a quote runs to the next non-doubled quote; "" is one
//    quote; each CRLF or lone CR inside is read as LF; what follows the closing
//    quote up to the next comma or line break is appended as it stands
//    (quote_junk when the field ends); a quote that never closes is a literal
//    character and the text after it is read again as unquoted
//    (unterminated_quote).
//  - A quote inside an unquoted field is a literal character.
//  - columns is the first record when header is true, else null; rows are the
//    records after it, each padded (short_row, fields: its count) or cut
//    (long_row, extra: the cut fields) to the first record's width.
//  - Each error is {code, line, row}: line the 1-based line its record starts
//    on, row its record's index in rows (null for the header), in the order met.

const COMMA = 0;
const LINE_BREAK = 1;
const END = 2;

/** csv-reader 1.0.0's answer for one case's input. */
export function run(input) {
  const text = String(input.text);
  const header = input.header === true;
  const n = text.length;
  const errors = [];
  const rows = [];
  let columns = null;
  let width = -1;

  let pos = text.charCodeAt(0) === 0xfeff ? 1 : 0;
  let line = 1;

  // Record being read: the line it starts on, and the index in rows it takes.
  let recordLine = 1;
  let recordRow = null;

  // First '\r' at/after the watermark; advanced only forward (one memchr-speed
  // pass over the text in total), except on an unterminated quote, where the
  // read restarts just after the opening quote.
  let nextCr = text.indexOf('\r');

  // The next LF at/after the record's start (or n): the same for every field
  // of the record, so it is looked up once per record, not once per field.
  // A quoted field can cross lines, so it is marked stale after one.
  let lineEnd = -1;
  let lineEndValid = false;

  function error(code) {
    errors.push({ code, line: recordLine, row: recordRow });
  }

  // First CR at/after p (or -1), keeping nextCr monotonic with the parse.
  function firstCrAtOrAfter(p) {
    while (nextCr !== -1 && nextCr < p) nextCr = text.indexOf('\r', nextCr + 1);
    return nextCr;
  }

  // The field just read: its value, how it ended, and how many characters the
  // unquoted part of it kept (for the quote_junk check).
  let fValue;
  let fEnded;
  let fAdded;

  // Reads unquoted characters from pos onto `init`, up to the next comma or
  // line break; a CR not followed by LF is dropped (stray_cr).
  function readUnquoted(init, initAdded) {
    fValue = init;
    fAdded = initAdded;
    let p = pos;
    for (;;) {
      const c = text.indexOf(',', p);
      const nl = text.indexOf('\n', p);
      let end;
      let isComma;
      if (c !== -1 && (nl === -1 || c < nl)) {
        end = c;
        isComma = true;
      } else if (nl !== -1) {
        end = nl;
        isComma = false;
      } else {
        end = n;
        isComma = false;
      }
      const cr = firstCrAtOrAfter(p);
      if (cr === -1 || cr >= end) {
        if (p < end) {
          fValue += text.slice(p, end);
          fAdded += end - p;
        }
        if (end === n) {
          pos = n;
          fEnded = END;
          return;
        }
        if (isComma) {
          pos = end + 1;
          fEnded = COMMA;
          return;
        }
        pos = end + 1;
        line += 1;
        fEnded = LINE_BREAK;
        return;
      }
      if (!isComma && end < n && cr === end - 1) {
        // CRLF: the only CR sits right before the LF.
        if (p < end - 1) {
          fValue += text.slice(p, end - 1);
          fAdded += end - 1 - p;
        }
        pos = end + 1;
        line += 1;
        fEnded = LINE_BREAK;
        return;
      }
      // A stray CR inside the field: keep what precedes it, drop it, go on.
      if (p < cr) {
        fValue += text.slice(p, cr);
        fAdded += cr - p;
      }
      error('stray_cr');
      p = cr + 1;
    }
  }

  // The quoted content [a, b) as a value: CRLF and lone CR each read as LF,
  // and every line break inside counted.
  function quotedSegment(a, b) {
    if (a >= b) return '';
    const cr = firstCrAtOrAfter(a);
    const hasCr = cr !== -1 && cr < b;
    const lf = text.indexOf('\n', a);
    const hasLf = lf !== -1 && lf < b;
    if (!hasCr && !hasLf) return text.slice(a, b);
    if (!hasCr) {
      let count = 0;
      let p = lf;
      while (p !== -1 && p < b) {
        count += 1;
        p = text.indexOf('\n', p + 1);
      }
      line += count;
      return text.slice(a, b);
    }
    const seg = text.slice(a, b);
    const breaks = seg.match(/\r\n|\r|\n/g);
    if (breaks) line += breaks.length;
    return seg.replace(/\r\n?/g, '\n');
  }

  // Reads a quoted field whose opening quote is at pos.
  function readQuoted() {
    const open = pos;
    const openLine = line;
    pos += 1;
    let value = '';
    let segStart = pos;
    for (;;) {
      const q = text.indexOf('"', pos);
      if (q === -1) {
        // The quote never closes: it is a literal character, and the text
        // after it is read again as unquoted.
        pos = open + 1;
        line = openLine;
        nextCr = text.indexOf('\r', open + 1);
        error('unterminated_quote');
        readUnquoted('"', 0);
        return;
      }
      if (text.charCodeAt(q + 1) === 34) {
        value += quotedSegment(segStart, q);
        value += '"';
        pos = q + 2;
        segStart = pos;
        continue;
      }
      value += quotedSegment(segStart, q);
      pos = q + 1;
      break;
    }
    lineEndValid = false;
    if (pos >= n) {
      fValue = value;
      fEnded = END;
      return;
    }
    const c = text.charCodeAt(pos);
    if (c === 44) {
      pos += 1;
      fValue = value;
      fEnded = COMMA;
      return;
    }
    if (c === 10) {
      pos += 1;
      line += 1;
      fValue = value;
      fEnded = LINE_BREAK;
      return;
    }
    if (c === 13 && text.charCodeAt(pos + 1) === 10) {
      pos += 2;
      line += 1;
      fValue = value;
      fEnded = LINE_BREAK;
      return;
    }
    // What follows the closing quote is appended as it stands, up to the next
    // comma or line break.
    readUnquoted(value, 0);
    if (fAdded > 0) error('quote_junk');
    lineEndValid = false;
  }

  for (;;) {
    // Lines with no characters are no records.
    while (pos < n) {
      if (text.charCodeAt(pos) === 10) {
        pos += 1;
        line += 1;
      } else if (text.charCodeAt(pos) === 13 && text.charCodeAt(pos + 1) === 10) {
        pos += 2;
        line += 1;
      } else {
        break;
      }
    }
    if (pos >= n) break;

    recordLine = line;
    recordRow = header && columns === null ? null : rows.length;
    lineEnd = text.indexOf('\n', pos);
    if (lineEnd === -1) lineEnd = n;
    lineEndValid = true;
    const fields = [];
    let lastQuoted = false;
    do {
      if (text.charCodeAt(pos) === 34) {
        lastQuoted = true;
        readQuoted();
      } else {
        lastQuoted = false;
        readUnquoted('', 0);
      }
      fields.push(fValue);
    } while (fEnded === COMMA);

    // A line that held only stray CRs is left with no characters: no record
    // (its stray_cr errors stay).
    if (fields.length === 1 && fields[0] === '' && !lastQuoted) continue;

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
