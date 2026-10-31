import { describe, expect, it } from 'vitest';
import { priceLines, type DiscountRule, type PricingLine } from '../src/pricing';

const lines: PricingLine[] = [
  { key: 'plan', productId: null, quantity: 5, unitPrice: 100_00, taxRateBp: 1800 },
  { key: 'addon', productId: 7, quantity: 2, unitPrice: 250_00, taxRateBp: 1800 },
];

const rule = (over: Partial<DiscountRule>): DiscountRule => ({
  id: 1,
  name: 'Bulk',
  type: 'percentage',
  value: 1000,
  scope: 'subscription',
  productIds: [],
  minAmount: 0,
  minQuantity: 0,
  startDate: '2026-01-01',
  endDate: null,
  usageLimit: null,
  timesUsed: 0,
  isActive: true,
  ...over,
});

describe('priceLines', () => {
  it('prices and taxes lines without discounts', () => {
    const r = priceLines(lines, [], '2026-10-31');
    expect(r.untaxed).toBe(1000_00);
    expect(r.tax).toBe(180_00);
    expect(r.total).toBe(1180_00);
  });

  it('applies a percentage discount before tax', () => {
    const r = priceLines(lines, [rule({})], '2026-10-31');
    expect(r.discount).toBe(100_00);
    expect(r.tax).toBe(162_00);
    expect(r.total).toBe(1062_00);
    expect(r.applied).toEqual([{ discountId: 1, name: 'Bulk', amount: 100_00 }]);
  });

  it('spreads a fixed discount so parts add up exactly', () => {
    const r = priceLines(lines, [rule({ type: 'fixed', value: 333 })], '2026-10-31');
    expect(r.lines.reduce((s, l) => s + l.discount, 0)).toBe(333);
  });

  it('limits a product discount to matching products', () => {
    const r = priceLines(lines, [rule({ scope: 'products', productIds: [7] })], '2026-10-31');
    expect(r.lines[0]?.discount).toBe(0);
    expect(r.lines[1]?.discount).toBe(50_00);
  });

  it('never discounts more than the line is worth', () => {
    const r = priceLines(lines, [rule({ type: 'fixed', value: 5000_00 })], '2026-10-31');
    expect(r.discount).toBe(1000_00);
    expect(r.tax).toBe(0);
  });

  it('skips expired, used-up and below-minimum discounts with a reason', () => {
    const r = priceLines(
      lines,
      [
        rule({ id: 2, endDate: '2026-10-01' }),
        rule({ id: 3, usageLimit: 3, timesUsed: 3 }),
        rule({ id: 4, minQuantity: 50 }),
        rule({ id: 5, minAmount: 5000_00 }),
      ],
      '2026-10-31',
    );
    expect(r.discount).toBe(0);
    expect(r.skipped.map((s) => s.reason)).toEqual([
      'Expired on 2026-10-01',
      'Usage limit reached',
      'Below minimum quantity',
      'Below minimum purchase',
    ]);
  });
});
