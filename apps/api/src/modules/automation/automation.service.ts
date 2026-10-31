import { addDays, todayIso } from '@brightloop/shared';
import { env } from '../../config/env';
import { pool, query, queryOne } from '../../db/pool';
import { NotFoundError } from '../../lib/errors';
import { events } from '../../lib/events';
import type { Actor } from '../../lib/http';
import { logger } from '../../lib/logger';
import { billingService } from '../billing/billing.service';
import { invoicesService } from '../invoices/invoices.service';
import { notifications } from '../notifications/notifications.service';
import { subscriptionsService } from '../subscriptions/subscriptions.service';
import { remindersService } from './reminders.service';

export const JOBS = ['activate', 'billing', 'renewals', 'reminders'] as const;
export type JobKey = (typeof JOBS)[number];

interface JobDef {
  key: JobKey;
  name: string;
  description: string;
  run: (actor: Actor, today: string) => Promise<Record<string, unknown>>;
}

let automationUserId: number | null = null;

/** Changes made by a job are recorded under the inactive "Automation" account. */
async function systemActor(): Promise<Actor> {
  if (automationUserId === null) {
    const row = await queryOne<{ id: number }>(
      pool,
      `SELECT id FROM users WHERE email = 'automation@brightloop.internal'`,
    );
    automationUserId = row!.id;
  }
  return { userId: automationUserId, role: 'admin', customerId: null, requestId: 'automation' };
}

const DEFS: Record<JobKey, JobDef> = {
  activate: {
    key: 'activate',
    name: 'Start confirmed subscriptions',
    description: 'Confirmed subscriptions become active on their start date, ready to bill.',
    async run(actor, today) {
      const due = await query<{ id: number }>(
        pool,
        `SELECT id FROM subscriptions WHERE status = 'confirmed' AND start_date <= $1 ORDER BY id`,
        [today],
      );
      let started = 0;
      for (const { id } of due) {
        try {
          await subscriptionsService.transition(
            id,
            'activate',
            'Started automatically on its start date',
            actor,
          );
          started += 1;
        } catch (err) {
          logger.warn({ err, subscriptionId: id }, 'Could not start subscription');
        }
      }
      return { due: due.length, started };
    },
  },
  billing: {
    key: 'billing',
    name: 'Billing run',
    description:
      'Invoices every subscription due today, confirms the invoices and emails them with the PDF.',
    async run(actor, today) {
      const { invoiceIds, ...result } = await billingService.run(
        { asOf: today, autoConfirm: true },
        actor,
      );
      let emailed = 0;
      for (const id of invoiceIds) {
        try {
          await invoicesService.act(id, 'send', actor);
          emailed += 1;
        } catch (err) {
          logger.warn({ err, invoiceId: id }, 'Could not email invoice');
        }
      }
      return { ...result, invoicesEmailed: emailed };
    },
  },
  renewals: {
    key: 'renewals',
    name: 'Renewal notices',
    description:
      'Tells customers 30 days and again 7 days before a subscription ends, unless it is already renewed.',
    async run(_actor, today) {
      const due = await query<{
        id: number;
        number: string;
        customerId: number;
        customerName: string;
        customerEmail: string;
        planName: string;
        expiryDate: string;
        renewable: boolean;
        daysLeft: number;
      }>(
        pool,
        `SELECT s.id, s.number, s.customer_id, c.name AS customer_name, c.email AS customer_email, p.name AS plan_name,
                s.expiry_date, p.renewable, (s.expiry_date - $1::date) AS days_left
         FROM subscriptions s JOIN customers c ON c.id = s.customer_id JOIN plans p ON p.id = s.plan_id
         WHERE s.status = 'active' AND s.expiry_date BETWEEN $1::date AND $2::date
           AND NOT EXISTS (SELECT 1 FROM subscriptions r WHERE r.renewed_from_id = s.id AND r.status <> 'closed')
         ORDER BY s.expiry_date`,
        [today, addDays(today, 30)],
      );
      let sent = 0;
      for (const sub of due) {
        const kind = sub.daysLeft <= 7 ? 'renewal_7' : 'renewal_30';
        const claim = await queryOne<{ id: number }>(
          pool,
          `INSERT INTO subscription_notices (subscription_id, kind) VALUES ($1, $2) ON CONFLICT DO NOTHING RETURNING id`,
          [sub.id, kind],
        );
        if (!claim) continue;
        const email = await notifications.renewal(sub, sub.daysLeft);
        await query(pool, 'UPDATE subscription_notices SET email_id = $2 WHERE id = $1', [
          claim.id,
          email.id,
        ]);
        sent += 1;
      }
      return { endingSoon: due.length, noticesSent: sent };
    },
  },
  reminders: {
    key: 'reminders',
    name: 'Overdue reminders',
    description:
      'Chases unpaid invoices at 3 days late (polite), 7 days (firm) and 14 days (final).',
    run: (actor, today) => remindersService.sendDue(actor, today),
  },
};

