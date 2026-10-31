/**
 * Money is stored and computed as integer minor units (paise) everywhere.
 * Floats never touch an amount; conversion happens only at the UI edge.
 */

export type Paise = number;

/** Rupees as typed by a person ("1,299.50") to paise. Returns NaN on garbage. */
export function toPaise(rupees: number | string): Paise {
  const value = typeof rupees === 'string' ? Number(rupees.replace(/,/g, '').trim()) : rupees;
  if (!Number.isFinite(value)) return Number.NaN;
  return Math.round(value * 100);
}

export function toRupees(paise: Paise): number {
  return paise / 100;
}

const inr = new Intl.NumberFormat('en-IN', {
  style: 'currency',
  currency: 'INR',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

export function formatMoney(paise: Paise): string {
  return inr.format(paise / 100);
}

/** Percentages are stored as basis points: 18% = 1800. */
export function percentOf(amount: Paise, basisPoints: number): Paise {
  return Math.round((amount * basisPoints) / 10_000);
}

export function formatPercent(basisPoints: number): string {
  const value = basisPoints / 100;
  return `${Number.isInteger(value) ? value : value.toFixed(2)}%`;
}

/**
 * Split `total` across `weights` so the parts always add up exactly to `total`
 * (largest-remainder method). Used to spread a fixed discount over lines.
 */
export function allocate(total: Paise, weights: number[]): Paise[] {
  const sum = weights.reduce((a, b) => a + b, 0);
  if (sum <= 0 || total <= 0) return weights.map(() => 0);
  const raw = weights.map((w) => (total * w) / sum);
  const parts = raw.map(Math.floor);
  let remainder = total - parts.reduce((a, b) => a + b, 0);
  const order = raw
    .map((value, index) => ({ index, frac: value - Math.floor(value) }))
    .sort((a, b) => b.frac - a.frac);
  for (const { index } of order) {
    if (remainder <= 0) break;
    parts[index] = (parts[index] ?? 0) + 1;
    remainder -= 1;
  }
  return parts;
}
