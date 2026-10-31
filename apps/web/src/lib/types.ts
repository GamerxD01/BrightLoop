import type {
  BillingPeriod,
  DiscountRule,
  InvoiceStatus,
  LineKind,
  PaymentMethod,
  ProductType,
  Role,
  SubscriptionStatus,
} from '@brightloop/shared';

/** Shapes the API returns. Kept beside the client, mirroring the repositories. */
export interface User {
  id: number;
  email: string;
  fullName: string;
  role: Role;
  customerId: number | null;
}

export interface Tax {
  id: number;
  name: string;
  rateBp: number;
  isActive: boolean;
}
export interface PaymentTerm {
  id: number;
  name: string;
  dueDays: number;
}
export interface AttributeValue {
  id: number;
  attributeId: number;
  name: string;
  extraPrice: number;
}
export interface Attribute {
  id: number;
  name: string;
  values: AttributeValue[];
}
export interface Variant {
  id: number;
  attributeValueId: number;
  attributeName: string;
  valueName: string;
  extraPrice: number;
}
export interface Product {
  id: number;
  name: string;
  type: ProductType;
  salesPrice: number;
  costPrice: number;
  notes: string | null;
  taxId: number | null;
  taxName: string | null;
  taxRateBp: number | null;
  isActive: boolean;
  variants: Variant[];
  hsnSac: string | null;
}
export interface Plan {
  id: number;
  name: string;
  price: number;
  billingPeriod: BillingPeriod;
  billingInterval: number;
  minQuantity: number;
  startDate: string;
  endDate: string | null;
  taxId: number | null;
  taxName?: string | null;
  taxRateBp: number | null;
  autoClose: boolean;
  closable: boolean;
  pausable: boolean;
  renewable: boolean;
  isActive: boolean;
  activeSubscriptions?: number;
  hsnSac?: string | null;
}
export interface TemplateLine {
  id: number;
  productId: number;
  productName: string;
  variantId: number | null;
  variantName: string | null;
  quantity: number;
}
export interface Template {
  id: number;
  name: string;
  planId: number;
  planName: string;
  validityDays: number;
  paymentTermId: number;
  paymentTermName: string;
  notes: string | null;
  lines: TemplateLine[];
}
export interface Discount extends DiscountRule {
  productNames: string[];
}

export interface Lookups {
  taxes: Tax[];
  paymentTerms: PaymentTerm[];
  attributes: Attribute[];
  products: Product[];
  plans: Plan[];
  templates: Template[];
  discounts: Discount[];
}

export interface Customer {
  id: number;
  name: string;
  email: string;
  phone: string | null;
  company: string | null;
  address: string | null;
  createdAt: string;
  activeSubscriptions?: number;
  outstanding?: number;
  hasPortalAccess?: boolean;
  gstin: string | null;
  stateCode: string | null;
}

export interface SubscriptionRow {
  id: number;
  number: string;
  status: SubscriptionStatus;
  customerId: number;
  customerName: string;
  planName: string;
  billingPeriod: BillingPeriod;
  startDate: string;
  expiryDate: string | null;
  nextInvoiceDate: string | null;
  amountTotal: number;
}

export interface SubscriptionLine {
  id: number;
  kind: LineKind;
  productId: number | null;
  variantId: number | null;
  description: string;
  quantity: number;
  unitPrice: number;
  taxId: number | null;
  taxRateBp: number;
}

export interface SubscriptionEvent {
  id: number;
  fromStatus: SubscriptionStatus | null;
  toStatus: SubscriptionStatus;
  note: string | null;
  actorName: string | null;
  createdAt: string;
}

export interface Subscription {
  id: number;
  number: string;
  status: SubscriptionStatus;
  customerId: number;
  customerName: string;
  customerEmail: string;
  customerCompany: string | null;
  planId: number;
  planName: string;
  billingPeriod: BillingPeriod;
  billingInterval: number;
  minQuantity: number;
  closable: boolean;
  pausable: boolean;
  renewable: boolean;
  autoClose: boolean;
  paymentTermId: number;
  paymentTermName: string;
  dueDays: number;
  templateId: number | null;
  templateName: string | null;
  renewedFromId: number | null;
  renewedFromNumber: string | null;
  startDate: string;
  expiryDate: string | null;
  quoteValidUntil: string | null;
  nextInvoiceDate: string | null;
  amountUntaxed: number;
  amountTax: number;
  amountTotal: number;
  notes?: string | null;
  lines: SubscriptionLine[];
  discountIds: number[];
  events: SubscriptionEvent[];
  createdAt: string;
}

