import { Link } from 'react-router-dom';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { LABELS, PAYMENT_METHODS } from '@brightloop/shared';
import { Money } from '../../components/Money';
import { PageHeader, Toolbar } from '../../components/Page';
import { SearchInput } from '../../components/SearchInput';
import { DataTable, EmptyState, Pagination, type Column } from '../../components/Table';
import { api } from '../../lib/api';
import { formatDate } from '../../lib/format';
import type { PaymentRow } from '../../lib/types';
import { useUrlState } from '../../lib/url-state';

const DEFAULTS = { q: '', method: '', from: '', to: '', page: '1', sort: 'paidOn', dir: 'desc' };

const columns: Column<PaymentRow>[] = [
  {
    key: 'paidOn',
    header: 'Received',
    sortable: true,
    cell: (p) => <span className="fig">{formatDate(p.paidOn)}</span>,
  },
  {
    key: 'invoice',
    header: 'Invoice',
    cell: (p) => (
      <Link to={`/invoices/${p.invoiceId}`} className="fig">
        {p.invoiceNumber}
      </Link>
    ),
  },
  { key: 'customer', header: 'Customer', cell: (p) => p.customerName },
  { key: 'method', header: 'Method', cell: (p) => LABELS.paymentMethod[p.method] },
  { key: 'note', header: 'Note', cell: (p) => <span className="muted">{p.note ?? ''}</span> },
  { key: 'by', header: 'Recorded by', cell: (p) => p.recordedBy ?? 'Not set' },
  {
    key: 'amount',
    header: 'Amount',
    sortable: true,
    align: 'end',
    cell: (p) => <Money value={p.amount} />,
  },
];

export function PaymentsPage() {
  const [f, set] = useUrlState(DEFAULTS);
  const query = useQuery({
    queryKey: ['payments', f],
    queryFn: () => api.list<PaymentRow>('/payments', { ...f, pageSize: 25 }),
    placeholderData: keepPreviousData,
  });
  return (
    <>
      <PageHeader title="Payments" />
      <Toolbar>
        <SearchInput label="Search invoice or customer" value={f.q} onChange={(q) => set({ q })} />
        <select
          className="input select input--inline"
          aria-label="Method"
          value={f.method}
          onChange={(e) => set({ method: e.target.value })}
        >
          <option value="">All methods</option>
          {PAYMENT_METHODS.map((m) => (
            <option key={m} value={m}>
              {LABELS.paymentMethod[m]}
            </option>
          ))}
        </select>
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
      </Toolbar>
      <DataTable
        caption="Payments"
        columns={columns}
        query={query}
        rowKey={(p) => p.id}
        sort={f.sort}
        dir={f.dir as 'asc' | 'desc'}
        onSort={(key) =>
          set({ sort: key, dir: f.sort === key && f.dir === 'desc' ? 'asc' : 'desc' })
        }
        empty={
          <EmptyState title="No payments found">
            Payments appear here once they are recorded against an invoice.
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
