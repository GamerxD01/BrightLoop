import { describe, expect, it } from 'vitest';
import {
  findInvoiceNumbers,
  parseBankAmount,
  parseBankDate,
  parseBankStatement,
  parseCsv,
} from '../src/bank';

describe('parseCsv', () => {
  it('handles quotes, escaped quotes, CRLF and a BOM', () => {
    expect(parseCsv('﻿a,"b, c","say ""hi"""\r\n1,2,3\r\n')).toEqual([
      ['a', 'b, c', 'say "hi"'],
      ['1', '2', '3'],
    ]);
  });
});

describe('dates and amounts', () => {
  it('reads Indian bank date formats, day first', () => {
    expect(parseBankDate('31/10/2026')).toBe('2026-10-31');
    expect(parseBankDate('05-11-26')).toBe('2026-11-05');
    expect(parseBankDate('2026-10-31')).toBe('2026-10-31');
    expect(parseBankDate('31 Oct 2026')).toBe('2026-10-31');
    expect(parseBankDate('31-Oct-2026')).toBe('2026-10-31');
    expect(parseBankDate('31/02/2026')).toBeNull();
    expect(parseBankDate('Closing balance')).toBeNull();
  });
  it('reads Indian digit grouping and markers', () => {
    expect(parseBankAmount('1,23,456.78')).toBe(12345678);
    expect(parseBankAmount('₹ 500')).toBe(50000);
    expect(parseBankAmount('250.00 CR')).toBe(25000);
    expect(parseBankAmount('(99.50)')).toBe(-9950);
    expect(parseBankAmount('')).toBeNull();
  });
});

describe('parseBankStatement', () => {
  it('reads an HDFC-style statement with account details above the table', () => {
    const csv = [
      'Account Statement,,,,,,',
      'Account No,50100123456789,,,,,',
      'Date,Narration,Chq./Ref.No.,Value Dt,Withdrawal Amt.,Deposit Amt.,Closing Balance',
      '31/10/26,UPI-IYER TEXTILES-INV/2026/00012,UTR123,31/10/26,,"8,912.95","1,00,000.00"',
      '30/10/26,RENT OCT,000045,30/10/26,"25,000.00",,"91,087.05"',
      ',Closing balance,,,,,91087.05',
    ].join('\n');
    const r = parseBankStatement(csv);
    expect(r.errors).toEqual([]);
    expect(r.rows).toEqual([
      {
        lineNo: 4,
        date: '2026-10-31',
        description: 'UPI-IYER TEXTILES-INV/2026/00012',
        reference: 'UTR123',
        amount: 891295,
        direction: 'in',
      },
      {
        lineNo: 5,
        date: '2026-10-30',
        description: 'RENT OCT',
        reference: '000045',
        amount: 2500000,
        direction: 'out',
      },
    ]);
    expect(r.columns.credit).toBe('Deposit Amt.');
  });

  it('reads a single amount column with a CR/DR type', () => {
    const r = parseBankStatement(
      'Transaction Date,Particulars,Amount,Cr/Dr\n2026-10-01,NEFT ACME,1500.00,CR\n2026-10-02,FEES,20,DR\n',
    );
    expect(r.rows.map((x) => [x.amount, x.direction])).toEqual([
      [150000, 'in'],
      [2000, 'out'],
    ]);
  });

  it('explains a file it cannot read', () => {
    expect(() => parseBankStatement('foo,bar\n1,2')).toThrow(/column headings/);
  });
});

describe('findInvoiceNumbers', () => {
  it('finds invoice numbers however they were typed', () => {
    expect(findInvoiceNumbers('NEFT INV-2026-12 and inv2026 00034 / INV/2026/00012')).toEqual([
      'INV/2026/00012',
      'INV/2026/00034',
    ]);
    expect(findInvoiceNumbers('no invoice here 2026')).toEqual([]);
  });
});
