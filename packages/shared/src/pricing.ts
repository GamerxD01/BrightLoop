import { allocate, percentOf, type Paise } from './money';
import type { DiscountScope, DiscountType } from './constants';
import type { IsoDate } from './dates';

/**
 * The pricing engine: pure functions, no I/O.
 * The web app runs it for the live preview; the API runs the same code when
 * it saves a subscription and when it generates an invoice, and the API's
 * result is the one that is stored.
 */

export interface PricingLine {
  key: string;
  productId: number | null;
  quantity: number;
  unitPrice: Paise;
  taxRateBp: number;
}

export interface DiscountRule {
  id: number;
  name: string;
  type: DiscountType;
  /** Paise for a fixed discount, basis points for a percentage. */
  value: number;
  scope: DiscountScope;
  productIds: number[];
  minAmount: Paise;
  minQuantity: number;
  startDate: IsoDate;
  endDate: IsoDate | null;
  usageLimit: number | null;
  timesUsed: number;
  isActive: boolean;
}

export interface PricedLine extends PricingLine {
  subtotal: Paise;
  discount: Paise;
  tax: Paise;
  total: Paise;
}

export interface AppliedDiscount {
  discountId: number;
  name: string;
  amount: Paise;
}

export interface SkippedDiscount {
  discountId: number;
  name: string;
  reason: string;
}

export interface PricingResult {
  lines: PricedLine[];
  untaxed: Paise;
  discount: Paise;
  tax: Paise;
  total: Paise;
  applied: AppliedDiscount[];
  skipped: SkippedDiscount[];
}

/** Why a discount cannot be used on `onDate`, or null when it can. */
export function discountUnavailableReason(rule: DiscountRule, onDate: IsoDate): string | null {
  if (!rule.isActive) return 'Discount is archived';
  if (onDate < rule.startDate) return `Starts on ${rule.startDate}`;
  if (rule.endDate && onDate > rule.endDate) return `Expired on ${rule.endDate}`;
  if (rule.usageLimit !== null && rule.timesUsed >= rule.usageLimit) return 'Usage limit reached';
  return null;
}

function lineSubtotal(line: PricingLine): Paise {
  return line.unitPrice * line.quantity;
}

/**
 * Prices lines, applies every eligible discount in order, then taxes the
 * discounted amount. A line's discount can never exceed its subtotal.
 */
export function priceLines(
  input: PricingLine[],
  rules: DiscountRule[] = [],
  onDate: IsoDate = new Date().toISOString().slice(0, 10),
): PricingResult {
  const discounts = new Map<string, Paise>(input.map((l) => [l.key, 0]));
  const applied: AppliedDiscount[] = [];
  const skipped: SkippedDiscount[] = [];

  for (const rule of rules) {
    const unavailable = discountUnavailableReason(rule, onDate);
    if (unavailable) {
      skipped.push({ discountId: rule.id, name: rule.name, reason: unavailable });
      continue;
    }

    const eligible = input.filter(
      (l) =>
        rule.scope === 'subscription' ||
        (l.productId !== null && rule.productIds.includes(l.productId)),
    );
    const eligibleAmount = eligible.reduce((sum, l) => sum + lineSubtotal(l), 0);
    const eligibleQty = eligible.reduce((sum, l) => sum + l.quantity, 0);

    if (eligible.length === 0) {
      skipped.push({ discountId: rule.id, name: rule.name, reason: 'No matching products' });
      continue;
    }
    if (eligibleAmount < rule.minAmount) {
      skipped.push({ discountId: rule.id, name: rule.name, reason: 'Below minimum purchase' });
      continue;
    }
    if (eligibleQty < rule.minQuantity) {
      skipped.push({ discountId: rule.id, name: rule.name, reason: 'Below minimum quantity' });
      continue;
    }

    // Room left on each line after earlier discounts.
    const headroom = eligible.map((l) => lineSubtotal(l) - (discounts.get(l.key) ?? 0));
    const shares =
      rule.type === 'percentage'
        ? eligible.map((l) => percentOf(lineSubtotal(l), rule.value))
        : allocate(
            Math.min(
              rule.value,
              headroom.reduce((a, b) => a + b, 0),
            ),
            eligible.map(lineSubtotal),
          );

    let total = 0;
    eligible.forEach((line, i) => {
      const share = Math.min(shares[i] ?? 0, headroom[i] ?? 0);
      discounts.set(line.key, (discounts.get(line.key) ?? 0) + share);
      total += share;
    });
    if (total > 0) applied.push({ discountId: rule.id, name: rule.name, amount: total });
  }

  const lines: PricedLine[] = input.map((line) => {
    const subtotal = lineSubtotal(line);
    const discount = discounts.get(line.key) ?? 0;
    const tax = percentOf(subtotal - discount, line.taxRateBp);
    return { ...line, subtotal, discount, tax, total: subtotal - discount + tax };
  });

  const sum = (pick: (l: PricedLine) => number) => lines.reduce((acc, l) => acc + pick(l), 0);
  return {
    lines,
    untaxed: sum((l) => l.subtotal),
    discount: sum((l) => l.discount),
    tax: sum((l) => l.tax),
    total: sum((l) => l.total),
    applied,
    skipped,
  };
}
