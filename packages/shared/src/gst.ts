/**
 * Indian GST rules. Tax on a supply inside the seller's own state splits into
 * CGST + SGST (half each); a supply to another state is IGST. The place of
 * supply for a service is the customer's state.
 */

export const INDIAN_STATES = [
  ['01', 'Jammu and Kashmir'],
  ['02', 'Himachal Pradesh'],
  ['03', 'Punjab'],
  ['04', 'Chandigarh'],
  ['05', 'Uttarakhand'],
  ['06', 'Haryana'],
  ['07', 'Delhi'],
  ['08', 'Rajasthan'],
  ['09', 'Uttar Pradesh'],
  ['10', 'Bihar'],
  ['11', 'Sikkim'],
  ['12', 'Arunachal Pradesh'],
  ['13', 'Nagaland'],
  ['14', 'Manipur'],
  ['15', 'Mizoram'],
  ['16', 'Tripura'],
  ['17', 'Meghalaya'],
  ['18', 'Assam'],
  ['19', 'West Bengal'],
  ['20', 'Jharkhand'],
  ['21', 'Odisha'],
  ['22', 'Chhattisgarh'],
  ['23', 'Madhya Pradesh'],
  ['24', 'Gujarat'],
  ['26', 'Dadra and Nagar Haveli and Daman and Diu'],
  ['27', 'Maharashtra'],
  ['29', 'Karnataka'],
  ['30', 'Goa'],
  ['31', 'Lakshadweep'],
  ['32', 'Kerala'],
  ['33', 'Tamil Nadu'],
  ['34', 'Puducherry'],
  ['35', 'Andaman and Nicobar Islands'],
  ['36', 'Telangana'],
  ['37', 'Andhra Pradesh'],
  ['38', 'Ladakh'],
] as const;

export type StateCode = (typeof INDIAN_STATES)[number][0];
export const STATE_CODES = INDIAN_STATES.map(([code]) => code) as unknown as [
  StateCode,
  ...StateCode[],
];

export function stateName(code: string | null | undefined): string | null {
  return INDIAN_STATES.find(([c]) => c === code)?.[1] ?? null;
}

export const GSTIN_PATTERN = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;
const GSTIN_CHARS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';

/**
 * Checks the 15-character GSTIN, including its check digit (the last
 * character, a weighted base-36 sum of the first fourteen).
 */
export function isValidGstin(value: string): boolean {
  if (!GSTIN_PATTERN.test(value)) return false;
  let sum = 0;
  for (let i = 0; i < 14; i++) {
    const product = GSTIN_CHARS.indexOf(value[i]!) * (i % 2 === 0 ? 1 : 2);
    sum += Math.floor(product / 36) + (product % 36);
  }
  return GSTIN_CHARS[(36 - (sum % 36)) % 36] === value[14];
}

/** Appends the correct check digit to 14 characters; used to build valid demo data. */
export function withGstinCheckDigit(first14: string): string {
  let sum = 0;
  for (let i = 0; i < 14; i++) {
    const product = GSTIN_CHARS.indexOf(first14[i]!) * (i % 2 === 0 ? 1 : 2);
    sum += Math.floor(product / 36) + (product % 36);
  }
  return first14 + GSTIN_CHARS[(36 - (sum % 36)) % 36];
}

export type GstMode = 'intra' | 'inter';

/** Missing states default to intra-state: the conservative reading for a local seller. */
export function gstMode(
  sellerState: string | null | undefined,
  placeOfSupply: string | null | undefined,
): GstMode {
  if (!sellerState || !placeOfSupply) return 'intra';
  return sellerState === placeOfSupply ? 'intra' : 'inter';
}

/** Splits a tax amount so the parts always add back to it exactly. */
export function splitGst(tax: number, mode: GstMode): { cgst: number; sgst: number; igst: number } {
  if (mode === 'inter') return { cgst: 0, sgst: 0, igst: tax };
  const cgst = Math.floor(tax / 2);
  return { cgst, sgst: tax - cgst, igst: 0 };
}
