import type { InvoiceStatus, SubscriptionStatus } from './constants';

/**
 * Lifecycle rules as data. The API refuses any transition not listed here,
 * and the web app uses the same table to decide which buttons to show.
 */

export const SUBSCRIPTION_ACTIONS = [
  'send_quotation',
  'back_to_draft',
  'confirm',
  'activate',
  'pause',
  'resume',
  'close',
  'renew',
] as const;
export type SubscriptionAction = (typeof SUBSCRIPTION_ACTIONS)[number];

interface Transition<S> {
  from: readonly S[];
  to: S;
  label: string;
}

export const SUBSCRIPTION_TRANSITIONS: Record<
  Exclude<SubscriptionAction, 'renew'>,
  Transition<SubscriptionStatus>
> = {
  send_quotation: { from: ['draft'], to: 'quotation', label: 'Send quotation' },
  back_to_draft: { from: ['quotation'], to: 'draft', label: 'Back to draft' },
  confirm: { from: ['quotation'], to: 'confirmed', label: 'Confirm' },
  activate: { from: ['confirmed'], to: 'active', label: 'Start subscription' },
  pause: { from: ['active'], to: 'paused', label: 'Pause' },
  resume: { from: ['paused'], to: 'active', label: 'Resume' },
  close: {
    from: ['draft', 'quotation', 'confirmed', 'active', 'paused'],
    to: 'closed',
    label: 'Close',
  },
};

export interface PlanRules {
  closable: boolean;
  pausable: boolean;
  renewable: boolean;
}

/**
 * Whether `action` may run on a subscription in `status` under `plan`.
 * Returns a reason string when it may not.
 */
export function subscriptionActionBlocker(
  action: SubscriptionAction,
  status: SubscriptionStatus,
  plan: PlanRules,
): string | null {
  if (action === 'renew') {
    if (!plan.renewable) return 'This plan cannot be renewed';
    return status === 'active' || status === 'closed'
      ? null
      : 'Only active or closed subscriptions can be renewed';
  }
  const rule = SUBSCRIPTION_TRANSITIONS[action];
  if (!rule.from.includes(status)) return `Cannot ${rule.label.toLowerCase()} from ${status}`;
  if (action === 'pause' && !plan.pausable) return 'This plan cannot be paused';
  // Closing early is a plan rule; drafts and quotes can always be dropped.
  if (action === 'close' && (status === 'active' || status === 'paused') && !plan.closable) {
    return 'This plan cannot be closed early';
  }
  return null;
}

export function availableSubscriptionActions(
  status: SubscriptionStatus,
  plan: PlanRules,
): SubscriptionAction[] {
  return [
    ...(Object.keys(SUBSCRIPTION_TRANSITIONS) as Exclude<SubscriptionAction, 'renew'>[]),
    'renew' as const,
  ].filter((action) => subscriptionActionBlocker(action, status, plan) === null);
}

/** Subscription lines can be edited only before the deal is confirmed. */
export function isSubscriptionEditable(status: SubscriptionStatus): boolean {
  return status === 'draft' || status === 'quotation';
}

export const INVOICE_ACTIONS = ['confirm', 'cancel', 'send'] as const;
export type InvoiceAction = (typeof INVOICE_ACTIONS)[number];

export function invoiceActionBlocker(
  action: InvoiceAction,
  status: InvoiceStatus,
  amountPaid: number,
): string | null {
  switch (action) {
    case 'confirm':
      return status === 'draft' ? null : 'Only draft invoices can be confirmed';
    case 'cancel':
      if (status === 'cancelled' || status === 'paid')
        return `A ${status} invoice cannot be cancelled`;
      return amountPaid > 0 ? 'Invoice has payments recorded against it' : null;
    case 'send':
      return status === 'confirmed' || status === 'paid'
        ? null
        : 'Confirm the invoice before sending';
  }
}
