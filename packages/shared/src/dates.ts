import type { BillingPeriod } from './constants';

/**
 * Calendar dates travel as ISO strings ("2026-10-31") and are computed in UTC,
 * so a server in one timezone and a browser in another always agree.
 */

export type IsoDate = string;

export function parseIsoDate(value: IsoDate): Date {
  const [y, m, d] = value.split('-').map(Number);
  return new Date(Date.UTC(y ?? 1970, (m ?? 1) - 1, d ?? 1));
}

export function toIsoDate(date: Date): IsoDate {
  return date.toISOString().slice(0, 10);
}

export function todayIso(): IsoDate {
  return toIsoDate(new Date());
}

export function addDays(value: IsoDate, days: number): IsoDate {
  const date = parseIsoDate(value);
  date.setUTCDate(date.getUTCDate() + days);
  return toIsoDate(date);
}

/** Adds months, clamping to the last day (31 Jan + 1 month = 28/29 Feb). */
export function addMonths(value: IsoDate, months: number): IsoDate {
  const date = parseIsoDate(value);
  const day = date.getUTCDate();
  date.setUTCDate(1);
  date.setUTCMonth(date.getUTCMonth() + months);
  const lastDay = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).getUTCDate();
  date.setUTCDate(Math.min(day, lastDay));
  return toIsoDate(date);
}

/** Start of the next billing period. */
export function addPeriod(value: IsoDate, period: BillingPeriod, interval = 1): IsoDate {
  switch (period) {
    case 'daily':
      return addDays(value, interval);
    case 'weekly':
      return addDays(value, 7 * interval);
    case 'monthly':
      return addMonths(value, interval);
    case 'yearly':
      return addMonths(value, 12 * interval);
  }
}

/** Factor that converts one period's amount to a monthly amount (for MRR). */
export const MONTHLY_FACTOR: Record<BillingPeriod, number> = {
  daily: 30,
  weekly: 52 / 12,
  monthly: 1,
  yearly: 1 / 12,
};

export function isBefore(a: IsoDate, b: IsoDate): boolean {
  return a < b;
}
