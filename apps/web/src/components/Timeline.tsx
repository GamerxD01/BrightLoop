import { LABELS } from '@brightloop/shared';
import { formatDateTime } from '../lib/format';
import type { SubscriptionEvent } from '../lib/types';

/** Where a subscription has been: every status change, who made it and when. */
export function Timeline({ events }: { events: SubscriptionEvent[] }) {
  return (
    <ol className="timeline">
      {[...events].reverse().map((e) => (
        <li key={e.id} className="timeline__item">
          <p className="timeline__what">
            {e.fromStatus && e.fromStatus !== e.toStatus
              ? `${LABELS.subscriptionStatus[e.fromStatus]} to ${LABELS.subscriptionStatus[e.toStatus]}`
              : (e.note ?? LABELS.subscriptionStatus[e.toStatus])}
          </p>
          <p className="timeline__meta">
            {formatDateTime(e.createdAt)}, {e.actorName ?? 'System'}
            {e.note && e.fromStatus && e.fromStatus !== e.toStatus ? `. ${e.note}` : ''}
          </p>
        </li>
      ))}
    </ol>
  );
}
