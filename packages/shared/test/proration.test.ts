import { describe, expect, it } from 'vitest';
import { prorate, type ProrationLine } from '../src/proration';

const plan = (quantity: number): ProrationLine => ({
  key: 'plan',
  description: 'Growth Monthly',
  productId: null,
  quantity,
  unitPrice: 1000_00,
  taxRateBp: 1800,
});
const addon = (quantity: number): ProrationLine => ({
  key: 'p:7',
  description: 'Analytics',
  productId: 7,
  quantity,
  unitPrice: 300_00,
  taxRateBp: 1800,
});
const period = { periodStart: '2026-11-01', periodEnd: '2026-11-30' };

describe('prorate', () => {
  it('charges added seats for the days left, with tax', () => {
    const r = prorate({ ...period, changeDate: '2026-11-16', before: [plan(5)], after: [plan(8)] });
    expect(r.daysLeft).toBe(15);
    expect(r.daysInPeriod).toBe(30);
    expect(r.charges).toHaveLength(1);
    expect(r.charges[0]).toMatchObject({
      quantity: 3,
      unitPrice: 500_00,
      amount: 1500_00,
      tax: 270_00,
    });
    expect(r.chargeTotal).toBe(1770_00);
    expect(r.credits).toHaveLength(0);
  });

  it('credits a removed add-on at the price that was paid', () => {
    const r = prorate({
      ...period,
      changeDate: '2026-11-21',
      before: [plan(5), addon(1)],
      after: [plan(5)],
    });
    expect(r.daysLeft).toBe(10);
    expect(r.credits[0]).toMatchObject({
      quantity: 1,
      unitPrice: 100_00,
      amount: 100_00,
      tax: 18_00,
    });
    expect(r.credits[0]!.description).toBe('Analytics removed (10 of 30 days)');
    expect(r.creditTotal).toBe(118_00);
  });

  it('charges and credits in the same change when lines move both ways', () => {
    const r = prorate({
      ...period,
      changeDate: '2026-11-01',
      before: [plan(5), addon(2)],
      after: [plan(6)],
    });
    expect(r.daysLeft).toBe(30);
    expect(r.chargeTotal).toBe(1180_00);
    expect(r.creditTotal).toBe(708_00);
  });

  it('nothing to settle on the last day after the period, or when nothing changed', () => {
    expect(
      prorate({ ...period, changeDate: '2026-12-01', before: [plan(5)], after: [plan(9)] })
        .chargeTotal,
    ).toBe(0);
    expect(
      prorate({ ...period, changeDate: '2026-11-10', before: [plan(5)], after: [plan(5)] }).charges,
    ).toHaveLength(0);
  });
});
