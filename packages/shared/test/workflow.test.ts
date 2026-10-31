import { describe, expect, it } from 'vitest';
import {
  availableSubscriptionActions,
  invoiceActionBlocker,
  subscriptionActionBlocker,
} from '../src/workflow';
import { passwordSchema } from '../src/schemas/auth';

const open = { closable: true, pausable: true, renewable: true };
const locked = { closable: false, pausable: false, renewable: false };

describe('subscription workflow', () => {
  it('follows draft → quotation → confirmed → active → closed', () => {
    expect(availableSubscriptionActions('draft', open)).toEqual(['send_quotation', 'close']);
    expect(availableSubscriptionActions('quotation', open)).toEqual([
      'back_to_draft',
      'confirm',
      'close',
    ]);
    expect(availableSubscriptionActions('confirmed', open)).toEqual(['activate', 'close']);
    expect(availableSubscriptionActions('active', open)).toEqual(['pause', 'close', 'renew']);
  });
  it('respects plan rules', () => {
    expect(subscriptionActionBlocker('pause', 'active', locked)).toBe('This plan cannot be paused');
    expect(subscriptionActionBlocker('close', 'active', locked)).toBe(
      'This plan cannot be closed early',
    );
    expect(subscriptionActionBlocker('close', 'draft', locked)).toBeNull();
    expect(subscriptionActionBlocker('renew', 'active', locked)).toBe(
      'This plan cannot be renewed',
    );
  });
  it('blocks skipping steps', () => {
    expect(subscriptionActionBlocker('activate', 'draft', open)).not.toBeNull();
  });
});

describe('invoice workflow', () => {
  it('refuses to cancel paid or part-paid invoices', () => {
    expect(invoiceActionBlocker('cancel', 'paid', 100)).not.toBeNull();
    expect(invoiceActionBlocker('cancel', 'confirmed', 100)).not.toBeNull();
    expect(invoiceActionBlocker('cancel', 'confirmed', 0)).toBeNull();
  });
});

describe('password policy', () => {
  it('needs >8 chars, upper, lower, special', () => {
    expect(passwordSchema.safeParse('Abcdefg!').success).toBe(false);
    expect(passwordSchema.safeParse('abcdefgh!x').success).toBe(false);
    expect(passwordSchema.safeParse('Abcdefghij').success).toBe(false);
    expect(passwordSchema.safeParse('Abcdefgh!').success).toBe(true);
  });
});
