import { Link, useNavigate } from 'react-router-dom';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { LABELS } from '@brightloop/shared';
import { Money } from '../../components/Money';
import { ExportLink } from '../../components/ExportLink';
import { PageHeader, Toolbar } from '../../components/Page';
import { SearchInput } from '../../components/SearchInput';
import { InvoiceStatusTag } from '../../components/Status';
import { DataTable, EmptyState, Pagination, type Column } from '../../components/Table';
import { api } from '../../lib/api';
import { formatDate } from '../../lib/format';
import type { InvoiceRow } from '../../lib/types';
import { useUrlState } from '../../lib/url-state';

const DEFAULTS = {
  q: '',
  status: '',
  overdue: '',
  subscriptionId: '',
  from: '',
  to: '',
  page: '1',
  sort: 'invoiceDate',
  dir: 'desc',
};

const FILTERS: { label: string; status: string; overdue: string }[] = [
  { label: 'All', status: '', overdue: '' },
  { label: LABELS.invoiceStatus.draft, status: 'draft', overdue: '' },
  { label: 'Outstanding', status: 'confirmed', overdue: '' },
  { label: 'Overdue', status: '', overdue: 'true' },
  { label: LABELS.invoiceStatus.paid, status: 'paid', overdue: '' },
  { label: LABELS.invoiceStatus.cancelled, status: 'cancelled', overdue: '' },
];

const columns: Column<InvoiceRow>[] = [
  {
    key: 'number',
    header: 'Invoice',
    sortable: true,
    cell: (i) => (
      <Link to={`/invoices/${i.id}`} className="fig">
        {i.number}
      </Link>
    ),
  },
  { key: 'customer', header: 'Customer', sortable: true, cell: (i) => i.customerName },
  {
    key: 'sub',
    header: 'Subscription',
    cell: (i) => <span className="fig muted">{i.subscriptionNumber ?? 'Not set'}</span>,
  },
  {
    key: 'invoiceDate',
    header: 'Issued',
    sortable: true,
    cell: (i) => <span className="fig">{formatDate(i.invoiceDate)}</span>,
  },
  {
    key: 'dueDate',
    header: 'Due',
    sortable: true,
    cell: (i) => (
      <span className={`fig ${i.isOverdue ? 'is-alert' : ''}`}>{formatDate(i.dueDate)}</span>
    ),
  },
  {
    key: 'status',
    header: 'Status',
    cell: (i) => <InvoiceStatusTag status={i.status} overdue={i.isOverdue} />,
  },
  {
    key: 'amountTotal',
    header: 'Total',
    sortable: true,
    align: 'end',
    cell: (i) => <Money value={i.amountTotal} />,
  },
  {
    key: 'due',
    header: 'Still owed',
    align: 'end',
    cell: (i) =>
      i.status === 'confirmed' ? (
        <Money value={i.amountTotal - i.amountPaid} />
      ) : (
        <span className="muted">None</span>
      ),
  },
];

export function InvoicesPage() {
  const [f, set] = useUrlState(DEFAULTS);
  const navigate = useNavigate();
  const query = useQuery({
    queryKey: ['invoices', f],
    queryFn: () => api.list<InvoiceRow>('/invoices', { ...f, pageSize: 25 }),
    placeholderData: keepPreviousData,
  });
  const filtered = Boolean(f.q || f.status || f.overdue || f.from || f.to || f.subscriptionId);

  return (
    <>
      <PageHeader title="Invoices" actions={<ExportLink entity="invoices" filters={f} />} />
      <Toolbar>
        <SearchInput label="Search invoice or customer" value={f.q} onChange={(q) => set({ q })} />
        <div className="tabs" role="group" aria-label="Status">
          {FILTERS.map((x) => (
            <button
              key={x.label}
              type="button"
              className="tab"
              aria-pressed={f.status === x.status && f.overdue === x.overdue}
              onClick={() => set({ status: x.status, overdue: x.overdue })}
            >
              {x.label}
            </button>
          ))}
        </div>
        <label className="filter filter--inline">
          <span>From</span>
          <input
            className="input"
            type="date"
            value={f.from}
            onChange={(e) => set({ from: e.target.value })}
          />
        </label>
        <label className="filter filter--inline">
          <span>To</span>
          <input
            className="input"
            type="date"
            value={f.to}
            onChange={(e) => set({ to: e.target.value })}
          />
        </label>
        {f.subscriptionId && (
          <button
            type="button"
            className="btn btn--quiet"
            onClick={() => set({ subscriptionId: '' })}
          >
            Show all subscriptions
          </button>
        )}
      </Toolbar>
      <DataTable
        caption="Invoices"
        columns={columns}
        query={query}
        rowKey={(i) => i.id}
        sort={f.sort}
        dir={f.dir as 'asc' | 'desc'}
        onSort={(key) =>
          set({ sort: key, dir: f.sort === key && f.dir === 'desc' ? 'asc' : 'desc' })
        }
        onRowClick={(i) => navigate(`/invoices/${i.id}`)}
        empty={
          <EmptyState title={filtered ? 'No invoices match these filters' : 'No invoices yet'}>
            {filtered
              ? 'Try clearing a filter.'
              : 'Invoices are created from active subscriptions on billing day.'}
          </EmptyState>
        }
      />
      {query.data && (
        <Pagination
          page={Number(f.page)}
          pageSize={25}
          total={query.data.meta.total}
          onPage={(p) => set({ page: String(p) }, { resetPage: false })}
        />
      )}
    </>
  );
}
