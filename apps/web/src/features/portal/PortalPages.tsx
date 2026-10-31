import { Link, useNavigate, useParams } from 'react-router-dom';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Money } from '../../components/Money';
import { Facts, PageHeader, Panel } from '../../components/Page';
import { ErrorState, SkeletonBlock } from '../../components/States';
import { InvoiceStatusTag, SubscriptionStatusTag } from '../../components/Status';
import { DataTable, EmptyState, Pagination } from '../../components/Table';
import { Timeline } from '../../components/Timeline';
import { api } from '../../lib/api';
import { useUser } from '../../lib/auth';
import { formatDate, formatMoney, formatPeriod } from '../../lib/format';
import type { InvoiceRow, Subscription, SubscriptionRow } from '../../lib/types';
import { useUrlState } from '../../lib/url-state';
import { ChangePanel, type AddonOption } from '../subscriptions/ChangePanel';
import { SubscriptionActions, SubscriptionLines } from '../subscriptions/SubscriptionDetailPage';

export function PortalHomePage() {
  const user = useUser();
  const navigate = useNavigate();
  const subs = useQuery({
    queryKey: ['portal', 'subscriptions'],
    queryFn: () => api.list<SubscriptionRow>('/portal/subscriptions', { pageSize: 50 }),
  });
  const open = useQuery({
    queryKey: ['portal', 'invoices', 'open'],
    queryFn: () =>
      api.list<InvoiceRow>('/portal/invoices', {
        status: 'confirmed',
        pageSize: 10,
        sort: 'dueDate',
        dir: 'asc',
      }),
  });
  const credits = useQuery({
    queryKey: ['credits', 'mine'],
    queryFn: () => api.get<{ balance: number }>('/portal/credits'),
  });
  const owed = open.data?.data.reduce((s, i) => s + i.amountTotal - i.amountPaid, 0) ?? 0;
  const visible = subs.data
    ? { ...subs.data, data: subs.data.data.filter((s) => s.status !== 'draft') }
    : undefined;

  return (
    <>
      <PageHeader
        title={`Hello, ${user.fullName.split(' ')[0]}`}
        meta={
          open.data
            ? owed > 0
              ? `You owe ${formatMoney(owed)} across ${open.data.meta.total} invoice${open.data.meta.total === 1 ? '' : 's'}.`
              : 'You are all paid up.'
            : undefined
        }
      />
      {(credits.data?.balance ?? 0) > 0 && (
        <div className="callout">
          <p>
            You have <span className="fig">{formatMoney(credits.data!.balance)}</span> of account
            credit. It is used automatically on your next invoice.
          </p>
        </div>
      )}
      <Panel title="Your subscriptions">
        <DataTable
          caption="Your subscriptions"
          query={{ ...subs, data: visible } as typeof subs}
          rowKey={(s) => s.id}
          onRowClick={(s) => navigate(`/portal/subscriptions/${s.id}`)}
          columns={[
            {
              key: 'n',
              header: 'Subscription',
              cell: (s) => (
                <Link to={`/portal/subscriptions/${s.id}`} className="fig">
                  {s.number}
                </Link>
              ),
            },
            {
              key: 'p',
              header: 'Plan',
              cell: (s) => `${s.planName}, ${formatPeriod(s.billingPeriod).toLowerCase()}`,
            },
            {
              key: 's',
              header: 'Status',
              cell: (s) => <SubscriptionStatusTag status={s.status} />,
            },
            {
              key: 'next',
              header: 'Next invoice',
              cell: (s) => <span className="fig">{formatDate(s.nextInvoiceDate)}</span>,
            },
            {
              key: 't',
              header: 'Per period',
              align: 'end',
              cell: (s) => <Money value={s.amountTotal} />,
            },
          ]}
          empty={
            <EmptyState title="No subscriptions yet">
              When we set one up for you, it appears here.
            </EmptyState>
          }
        />
      </Panel>
      <Panel title="To pay" actions={<Link to="/portal/invoices">All invoices</Link>}>
        <DataTable
          caption="Invoices to pay"
          query={open}
          rowKey={(i) => i.id}
          onRowClick={(i) => navigate(`/portal/invoices/${i.id}`)}
          columns={[
            {
              key: 'n',
              header: 'Invoice',
              cell: (i) => (
                <Link to={`/portal/invoices/${i.id}`} className="fig">
                  {i.number}
                </Link>
              ),
            },
            {
              key: 'd',
              header: 'Due',
              cell: (i) => <span className="fig">{formatDate(i.dueDate)}</span>,
            },
            {
              key: 's',
              header: 'Status',
              cell: (i) => <InvoiceStatusTag status={i.status} overdue={i.isOverdue} />,
            },
            {
              key: 'o',
              header: 'Owed',
              align: 'end',
              cell: (i) => <Money value={i.amountTotal - i.amountPaid} />,
            },
          ]}
          empty={<EmptyState title="Nothing to pay">Every invoice is settled.</EmptyState>}
        />
      </Panel>
    </>
  );
}

