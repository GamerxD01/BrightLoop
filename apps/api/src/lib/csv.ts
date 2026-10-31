/**
 * CSV writing for exports. Every cell is quoted, and a cell that a
 * spreadsheet would run as a formula (=, +, -, @, tab, CR) is prefixed with
 * an apostrophe, so a customer named "=HYPERLINK(...)" stays text.
 */
export type Cell = string | number | boolean | null | undefined;

const FORMULA = /^[=+\-@\t\r]/;

export function csvCell(value: Cell): string {
  if (value === null || value === undefined) return '""';
  let text = String(value);
  if (typeof value === 'string' && FORMULA.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
}

export function toCsv(headers: string[], rows: Cell[][]): string {
  // BOM so Excel opens UTF-8 (₹, names) correctly.
  return '﻿' + [headers, ...rows].map((r) => r.map(csvCell).join(',')).join('\r\n') + '\r\n';
}

/** Paise as a plain decimal for spreadsheets: 123456 → "1234.56". */
export const rupees = (paise: number | null | undefined) =>
  paise === null || paise === undefined ? '' : (paise / 100).toFixed(2);
