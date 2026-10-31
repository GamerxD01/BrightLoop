import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { todayIso } from '@brightloop/shared';
import { Button } from '../../components/Button';
import { Checkbox, TextField } from '../../components/Field';
import { Facts, PageHeader, Panel } from '../../components/Page';
import { ErrorState, SkeletonBlock } from '../../components/States';
import { useToast } from '../../components/Toast';
import { ApiError, api } from '../../lib/api';
import { formatDate, formatDateTime, formatMoney, plural } from '../../lib/format';
import type { BillingProgress } from '../../lib/realtime';
import type { BillingStatus } from '../../lib/types';

/**
 * Billing day. One button bills every due subscription; progress streams in
 * live. Running it twice is safe: periods already billed are skipped.
 */
export function BillingPage() {
  const qc = useQueryClient();
  const toast = useToast();
  const [asOf, setAsOf] = useState(todayIso());
  const [autoConfirm, setAutoConfirm] = useState(true);
  const status = useQuery({
    queryKey: ['billing'],
    queryFn: () => api.get<BillingStatus>('/billing'),
  });
  const progress = useQuery<BillingProgress | null>({
    queryKey: ['billing-progress'],
    queryFn: () => null,
    staleTime: Infinity,
    enabled: false,
  });

  const run = useMutation({
    mutationFn: () =>
      api.post<NonNullable<BillingStatus['lastRun']>>('/billing/run', { asOf, autoConfirm }),
    onMutate: () =>
      qc.setQueryData(['billing-progress'], {
        processed: 0,
        total: status.data?.due.subscriptions ?? 0,
        invoices: 0,
      }),
    onSuccess: (r) => {
      toast.show(
        r.invoicesCreated
          ? `Created ${plural(r.invoicesCreated, 'invoice')}`
          : 'Nothing new to bill',
      );
      void qc.invalidateQueries({ queryKey: ['billing'] });
      void qc.invalidateQueries({ queryKey: ['invoices'] });
    },
    onError: (err) =>
      toast.show(err instanceof ApiError ? err.message : 'Billing run failed', 'error'),
  });

  if (status.isError)
    return <ErrorState error={status.error} onRetry={() => void status.refetch()} />;
  if (!status.data) return <SkeletonBlock />;
  const s = status.data;
  const p = progress.data;
  const pct = p && p.total ? Math.min(100, Math.round((p.processed / p.total) * 100)) : 0;

  return (
    <>
      <PageHeader title="Billing run" />
      <div className="detail">
        <div className="detail__main">
          <Panel title="Bill everything that is due">
            <p className="lead-text">
              {s.due.subscriptions > 0 ? (
                <>
                  <strong>{plural(s.due.subscriptions, 'subscription')}</strong> have a period
                  starting on or before today, worth{' '}
                  <span className="fig">{formatMoney(s.due.amount)}</span> a period before
                  discounts.
                </>
              ) : (
                'Every active subscription is billed up to date.'
              )}
            </p>
            <form
              className="inline-form"
              onSubmit={(e) => {
                e.preventDefault();
                run.mutate();
              }}
            >
              <TextField
                label="Bill up to"
                type="date"
                max={todayIso()}
                value={asOf}
                onChange={(e) => setAsOf(e.target.value)}
              />
              <Checkbox
                label="Confirm the new invoices"
                hint="Leave off to review them as drafts first"
                checked={autoConfirm}
                onChange={(e) => setAutoConfirm(e.target.checked)}
              />
              <Button type="submit" variant="primary" pending={run.isPending || !!s.running}>
                Run billing
              </Button>
            </form>
            {(run.isPending || s.running) && p && (
              <div
                className="progress"
                role="progressbar"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={pct}
                aria-label="Billing progress"
              >
                <div className="progress__track">
                  <div className="progress__fill" style={{ transform: `scaleX(${pct / 100})` }} />
                </div>
                <p className="progress__text">
                  <span className="fig">{p.processed}</span> of{' '}
                  <span className="fig">{p.total}</span> subscriptions,{' '}
                  <span className="fig">{p.invoices}</span> invoices so far
                </p>
              </div>
            )}
          </Panel>
          <Panel title="How it stays correct">
            <ul className="plainlist plainlist--spaced">
              <li>
                Each subscription gets one invoice per period. The database refuses a second one, so
                a run can be repeated safely.
              </li>
              <li>
                A subscription that missed several periods gets one invoice for each; none is
                skipped.
              </li>
              <li>
                Paused periods are not billed, and plans set to close at expiry are closed by the
                run.
              </li>
              <li>
                Discounts attached to a subscription are applied while they are valid and stop when
                they expire or run out.
              </li>
            </ul>
          </Panel>
        </div>
        <aside className="detail__side">
          <Panel title="Last run">
            {s.lastRun ? (
              <Facts
                items={[
                  ['Finished', formatDateTime(s.lastRun.finishedAt)],
                  ['Billed up to', formatDate(s.lastRun.asOf)],
                  ['Subscriptions', String(s.lastRun.subscriptionsBilled)],
                  [
                    'Invoices created',
                    <Link key="i" to="/invoices">
                      {s.lastRun.invoicesCreated}
                    </Link>,
                  ],
                  ['Confirmed', String(s.lastRun.invoicesConfirmed)],
                  ['Closed at expiry', String(s.lastRun.autoClosed)],
                  ['Took', `${(s.lastRun.durationMs / 1000).toFixed(1)} s`],
                ]}
              />
            ) : (
              <p className="muted">No run since the server started.</p>
            )}
          </Panel>
        </aside>
      </div>
    </>
  );
}
