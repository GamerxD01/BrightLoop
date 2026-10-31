import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  SUBSCRIPTION_TRANSITIONS,
  availableSubscriptionActions,
  formatPercent,
  isSubscriptionEditable,
  todayIso,
  type SubscriptionAction,
} from '@brightloop/shared';
import { Button, ButtonLink } from '../../components/Button';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { Money } from '../../components/Money';
import { Facts, PageHeader, Panel } from '../../components/Page';
import { ErrorState, SkeletonBlock } from '../../components/States';
import { InvoiceStatusTag, SubscriptionStatusTag } from '../../components/Status';
import { DataTable, EmptyState } from '../../components/Table';
import { Timeline } from '../../components/Timeline';
import { useToast } from '../../components/Toast';
import { ApiError, api } from '../../lib/api';
import { formatDate, formatPeriod } from '../../lib/format';
import { useLookups } from '../../lib/queries';
import { ChangePanel } from './ChangePanel';
import type { InvoiceRow, Subscription } from '../../lib/types';

/** The step that moves the deal forward is the one filled button. */
const FORWARD: SubscriptionAction[] = ['send_quotation', 'confirm', 'activate', 'resume'];
const LABEL: Record<SubscriptionAction, string> = {
  ...Object.fromEntries(Object.entries(SUBSCRIPTION_TRANSITIONS).map(([k, v]) => [k, v.label])),
  renew: 'Renew',
} as Record<SubscriptionAction, string>;

export function SubscriptionActions({ sub, basePath }: { sub: Subscription; basePath: string }) {
  const qc = useQueryClient();
  const toast = useToast();
  const navigate = useNavigate();
  const [confirming, setConfirming] = useState(false);
  const [deletingDraft, setDeletingDraft] = useState(false);
  const removeDraft = useMutation({
    mutationFn: () => api.delete(`/subscriptions/${sub.id}`),
    onSuccess: () => {
      toast.show(`Draft ${sub.number} deleted`);
      void qc.invalidateQueries({ queryKey: ['subscriptions'] });
      navigate('/subscriptions');
    },
    onError: (err) =>
      toast.show(err instanceof ApiError ? err.message : 'Could not delete', 'error'),
  });
  const isPortal = basePath.startsWith('/portal');
  const actions = availableSubscriptionActions(sub.status, sub).filter(
    (a) => !isPortal || ['confirm', 'pause', 'resume', 'close', 'renew'].includes(a),
  );

  const act = useMutation({
    mutationFn: (action: SubscriptionAction) =>
      api.post<Subscription>(`${isPortal ? '/portal' : ''}/subscriptions/${sub.id}/actions`, {
        action,
      }),
    onSuccess: (updated, action) => {
      setConfirming(false);
      void qc.invalidateQueries({ queryKey: ['subscription'] });
      void qc.invalidateQueries({ queryKey: ['portal'] });
      if (action === 'renew') {
        toast.show(`Renewal ${updated.number} created as a quotation`);
        navigate(`${basePath}/${updated.id}`);
      } else {
        toast.show(`${sub.number} is now ${updated.status}`);
      }
    },
    onError: (err) =>
      toast.show(err instanceof ApiError ? err.message : 'That did not work', 'error'),
  });

  const bill = useMutation({
    mutationFn: () => api.post<{ invoiceIds: number[] }>(`/billing/subscriptions/${sub.id}`),
    onSuccess: (r) => {
      toast.show(
        r.invoiceIds.length ? `Created ${r.invoiceIds.length} invoice(s)` : 'Nothing new to bill',
      );
      void qc.invalidateQueries({ queryKey: ['invoices'] });
      void qc.invalidateQueries({ queryKey: ['subscription'] });
    },
    onError: (err) => toast.show(err instanceof ApiError ? err.message : 'Could not bill', 'error'),
  });

  const due = sub.status === 'active' && sub.nextInvoiceDate && sub.nextInvoiceDate <= todayIso();
  const forward = actions.find((a) => FORWARD.includes(a));

  return (
    <>
      {!isPortal && sub.status === 'draft' && sub.events.length <= 1 && (
        <Button variant="danger" onClick={() => setDeletingDraft(true)}>
          Delete draft
        </Button>
      )}
      {!isPortal && isSubscriptionEditable(sub.status) && (
        <ButtonLink to={`/subscriptions/${sub.id}/edit`}>Edit</ButtonLink>
      )}
      {!isPortal && due && (
        <Button onClick={() => bill.mutate()} pending={bill.isPending}>
          Create invoice now
        </Button>
      )}
      {actions
        .filter((a) => a !== forward)
        .map((a) => (
          <Button
            key={a}
            variant={a === 'close' ? 'danger' : 'secondary'}
            disabled={act.isPending}
            onClick={() => (a === 'close' ? setConfirming(true) : act.mutate(a))}
          >
            {LABEL[a]}
          </Button>
        ))}
      {forward && (
        <Button
          variant="primary"
          pending={act.isPending && act.variables === forward}
          onClick={() => act.mutate(forward)}
        >
          {isPortal && forward === 'confirm' ? 'Accept quotation' : LABEL[forward]}
        </Button>
      )}
      <ConfirmDialog
        open={deletingDraft}
        title={`Delete draft ${sub.number}?`}
        confirmLabel="Delete draft"
        pending={removeDraft.isPending}
        onCancel={() => setDeletingDraft(false)}
        onConfirm={() => removeDraft.mutate()}
      >
        <p>
          The draft was never sent to the customer, so it is removed entirely. This cannot be
          undone.
        </p>
      </ConfirmDialog>
      <ConfirmDialog
        open={confirming}
        title={`Close ${sub.number}?`}
        confirmLabel="Close subscription"
        pending={act.isPending}
        onCancel={() => setConfirming(false)}
        onConfirm={() => act.mutate('close')}
      >
        <p>
          Billing stops and no further invoices are created. Invoices already issued stay as they
          are. A closed subscription cannot be reopened, only renewed.
        </p>
      </ConfirmDialog>
    </>
  );
}

