/**
 * Bank statement CSV reading, written from scratch: no CSV library.
 * Handles quoted fields, CRLF, a UTF-8 BOM, Indian digit grouping (1,23,456.78),
 * the column names Indian banks use, and the usual date formats.
 */

export interface BankRow {
  lineNo: number;
  date: string;
  description: string;
  reference: string | null;
  /** Paise, always positive. */
  amount: number;
  direction: 'in' | 'out';
}

export interface BankParseResult {
  rows: BankRow[];
  errors: { lineNo: number; message: string }[];
  columns: {
    date: string;
    description: string;
    reference: string | null;
    credit: string;
    debit: string | null;
  };
}

/** RFC 4180-style split into records and fields. */
export function parseCsv(text: string): string[][] {
  const src = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const records: string[][] = [];
  let field = '';
  let record: string[] = [];
  let quoted = false;

  for (let i = 0; i < src.length; i++) {
    const ch = src[i]!;
    if (quoted) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else field += ch;
      continue;
    }
    if (ch === '"') quoted = true;
    else if (ch === ',') {
      record.push(field);
      field = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && src[i + 1] === '\n') i++;
      record.push(field);
      records.push(record);
      record = [];
      field = '';
    } else field += ch;
  }
  if (field !== '' || record.length) {
    record.push(field);
    records.push(record);
  }
  return records.filter((r) => r.some((f) => f.trim() !== ''));
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z]/g, '');

const ALIASES = {
  date: ['date', 'txndate', 'transactiondate', 'valuedate', 'valuedt', 'postingdate', 'trandate'],
  description: [
    'description',
    'narration',
    'particulars',
    'remarks',
    'details',
    'transactiondetails',
    'transactionremarks',
  ],
  reference: [
    'reference',
    'refno',
    'chqrefno',
    'refnochequeno',
    'chequeno',
    'utr',
    'utrno',
    'chqno',
    'referenceno',
    'transactionid',
  ],
  credit: [
    'credit',
    'deposit',
    'depositamt',
    'creditamount',
    'cramount',
    'deposits',
    'amountin',
    'credits',
  ],
  debit: [
    'debit',
    'withdrawal',
    'withdrawalamt',
    'debitamount',
    'dramount',
    'withdrawals',
    'amountout',
    'debits',
  ],
  amount: ['amount', 'transactionamount', 'amt'],
  type: ['type', 'crdr', 'drcr', 'transactiontype'],
};

function findColumn(headers: string[], names: string[]): number {
  const n = headers.map(norm);
  for (const name of names) {
    const i = n.indexOf(name);
    if (i >= 0) return i;
  }
  return -1;
}

const MONTHS: Record<string, number> = {
  jan: 1,
  feb: 2,
  mar: 3,
  apr: 4,
  may: 5,
  jun: 6,
  jul: 7,
  aug: 8,
  sep: 9,
  sept: 9,
  oct: 10,
  nov: 11,
  dec: 12,
};

