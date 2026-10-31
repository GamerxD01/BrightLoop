import { Router } from 'express';
import { auditWrites } from './middleware/audit-writes';
import { adminOnly, authenticate, backOffice, customerOnly } from './middleware/auth';
import { authRoutes } from './modules/auth/auth.routes';
import { automationRoutes } from './modules/automation/automation.routes';
import { activityRoutes } from './modules/activity/activity.routes';
import { exportsRoutes } from './modules/exports/exports.routes';
import { bankRoutes } from './modules/bank/bank.routes';
import { billingRoutes } from './modules/billing/billing.routes';
import { catalogRoutes } from './modules/catalog/catalog.routes';
import { brandRoutes, companyRoutes } from './modules/company/company.routes';
import { customersRoutes } from './modules/customers/customers.routes';
import { discountsRoutes } from './modules/discounts/discounts.routes';
import { invoicesRoutes } from './modules/invoices/invoices.routes';
import { lookupsRoutes } from './modules/lookups.routes';
import { outboxRoutes } from './modules/notifications/outbox.routes';
import { paymentsRoutes } from './modules/payments/payments.routes';
import { plansRoutes } from './modules/plans/plans.routes';
import { portalRoutes } from './modules/portal/portal.routes';
import { realtimeRoutes } from './modules/realtime/realtime.routes';
import { reportsRoutes } from './modules/reports/reports.routes';
import { subscriptionsRoutes } from './modules/subscriptions/subscriptions.routes';
import { templatesRoutes } from './modules/templates/templates.routes';
import { usersRoutes } from './modules/users/users.routes';

/**
 * The whole API surface. Access is decided here, per mount, so each module's
 * router stays about its own resource.
 */
export const apiRoutes = Router()
  .use('/auth', authRoutes)
  .use('/brand', brandRoutes)
  .use('/company', companyRoutes)
  .use('/events', authenticate, realtimeRoutes)
  .use('/portal', authenticate, customerOnly, portalRoutes)
  .use('/users', authenticate, adminOnly, usersRoutes)
  .use('/lookups', authenticate, backOffice, lookupsRoutes)
  .use('/catalog', authenticate, backOffice, auditWrites('catalog'), catalogRoutes)
  .use('/plans', authenticate, backOffice, auditWrites('plan'), plansRoutes)
  .use('/templates', authenticate, backOffice, auditWrites('template'), templatesRoutes)
  .use('/discounts', authenticate, backOffice, discountsRoutes)
  .use('/customers', authenticate, backOffice, auditWrites('customer'), customersRoutes)
  .use('/subscriptions', authenticate, backOffice, subscriptionsRoutes)
  .use('/invoices', authenticate, backOffice, invoicesRoutes)
  .use('/payments', authenticate, backOffice, paymentsRoutes)
  .use('/billing', authenticate, backOffice, billingRoutes)
  .use('/bank-imports', authenticate, backOffice, bankRoutes)
  .use('/automation', authenticate, backOffice, automationRoutes)
  .use('/outbox', authenticate, backOffice, outboxRoutes)
  .use('/reports', authenticate, backOffice, reportsRoutes)
  .use('/exports', authenticate, backOffice, exportsRoutes)
  .use('/activity', authenticate, adminOnly, activityRoutes);
