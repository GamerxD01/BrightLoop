import { LABELS, formatMoney, type PaymentMethod } from '@brightloop/shared';
import { env } from '../../config/env';
import { renderEmail, type EmailBrand, type EmailContent } from '../../lib/email-templates';
import { mailConfigured, sendMail, type Mail, type MailAttachment } from '../../lib/mailer';
import { companyService } from '../company/company.service';
import { renderInvoicePdf } from '../invoices/invoice-pdf';
import type { InvoiceDetail } from '../invoices/invoices.repository';

const date = (iso: string) =>
  new Date(`${iso.slice(0, 10)}T00:00:00Z`).toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  });

async function brand(): Promise<{ brand: EmailBrand; inline: MailAttachment[] }> {
  const seller = await companyService.snapshot();
  const logo = mailConfigured ? await companyService.logo() : null;
  const inline: MailAttachment[] = logo?.logo
    ? [{ filename: 'logo', content: logo.logo, contentType: logo.logoMime!, cid: 'brand-logo' }]
    : [];
  return {
    brand: {
      brandName: seller.brandName,
      legalName: seller.legalName,
      address: seller.address,
      email: seller.email,
      logoCid: inline.length ? 'brand-logo' : undefined,
    },
    inline,
  };
}

async function deliver(
  base: Omit<Mail, 'html' | 'text' | 'attachments'> & { attachments?: MailAttachment[] },
  content: EmailContent,
) {
  const { brand: b, inline } = await brand();
  const { html, text } = renderEmail(b, content);
  return sendMail({ ...base, html, text, attachments: [...inline, ...(base.attachments ?? [])] });
}

/**
 * Every message the business sends to a customer, in one place, so tone,
 * branding and logging stay consistent.
 */