export function PortalInvoicesPage() {
  const [f, set] = useUrlState({ page: '1' });
  const navigate = useNavigate();
  const q = useQuery({
    queryKey: ['portal', 'invoices', f],
    queryFn: () => api.list<InvoiceRow>('/portal/invoices', { ...f, pageSize: 25 }),
    placeholderData: keepPreviousData,
  });
  return (
    <>
      <PageHeader title="Invoices" />
      <DataTable
        caption="Your invoices"
        query={q}
        rowKey={(i) => i.id}
        onRowClick={(i) => navigate(`/portal/invoices/${i.id}`)}
        columns={[
          {
            key: 'n',
            header: 'Invoice',
            cell: (i) => (
              <Link to={`/portal/invoices/${i.id}`} className="fig">
                {i.number}
              </Link>
            ),
          },
          {
            key: 'i',
            header: 'Issued',
            cell: (i) => <span className="fig">{formatDate(i.invoiceDate)}</span>,
          },
          {
            key: 'd',
            header: 'Due',
            cell: (i) => <span className="fig">{formatDate(i.dueDate)}</span>,
          },
          {
            key: 's',
            header: 'Status',
            cell: (i) => <InvoiceStatusTag status={i.status} overdue={i.isOverdue} />,
          },
          { key: 't', header: 'Total', align: 'end', cell: (i) => <Money value={i.amountTotal} /> },
        ]}
        empty={<EmptyState title="No invoices yet" />}
      />
      {q.data && (
        <Pagination
          page={Number(f.page)}
          pageSize={25}
          total={q.data.meta.total}
          onPage={(p) => set({ page: String(p) }, { resetPage: false })}
        />
      )}
    </>
  );
}

export function PortalSubscriptionPage() {
  const id = Number(useParams().id);
  const sub = useQuery({
    queryKey: ['portal', 'subscription', id],
    queryFn: () => api.get<Subscription>(`/portal/subscriptions/${id}`),
  });
  const addons = useQuery({
    queryKey: ['portal', 'addons'],
    queryFn: () => api.get<AddonOption[]>('/portal/addons'),
    staleTime: 60_000,
  });
  if (sub.isError) return <ErrorState error={sub.error} onRetry={() => void sub.refetch()} />;
  if (!sub.data) return <SkeletonBlock />;
  const s = sub.data;
  return (
    <>
      <PageHeader
        crumbs={[{ label: 'My subscriptions', to: '/portal' }, { label: s.number }]}
        title={<span className="fig">{s.number}</span>}
        meta={
          <>
            <SubscriptionStatusTag status={s.status} /> {s.planName}
          </>
        }
        actions={<SubscriptionActions sub={s} basePath="/portal/subscriptions" />}
      />
      <div className="detail">
        <div className="detail__main">
          {s.status === 'quotation' && (
            <div className="callout">
              <p>
                This is a quotation
                {s.quoteValidUntil ? `, valid until ${formatDate(s.quoteValidUntil)}` : ''}. Review
                the lines below and accept it to start.
              </p>
            </div>
          )}
          <Panel title="What you pay for">
            <SubscriptionLines sub={s} />
          </Panel>
          {s.status === 'active' && addons.data && (
            <ChangePanel sub={s} addons={addons.data} portal />
          )}
        </div>
        <aside className="detail__side">
          <Panel title="Details">
            <Facts
              items={[
                ['Bills', formatPeriod(s.billingPeriod, s.billingInterval)],
                ['Started', formatDate(s.startDate)],
                ['Ends', s.expiryDate ? formatDate(s.expiryDate) : 'Runs until closed'],
                ['Next invoice', formatDate(s.nextInvoiceDate)],
                ['Payment terms', s.paymentTermName],
              ]}
            />
          </Panel>
          <Panel title="History">
            <Timeline events={s.events} />
          </Panel>
        </aside>
      </div>
    </>
  );
}
