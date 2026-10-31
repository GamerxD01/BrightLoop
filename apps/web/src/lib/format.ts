import { formatMoney, formatPercent, LABELS, type BillingPeriod } from '@brightloop/shared';

export { formatMoney, formatPercent };

const dateFmt = new Intl.DateTimeFormat('en-IN', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  timeZone: 'UTC',
});
const dateTimeFmt = new Intl.DateTimeFormat('en-IN', {
  day: 'numeric',
  month: 'short',
  hour: 'numeric',
  minute: '2-digit',
});
const monthFmt = new Intl.DateTimeFormat('en-IN', { month: 'short', timeZone: 'UTC' });

/** "2026-10-31" → "31 Oct 2026". Dates are calendar days, so they are read in UTC. */
export function formatDate(iso: string | null | undefined): string {
  if (!iso) return 'Not set';
  return dateFmt.format(new Date(`${iso.slice(0, 10)}T00:00:00Z`));
}

export function formatDateTime(iso: string): string {
  return dateTimeFmt.format(new Date(iso));
}

export function formatMonth(yyyyMm: string): string {
  return monthFmt.format(new Date(`${yyyyMm}-01T00:00:00Z`));
}

export function formatPeriod(period: BillingPeriod, interval = 1): string {
  if (interval === 1) return LABELS.billingPeriod[period];
  const unit = { daily: 'days', weekly: 'weeks', monthly: 'months', yearly: 'years' }[period];
  return `Every ${interval} ${unit}`;
}

/** Compact rupees for headline figures: ₹12.4L, ₹3.2Cr. */
export function formatCompactMoney(paise: number): string {
  const rupees = paise / 100;
  if (Math.abs(rupees) >= 1e7) return `₹${(rupees / 1e7).toFixed(2)}Cr`;
  if (Math.abs(rupees) >= 1e5) return `₹${(rupees / 1e5).toFixed(2)}L`;
  return formatMoney(paise);
}

export function plural(n: number, one: string, many = `${one}s`): string {
  return `${n.toLocaleString('en-IN')} ${n === 1 ? one : many}`;
}
