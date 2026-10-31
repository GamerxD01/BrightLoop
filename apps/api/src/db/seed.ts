/**
 * Demo data built through the real services, so every total, number, event and
 * invoice is produced by the same code paths the app uses.
 *
 *   npm run db:seed            seed an empty database
 *   npm run db:seed -- --reset wipe everything first
 */
import { addDays, addMonths, todayIso, toPaise, type SubscriptionAction } from '@brightloop/shared';
import { pool, query, queryOne } from './pool';
import { migrate } from './migrate';
import { logger } from '../lib/logger';
import { hashPassword } from '../lib/security';
import type { Actor } from '../lib/http';
import { catalogService } from '../modules/catalog/catalog.service';
import { plansService } from '../modules/plans/plans.service';
import { templatesService } from '../modules/templates/templates.service';
import { discountsService } from '../modules/discounts/discounts.service';
import { customersService } from '../modules/customers/customers.service';
import type { Customer } from '../modules/customers/customers.repository';
import { subscriptionsService } from '../modules/subscriptions/subscriptions.service';
import { billingService } from '../modules/billing/billing.service';
import { paymentsService } from '../modules/payments/payments.service';

export const DEMO_PASSWORD = 'Brightloop@2026';

async function reset() {
  await pool.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
  logger.info('Database wiped');
}