export const notifications = {
  welcome: (to: string, name: string, customerId: number) =>
    deliver(
      {
        kind: 'welcome',
        to,
        subject: 'Welcome to your billing portal',
        customerId,
        entity: 'customer',
        entityId: customerId,
      },
      {
        preheader: 'Your subscriptions and invoices, in one place.',
        heading: `Welcome, ${name.split(' ')[0]}`,
        paragraphs: [
          'Your account is ready. You can see your subscriptions and invoices, and pause, renew or change a plan without writing to us.',
        ],
        action: { label: 'Open your portal', url: `${env.APP_URL}/portal` },
      },
    ),

  passwordReset: (to: string, name: string, link: string, minutes: number) =>
    deliver(
      { kind: 'reset', to, subject: 'Reset your password', redactInLog: link },
      {
        preheader: `This link works once and expires in ${minutes} minutes.`,
        heading: 'Choose a new password',
        paragraphs: [
          `Hi ${name.split(' ')[0]}, use the button below to choose a new password. It works once and expires in ${minutes} minutes.`,
        ],
        action: { label: 'Choose a new password', url: link },
        note: 'If you did not ask for this, ignore this email; your password stays as it is.',
      },
    ),

  async invoice(inv: InvoiceDetail) {
    const pdf = await renderInvoicePdf(inv);
    return deliver(
      {
        kind: 'invoice',
        to: inv.customerEmail,
        subject: `Invoice ${inv.number}: ${formatMoney(inv.amountDue)} due ${date(inv.dueDate)}`,
        entity: 'invoice',
        entityId: inv.id,
        customerId: inv.customerId,
        attachments: [
          {
            filename: `${inv.number.replace(/\//g, '-')}.pdf`,
            content: pdf,
            contentType: 'application/pdf',
          },
        ],
      },
      {
        preheader: `${formatMoney(inv.amountDue)} due by ${date(inv.dueDate)}.`,
        heading: `Invoice ${inv.number}`,
        paragraphs: [
          `Hello ${inv.customerName}, here is your invoice for ${date(inv.periodStart)} to ${date(inv.periodEnd)}. The PDF is attached.`,
        ],
        rows: [
          ['Total', formatMoney(inv.amountTotal)],
          ...(inv.amountPaid
            ? ([['Paid', formatMoney(inv.amountPaid)]] as [string, string][])
            : []),
          ['Due', `${formatMoney(inv.amountDue)} by ${date(inv.dueDate)}`],
        ],
        action: { label: 'View and pay', url: `${env.APP_URL}/portal/invoices/${inv.id}` },
      },
    );
  },

  receipt: (inv: InvoiceDetail, amount: number, method: PaymentMethod, paidOn: string) =>
    deliver(
      {
        kind: 'receipt',
        to: inv.customerEmail,
        subject: `Payment received for ${inv.number}`,
        entity: 'invoice',
        entityId: inv.id,
        customerId: inv.customerId,
      },
      {
        preheader: `We received ${formatMoney(amount)}. Thank you.`,
        heading: 'Thank you, payment received',
        paragraphs: [
          inv.status === 'paid'
            ? `Invoice ${inv.number} is now paid in full.`
            : `Invoice ${inv.number} has ${formatMoney(inv.amountDue)} still to pay.`,
        ],
        rows: [
          ['Amount', formatMoney(amount)],
          ['Method', LABELS.paymentMethod[method]],
          ['Received on', date(paidOn)],
          ['Still due', formatMoney(inv.amountDue)],
        ],
        action: { label: 'View invoice', url: `${env.APP_URL}/portal/invoices/${inv.id}` },
      },
    ),

  /** Overdue reminders get firmer: 1 polite, 2 firm, 3 final. 0 is one sent by hand. */
  reminder(inv: InvoiceDetail, stage: 0 | 1 | 2 | 3, daysLate: number) {
    const tone = {
      0: {
        subject: `Reminder: invoice ${inv.number} is due`,
        heading: 'A quick reminder',
        line: `Invoice ${inv.number} for ${formatMoney(inv.amountDue)} was due on ${date(inv.dueDate)}.`,
      },
      1: {
        subject: `Invoice ${inv.number} is ${daysLate} days overdue`,
        heading: 'Just a friendly reminder',
        line: `We have not yet received payment for invoice ${inv.number}. It was due on ${date(inv.dueDate)}; if it is already on its way, thank you and please ignore this.`,
      },
      2: {
        subject: `Second reminder: invoice ${inv.number} is overdue`,
        heading: 'Your invoice is overdue',
        line: `Invoice ${inv.number} is now ${daysLate} days past its due date. Please arrange payment this week so your service continues without interruption.`,
      },
      3: {
        subject: `Final reminder: invoice ${inv.number}`,
        heading: 'Final reminder before we pause service',
        line: `Invoice ${inv.number} is ${daysLate} days overdue. If we do not receive payment soon, we may need to pause your subscription. Reply to this email if something is holding it up.`,
      },
    }[stage];
    return deliver(
      {
        kind: 'reminder',
        to: inv.customerEmail,
        subject: tone.subject,
        entity: 'invoice',
        entityId: inv.id,
        customerId: inv.customerId,
      },
      {
        preheader: `${formatMoney(inv.amountDue)} outstanding on ${inv.number}.`,
        heading: tone.heading,
        paragraphs: [`Hello ${inv.customerName},`, tone.line],
        rows: [
          ['Invoice', inv.number],
          ['Due date', date(inv.dueDate)],
          ['Outstanding', formatMoney(inv.amountDue)],
        ],
        action: { label: 'View and pay', url: `${env.APP_URL}/portal/invoices/${inv.id}` },
        note: 'You can pay by UPI using the QR code on the invoice, or by bank transfer quoting the invoice number.',
      },
    );
  },

  renewal(
    sub: {
      id: number;
      number: string;
      customerId: number;
      customerName: string;
      customerEmail: string;
      planName: string;
      expiryDate: string;
      renewable: boolean;
    },
    daysLeft: number,
  ) {
    return deliver(
      {
        kind: 'renewal',
        to: sub.customerEmail,
        subject: `Your ${sub.planName} subscription ends in ${daysLeft} day${daysLeft === 1 ? '' : 's'}`,
        entity: 'subscription',
        entityId: sub.id,
        customerId: sub.customerId,
      },
      {
        preheader: `${sub.number} ends on ${date(sub.expiryDate)}.`,
        heading: 'Time to renew',
        paragraphs: [
          `Hello ${sub.customerName}, your subscription ${sub.number} on ${sub.planName} ends on ${date(sub.expiryDate)}.`,
          sub.renewable
            ? 'You can renew it from your portal in one click, and nothing changes in how you use it.'
            : 'This plan does not renew automatically. Reply to this email and we will set up what comes next.',
        ],
        action: sub.renewable
          ? { label: 'Renew now', url: `${env.APP_URL}/portal/subscriptions/${sub.id}` }
          : undefined,
      },
    );
  },

  quotation(sub: {
    id: number;
    number: string;
    customerId: number;
    customerName: string;
    customerEmail: string;
    planName: string;
    amountTotal: number;
    quoteValidUntil: string | null;
  }) {
    return deliver(
      {
        kind: 'quote',
        to: sub.customerEmail,
        subject: `Your quotation ${sub.number}`,
        entity: 'subscription',
        entityId: sub.id,
        customerId: sub.customerId,
      },
      {
        preheader: `${sub.planName}, ${formatMoney(sub.amountTotal)} each period.`,
        heading: 'Your quotation is ready',
        paragraphs: [
          `Hello ${sub.customerName}, here is the quotation we prepared for you on ${sub.planName}.`,
          'Review the lines in your portal and accept it there; we will take it from there.',
        ],
        rows: [
          ['Quotation', sub.number],
          ['Each period', `${formatMoney(sub.amountTotal)} incl. tax`],
          ...(sub.quoteValidUntil
            ? ([['Valid until', date(sub.quoteValidUntil)]] as [string, string][])
            : []),
        ],
        action: {
          label: 'Review and accept',
          url: `${env.APP_URL}/portal/subscriptions/${sub.id}`,
        },
      },
    );
  },
};
