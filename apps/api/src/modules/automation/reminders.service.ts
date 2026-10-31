import { todayIso } from '@brightloop/shared';
import { pool, query, queryOne } from '../../db/pool';
import { RuleError } from '../../lib/errors';
import type { Actor } from '../../lib/http';
import { invoicesService } from '../invoices/invoices.service';
import { notifications } from '../notifications/notifications.service';

/** Days late at which each reminder goes out. */
export const REMINDER_STAGES: { stage: 1 | 2 | 3; afterDays: number; tone: string }[] = [
  { stage: 1, afterDays: 3, tone: 'Polite' },
  { stage: 2, afterDays: 7, tone: 'Firm' },
  { stage: 3, afterDays: 14, tone: 'Final' },
];

export function stageFor(daysLate: number): 0 | 1 | 2 | 3 {
  let stage: 0 | 1 | 2 | 3 = 0;
  for (const s of REMINDER_STAGES) if (daysLate >= s.afterDays) stage = s.stage;
  return stage;
}

const daysBetween = (from: string, to: string) =>
  Math.round((Date.parse(to) - Date.parse(from)) / 86_400_000);

export const remindersService = {
  /**
   * One pass over overdue invoices. Each gets the reminder for the stage it
   * has reached, once: the stage is claimed with an insert before the email
   * goes, so two servers can never both send it. An invoice that jumped past
   * a stage (say, first seen at 10 days late) gets only the current one.
   */
  async sendDue(actor: Actor, today = todayIso()) {
    const due = await query<{ id: number; dueDate: string; sent: number | null }>(
      pool,
      `SELECT i.id, i.due_date, (SELECT max(stage) FROM invoice_reminders r WHERE r.invoice_id = i.id AND r.stage > 0) AS sent
       FROM invoices i
       WHERE i.status = 'confirmed' AND i.due_date <= $1::date - 3
       ORDER BY i.due_date, i.id`,
      [today],
    );
    let sent = 0;
    for (const row of due) {
      const daysLate = daysBetween(row.dueDate, today);
      const stage = stageFor(daysLate);
      if (stage === 0 || (row.sent ?? 0) >= stage) continue;
      const claim = await queryOne<{ id: number }>(
        pool,
        `INSERT INTO invoice_reminders (invoice_id, stage, sent_by) VALUES ($1, $2, $3)
         ON CONFLICT (invoice_id, stage) WHERE stage > 0 DO NOTHING RETURNING id`,
        [row.id, stage, actor.userId],
      );
      if (!claim) continue;
      const email = await notifications.reminder(
        await invoicesService.get(row.id),
        stage,
        daysLate,
      );
      await query(pool, 'UPDATE invoice_reminders SET email_id = $2 WHERE id = $1', [
        claim.id,
        email.id,
      ]);
      sent += 1;
    }
    return { overdue: due.length, remindersSent: sent };
  },

  /** "Send reminder" from an invoice page; at most one a day so a double click cannot spam. */
  async sendNow(invoiceId: number, actor: Actor) {
    const inv = await invoicesService.get(invoiceId);
    if (inv.status !== 'confirmed')
      throw new RuleError('Only confirmed, unpaid invoices can be chased');
    const recent = await queryOne(
      pool,
      `SELECT 1 FROM invoice_reminders WHERE invoice_id = $1 AND created_at > now() - interval '20 hours'`,
      [invoiceId],
    );
    if (recent) throw new RuleError('A reminder already went out today');
    const daysLate = Math.max(0, daysBetween(inv.dueDate, todayIso()));
    const email = await notifications.reminder(inv, 0, daysLate);
    await query(
      pool,
      'INSERT INTO invoice_reminders (invoice_id, stage, email_id, sent_by) VALUES ($1, 0, $2, $3)',
      [invoiceId, email.id, actor.userId],
    );
    return { emailId: email.id };
  },

  history: (invoiceId: number) =>
    query<{
      id: number;
      stage: number;
      emailId: number | null;
      sentBy: string | null;
      createdAt: string;
    }>(
      pool,
      `SELECT r.id, r.stage, r.email_id, u.full_name AS sent_by, r.created_at
       FROM invoice_reminders r LEFT JOIN users u ON u.id = r.sent_by
       WHERE r.invoice_id = $1 ORDER BY r.created_at DESC`,
      [invoiceId],
    ),
};