async function seed() {
  if (process.argv.includes('--reset')) await reset();
  await migrate();

  if (await queryOne(pool, 'SELECT 1 FROM users LIMIT 1')) {
    logger.warn('Database already has users; run with --reset to start over');
    return;
  }

  const passwordHash = await hashPassword(DEMO_PASSWORD);
  const admin = (await queryOne<{ id: number }>(
    pool,
    `INSERT INTO users (email, password_hash, full_name, role) VALUES ('admin@brightloop.test', $1, 'Aarav Mehta', 'admin') RETURNING id`,
    [passwordHash],
  ))!;
  await query(
    pool,
    `INSERT INTO users (email, password_hash, full_name, role, created_by) VALUES ('staff@brightloop.test', $1, 'Neha Kapoor', 'staff', $2)`,
    [passwordHash, admin.id],
  );
  const actor: Actor = { userId: admin.id, role: 'admin', customerId: null, requestId: 'seed' };

  // ── catalog
  const gst18 = await catalogService.saveTax({ name: 'GST 18%', rateBp: 1800, isActive: true });
  const gst5 = await catalogService.saveTax({ name: 'GST 5%', rateBp: 500, isActive: true });
  await catalogService.saveTax({ name: 'Exempt', rateBp: 0, isActive: true });
  const immediate = await catalogService.createPaymentTerm({ name: 'Immediate', dueDays: 0 });
  const net15 = await catalogService.createPaymentTerm({ name: '15 days', dueDays: 15 });
  const net30 = await catalogService.createPaymentTerm({ name: '30 days', dueDays: 30 });

  const [brand] = await catalogService.saveAttribute({
    name: 'Brand',
    values: [
      { name: 'Odoo', extraPrice: toPaise(560) },
      { name: 'Generic', extraPrice: 0 },
    ],
  });
  const odoo = brand!.values.find((v) => v.name === 'Odoo')!;
  const generic = brand!.values.find((v) => v.name === 'Generic')!;
  await catalogService.saveAttribute({
    name: 'Region',
    values: [
      { name: 'India', extraPrice: 0 },
      { name: 'EU data residency', extraPrice: toPaise(350) },
    ],
  });

  const p = (
    name: string,
    price: number,
    cost: number,
    notes: string,
    taxId: number,
    variants: number[] = [],
    type: 'service' | 'goods' = 'service',
  ) =>
    catalogService.saveProduct({
      name,
      type,
      salesPrice: toPaise(price),
      costPrice: toPaise(cost),
      notes,
      taxId,
      isActive: true,
      variantValueIds: variants,
    });
  const connector = await p(
    'ERP Connector',
    1499,
    300,
    'Two-way sync with the customer ERP.',
    gst18.id,
    [odoo.id, generic.id],
  );
  const analytics = await p('Advanced Analytics', 899, 150, 'Dashboards and exports.', gst18.id);
  const storage = await p('Extra Storage 100 GB', 249, 60, 'Billed per 100 GB block.', gst18.id);
  const support = await p(
    'Priority Support',
    1999,
    900,
    '4-hour response, named engineer.',
    gst18.id,
  );
  const sms = await p('SMS Credits (1,000)', 350, 210, 'Transactional SMS bundle.', gst5.id);
  await p('Hardware Token', 1200, 700, 'Physical 2FA key, shipped.', gst18.id, [], 'goods');

  // ── plans
  const yearStart = `${todayIso().slice(0, 4)}-01-01`;
  const planBase = {
    billingInterval: 1,
    startDate: '2025-01-01',
    endDate: null,
    isActive: true,
  } as const;
  const starter = await plansService.save({
    ...planBase,
    name: 'Starter Monthly',
    price: toPaise(499),
    billingPeriod: 'monthly',
    minQuantity: 1,
    taxId: gst18.id,
    autoClose: false,
    closable: true,
    pausable: true,
    renewable: true,
  });
  const growth = await plansService.save({
    ...planBase,
    name: 'Growth Monthly',
    price: toPaise(1299),
    billingPeriod: 'monthly',
    minQuantity: 3,
    taxId: gst18.id,
    autoClose: false,
    closable: true,
    pausable: true,
    renewable: true,
  });
  const business = await plansService.save({
    ...planBase,
    name: 'Business Yearly',
    price: toPaise(11990),
    billingPeriod: 'yearly',
    minQuantity: 5,
    taxId: gst18.id,
    autoClose: false,
    closable: false,
    pausable: false,
    renewable: true,
  });
  const pilot = await plansService.save({
    ...planBase,
    name: 'Pilot Weekly',
    price: toPaise(199),
    billingPeriod: 'weekly',
    minQuantity: 1,
    taxId: gst18.id,
    autoClose: true,
    closable: true,
    pausable: false,
    renewable: false,
  });
  await plansService.save({
    ...planBase,
    name: 'Event Pass Daily',
    price: toPaise(99),
    billingPeriod: 'daily',
    minQuantity: 10,
    startDate: yearStart,
    endDate: `${todayIso().slice(0, 4)}-12-31`,
    taxId: gst18.id,
    autoClose: true,
    closable: true,
    pausable: false,
    renewable: false,
  });

  // ── templates and discounts
  const enterprise = await templatesService.save({
    name: 'Enterprise Annual Offer',
    planId: business.id,
    validityDays: 21,
    paymentTermId: net30.id,
    notes: 'Includes onboarding call and priority support.',
    lines: [
      {
        productId: connector.id,
        variantId: connector.variants.find((v) => v.valueName === 'Odoo')!.id,
        quantity: 1,
      },
      { productId: support.id, variantId: null, quantity: 1 },
      { productId: analytics.id, variantId: null, quantity: 1 },
    ],
  });
  await templatesService.save({
    name: 'Small Shop Starter',
    planId: starter.id,
    validityDays: 7,
    paymentTermId: immediate.id,
    notes: null,
    lines: [{ productId: storage.id, variantId: null, quantity: 1 }],
  });

  const bulk = await discountsService.save(
    {
      name: 'Bulk seats 10%',
      type: 'percentage',
      value: 1000,
      scope: 'subscription',
      productIds: [],
      minAmount: 0,
      minQuantity: 10,
      startDate: '2025-01-01',
      endDate: null,
      usageLimit: null,
      isActive: true,
    },
    actor,
  );
  const festive = await discountsService.save(
    {
      name: 'Festive ₹500 off',
      type: 'fixed',
      value: toPaise(500),
      scope: 'subscription',
      productIds: [],
      minAmount: toPaise(2000),
      minQuantity: 0,
      startDate: addMonths(todayIso(), -2),
      endDate: addMonths(todayIso(), 2),
      usageLimit: 25,
      isActive: true,
    },
    actor,
  );
  const analyticsLaunch = await discountsService.save(
    {
      name: 'Analytics launch 20%',
      type: 'percentage',
      value: 2000,
      scope: 'products',
      productIds: [analytics.id],
      minAmount: 0,
      minQuantity: 0,
      startDate: '2025-06-01',
      endDate: addMonths(todayIso(), 6),
      usageLimit: 100,
      isActive: true,
    },
    actor,
  );
  await discountsService.save(
    {
      name: 'Summer 2025 (ended)',
      type: 'percentage',
      value: 1500,
      scope: 'subscription',
      productIds: [],
      minAmount: 0,
      minQuantity: 0,
      startDate: '2025-04-01',
      endDate: '2025-06-30',
      usageLimit: null,
      isActive: true,
    },
    actor,
  );

  // ── customers
  const companies: [string, string, string][] = [
    ['Kavya Iyer', 'Iyer Textiles', 'Chennai'],
    ['Rohan Gupta', 'Gupta Hardware', 'Lucknow'],
    ['Priya Nair', 'Nair Clinics', 'Kochi'],
    ['Arjun Singh', 'Singh Logistics', 'Ludhiana'],
    ['Meera Joshi', 'Joshi & Co. Chartered Accountants', 'Pune'],
    ['Ishaan Reddy', 'Reddy Agritech', 'Hyderabad'],
    ['Ananya Das', 'Das Bookhouse', 'Kolkata'],
    ['Vikram Rao', 'Rao Engineering Works', 'Bengaluru'],
    ['Sara Khan', 'Khan Foods', 'Lucknow'],
    ['Dev Malhotra', 'Malhotra Retail Group', 'Delhi'],
    ['Tara Pillai', 'Pillai Studio', 'Thiruvananthapuram'],
    ['Kabir Shah', 'Shah Pharma Distributors', 'Ahmedabad'],
  ];
  const customers: Customer[] = [];
  for (const [name, company, city] of companies) {
    const slug = company
      .toLowerCase()
      .replace(/[^a-z]+/g, '.')
      .replace(/^\.|\.$/g, '');
    customers.push(
      await customersService.create({
        name,
        email: `${slug}@example.in`,
        phone: '+91 98765 4' + String(customers.length).padStart(4, '0'),
        company,
        address: `${city}, India`,
      }),
    );
  }

  // The demo portal login belongs to the first customer.
  await query(
    pool,
    `INSERT INTO users (email, password_hash, full_name, role, customer_id) VALUES ($1, $2, $3, 'customer', $4)`,
    [customers[0]!.email, passwordHash, customers[0]!.name, customers[0]!.id],
  );

  // ── subscriptions across the whole lifecycle
  const make = async (
    customerIdx: number,
    planId: number,
    planQuantity: number,
    startDate: string,
    lines: { productId: number; variantId?: number | null; quantity: number }[],
    path: SubscriptionAction[],
    extra: { discountIds?: number[]; expiryDate?: string | null; paymentTermId?: number } = {},
  ) => {
    let sub = await subscriptionsService.create(
      {
        customerId: customers[customerIdx]!.id,
        planId,
        templateId: null,
        planQuantity,
        startDate,
        expiryDate: extra.expiryDate ?? null,
        paymentTermId: extra.paymentTermId ?? net15.id,
        notes: null,
        lines: lines.map((l) => ({
          productId: l.productId,
          variantId: l.variantId ?? null,
          quantity: l.quantity,
          unitPrice: null,
        })),
        discountIds: extra.discountIds ?? [],
      },
      actor,
    );
    for (const action of path)
      sub = await subscriptionsService.transition(sub.id, action, null, actor);
    return sub;
  };
  const live: SubscriptionAction[] = ['send_quotation', 'confirm', 'activate'];
  const odooVariant = connector.variants.find((v) => v.valueName === 'Odoo')!.id;
  const genericVariant = connector.variants.find((v) => v.valueName === 'Generic')!.id;

  await make(
    0,
    growth.id,
    12,
    addMonths(todayIso(), -7),
    [
      { productId: analytics.id, quantity: 1 },
      { productId: storage.id, quantity: 2 },
    ],
    live,
    { discountIds: [bulk.id, analyticsLaunch.id] },
  );
  await make(
    1,
    starter.id,
    2,
    addMonths(todayIso(), -5),
    [{ productId: storage.id, quantity: 1 }],
    live,
    { paymentTermId: immediate.id },
  );
  await make(
    2,
    business.id,
    8,
    addMonths(todayIso(), -13),
    [
      { productId: connector.id, variantId: odooVariant, quantity: 1 },
      { productId: support.id, quantity: 1 },
    ],
    live,
    { paymentTermId: net30.id, expiryDate: addMonths(todayIso(), 11) },
  );
  await make(
    3,
    growth.id,
    5,
    addMonths(todayIso(), -4),
    [
      { productId: sms.id, quantity: 3 },
      { productId: connector.id, variantId: genericVariant, quantity: 1 },
    ],
    live,
    { discountIds: [festive.id] },
  );
  await make(4, starter.id, 1, addMonths(todayIso(), -9), [], live);
  await make(
    5,
    growth.id,
    4,
    addMonths(todayIso(), -3),
    [{ productId: analytics.id, quantity: 1 }],
    [...live, 'pause'],
  );
  const pilotSub = await make(6, pilot.id, 1, addDays(todayIso(), -40), [], live, {
    expiryDate: addDays(todayIso(), 2),
    paymentTermId: immediate.id,
  });
  // History: the pilot's term actually ended last week, so billing day auto-closes it.
  await query(pool, 'UPDATE subscriptions SET expiry_date = $2 WHERE id = $1', [
    pilotSub.id,
    addDays(todayIso(), -5),
  ]);
  await make(
    7,
    business.id,
    15,
    addMonths(todayIso(), -2),
    [{ productId: support.id, quantity: 1 }],
    live,
    { discountIds: [bulk.id], paymentTermId: net30.id },
  );
  await make(
    8,
    starter.id,
    3,
    addMonths(todayIso(), -6),
    [{ productId: storage.id, quantity: 1 }],
    [...live, 'close'],
  );
  await make(
    9,
    growth.id,
    6,
    addMonths(todayIso(), -1),
    [
      { productId: analytics.id, quantity: 1 },
      { productId: support.id, quantity: 1 },
    ],
    live,
    { discountIds: [festive.id, analyticsLaunch.id] },
  );
  await make(10, starter.id, 2, todayIso(), [], ['send_quotation']);
  await make(
    11,
    business.id,
    5,
    addDays(todayIso(), 7),
    [{ productId: connector.id, variantId: odooVariant, quantity: 1 }],
    ['send_quotation', 'confirm'],
    { paymentTermId: net30.id },
  );
  await subscriptionsService.createFromTemplate(
    { templateId: enterprise.id, customerId: customers[1]!.id, startDate: addDays(todayIso(), 14) },
    actor,
  );
  await make(9, starter.id, 1, todayIso(), [{ productId: sms.id, quantity: 1 }], []);

  // ── billing history: run billing up to today, confirm, then collect most of it
  await billingService.run({ asOf: todayIso(), autoConfirm: true }, actor);

  const open = await query<{
    id: number;
    amountTotal: number;
    dueDate: string;
    customerId: number;
  }>(
    pool,
    `SELECT id, amount_total, due_date, customer_id FROM invoices WHERE status = 'confirmed' ORDER BY invoice_date, id`,
  );
  const methods = ['upi', 'bank_transfer', 'card', 'bank_transfer', 'cheque'] as const;
  const slowPayers = new Set([customers[3]!.id, customers[9]!.id]);
  for (const [i, inv] of open.entries()) {
    const ageDays = (Date.parse(todayIso()) - Date.parse(inv.dueDate)) / 86_400_000;
    if (ageDays < 3) continue; // recent invoices stay outstanding
    if (slowPayers.has(inv.customerId) && ageDays < 75) continue; // these become overdue
    const paidOn = inv.dueDate > todayIso() ? todayIso() : addDays(inv.dueDate, -(i % 4));
    const partial = i % 9 === 4;
    await paymentsService.record(
      {
        invoiceId: inv.id,
        amount: partial ? Math.round(inv.amountTotal / 2) : inv.amountTotal,
        method: methods[i % methods.length]!,
        paidOn: paidOn > todayIso() ? todayIso() : paidOn,
        note: partial ? 'Part payment, balance promised next week' : null,
      },
      actor,
    );
  }
  // One invoice left as a draft so the confirm flow can be shown.
  const lastDraftable = await queryOne<{ id: number }>(
    pool,
    `SELECT id FROM invoices WHERE status = 'confirmed' AND amount_paid = 0 ORDER BY id DESC LIMIT 1`,
  );
  if (lastDraftable)
    await query(pool, `UPDATE invoices SET status = 'draft', confirmed_at = NULL WHERE id = $1`, [
      lastDraftable.id,
    ]);

  logger.info(
    `Seeded. Sign in with admin@brightloop.test, staff@brightloop.test or ${customers[0]!.email} — password ${DEMO_PASSWORD}`,
  );
}

seed()
  .then(() => pool.end())
  .catch((err) => {
    logger.error({ err }, 'Seed failed');
    process.exit(1);
  });
