import { describe, expect, it } from 'vitest';
import { gstMode, isValidGstin, splitGst, withGstinCheckDigit } from '../src/gst';
import { amountInWords } from '../src/words';

describe('GST', () => {
  it('validates the GSTIN check digit', () => {
    expect(isValidGstin('27AAPFU0939F1ZV')).toBe(true);
    expect(isValidGstin('27AAPFU0939F1ZX')).toBe(false);
    expect(isValidGstin(withGstinCheckDigit('09AAKCB1234F1Z'))).toBe(true);
  });
  it('splits intra-state tax in half and keeps every paisa', () => {
    expect(splitGst(1801, 'intra')).toEqual({ cgst: 900, sgst: 901, igst: 0 });
    expect(splitGst(1801, 'inter')).toEqual({ cgst: 0, sgst: 0, igst: 1801 });
  });
  it('chooses IGST only across states', () => {
    expect(gstMode('09', '09')).toBe('intra');
    expect(gstMode('09', '27')).toBe('inter');
    expect(gstMode('09', null)).toBe('intra');
  });
});

describe('amountInWords', () => {
  it('uses lakh and crore', () => {
    expect(amountInWords(12345678_50)).toBe(
      'Rupees One Crore Twenty-Three Lakh Forty-Five Thousand Six Hundred Seventy-Eight and Fifty Paise Only',
    );
    expect(amountInWords(17825_91)).toBe(
      'Rupees Seventeen Thousand Eight Hundred Twenty-Five and Ninety-One Paise Only',
    );
    expect(amountInWords(100)).toBe('Rupees One Only');
  });
});