/** 31/10/2026, 31-10-26, 2026-10-31, 31 Oct 2026, 31-Oct-2026 → 2026-10-31. Day first, as Indian banks print. */
export function parseBankDate(value: string): string | null {
  const v = value.trim();
  let y: number, m: number, d: number;
  let match = v.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (match) [y, m, d] = [Number(match[1]), Number(match[2]), Number(match[3])];
  else if ((match = v.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})$/))) {
    [d, m, y] = [Number(match[1]), Number(match[2]), Number(match[3])];
    if (y < 100) y += 2000;
  } else if ((match = v.match(/^(\d{1,2})[\s-]([A-Za-z]{3,4})[a-z]*[\s-,]+(\d{2,4})$/))) {
    d = Number(match[1]);
    m = MONTHS[match[2]!.toLowerCase()] ?? 0;
    y = Number(match[3]);
    if (y < 100) y += 2000;
  } else return null;
  if (!m || m > 12 || !d || d > 31) return null;
  const iso = `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  const check = new Date(`${iso}T00:00:00Z`);
  return check.getUTCDate() === d ? iso : null;
}

/** "1,23,456.78", "₹ 500", "500.00 CR", "(250.00)" → paise, or null when empty. */
export function parseBankAmount(value: string): number | null {
  const v = value.replace(/[₹,\s]|INR|Rs\.?/gi, '').replace(/(CR|DR)$/i, '');
  if (v === '' || v === '-') return null;
  const negative = /^\(.*\)$/.test(v) || v.startsWith('-');
  const n = Number(v.replace(/[()]/g, '').replace(/^-/, ''));
  if (!Number.isFinite(n)) return Number.NaN;
  return Math.round(n * 100) * (negative ? -1 : 1);
}

export function parseBankStatement(text: string): BankParseResult {
  const records = parseCsv(text);
  // Some banks print account details above the table: the header is the first row with a date and an amount column.
  const headerAt = records.findIndex(
    (r) =>
      findColumn(r, ALIASES.date) >= 0 &&
      (findColumn(r, ALIASES.credit) >= 0 || findColumn(r, ALIASES.amount) >= 0),
  );
  if (headerAt < 0) {
    throw new Error(
      'Could not find the column headings. The file needs a date column and a credit or amount column.',
    );
  }
  const headers = records[headerAt]!;
  const col = {
    date: findColumn(headers, ALIASES.date),
    description: findColumn(headers, ALIASES.description),
    reference: findColumn(headers, ALIASES.reference),
    credit: findColumn(headers, ALIASES.credit),
    debit: findColumn(headers, ALIASES.debit),
    amount: findColumn(headers, ALIASES.amount),
    type: findColumn(headers, ALIASES.type),
  };

  const rows: BankRow[] = [];
  const errors: BankParseResult['errors'] = [];
  records.slice(headerAt + 1).forEach((r, i) => {
    const lineNo = headerAt + i + 2;
    const cell = (c: number) => (c >= 0 ? (r[c] ?? '').trim() : '');
    const date = parseBankDate(cell(col.date));
    if (!date) {
      // Footer lines ("Closing balance", totals) have no date: skip them quietly.
      if (cell(col.date) && /\d/.test(cell(col.date)))
        errors.push({ lineNo, message: `Unreadable date "${cell(col.date)}"` });
      return;
    }

    let amount: number | null = null;
    let direction: 'in' | 'out' = 'in';
    if (col.credit >= 0) {
      const credit = parseBankAmount(cell(col.credit));
      const debit = col.debit >= 0 ? parseBankAmount(cell(col.debit)) : null;
      if (credit && credit > 0) amount = credit;
      else if (debit && debit !== 0) {
        amount = Math.abs(debit);
        direction = 'out';
      }
    } else {
      const raw = cell(col.amount);
      const value = parseBankAmount(raw);
      const type = cell(col.type).toUpperCase();
      if (value !== null && Number.isFinite(value)) {
        direction = type.startsWith('D') || /DR$/i.test(raw) || value < 0 ? 'out' : 'in';
        amount = Math.abs(value);
      }
    }
    if (amount === null || Number.isNaN(amount) || amount === 0) {
      errors.push({ lineNo, message: 'No amount on this line' });
      return;
    }
    rows.push({
      lineNo,
      date,
      description: cell(col.description) || '(no description)',
      reference: cell(col.reference) || null,
      amount,
      direction,
    });
  });

  return {
    rows,
    errors,
    columns: {
      date: headers[col.date] ?? '',
      description: headers[col.description] ?? '',
      reference: col.reference >= 0 ? headers[col.reference]! : null,
      credit: headers[col.credit >= 0 ? col.credit : col.amount] ?? '',
      debit: col.debit >= 0 ? headers[col.debit]! : null,
    },
  };
}

/** Finds invoice numbers written any common way: INV/2026/00012, INV-2026-12, INV2026 00012, inv 2026/12. */
export function findInvoiceNumbers(text: string): string[] {
  const out = new Set<string>();
  for (const m of text.matchAll(/INV[\s/_-]*(\d{4})[\s/_-]*(\d{1,6})(?!\d)/gi)) {
    out.add(`INV/${m[1]}/${m[2]!.padStart(5, '0')}`);
  }
  return [...out];
}
