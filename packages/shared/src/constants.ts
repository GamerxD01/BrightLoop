/**
 * Domain constants shared by the API and the web app.
 * Every enum here mirrors a PostgreSQL enum type in the initial migration.
 */

export const ROLES = ['admin', 'staff', 'customer'] as const;
export type Role = (typeof ROLES)[number];

export const PRODUCT_TYPES = ['service', 'goods'] as const;
export type ProductType = (typeof PRODUCT_TYPES)[number];

export const BILLING_PERIODS = ['daily', 'weekly', 'monthly', 'yearly'] as const;
export type BillingPeriod = (typeof BILLING_PERIODS)[number];

export const SUBSCRIPTION_STATUSES = [
  'draft',
  'quotation',
  'confirmed',
  'active',
  'paused',
  'closed',
] as const;
export type SubscriptionStatus = (typeof SUBSCRIPTION_STATUSES)[number];

export const INVOICE_STATUSES = ['draft', 'confirmed', 'paid', 'cancelled'] as const;
export type InvoiceStatus = (typeof INVOICE_STATUSES)[number];

export const PAYMENT_METHODS = ['bank_transfer', 'upi', 'card', 'cash', 'cheque'] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

export const DISCOUNT_TYPES = ['fixed', 'percentage'] as const;
export type DiscountType = (typeof DISCOUNT_TYPES)[number];

export const DISCOUNT_SCOPES = ['subscription', 'products'] as const;
export type DiscountScope = (typeof DISCOUNT_SCOPES)[number];

export const LINE_KINDS = ['plan', 'product'] as const;
export type LineKind = (typeof LINE_KINDS)[number];

/** Human labels, kept next to the values so UI and emails never drift. */
export const LABELS = {
  billingPeriod: { daily: 'Daily', weekly: 'Weekly', monthly: 'Monthly', yearly: 'Yearly' },
  paymentMethod: {
    bank_transfer: 'Bank transfer',
    upi: 'UPI',
    card: 'Card',
    cash: 'Cash',
    cheque: 'Cheque',
  },
  subscriptionStatus: {
    draft: 'Draft',
    quotation: 'Quotation',
    confirmed: 'Confirmed',
    active: 'Active',
    paused: 'Paused',
    closed: 'Closed',
  },
  invoiceStatus: { draft: 'Draft', confirmed: 'Confirmed', paid: 'Paid', cancelled: 'Cancelled' },
  role: { admin: 'Admin', staff: 'Staff', customer: 'Customer' },
} as const;

/** Realtime event names pushed over Server-Sent Events. */
export const EVENT_TYPES = [
  'subscription.changed',
  'invoice.changed',
  'payment.recorded',
  'billing.progress',
  'catalog.changed',
] as const;
export type EventType = (typeof EVENT_TYPES)[number];
