import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { LABELS, SUBSCRIPTION_STATUSES, fromTemplateSchema, todayIso } from '@brightloop/shared';
import { Button, ButtonLink } from '../../components/Button';
import { CustomerPicker } from '../../components/CustomerPicker';
import { SelectField, TextField } from '../../components/Field';
import { Money } from '../../components/Money';
import { PageHeader, Panel, Toolbar } from '../../components/Page';
import { SearchInput } from '../../components/SearchInput';
import { SubscriptionStatusTag } from '../../components/Status';
import { DataTable, EmptyState, Pagination, type Column } from '../../components/Table';
import { api } from '../../lib/api';
import { formatDate } from '../../lib/format';
import { useFormSubmit } from '../../lib/forms';
import { useLookups } from '../../lib/queries';
import type { Subscription, SubscriptionRow } from '../../lib/types';
import { useUrlState } from '../../lib/url-state';

const DEFAULTS = { q: '', status: '', planId: '', page: '1', sort: 'createdAt', dir: 'desc' };

const columns: Column<SubscriptionRow>[] = [
  {
    key: 'number',
    header: 'Number',
    sortable: true,
    cell: (s) => (
      <Link to={`/subscriptions/${s.id}`} className="fig">
        {s.number}
      </Link>
    ),
  },
  { key: 'customer', header: 'Customer', sortable: true, cell: (s) => s.customerName },
  { key: 'plan', header: 'Plan', cell: (s) => s.planName },
  { key: 'status', header: 'Status', cell: (s) => <SubscriptionStatusTag status={s.status} /> },
  {
    key: 'startDate',
    header: 'Starts',
    sortable: true,
    cell: (s) => <span className="fig">{formatDate(s.startDate)}</span>,
  },
  {
    key: 'nextInvoiceDate',
    header: 'Next invoice',
    sortable: true,
    cell: (s) => <span className="fig">{formatDate(s.nextInvoiceDate)}</span>,
  },
  {
    key: 'amountTotal',
    header: 'Per period',
    sortable: true,
    align: 'end',
    cell: (s) => <Money value={s.amountTotal} />,
  },
];

/** Start a quotation from a template: plan, lines and validity come along. */
function FromTemplate({ onClose }: { onClose: () => void }) {
  const lookups = useLookups();
  const navigate = useNavigate();
  const [customer, setCustomer] = useState<{ id: number; name: string } | null>(null);
  const [templateId, setTemplateId] = useState('');
  const [startDate, setStartDate] = useState(todayIso());
  const { errors, pending, submit, formRef } = useFormSubmit(
    fromTemplateSchema,
    (data) => api.post<Subscription>('/subscriptions/from-template', data),
    {
      success: 'Quotation started from the template',
      onDone: (s) => navigate(`/subscriptions/${s.id}`),
    },
  );

  return (
    <Panel title="New quotation from a template">
      <form
        ref={formRef}
        noValidate
        className="form-grid"
        onSubmit={(e) => {
          e.preventDefault();
          void submit({
            templateId: Number(templateId) || undefined,
            customerId: customer?.id,
            startDate,
          });
        }}
      >
        <SelectField
          label="Template"
          value={templateId}
          error={errors.templateId}
          onChange={(e) => setTemplateId(e.target.value)}
        >
          <option value="">Choose a template</option>
          {lookups.data?.templates.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name} ({t.planName})
            </option>
          ))}
        </SelectField>
        <CustomerPicker value={customer} onChange={setCustomer} error={errors.customerId} />
        <TextField
          label="Start date"
          type="date"
          value={startDate}
          error={errors.startDate}
          onChange={(e) => setStartDate(e.target.value)}
        />
        <div className="form-actions">
          <Button onClick={onClose}>Cancel</Button>
          <Button type="submit" variant="primary" pending={pending}>
            Create quotation
          </Button>
        </div>
      </form>
    </Panel>
  );
}

export function SubscriptionsPage() {
  const [f, set] = useUrlState(DEFAULTS);
  const lookups = useLookups();
  const navigate = useNavigate();
  const [templating, setTemplating] = useState(false);
  const query = useQuery({
    queryKey: ['subscriptions', f],
    queryFn: () => api.list<SubscriptionRow>('/subscriptions', { ...f, pageSize: 25 }),
    placeholderData: keepPreviousData,
  });

  return (
    <>
      <PageHeader
        title="Subscriptions"
        actions={
          <>
            <Button onClick={() => setTemplating((v) => !v)} aria-expanded={templating}>
              From a template
            </Button>
            <ButtonLink to="/subscriptions/new" variant="primary">
              New subscription
            </ButtonLink>
          </>
        }
      />
      {templating && <FromTemplate onClose={() => setTemplating(false)} />}

      <Toolbar>
        <SearchInput label="Search number or customer" value={f.q} onChange={(q) => set({ q })} />
        <div className="tabs" role="group" aria-label="Status">
          <button
            type="button"
            className="tab"
            aria-pressed={!f.status}
            onClick={() => set({ status: '' })}
          >
            All
          </button>
          {SUBSCRIPTION_STATUSES.map((s) => (
            <button
              key={s}
              type="button"
              className="tab"
              aria-pressed={f.status === s}
              onClick={() => set({ status: s })}
            >
              {LABELS.subscriptionStatus[s]}
            </button>
          ))}
        </div>
        <select
          className="input select input--inline"
          aria-label="Plan"
          value={f.planId}
          onChange={(e) => set({ planId: e.target.value })}
        >
          <option value="">All plans</option>
          {lookups.data?.plans.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </Toolbar>

      <DataTable
        caption="Subscriptions"
        columns={columns}
        query={query}
        rowKey={(s) => s.id}
        sort={f.sort}
        dir={f.dir as 'asc' | 'desc'}
        onSort={(key) =>
          set({ sort: key, dir: f.sort === key && f.dir === 'desc' ? 'asc' : 'desc' })
        }
        onRowClick={(s) => navigate(`/subscriptions/${s.id}`)}
        empty={
          <EmptyState
            title={
              f.q || f.status || f.planId
                ? 'No subscriptions match these filters'
                : 'No subscriptions yet'
            }
            action={
              <ButtonLink to="/subscriptions/new" variant="primary">
                New subscription
              </ButtonLink>
            }
          >
            {f.q || f.status || f.planId
              ? 'Try clearing a filter.'
              : 'Create the first one, or start from a quotation template.'}
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
