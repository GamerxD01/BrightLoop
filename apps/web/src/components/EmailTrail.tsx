import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { api } from '../lib/api';
import { formatDateTime } from '../lib/format';
import type { EmailLogRow } from '../lib/types';

const KIND: Record<string, string> = {
  invoice: 'Invoice',
  receipt: 'Payment receipt',
  reminder: 'Payment reminder',
  renewal: 'Renewal notice',
  welcome: 'Welcome',
  reset: 'Password reset',
  quote: 'Quotation',
};

export const emailKindLabel = (kind: string) => KIND[kind] ?? kind;

/** Emails sent about one record, newest first, each linking to its copy in the outbox. */
export function EmailTrail({
  entity,
  entityId,
}: {
  entity: 'invoice' | 'subscription' | 'customer';
  entityId: number;
}) {
  const q = useQuery({
    queryKey: ['outbox', entity, entityId],
    queryFn: () => api.list<EmailLogRow>('/outbox', { entity, entityId, pageSize: 20 }),
  });
  if (!q.data) return <p className="muted">Loading…</p>;
  if (q.data.data.length === 0) return <p className="muted">No emails yet.</p>;
  return (
    <ul className="trail">
      {q.data.data.map((m) => (
        <li key={m.id}>
          <Link to={`/outbox/${m.id}`}>{emailKindLabel(m.kind)}</Link>
          <span className="cell-sub">
            {formatDateTime(m.createdAt)},{' '}
            {m.status === 'failed'
              ? 'failed to send'
              : m.status === 'sent'
                ? 'delivered to the mail server'
                : 'recorded (no mail server set up)'}
          </span>
        </li>
      ))}
    </ul>
  );
}