async function execute(
  job: JobKey,
  trigger: 'schedule' | 'manual',
  triggeredBy: number | null,
  today: string,
) {
  const claim = await queryOne<{ id: number }>(
    pool,
    trigger === 'schedule'
      ? `INSERT INTO job_runs (job, run_date, trigger, triggered_by) VALUES ($1, $2, 'schedule', $3)
         ON CONFLICT (job, run_date) WHERE trigger = 'schedule' DO NOTHING RETURNING id`
      : `INSERT INTO job_runs (job, run_date, trigger, triggered_by) VALUES ($1, $2, 'manual', $3) RETURNING id`,
    [job, today, triggeredBy],
  );
  if (!claim) return null; // another server already ran today's job
  try {
    const result = await DEFS[job].run(await systemActor(), today);
    await query(
      pool,
      `UPDATE job_runs SET status = 'done', result = $2, finished_at = now() WHERE id = $1`,
      [claim.id, result],
    );
    logger.info({ job, trigger, ...result }, 'Automation job finished');
    return { id: claim.id, status: 'done' as const, result };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await query(
      pool,
      `UPDATE job_runs SET status = 'failed', error = $2, finished_at = now() WHERE id = $1`,
      [claim.id, message],
    );
    logger.error({ err, job }, 'Automation job failed');
    return { id: claim.id, status: 'failed' as const, error: message };
  } finally {
    events.publish({ type: 'billing.progress', data: { automation: job, done: true } });
  }
}

let timer: NodeJS.Timeout | null = null;
let ticking = false;

export const automationService = {
  jobs: () => JOBS.map((k) => ({ key: k, name: DEFS[k].name, description: DEFS[k].description })),

  /** Runs every job that has not yet run today, in order. Safe to call often. */
  async tick(today = todayIso()) {
    if (ticking) return;
    ticking = true;
    try {
      for (const job of JOBS) await execute(job, 'schedule', null, today);
    } finally {
      ticking = false;
    }
  },

  async runNow(job: string, actor: Actor) {
    if (!JOBS.includes(job as JobKey)) throw new NotFoundError('Job');
    return execute(job as JobKey, 'manual', actor.userId, todayIso());
  },

  async status() {
    const runs = await query(
      pool,
      `SELECT r.id, r.job, r.run_date, r.trigger, r.status, r.result, r.error, r.started_at, r.finished_at, u.full_name AS triggered_by
       FROM job_runs r LEFT JOIN users u ON u.id = r.triggered_by
       ORDER BY r.started_at DESC LIMIT 40`,
    );
    return {
      enabled: env.AUTOMATION_ENABLED,
      intervalMinutes: env.AUTOMATION_INTERVAL_MINUTES,
      jobs: this.jobs(),
      runs,
    };
  },

  start() {
    if (!env.AUTOMATION_ENABLED || timer) return;
    const every = env.AUTOMATION_INTERVAL_MINUTES * 60_000;
    // First pass shortly after boot, then on an interval; each job still runs once a day.
    setTimeout(
      () => void this.tick().catch((err) => logger.error({ err }, 'Automation tick failed')),
      5_000,
    ).unref();
    timer = setInterval(
      () => void this.tick().catch((err) => logger.error({ err }, 'Automation tick failed')),
      every,
    );
    timer.unref();
    logger.info(`Automation on: daily jobs checked every ${env.AUTOMATION_INTERVAL_MINUTES} min`);
  },

  stop() {
    if (timer) clearInterval(timer);
    timer = null;
  },
};
