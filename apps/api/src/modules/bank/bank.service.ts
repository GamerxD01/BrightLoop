import { createHash } from 'node:crypto';
import {
  addDays,
  findInvoiceNumbers,
  formatMoney,
  parseBankStatement,
  todayIso,
  type BankRow,
} from '@brightloop/shared';
import { isUniqueViolation, pool, query, queryOne, withTransaction } from '../../db/pool';
import { audit } from '../../lib/audit';
import { AppError, BadRequestError, NotFoundError, RuleError } from '../../lib/errors';
import type { Actor } from '../../lib/http';
import { paymentsService } from '../payments/payments.service';

type Status = 'matched' | 'suggested' | 'unmatched' | 'ignored' | 'duplicate' | 'posted';

interface OpenInvoice {
  id: number;
  number: string;
  customerName: string;
  company: string | null;
  due: number;
  status: string;
}

export interface BankLine {
  id: number;
  lineNo: number;
  txnDate: string;
  description: string;
  reference: string | null;
  amount: number;
  direction: 'in' | 'out';
  status: Status;
  reason: string | null;
  invoiceId: number | null;
  invoiceNumber: string | null;
  invoiceCustomer: string | null;
  invoiceDue: number | null;
  paymentId: number | null;
}

const fingerprint = (r: BankRow) =>
  createHash('sha256')
    .update(
      [r.date, r.amount, r.reference ?? '', r.description.toLowerCase().replace(/\s+/g, ' ')].join(
        '|',
      ),
    )
    .digest('hex');

/** Words long enough to mean something when looking for a customer name in a narration. */
const nameWords = (s: string) =>
  s
    .toLowerCase()
    .split(/[^a-z]+/)
    .filter((w) => w.length >= 4);

/**
 * Decides what one incoming line most likely pays, strongest evidence first:
 * the invoice number in the narration, then a unique amount, then the
 * customer's name among invoices for that amount.
 */
function match(
  row: BankRow,
  byNumber: Map<string, OpenInvoice>,
  open: OpenInvoice[],
): { status: Status; invoiceId: number | null; reason: string } {
  if (row.direction === 'out')
    return { status: 'ignored', invoiceId: null, reason: 'Money going out' };

  const text = `${row.description} ${row.reference ?? ''}`;
  for (const number of findInvoiceNumbers(text)) {
    const inv = byNumber.get(number);
    if (!inv) continue;
    if (inv.status !== 'confirmed')
      return {
        status: 'unmatched',
        invoiceId: inv.id,
        reason: `${number} is already ${inv.status}`,
      };
    if (row.amount > inv.due)
      return {
        status: 'suggested',
        invoiceId: inv.id,
        reason: `Mentions ${number}, but is ${formatMoney(row.amount - inv.due)} more than is owed`,
      };
    return {
      status: 'matched',
      invoiceId: inv.id,
      reason:
        row.amount === inv.due
          ? `Mentions ${number}; amount is exactly what is owed`
          : `Mentions ${number}; part payment`,
    };
  }

  const sameAmount = open.filter((i) => i.due === row.amount);
  const words = new Set(nameWords(text));
  const named = sameAmount.filter((i) =>
    nameWords(`${i.customerName} ${i.company ?? ''}`).some((w) => words.has(w)),
  );
  if (named.length === 1)
    return {
      status: 'matched',
      invoiceId: named[0]!.id,
      reason: `Customer name and amount match ${named[0]!.number}`,
    };
  if (sameAmount.length === 1)
    return {
      status: 'suggested',
      invoiceId: sameAmount[0]!.id,
      reason: `Only ${sameAmount[0]!.number} is owed exactly this amount`,
    };
  if (sameAmount.length > 1)
    return {
      status: 'unmatched',
      invoiceId: null,
      reason: `${sameAmount.length} invoices are owed this amount; pick one`,
    };

  const byName = open.filter((i) =>
    nameWords(`${i.customerName} ${i.company ?? ''}`).some((w) => words.has(w)),
  );
  if (byName.length === 1)
    return {
      status: 'suggested',
      invoiceId: byName[0]!.id,
      reason: `Name matches ${byName[0]!.customerName}, but the amount differs`,
    };
  return {
    status: 'unmatched',
    invoiceId: null,
    reason: 'No invoice number, amount or name to go on',
  };
}

const LINE_SELECT = `
  SELECT l.id, l.line_no, l.txn_date, l.description, l.reference, l.amount, l.direction, l.status, l.reason,
         l.invoice_id, i.number AS invoice_number, c.name AS invoice_customer,
         CASE WHEN i.id IS NULL THEN NULL ELSE i.amount_total - i.amount_paid END AS invoice_due, l.payment_id
  FROM bank_lines l
  LEFT JOIN invoices i ON i.id = l.invoice_id
  LEFT JOIN customers c ON c.id = i.customer_id`;

