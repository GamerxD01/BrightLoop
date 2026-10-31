import nodemailer from 'nodemailer';
import { env } from '../config/env';
import { logger } from './logger';

export interface Mail {
  to: string;
  subject: string;
  text: string;
}

const transport = env.SMTP_HOST
  ? nodemailer.createTransport({
      host: env.SMTP_HOST,
      port: env.SMTP_PORT,
      secure: env.SMTP_PORT === 465,
      auth: env.SMTP_USER ? { user: env.SMTP_USER, pass: env.SMTP_PASS } : undefined,
    })
  : null;

/**
 * Sends through SMTP when configured; otherwise writes the message to the log
 * so local development and demos never depend on an outside service.
 */
export async function sendMail(mail: Mail): Promise<void> {
  if (!transport) {
    logger.info(
      { to: mail.to, subject: mail.subject },
      `✉  Email (SMTP not configured)\n${mail.text}`,
    );
    return;
  }
  await transport.sendMail({ from: env.MAIL_FROM, ...mail });
}
