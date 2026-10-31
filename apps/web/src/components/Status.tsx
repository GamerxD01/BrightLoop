import { LABELS, type InvoiceStatus, type SubscriptionStatus } from '@brightloop/shared';

/**
 * One status vocabulary used everywhere. An ink outline for every state;
 * only a settled one (Paid, Active) is set in the pressed coral ink, and
 * Overdue takes the error tone.
 */
export function SubscriptionStatusTag({ status }: { status: SubscriptionStatus }) {
  return <span className={`tag tag--${status}`}>{LABELS.subscriptionStatus[status]}</span>;
}

export function InvoiceStatusTag({
  status,
  overdue,
}: {
  status: InvoiceStatus;
  overdue?: boolean;
}) {
  if (overdue) return <span className="tag tag--overdue">Overdue</span>;
  return <span className={`tag tag--${status}`}>{LABELS.invoiceStatus[status]}</span>;
}

export function ActiveTag({
  active,
  on = 'Active',
  off = 'Archived',
}: {
  active: boolean;
  on?: string;
  off?: string;
}) {
  return (
    <span className={`tag ${active ? 'tag--plain' : 'tag--closed'}`}>{active ? on : off}</span>
  );
}