export const bankService = {
  async import(input: { filename: string; content: string }, actor: Actor) {
    let parsed;
    try {
      parsed = parseBankStatement(input.content);
    } catch (err) {
      throw new BadRequestError(
        err instanceof Error ? err.message : 'This file could not be read',
        'BAD_STATEMENT',
      );
    }
    if (!parsed.rows.length)
      throw new BadRequestError('No transactions were found in this file', 'EMPTY_STATEMENT');
    if (parsed.rows.length > 5000)
      throw new BadRequestError('Import at most 5,000 lines at a time', 'TOO_MANY_LINES');

    const open = await query<OpenInvoice>(
      pool,
      `SELECT i.id, i.number, c.name AS customer_name, c.company, i.amount_total - i.amount_paid AS due, i.status
       FROM invoices i JOIN customers c ON c.id = i.customer_id
       WHERE i.status = 'confirmed' AND i.amount_total > i.amount_paid`,
    );
    const wanted = [
      ...new Set(
        parsed.rows.flatMap((r) => findInvoiceNumbers(`${r.description} ${r.reference ?? ''}`)),
      ),
    ];
    const named = wanted.length
      ? await query<OpenInvoice>(
          pool,
          `SELECT i.id, i.number, c.name AS customer_name, c.company, i.amount_total - i.amount_paid AS due, i.status
           FROM invoices i JOIN customers c ON c.id = i.customer_id WHERE i.number = ANY($1::text[])`,
          [wanted],
        )
      : [];
    const byNumber = new Map(named.map((i) => [i.number, i]));

    const prints = parsed.rows.map(fingerprint);
    const seen = new Set(
      (
        await query<{ fingerprint: string }>(
          pool,
          `SELECT fingerprint FROM bank_lines WHERE status = 'posted' AND fingerprint = ANY($1::text[])`,
          [prints],
        )
      ).map((r) => r.fingerprint),
    );

    const importId = await withTransaction(async (tx) => {
      const imp = (await queryOne<{ id: number }>(
        tx,
        'INSERT INTO bank_imports (filename, columns, uploaded_by) VALUES ($1, $2, $3) RETURNING id',
        [input.filename.slice(0, 200), JSON.stringify(parsed.columns), actor.userId],
      ))!;
      const inFile = new Set<string>();
      const lines = parsed.rows.map((row, i) => {
        const fp = prints[i]!;
        const repeat = seen.has(fp) || inFile.has(fp);
        inFile.add(fp);
        const m = repeat
          ? {
              status: 'duplicate' as Status,
              invoiceId: null,
              reason: 'Already recorded from an earlier statement',
            }
          : match(row, byNumber, open);
        return { row, fp, ...m };
      });
      await query(
        tx,
        `INSERT INTO bank_lines (import_id, line_no, txn_date, description, reference, amount, direction, fingerprint, status, invoice_id, reason)
         SELECT $1, x.line_no, x.txn_date, x.description, x.reference, x.amount, x.direction, x.fingerprint, x.status, x.invoice_id, x.reason
         FROM unnest($2::int[], $3::date[], $4::text[], $5::text[], $6::bigint[], $7::text[], $8::text[], $9::bank_line_status[], $10::bigint[], $11::text[])
              AS x(line_no, txn_date, description, reference, amount, direction, fingerprint, status, invoice_id, reason)`,
        [
          imp.id,
          lines.map((l) => l.row.lineNo),
          lines.map((l) => l.row.date),
          lines.map((l) => l.row.description),
          lines.map((l) => l.row.reference),
          lines.map((l) => l.row.amount),
          lines.map((l) => l.row.direction),
          lines.map((l) => l.fp),
          lines.map((l) => l.status),
          lines.map((l) => l.invoiceId),
          lines.map((l) => l.reason),
        ],
      );
      await audit(tx, {
        actorId: actor.userId,
        action: 'bank_import',
        entity: 'bank_import',
        entityId: imp.id,
        data: { lines: lines.length, skipped: parsed.errors.length },
        requestId: actor.requestId,
      });
      return imp.id;
    });
    return { ...(await this.get(importId)), skipped: parsed.errors };
  },

  list: () =>
    query(
      pool,
      `SELECT b.id, b.filename, b.created_at, u.full_name AS uploaded_by,
              count(l.id) AS lines,
              count(l.id) FILTER (WHERE l.status = 'posted') AS posted,
              count(l.id) FILTER (WHERE l.status IN ('matched', 'suggested')) AS to_review,
              count(l.id) FILTER (WHERE l.status = 'unmatched') AS unmatched,
              COALESCE(sum(l.amount) FILTER (WHERE l.status = 'posted'), 0) AS posted_amount
       FROM bank_imports b LEFT JOIN bank_lines l ON l.import_id = b.id LEFT JOIN users u ON u.id = b.uploaded_by
       GROUP BY b.id, u.full_name ORDER BY b.created_at DESC LIMIT 50`,
    ),

  async get(id: number) {
    const header = await queryOne<{
      id: number;
      filename: string;
      columns: unknown;
      createdAt: string;
      uploadedBy: string | null;
    }>(
      pool,
      `SELECT b.id, b.filename, b.columns, b.created_at, u.full_name AS uploaded_by
       FROM bank_imports b LEFT JOIN users u ON u.id = b.uploaded_by WHERE b.id = $1`,
      [id],
    );
    if (!header) throw new NotFoundError('Bank import');
    const lines = await query<BankLine>(
      pool,
      `${LINE_SELECT} WHERE l.import_id = $1 ORDER BY l.line_no`,
      [id],
    );
    return { ...header, lines };
  },

  /** Staff point a line at another invoice (by number) or set it aside. */
  async updateLine(
    importId: number,
    lineId: number,
    change: { invoiceNumber?: string | null; ignore?: boolean },
    actor: Actor,
  ) {
    const line = await queryOne<{ status: Status; amount: number; direction: string }>(
      pool,
      'SELECT status, amount, direction FROM bank_lines WHERE id = $1 AND import_id = $2',
      [lineId, importId],
    );
    if (!line) throw new NotFoundError('Bank line');
    if (line.status === 'posted' || line.status === 'duplicate')
      throw new RuleError(`This line is ${line.status}`);

    if (change.ignore) {
      await query(
        pool,
        `UPDATE bank_lines SET status = 'ignored', invoice_id = NULL, reason = 'Set aside by ' || $2, updated_at = now() WHERE id = $1`,
        [lineId, `staff`],
      );
    } else if (change.invoiceNumber) {
      const number =
        findInvoiceNumbers(change.invoiceNumber)[0] ?? change.invoiceNumber.trim().toUpperCase();
      const inv = await queryOne<{ id: number; status: string; due: number }>(
        pool,
        'SELECT id, status, amount_total - amount_paid AS due FROM invoices WHERE number = $1',
        [number],
      );
      if (!inv)
        throw new AppError(422, 'VALIDATION_FAILED', 'No invoice with that number', {
          invoiceNumber: `${number} not found`,
        });
      if (inv.status !== 'confirmed')
        throw new AppError(422, 'VALIDATION_FAILED', `That invoice is ${inv.status}`, {
          invoiceNumber: `${number} is ${inv.status}`,
        });
      if (line.direction === 'out') throw new RuleError('Money going out cannot pay an invoice');
      const status: Status = line.amount <= inv.due ? 'matched' : 'suggested';
      await query(
        pool,
        `UPDATE bank_lines SET status = $2, invoice_id = $3, reason = $4, updated_at = now() WHERE id = $1`,
        [
          lineId,
          status,
          inv.id,
          line.amount <= inv.due
            ? `Chosen by staff`
            : `Chosen by staff; ${formatMoney(line.amount - inv.due)} more than is owed`,
        ],
      );
    } else {
      await query(
        pool,
        `UPDATE bank_lines SET status = 'unmatched', invoice_id = NULL, reason = 'Cleared by staff', updated_at = now() WHERE id = $1`,
        [lineId],
      );
    }
    await audit(pool, {
      actorId: actor.userId,
      action: 'bank_line_update',
      entity: 'bank_line',
      entityId: lineId,
      data: change,
      requestId: actor.requestId,
    });
    return (await queryOne<BankLine>(pool, `${LINE_SELECT} WHERE l.id = $1`, [lineId]))!;
  },

  /**
   * Records a payment for every approved line, one line at a time so one
   * problem (an invoice paid meanwhile, an overpayment) never blocks the rest.
   * The posted-once index means a bank transaction can never pay twice.
   */
  async post(importId: number, lineIds: number[], actor: Actor) {
    const lines = await query<BankLine>(
      pool,
      `${LINE_SELECT} WHERE l.import_id = $1 AND l.id = ANY($2::bigint[]) AND l.status IN ('matched', 'suggested') ORDER BY l.line_no`,
      [importId, lineIds],
    );
    const results: { lineId: number; ok: boolean; message: string }[] = [];
    for (const line of lines) {
      try {
        const amount = Math.min(line.amount, line.invoiceDue ?? 0);
        if (!line.invoiceId || amount <= 0)
          throw new RuleError('Nothing is owed on that invoice now');
        const paidOn = line.txnDate > todayIso() ? todayIso() : line.txnDate;
        const input = {
          invoiceId: line.invoiceId,
          amount,
          method: 'bank_transfer' as const,
          paidOn,
          note: `Bank statement: ${line.reference ?? line.description}`.slice(0, 500),
        };
        // Line and payment change together, or not at all.
        const done = await withTransaction(async (tx) => {
          const locked = await queryOne(
            tx,
            `SELECT id FROM bank_lines WHERE id = $1 AND status IN ('matched', 'suggested') FOR UPDATE`,
            [line.id],
          );
          if (!locked) throw new RuleError('Already handled');
          const paid = await paymentsService.recordInTx(tx, input, actor);
          await query(
            tx,
            `UPDATE bank_lines SET status = 'posted', payment_id = $2, reason = $3, updated_at = now() WHERE id = $1`,
            [
              line.id,
              paid.paymentId,
              amount < line.amount
                ? `Recorded ${formatMoney(amount)}; ${formatMoney(line.amount - amount)} more than was owed`
                : `Recorded against ${line.invoiceNumber}`,
            ],
          );
          return paid;
        });
        await paymentsService.announce(done.invoiceId, done.customerId, input);
        results.push({
          lineId: line.id,
          ok: true,
          message: `${formatMoney(amount)} to ${line.invoiceNumber}`,
        });
      } catch (err) {
        if (isUniqueViolation(err, 'bank_lines_posted_once')) {
          await query(
            pool,
            `UPDATE bank_lines SET status = 'duplicate', invoice_id = NULL, reason = 'Already recorded from an earlier statement' WHERE id = $1`,
            [line.id],
          );
          results.push({
            lineId: line.id,
            ok: false,
            message: 'Already recorded from an earlier statement',
          });
        } else {
          const message = err instanceof Error ? err.message : 'Failed';
          await query(
            pool,
            `UPDATE bank_lines SET reason = $2, updated_at = now() WHERE id = $1 AND status <> 'posted'`,
            [line.id, message],
          );
          results.push({ lineId: line.id, ok: false, message });
        }
      }
    }
    await audit(pool, {
      actorId: actor.userId,
      action: 'bank_post',
      entity: 'bank_import',
      entityId: importId,
      data: { results },
      requestId: actor.requestId,
    });
    return {
      posted: results.filter((r) => r.ok).length,
      failed: results.filter((r) => !r.ok),
      results,
    };
  },

  /**
   * A realistic statement for a demo, built from today's open invoices:
   * some lines quote the invoice, some only the amount, one is part-paid,
   * plus money going out and a payment nobody can place.
   */
  async sample() {
    const open = await query<{ number: string; customerName: string; due: number }>(
      pool,
      `SELECT i.number, c.name AS customer_name, i.amount_total - i.amount_paid AS due
       FROM invoices i JOIN customers c ON c.id = i.customer_id
       WHERE i.status = 'confirmed' AND i.amount_total > i.amount_paid ORDER BY i.due_date LIMIT 6`,
    );
    const day = (n: number) => addDays(todayIso(), -n).split('-').reverse().join('/');
    const money = (p: number) =>
      (p / 100).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const q = (s: string) => `"${s.replace(/"/g, '""')}"`;
    const rows: string[] = [];
    open.forEach((inv, i) => {
      const name = inv.customerName.toUpperCase();
      const tail = inv.number.split('/').at(-1)!;
      if (i % 3 === 0)
        rows.push(
          [
            day(i),
            q(`NEFT CR-${name}-${inv.number}`),
            `N${300120 + i}`,
            '',
            q(money(inv.due)),
          ].join(','),
        );
      else if (i % 3 === 1)
        rows.push(
          [
            day(i),
            q(`UPI/${name.split(' ')[0]}/PAYMENT INV-${inv.number.split('/')[1]}-${Number(tail)}`),
            `UTR${880000 + i}`,
            '',
            q(money(Math.round(inv.due / 2))),
          ].join(','),
        );
      else
        rows.push([day(i), q(`IMPS ${name}`), `IMPS${4400 + i}`, '', q(money(inv.due))].join(','));
    });
    rows.push([day(1), q('ACH DEBIT - OFFICE RENT'), 'ACH9912', q('35,000.00'), ''].join(','));
    rows.push([day(2), q('NEFT CR-UNKNOWN SENDER'), 'N777001', '', q('1,234.00')].join(','));
    return [
      'Brightloop Software Private Limited,,,,',
      'Account,Demo Bank current account,,,',
      'Date,Narration,Chq./Ref.No.,Withdrawal Amt.,Deposit Amt.',
      ...rows,
    ].join('\r\n');
  },
};
