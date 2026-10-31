import { percentOf, type Paise } from './money';
import type { IsoDate } from './dates';

/**
 * Part-period pricing for a mid-period change. Pure, so the portal preview,
 * the API and the tests all use the same numbers.
 *
 * Lines are matched by `key` (the plan line, or product + variant). Anything
 * added is charged for the days left in the current period at the new line's
 * price; anything removed is credited at the price the customer was paying.
 */

export interface ProrationLine {
  key: string;
  description: string;
  productId: number | null;
  quantity: number;
  unitPrice: Paise;
  taxRateBp: number;
  hsnSac?: string | null;
}

export interface ProratedLine {
  key: string;
  description: string;
  productId: number | null;
  /** Units added or removed, always positive. */
  quantity: number;
  /** Price per unit for the days left. */
  unitPrice: Paise;
  taxRateBp: number;
  hsnSac: string | null;
  amount: Paise;
  tax: Paise;
  total: Paise;
}

export interface ProrationResult {
  daysLeft: number;
  daysInPeriod: number;
  charges: ProratedLine[];
  credits: ProratedLine[];
  chargeTotal: Paise;
  creditTotal: Paise;
}

const DAY = 86_400_000;
const dayDiff = (from: IsoDate, to: IsoDate) =>
  Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY);

export function prorate(input: {
  periodStart: IsoDate;
  periodEnd: IsoDate;
  changeDate: IsoDate;
  before: ProrationLine[];
  after: ProrationLine[];
}): ProrationResult {
  const daysInPeriod = dayDiff(input.periodStart, input.periodEnd) + 1;
  const daysLeft = Math.min(
    daysInPeriod,
    Math.max(0, dayDiff(input.changeDate, input.periodEnd) + 1),
  );
  const before = new Map(input.before.map((l) => [l.key, l]));
  const after = new Map(input.after.map((l) => [l.key, l]));
  const keys = [...new Set([...before.keys(), ...after.keys()])];

  const charges: ProratedLine[] = [];
  const credits: ProratedLine[] = [];

  for (const key of keys) {
    const was = before.get(key);
    const now = after.get(key);
    const delta = (now?.quantity ?? 0) - (was?.quantity ?? 0);
    if (delta === 0 || daysLeft === 0) continue;

    // Additions at the new price, removals at what was being paid.
    const source = (delta > 0 ? now : was)!;
    const unitPrice = Math.round((source.unitPrice * daysLeft) / daysInPeriod);
    const quantity = Math.abs(delta);
    const amount = unitPrice * quantity;
    const tax = percentOf(amount, source.taxRateBp);
    const line: ProratedLine = {
      key,
      description: describe(
        source.description,
        was?.quantity ?? 0,
        now?.quantity ?? 0,
        daysLeft,
        daysInPeriod,
      ),
      productId: source.productId,
      quantity,
      unitPrice,
      taxRateBp: source.taxRateBp,
      hsnSac: source.hsnSac ?? null,
      amount,
      tax,
      total: amount + tax,
    };
    (delta > 0 ? charges : credits).push(line);
  }

  const total = (lines: ProratedLine[]) => lines.reduce((s, l) => s + l.total, 0);
  return {
    daysLeft,
    daysInPeriod,
    charges,
    credits,
    chargeTotal: total(charges),
    creditTotal: total(credits),
  };
}

function describe(name: string, from: number, to: number, daysLeft: number, days: number): string {
  const what =
    from === 0 ? `${name} added` : to === 0 ? `${name} removed` : `${name}, ${from} to ${to}`;
  return `${what} (${daysLeft} of ${days} days)`;
}
