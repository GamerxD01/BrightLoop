import { addMonths, todayIso, type ReportQuery } from '@brightloop/shared';
import { pool } from '../../db/pool';
import { ValidationError } from '../../lib/errors';
import { reportsRepository as repo } from './reports.repository';

export const reportsService = {
  /** Finance overview. Defaults to the last 12 months including this one. */
  async summary(q: ReportQuery) {
    const to = q.to ?? todayIso();
    const from = q.from ?? `${addMonths(to, -11).slice(0, 7)}-01`;
    if (from > to) throw new ValidationError({ from: 'Start must be before end' });
    const planId = q.planId ?? null;

    const [headline, monthly, byStatus, byPlan, topOverdue, renewalsDue, automation, health] =
      await Promise.all([
        repo.headline(pool, from, to, planId),
        repo.monthly(pool, from, to, planId),
        repo.byStatus(pool, planId),
        repo.byPlan(pool),
        repo.topOverdue(pool, planId),
        repo.renewalsDue(pool, planId),
        repo.lastAutomation(pool),
        repo.health(pool, from, to, planId),
      ]);
    return {
      range: { from, to, planId },
      headline,
      health: {
        churnRate: health!.liveInRange ? health!.churned / health!.liveInRange : null,
        churned: health!.churned,
        liveInRange: health!.liveInRange,
        activeCustomers: health!.activeCustomers,
        arpu: health!.activeCustomers ? Math.round(headline!.mrr / health!.activeCustomers) : 0,
        collectionRate: headline!.invoiced ? headline!.collected / headline!.invoiced : null,
        avgDaysToPay: health!.avgDaysToPay,
      },
      monthly,
      byStatus,
      byPlan,
      topOverdue,
      renewalsDue,
      automation,
    };
  },
};
