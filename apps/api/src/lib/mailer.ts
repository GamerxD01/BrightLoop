import nodemailer from 'nodemailer';
import { env } from '../config/env';
import { pool, queryOne } from '../db/pool';
import { logger } from './logger';

export interface MailAttachment {
  filename: string;
  content: Buffer;
  contentType: string;
  cid?: string;
}

export interface Mail {
  kind: 'welcome' | 'reset' | 'invoice' | 'receipt' | 'reminder' | 'renewal' | 'quote';
  to: string;
  subject: string;
  text: string;
  html?: string;
  attachments?: MailAttachment[];
  entity?: string;
  entityId?: number;
  customerId?: number | null;
  /** Kept out of the log, e.g. a password-reset link that would let a reader take over the account. */
  redactInLog?: string;
}

const transport = env.SMTP_HOST
  ? nodemailer.createTransport({
      host: env.SMTP_HOST,
      port: env.SMTP_PORT,
      secure: env.SMTP_PORT === 465,
      auth: env.SMTP_USER ? { user: env.SMTP_USER, pass: env.SMTP_PASS } : undefined,
    })
  : null;

export const mailConfigured = transport !== null;

/**
 * Sends through SMTP when configured; otherwise records the message only, so
 * development and demos never depend on an outside service. Every email lands
 * in email_log either way, and the Outbox screen shows it.
 */
export async function sendMail(
  mail: Mail,
): Promise<{ id: number; status: 'sent' | 'logged' | 'failed' }> {
  let status: 'sent' | 'logged' | 'failed' = 'logged';
  let error: string | null = null;
  if (transport) {
    try {
      await transport.sendMail({
        from: env.MAIL_FROM,
        to: mail.to,
        subject: mail.subject,
        text: mail.text,
        html: mail.html,
        attachments: mail.attachments,
      });
      status = 'sent';
    } catch (err) {
      status = 'failed';
      error = err instanceof Error ? err.message : String(err);
      logger.error({ err, to: mail.to, kind: mail.kind }, 'Email failed');
    }
  } else {
    logger.info({ to: mail.to, subject: mail.subject }, 'Email recorded (SMTP not configured)');
  }

  const redact = (s: string | undefined) =>
    s && mail.redactInLog ? s.split(mail.redactInLog).join('[link removed from the log]') : s;
  const row = await queryOne<{ id: number }>(
    pool,
    `INSERT INTO email_log (kind, to_address, subject, body_text, body_html, status, error, entity, entity_id, customer_id, attachments)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id`,
    [
      mail.kind,
      mail.to,
      mail.subject,
      redact(mail.text),
      redact(mail.html) ?? null,
      status,
      error,
      mail.entity ?? null,
      mail.entityId ?? null,
      mail.customerId ?? null,
      (mail.attachments ?? []).filter((a) => !a.cid).map((a) => a.filename),
    ],
  );
  return { id: row!.id, status };
}
