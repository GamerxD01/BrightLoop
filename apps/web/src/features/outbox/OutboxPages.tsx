import { Link, useNavigate, useParams } from 'react-router-dom';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { emailKindLabel } from '../../components/EmailTrail';
import { Facts, PageHeader, Panel, Toolbar } from '../../components/Page';
import { SearchInput } from '../../components/SearchInput';
import { ErrorState, SkeletonBlock } from '../../components/States';
import { DataTable, EmptyState, Pagination } from '../../components/Table';
import { api } from '../../lib/api';
import { formatDateTime } from '../../lib/format';
import type { EmailLogRow } from '../../lib/types';
import { useUrlState } from '../../lib/url-state';

const STATUS = {
  sent: 'Delivered to mail server',
  logged: 'Recorded only',
  failed: 'Failed',
} as const;
const KINDS = ['', 'invoice', 'receipt', 'reminder', 'renewal', 'quote', 'welcome', 'reset'];

const entityLink = (m: EmailLogRow) =>
  m.entity === 'invoice'
    ? `/invoices/${m.entityId}`
    : m.entity === 'subscription'
      ? `/subscriptions/${m.entityId}`
      : m.entity === 'customer'
        ? `/customers/${m.entityId}`
        : null;

/** Every email the system sent, so "did the customer get reminded?" has an answer. */
export function OutboxPage() {
  const [f, set] = useUrlState({ q: '', kind: '', page: '1' });
  const navigate = useNavigate();
  const q = useQuery({
    queryKey: ['outbox', f],
    queryFn: () => api.list<EmailLogRow>('/outbox', { ...f, pageSize: 25 }),
    placeholderData: keepPreviousData,
  });
  return (
    <>
      <PageHeader
        title="Emails sent"
        meta="Without a mail server configured, emails are recorded here instead of delivered."
      />
      <Toolbar>
        <SearchInput
          label="Search recipient or subject"
          value={f.q}
          onChange={(v) => set({ q: v })}
        />
        <div className="tabs" role="group" aria-label="Kind">
          {KINDS.map((k) => (
            <button
              key={k}
              type="button"
              className="tab"
              aria-pressed={f.kind === k}
              onClick={() => set({ kind: k })}
            >
              {k ? emailKindLabel(k) : 'All'}
            </button>
          ))}
        </div>
      </Toolbar>
      <DataTable
        caption="Emails"
        query={q}
        rowKey={(m) => m.id}
        onRowClick={(m) => navigate(`/outbox/${m.id}`)}
        columns={[
          {
            key: 'when',
            header: 'When',
            cell: (m) => <span className="fig">{formatDateTime(m.createdAt)}</span>,
          },
          { key: 'kind', header: 'Kind', cell: (m) => emailKindLabel(m.kind) },
          { key: 'to', header: 'To', cell: (m) => m.toAddress },
          {
            key: 'subject',
            header: 'Subject',
            cell: (m) => <Link to={`/outbox/${m.id}`}>{m.subject}</Link>,
          },
          {
            key: 'status',
            header: 'Status',
            cell: (m) => (
              <span className={m.status === 'failed' ? 'is-alert' : 'muted'}>
                {STATUS[m.status]}
              </span>
            ),
          },
        ]}
        empty={
          <EmptyState title="No emails yet">
            Invoices, receipts and reminders appear here as they go out.
          </EmptyState>
        }
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

export function OutboxEmailPage() {
  const id = Number(useParams().id);
  const q = useQuery({
    queryKey: ['outbox', 'one', id],
    queryFn: () => api.get<EmailLogRow>(`/outbox/${id}`),
  });
  if (q.isError) return <ErrorState error={q.error} />;
  if (!q.data) return <SkeletonBlock />;
  const m = q.data;
  const link = entityLink(m);
  return (
    <>
      <PageHeader
        crumbs={[{ label: 'Emails sent', to: '/outbox' }, { label: emailKindLabel(m.kind) }]}
        title={m.subject}
      />
      <div className="detail">
        <div className="detail__main">
          {m.bodyHtml ? (
            <iframe
              className="email-frame"
              title={`Email: ${m.subject}`}
              sandbox=""
              srcDoc={m.bodyHtml}
            />
          ) : (
            <pre className="email-text">{m.bodyText}</pre>
          )}
        </div>
        <aside className="detail__side">
          <Panel title="Details">
            <Facts
              items={[
                ['To', m.toAddress],
                ['When', formatDateTime(m.createdAt)],
                ['Status', STATUS[m.status]],
                ...(m.error ? [['Error', m.error] as [string, string]] : []),
                ['Attachments', m.attachments.length ? m.attachments.join(', ') : 'None'],
                ...(link
                  ? [
                      [
                        'About',
                        <Link key="l" to={link}>
                          Open the {m.entity}
                        </Link>,
                      ] as [string, React.ReactNode],
                    ]
                  : []),
              ]}
            />
          </Panel>
        </aside>
      </div>
    </>
  );
}