export function SubscriptionLines({ sub }: { sub: Subscription }) {
  return (
    <div className="table-wrap">
      <table className="table">
        <caption className="visually-hidden">Lines</caption>
        <thead>
          <tr>
            <th scope="col">Item</th>
            <th scope="col" className="num">
              Qty
            </th>
            <th scope="col" className="num">
              Unit price
            </th>
            <th scope="col" className="num">
              Tax
            </th>
            <th scope="col" className="num">
              Amount
            </th>
          </tr>
        </thead>
        <tbody>
          {sub.lines.map((l) => (
            <tr key={l.id}>
              <td>{l.description}</td>
              <td className="num fig">{l.quantity}</td>
              <td className="num">
                <Money value={l.unitPrice} />
              </td>
              <td className="num fig">{formatPercent(l.taxRateBp)}</td>
              <td className="num">
                <Money value={l.unitPrice * l.quantity} />
              </td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr>
            <th scope="row" colSpan={4}>
              Untaxed
            </th>
            <td className="num">
              <Money value={sub.amountUntaxed} />
            </td>
          </tr>
          <tr>
            <th scope="row" colSpan={4}>
              Tax
            </th>
            <td className="num">
              <Money value={sub.amountTax} />
            </td>
          </tr>
          <tr className="is-total">
            <th scope="row" colSpan={4}>
              Total per period, before discounts
            </th>
            <td className="num">
              <Money value={sub.amountTotal} />
            </td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

export function SubscriptionDetailPage() {
  const id = Number(useParams().id);
  const lookups = useLookups();
  const sub = useQuery({
    queryKey: ['subscription', id],
    queryFn: () => api.get<Subscription>(`/subscriptions/${id}`),
  });
  const invoices = useQuery({
    queryKey: ['invoices', { subscriptionId: id }],
    queryFn: () =>
      api.list<InvoiceRow>('/invoices', {
        subscriptionId: id,
        pageSize: 50,
        sort: 'invoiceDate',
        dir: 'desc',
      }),
  });

  if (sub.isError) return <ErrorState error={sub.error} onRetry={() => void sub.refetch()} />;
  if (!sub.data) return <SkeletonBlock lines={8} />;
  const s = sub.data;
  const discounts = lookups.data?.discounts.filter((d) => s.discountIds.includes(d.id)) ?? [];

  return (
    <>
      <PageHeader
        crumbs={[{ label: 'Subscriptions', to: '/subscriptions' }, { label: s.number }]}
        title={<span className="fig">{s.number}</span>}
        meta={
          <>
            <SubscriptionStatusTag status={s.status} /> {s.customerName}, {s.planName}
          </>
        }
        actions={<SubscriptionActions sub={s} basePath="/subscriptions" />}
      />
      <div className="detail">
        <div className="detail__main">
          <Panel title="Lines">
            <SubscriptionLines sub={s} />
          </Panel>
          {s.status === 'active' && lookups.data && (
            <ChangePanel
              sub={s}
              addons={lookups.data.products.filter((p) => p.isActive)}
              portal={false}
            />
          )}
          <Panel
            title="Invoices"
            actions={<Link to={`/invoices?subscriptionId=${s.id}`}>Open in invoices</Link>}
          >
            <DataTable
              caption="Invoices for this subscription"
              query={invoices}
              rowKey={(i) => i.id}
              columns={[
                {
                  key: 'n',
                  header: 'Invoice',
                  cell: (i) => (
                    <Link to={`/invoices/${i.id}`} className="fig">
                      {i.number}
                    </Link>
                  ),
                },
                {
                  key: 'd',
                  header: 'Issued',
                  cell: (i) => <span className="fig">{formatDate(i.invoiceDate)}</span>,
                },
                {
                  key: 's',
                  header: 'Status',
                  cell: (i) => <InvoiceStatusTag status={i.status} overdue={i.isOverdue} />,
                },
                {
                  key: 't',
                  header: 'Total',
                  align: 'end',
                  cell: (i) => <Money value={i.amountTotal} />,
                },
              ]}
              empty={
                <EmptyState title="No invoices yet">
                  {s.status === 'active'
                    ? 'The billing run creates them on each period start.'
                    : 'Invoices start once the subscription is active.'}
                </EmptyState>
              }
            />
          </Panel>
        </div>
        <aside className="detail__side">
          <Panel title="Details">
            <Facts
              items={[
                [
                  'Customer',
                  <Link key="c" to={`/customers/${s.customerId}`}>
                    {s.customerName}
                  </Link>,
                ],
                ['Plan', s.planName],
                ['Bills', formatPeriod(s.billingPeriod, s.billingInterval)],
                [
                  'Starts',
                  <span key="s" className="fig">
                    {formatDate(s.startDate)}
                  </span>,
                ],
                [
                  'Expires',
                  <span key="e" className="fig">
                    {s.expiryDate ? formatDate(s.expiryDate) : 'Runs until closed'}
                  </span>,
                ],
                [
                  'Next invoice',
                  <span key="n" className="fig">
                    {formatDate(s.nextInvoiceDate)}
                  </span>,
                ],
                ['Payment terms', s.paymentTermName],
                ...(s.quoteValidUntil && ['draft', 'quotation'].includes(s.status)
                  ? [
                      [
                        'Quote valid until',
                        <span key="q" className="fig">
                          {formatDate(s.quoteValidUntil)}
                        </span>,
                      ] as [string, React.ReactNode],
                    ]
                  : []),
                ...(s.templateName
                  ? [['From template', s.templateName] as [string, React.ReactNode]]
                  : []),
                ...(s.renewedFromNumber
                  ? [
                      [
                        'Renews',
                        <Link key="r" to={`/subscriptions/${s.renewedFromId}`} className="fig">
                          {s.renewedFromNumber}
                        </Link>,
                      ] as [string, React.ReactNode],
                    ]
                  : []),
                [
                  'Plan rules',
                  [
                    s.pausable && 'can pause',
                    s.closable ? 'can close early' : 'runs to term',
                    s.renewable && 'renewable',
                    s.autoClose && 'closes at expiry',
                  ]
                    .filter(Boolean)
                    .join(', '),
                ],
              ]}
            />
          </Panel>
          <Panel title="Discounts">
            {discounts.length === 0 ? (
              <p className="muted">None attached.</p>
            ) : (
              <ul className="plainlist">
                {discounts.map((d) => (
                  <li key={d.id}>
                    <Link to={`/discounts/${d.id}`}>{d.name}</Link>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
          {s.notes && (
            <Panel title="Notes">
              <p>{s.notes}</p>
            </Panel>
          )}
          <Panel title="History">
            <Timeline events={s.events} />
          </Panel>
        </aside>
      </div>
    </>
  );
}