export interface InvoiceRow {
  id: number;
  number: string;
  status: InvoiceStatus;
  customerId: number;
  customerName: string;
  subscriptionNumber: string | null;
  invoiceDate: string;
  dueDate: string;
  amountTotal: number;
  amountPaid: number;
  isOverdue: boolean;
}

export interface InvoicePayment {
  id: number;
  amount: number;
  method: PaymentMethod;
  paidOn: string;
  note: string | null;
  recordedBy: string | null;
}

export interface Invoice {
  id: number;
  number: string;
  status: InvoiceStatus;
  kind: 'recurring' | 'adjustment';
  subscriptionId: number | null;
  subscriptionNumber: string | null;
  planName: string | null;
  customerId: number;
  customerName: string;
  customerEmail: string;
  customerCompany: string | null;
  customerAddress: string | null;
  periodStart: string;
  periodEnd: string;
  invoiceDate: string;
  dueDate: string;
  amountUntaxed: number;
  amountDiscount: number;
  amountTax: number;
  amountTotal: number;
  amountPaid: number;
  amountDue: number;
  isOverdue: boolean;
  sentAt: string | null;
  gstMode: 'intra' | 'inter';
  placeOfSupply: string | null;
  customerGstin: string | null;
  amountCgst: number;
  amountSgst: number;
  amountIgst: number;
  seller: Seller | null;
  lines: {
    id: number;
    description: string;
    quantity: number;
    unitPrice: number;
    discount: number;
    taxRateBp: number;
    taxAmount: number;
    subtotal: number;
    total: number;
    hsnSac: string | null;
    cgst: number;
    sgst: number;
    igst: number;
  }[];
  payments: InvoicePayment[];
  discounts: { name: string; amount: number }[];
}

export interface PaymentRow {
  id: number;
  invoiceId: number;
  invoiceNumber: string;
  customerId: number;
  customerName: string;
  amount: number;
  method: PaymentMethod;
  paidOn: string;
  note: string | null;
  recordedBy: string | null;
}

export interface StaffUser {
  id: number;
  email: string;
  fullName: string;
  role: Role;
  isActive: boolean;
  lastLoginAt: string | null;
  createdAt: string;
}

export interface ReportSummary {
  range: { from: string; to: string; planId: number | null };
  headline: {
    activeSubscriptions: number;
    mrr: number;
    newSubscriptions: number;
    invoiced: number;
    collected: number;
    outstanding: number;
    overdueCount: number;
    overdueAmount: number;
  };
  monthly: { month: string; invoiced: number; collected: number }[];
  byStatus: { status: SubscriptionStatus; count: number }[];
  byPlan: { planId: number; planName: string; active: number; mrr: number }[];
  renewalsDue: {
    id: number;
    number: string;
    customerName: string;
    planName: string;
    expiryDate: string;
    daysLeft: number;
    renewalId: number | null;
    noticeSent: boolean;
  }[];
  automation: {
    job: string;
    status: string;
    result: Record<string, unknown> | null;
    finishedAt: string | null;
    trigger: string;
  }[];
  topOverdue: {
    id: number;
    number: string;
    customerName: string;
    dueDate: string;
    amountDue: number;
    daysOverdue: number;
  }[];
}

export interface BillingStatus {
  running: { startedAt: string; asOf: string; processed: number } | null;
  lastRun: {
    asOf: string;
    subscriptionsBilled: number;
    invoicesCreated: number;
    invoicesConfirmed: number;
    autoClosed: number;
    durationMs: number;
    finishedAt: string;
  } | null;
  due: { subscriptions: number; amount: number };
}

export interface Seller {
  legalName: string;
  brandName: string;
  address: string | null;
  stateCode: string | null;
  stateName: string | null;
  gstin: string | null;
  email: string | null;
  phone: string | null;
  bank: { name: string | null; account: string | null; ifsc: string | null } | null;
  upiId: string | null;
  footer: string | null;
}

export interface Company {
  brandName: string;
  legalName: string;
  addressLine: string | null;
  city: string | null;
  stateCode: string | null;
  pincode: string | null;
  gstin: string | null;
  email: string | null;
  phone: string | null;
  website: string | null;
  bankName: string | null;
  bankAccount: string | null;
  bankIfsc: string | null;
  upiId: string | null;
  invoiceFooter: string | null;
  hasLogo: boolean;
  updatedAt: string;
}

export interface EmailLogRow {
  id: number;
  kind: string;
  toAddress: string;
  subject: string;
  status: 'sent' | 'logged' | 'failed';
  error: string | null;
  entity: string | null;
  entityId: number | null;
  customerId: number | null;
  attachments: string[];
  createdAt: string;
  bodyText?: string;
  bodyHtml?: string | null;
}
