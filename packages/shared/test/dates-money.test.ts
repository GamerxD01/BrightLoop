import { describe, expect, it } from 'vitest';
import { addPeriod } from '../src/dates';
import { allocate, toPaise } from '../src/money';

describe('addPeriod', () => {
  it('clamps month ends', () => {
    expect(addPeriod('2026-01-31', 'monthly')).toBe('2026-02-28');
    expect(addPeriod('2028-01-31', 'monthly')).toBe('2028-02-29');
  });
  it('handles every period', () => {
    expect(addPeriod('2026-10-31', 'daily')).toBe('2026-11-01');
    expect(addPeriod('2026-10-31', 'weekly')).toBe('2026-11-07');
    expect(addPeriod('2026-10-31', 'yearly')).toBe('2027-10-31');
    expect(addPeriod('2026-10-31', 'monthly', 3)).toBe('2027-01-31');
  });
});

describe('money', () => {
  it('converts rupees to paise without float drift', () => {
    expect(toPaise('1,299.99')).toBe(129999);
    expect(toPaise(0.1 + 0.2)).toBe(30);
  });
  it('allocates exactly', () => {
    expect(allocate(100, [1, 1, 1])).toEqual([34, 33, 33]);
    expect(allocate(0, [1, 2])).toEqual([0, 0]);
  });
});
