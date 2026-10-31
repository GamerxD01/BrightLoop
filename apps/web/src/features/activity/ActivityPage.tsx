import { Link } from 'react-router-dom';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { PageHeader, Toolbar } from '../../components/Page';
import { SearchInput } from '../../components/SearchInput';
import { DataTable, EmptyState, Pagination } from '../../components/Table';
import { api } from '../../lib/api';
import { formatDateTime } from '../../lib/format';
import { useUrlState } from '../../lib/url-state';

interface Entry {
  id: number;
  action: string;
  entity: string;
  entityId: number | null;
  data: Record<string, unknown> | null;
  requestId: string | null;
  createdAt: string;
  actorId: number | null;
  actorName: string | null;
  actorRole: string | null;
}

const DEFAULTS = {
  q: '',
  actorId: '',
  action: '',
  entity: '',
  requestId: '',
  from: '',
  to: '',
  page: '1',
};

/** Where a record lives in the app, so each entry links to what it changed. */
const LINKS: Record<string, string> = {
  subscription: '/subscriptions',
  invoice: '/invoices',
  customer: '/customers',
  product: '/products',
  plan: '/plans',
  template: '/templates',
  discount: '/discounts',
  bank_import: '/bank',
};

/** "subscription_send_quotation" → "Subscription send quotation". */
const words = (s: string) => {
  const t = s.replace(/_/g, ' ');
  return t.charAt(0).toUpperCase() + t.slice(1);
};

function Detail({ data }: { data: Record<string, unknown> | null }) {
  if (!data) return null;
  const parts = Object.entries(data)
    .filter(([, v]) => v !== null && typeof v !== 'object')
    .slice(0, 4)
    .map(([k, v]) => `${words(k).toLowerCase()} ${String(v)}`);
  return parts.length ? <span className="cell-sub">{parts.join(', ')}</span> : null;
}

/**
 * Who did what, to which record, when. The request id links an entry to the
 * server log line for the same request, which is how a problem gets traced.
 */
export function ActivityPage() {
  const [f, set] = useUrlState(DEFAULTS);
  const facets = useQuery({
    queryKey: ['activity', 'facets'],
    queryFn: () =>
      api.get<{
        actions: { action: string; n: number }[];
        actors: { id: number; fullName: string }[];
      }>('/activity/facets'),
  });
  const log = useQuery({
    queryKey: ['activity', f],
    queryFn: () => api.list<Entry>('/activity', { ...f, pageSize: 50 }),
    placeholderData: keepPreviousData,
  });
  const filtered = Object.entries(f).some(([k, v]) => k !== 'page' && v);

  return (
    <>
      <PageHeader
        title="Activity log"
        meta="Every change, with who made it and the request id from the server log."
      />
      <Toolbar>
        <SearchInput
          label="Search action, record or person"
          value={f.q}
          onChange={(q) => set({ q })}
        />
        <select
          className="input select input--inline"
          aria-label="Person"
          value={f.actorId}
          onChange={(e) => set({ actorId: e.target.value })}
        >
          <option value="">Everyone</option>
          {facets.data?.actors.map((a) => (
            <option key={a.id} value={a.id}>
              {a.fullName}
            </option>
          ))}
        </select>
        <select
          className="input select input--inline"
          aria-label="Action"
          value={f.action}
          onChange={(e) => set({ action: e.target.value })}
        >
          <option value="">All actions</option>
          {facets.data?.actions.map((a) => (
            <option key={a.action} value={a.action}>
              {words(a.action)} ({a.n})
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
        {filtered && (
          <button type="button" className="btn btn--quiet" onClick={() => set({ ...DEFAULTS })}>
            Clear filters
          </button>
        )}
      </Toolbar>
      {f.requestId && (
        <p className="muted filter-note">
          Showing request <code>{f.requestId}</code>. Search the server log for the same id to see
          its full trace.
        </p>
      )}
      <DataTable
        caption="Activity"
        query={log}
        rowKey={(e) => e.id}
        columns={[
          {
            key: 'w',
            header: 'When',
            cell: (e) => <span className="fig">{formatDateTime(e.createdAt)}</span>,
          },
          {
            key: 'who',
            header: 'Who',
            cell: (e) =>
              e.actorId ? (
                <button
                  type="button"
                  className="linkish"
                  onClick={() => set({ actorId: String(e.actorId) })}
                >
                  {e.actorName ?? 'Unknown'}
                </button>
              ) : (
                'System'
              ),
          },
          {
            key: 'what',
            header: 'What',
            cell: (e) => (
              <>
                {words(e.action)}
                <Detail data={e.data} />
              </>
            ),
          },
          {
            key: 'rec',
            header: 'Record',
            cell: (e) =>
              e.entityId && LINKS[e.entity] ? (
                <Link to={`${LINKS[e.entity]}/${e.entityId}`}>
                  {words(e.entity)} {e.entityId}
                </Link>
              ) : (
                <span className="muted">
                  {words(e.entity)}
                  {e.entityId ? ` ${e.entityId}` : ''}
                </span>
              ),
          },
          {
            key: 'req',
            header: 'Request',
            cell: (e) =>
              e.requestId ? (
                <button
                  type="button"
                  className="linkish fig"
                  title={e.requestId}
                  onClick={() => set({ requestId: e.requestId! })}
                >
                  {e.requestId.slice(0, 8)}
                </button>
              ) : null,
          },
        ]}
        empty={
          <EmptyState title={filtered ? 'Nothing matches these filters' : 'Nothing recorded yet'} />
        }
      />
      {log.data && (
        <Pagination
          page={Number(f.page)}
          pageSize={50}
          total={log.data.meta.total}
          onPage={(p) => set({ page: String(p) }, { resetPage: false })}
        />
      )}
    </>
  );
}
