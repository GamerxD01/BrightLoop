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
};
