import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { LABELS, SUBSCRIPTION_STATUSES, todayIso } from '@brightloop/shared';
import { ButtonLink } from '../../components/Button';
import { Money } from '../../components/Money';
import { PageHeader, Panel } from '../../components/Page';
import { EmptyState, ErrorState, SkeletonBlock } from '../../components/States';
import { api } from '../../lib/api';
import { summarise } from '../automation/AutomationPage';
import {
  formatCompactMoney,
  formatDate,
  formatDateTime,
  formatMonth,
  formatMoney,
  plural,
} from '../../lib/format';
import { useLookups } from '../../lib/queries';
import type { BillingStatus, ReportSummary } from '../../lib/types';
import { useUrlState } from '../../lib/url-state';

const DEFAULTS = { from: '', to: '', planId: '' };

/** Invoiced against collected, month by month. Collected is the series that argues. */
function MonthlyChart({ data }: { data: ReportSummary['monthly'] }) {
  const max = Math.max(1, ...data.map((d) => Math.max(d.invoiced, d.collected)));
  return (
    <figure className="chart">
      <div className="chart__legend">
        <span className="chart__key chart__key--invoiced">Invoiced</span>
        <span className="chart__key chart__key--collected">Collected</span>
      </div>
      <div className="chart__bars" role="img" aria-label="Invoiced and collected by month">
        {data.map((d) => (
          <div key={d.month} className="chart__month">
            <div className="chart__pair">
              <span
                className="chart__bar chart__bar--invoiced"
                style={{ height: `${(d.invoiced / max) * 100}%` }}
                title={`${formatMonth(d.month)} invoiced ${formatMoney(d.invoiced)}`}
              />
              <span
                className="chart__bar chart__bar--collected"
                style={{ height: `${(d.collected / max) * 100}%` }}
                title={`${formatMonth(d.month)} collected ${formatMoney(d.collected)}`}
              />
            </div>
            <span className="chart__label">{formatMonth(d.month)}</span>
          </div>
        ))}
      </div>
      <table className="visually-hidden">
        <caption>Monthly invoiced and collected</caption>
        <thead>
          <tr>
            <th>Month</th>
            <th>Invoiced</th>
            <th>Collected</th>
          </tr>
        </thead>
        <tbody>
          {data.map((d) => (
            <tr key={d.month}>
              <td>{d.month}</td>
              <td>{formatMoney(d.invoiced)}</td>
              <td>{formatMoney(d.collected)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  );
}

/** Today's billing, said plainly: what ran by itself and what is still due. */
function BillingDue({ automation }: { automation?: ReportSummary['automation'] }) {
  const status = useQuery({
    queryKey: ['billing'],
    queryFn: () => api.get<BillingStatus>('/billing'),
  });
  if (!status.data) return null;
  const { due } = status.data;
  const billing = automation?.find((a) => a.job === 'billing');
  return (
    <div className="callout">
      <div className="callout__text">
        <p>
          {due.subscriptions > 0 ? (
            <>
              <strong>{plural(due.subscriptions, 'subscription')}</strong> due for billing today,
              worth <span className="fig">{formatMoney(due.amount)}</span> a period.
            </>
          ) : (
            'Every active subscription is billed up to date.'
          )}
        </p>
        {billing?.finishedAt && (
          <p className="muted">
            Billing ran {billing.trigger === 'schedule' ? 'automatically' : 'by hand'} at{' '}
            {formatDateTime(billing.finishedAt)}
            {billing.result ? `: ${summarise(billing.result) || 'nothing to bill'}` : ''}.
          </p>
        )}
      </div>
      <ButtonLink
        to={due.subscriptions > 0 ? '/billing' : '/automation'}
        variant={due.subscriptions > 0 ? 'primary' : 'secondary'}
      >
        {due.subscriptions > 0 ? 'Run billing now' : 'See automation'}
      </ButtonLink>
    </div>
  );
}

export function DashboardPage() {
  const [filters, setFilters] = useUrlState(DEFAULTS);
  const lookups = useLookups();
  const report = useQuery({
    queryKey: ['dashboard', filters],
    queryFn: () =>
      api.get<ReportSummary>('/reports/summary', {
        from: filters.from,
        to: filters.to,
        planId: filters.planId,
      }),
    placeholderData: (prev) => prev,
  });
  const r = report.data;

  return (
    <>
      <PageHeader
        title="Dashboard"
        meta={r ? `${formatDate(r.range.from)} to ${formatDate(r.range.to)}` : undefined}
      />

      <form className="filters" onSubmit={(e) => e.preventDefault()} aria-label="Dashboard filters">
        <label className="filter">
          <span>From</span>
          <input
            className="input"
            type="date"
            value={filters.from}
            max={filters.to || todayIso()}
            onChange={(e) => setFilters({ from: e.target.value })}
          />
        </label>
        <label className="filter">
          <span>To</span>
          <input
            className="input"
            type="date"
            value={filters.to}
            min={filters.from || undefined}
            max={todayIso()}
            onChange={(e) => setFilters({ to: e.target.value })}
          />
        </label>
        <label className="filter">
          <span>Plan</span>
          <select
            className="input select"
            value={filters.planId}
            onChange={(e) => setFilters({ planId: e.target.value })}
          >
            <option value="">All plans</option>
            {lookups.data?.plans.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
        {(filters.from || filters.to || filters.planId) && (
          <button
            type="button"
            className="btn btn--quiet"
            onClick={() => setFilters({ from: '', to: '', planId: '' })}
          >
            Clear filters
          </button>
        )}
      </form>

      <BillingDue automation={r?.automation} />

      {report.isError && <ErrorState error={report.error} onRetry={() => void report.refetch()} />}
      {!r && !report.isError && <SkeletonBlock lines={6} />}

      {r && (
        <div className={`dash ${report.isFetching ? 'is-refreshing' : ''}`}>
          <dl className="stats">
            <div className="stat">
              <dt>Active subscriptions</dt>
              <dd className="fig">{r.headline.activeSubscriptions.toLocaleString('en-IN')}</dd>
            </div>
            <div className="stat">
              <dt>Monthly recurring revenue</dt>
              <dd className="fig">{formatCompactMoney(r.headline.mrr)}</dd>
            </div>
            <div className="stat">
              <dt>Collected in range</dt>
              <dd className="fig">{formatCompactMoney(r.headline.collected)}</dd>
            </div>
            <div className="stat">
              <dt>Outstanding</dt>
              <dd className="fig">{formatCompactMoney(r.headline.outstanding)}</dd>
            </div>
            <div className="stat">
              <dt>
                <Link to="/invoices?overdue=true">Overdue</Link>
              </dt>
              <dd className={`fig ${r.headline.overdueCount ? 'is-alert' : ''}`}>
                {formatCompactMoney(r.headline.overdueAmount)}
                <span className="stat__sub">{plural(r.headline.overdueCount, 'invoice')}</span>
              </dd>
            </div>
          </dl>

          <div className="dash__grid">
            <Panel title="Invoiced and collected" className="dash__wide">
              {r.monthly.some((m) => m.invoiced || m.collected) ? (
                <MonthlyChart data={r.monthly} />
              ) : (
                <EmptyState title="No invoices in this range">
                  Run billing or widen the dates to see revenue here.
                </EmptyState>
              )}
            </Panel>

            <Panel
              title="Overdue, oldest first"
              actions={<Link to="/invoices?overdue=true">All overdue</Link>}
            >
              {r.topOverdue.length === 0 ? (
                <EmptyState title="Nothing overdue">
                  Every confirmed invoice is within its payment terms.
                </EmptyState>
              ) : (
                <table className="table table--compact">
                  <caption className="visually-hidden">Most overdue invoices</caption>
                  <thead>
                    <tr>
                      <th scope="col">Invoice</th>
                      <th scope="col">Customer</th>
                      <th scope="col" className="num">
                        Days late
                      </th>
                      <th scope="col" className="num">
                        Due
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {r.topOverdue.map((i) => (
                      <tr key={i.id}>
                        <td>
                          <Link to={`/invoices/${i.id}`} className="fig">
                            {i.number}
                          </Link>
                        </td>
                        <td>{i.customerName}</td>
                        <td className="num fig">{i.daysOverdue}</td>
                        <td className="num">
                          <Money value={i.amountDue} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </Panel>

            <Panel
              title="Renewals in the next 30 days"
              actions={<Link to="/subscriptions?expiringWithin=30">All ending soon</Link>}
            >
              {r.renewalsDue.length === 0 ? (
                <EmptyState title="Nothing ending soon">
                  No active subscription ends in the next 30 days.
                </EmptyState>
              ) : (
                <table className="table table--compact">
                  <caption className="visually-hidden">
                    Subscriptions ending in the next 30 days
                  </caption>
                  <thead>
                    <tr>
                      <th scope="col">Subscription</th>
                      <th scope="col">Customer</th>
                      <th scope="col" className="num">
                        Days left
                      </th>
                      <th scope="col">Next step</th>
                    </tr>
                  </thead>
                  <tbody>
                    {r.renewalsDue.map((x) => (
                      <tr key={x.id}>
                        <td>
                          <Link to={`/subscriptions/${x.id}`} className="fig">
                            {x.number}
                          </Link>
                        </td>
                        <td>{x.customerName}</td>
                        <td className={`num fig ${x.daysLeft <= 7 ? 'is-alert' : ''}`}>
                          {x.daysLeft}
                        </td>
                        <td>
                          {x.renewalId ? (
                            <Link to={`/subscriptions/${x.renewalId}`}>Renewal quoted</Link>
                          ) : x.noticeSent ? (
                            'Customer notified'
                          ) : (
                            <span className="muted">Notice goes out today</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </Panel>

            <Panel title="Subscriptions by status">
              <table className="table table--compact">
                <caption className="visually-hidden">Subscriptions by status</caption>
                <tbody>
                  {SUBSCRIPTION_STATUSES.map((s) => (
                    <tr key={s}>
                      <td>
                        <Link to={`/subscriptions?status=${s}`}>
                          {LABELS.subscriptionStatus[s]}
                        </Link>
                      </td>
                      <td className="num fig">
                        {(r.byStatus.find((b) => b.status === s)?.count ?? 0).toLocaleString(
                          'en-IN',
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Panel>

            <Panel title="Recurring revenue by plan" className="dash__wide">
              <table className="table table--compact">
                <caption className="visually-hidden">Recurring revenue by plan</caption>
                <thead>
                  <tr>
                    <th scope="col">Plan</th>
                    <th scope="col" className="num">
                      Active
                    </th>
                    <th scope="col" className="num">
                      Monthly revenue
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {r.byPlan.map((p) => (
                    <tr key={p.planId}>
                      <td>
                        <Link to={`/plans/${p.planId}`}>{p.planName}</Link>
                      </td>
                      <td className="num fig">{p.active.toLocaleString('en-IN')}</td>
                      <td className="num">
                        <Money value={p.mrr} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Panel>
          </div>
        </div>
      )}
    </>
  );
}
