import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import { customerSchema } from '@brightloop/shared';
import { Button, ButtonLink } from '../../components/Button';
import { TextArea, TextField } from '../../components/Field';
import { Money } from '../../components/Money';
import { Facts, PageHeader, Panel, Toolbar } from '../../components/Page';
import { SearchInput } from '../../components/SearchInput';
import { ErrorState, SkeletonBlock } from '../../components/States';
import { InvoiceStatusTag, SubscriptionStatusTag } from '../../components/Status';
import { DataTable, EmptyState, Pagination, type Column } from '../../components/Table';
import { api } from '../../lib/api';
import { formatDate } from '../../lib/format';
import { useFormSubmit } from '../../lib/forms';
import type { Customer, InvoiceRow, SubscriptionRow } from '../../lib/types';
import { useUrlState } from '../../lib/url-state';

const DEFAULTS = { q: '', page: '1', sort: 'createdAt', dir: 'desc' };

const columns: Column<Customer>[] = [
  {
    key: 'name',
    header: 'Name',
    sortable: true,
    cell: (c) => <Link to={`/customers/${c.id}`}>{c.name}</Link>,
  },
  {
    key: 'company',
    header: 'Company',
    cell: (c) => c.company ?? <span className="muted">None</span>,
  },
  { key: 'email', header: 'Email', cell: (c) => c.email },
  {
    key: 'portal',
    header: 'Portal',
    cell: (c) => (c.hasPortalAccess ? 'Has a login' : <span className="muted">No login</span>),
  },
  {
    key: 'active',
    header: 'Active',
    align: 'end',
    cell: (c) => <span className="fig">{c.activeSubscriptions ?? 0}</span>,
  },
  {
    key: 'outstanding',
    header: 'Owes',
    sortable: true,
    align: 'end',
    cell: (c) => <Money value={c.outstanding ?? 0} />,
  },
];

export function CustomersPage() {
  const [f, set] = useUrlState(DEFAULTS);
  const navigate = useNavigate();
  const query = useQuery({
    queryKey: ['customers', f],
    queryFn: () => api.list<Customer>('/customers', { ...f, pageSize: 25 }),
    placeholderData: keepPreviousData,
  });
  return (
    <>
      <PageHeader
        title="Customers"
        actions={
          <ButtonLink to="/customers/new" variant="primary">
            New customer
          </ButtonLink>
        }
      />
      <Toolbar>
        <SearchInput
          label="Search name, email or company"
          value={f.q}
          onChange={(q) => set({ q })}
        />
      </Toolbar>
      <DataTable
        caption="Customers"
        columns={columns}
        query={query}
        rowKey={(c) => c.id}
        sort={f.sort}
        dir={f.dir as 'asc' | 'desc'}
        onSort={(key) =>
          set({ sort: key, dir: f.sort === key && f.dir === 'desc' ? 'asc' : 'desc' })
        }
        onRowClick={(c) => navigate(`/customers/${c.id}`)}
        empty={
          <EmptyState
            title={f.q ? `No customer matches “${f.q}”` : 'No customers yet'}
            action={<ButtonLink to="/customers/new">New customer</ButtonLink>}
          />
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

export function CustomerFormPage() {
  const id = useParams().id;
  const editing = id ? Number(id) : null;
  const navigate = useNavigate();
  const qc = useQueryClient();
  const existing = useQuery({
    queryKey: ['customer', editing],
    queryFn: () => api.get<Customer>(`/customers/${editing}`),
    enabled: !!editing,
  });
  const [f, setF] = useState({ name: '', email: '', phone: '', company: '', address: '' });
  useEffect(() => {
    const c = existing.data;
    if (c)
      setF({
        name: c.name,
        email: c.email,
        phone: c.phone ?? '',
        company: c.company ?? '',
        address: c.address ?? '',
      });
  }, [existing.data]);
  const { errors, pending, submit, formRef } = useFormSubmit(
    customerSchema,
    (data) =>
      editing
        ? api.put<Customer>(`/customers/${editing}`, data)
        : api.post<Customer>('/customers', data),
    {
      success: 'Customer saved',
      onDone: (c) => {
        void qc.invalidateQueries({ queryKey: ['customer'] });
        navigate(`/customers/${c.id}`);
      },
    },
  );
  if (editing && !existing.data)
    return existing.isError ? <ErrorState error={existing.error} /> : <SkeletonBlock />;

  return (
    <>
      <PageHeader
        crumbs={[
          { label: 'Customers', to: '/customers' },
          { label: editing ? existing.data!.name : 'New' },
        ]}
        title={editing ? `Edit ${existing.data!.name}` : 'New customer'}
      />
      <Panel>
        <form
          ref={formRef}
          noValidate
          className="form-grid"
          onSubmit={(e) => {
            e.preventDefault();
            void submit(f);
          }}
        >
          <TextField
            label="Name"
            autoComplete="name"
            value={f.name}
            error={errors.name}
            onChange={(e) => setF({ ...f, name: e.target.value })}
          />
          <TextField
            label="Company"
            autoComplete="organization"
            value={f.company}
            error={errors.company}
            hint="Optional"
            onChange={(e) => setF({ ...f, company: e.target.value })}
          />
          <TextField
            label="Email"
            type="email"
            autoComplete="email"
            value={f.email}
            error={errors.email}
            hint="Invoices are sent here"
            onChange={(e) => setF({ ...f, email: e.target.value })}
          />
          <TextField
            label="Phone"
            type="tel"
            autoComplete="tel"
            inputMode="tel"
            value={f.phone}
            error={errors.phone}
            hint="Optional"
            onChange={(e) => setF({ ...f, phone: e.target.value })}
          />
          <TextArea
            label="Billing address"
            className="span-2"
            autoComplete="street-address"
            value={f.address}
            error={errors.address}
            onChange={(e) => setF({ ...f, address: e.target.value })}
          />
          <div className="form-actions span-2">
            <ButtonLink to={editing ? `/customers/${editing}` : '/customers'}>Cancel</ButtonLink>
            <Button type="submit" variant="primary" pending={pending}>
              Save customer
            </Button>
          </div>
        </form>
      </Panel>
    </>
  );
}

export function CustomerDetailPage() {
  const id = Number(useParams().id);
  const customer = useQuery({
    queryKey: ['customer', id],
    queryFn: () => api.get<Customer>(`/customers/${id}`),
  });
  const subs = useQuery({
    queryKey: ['subscriptions', { customerId: id }],
    queryFn: () => api.list<SubscriptionRow>('/subscriptions', { customerId: id, pageSize: 50 }),
  });
  const invoices = useQuery({
    queryKey: ['invoices', { customerId: id }],
    queryFn: () => api.list<InvoiceRow>('/invoices', { customerId: id, pageSize: 50 }),
  });
  if (customer.isError)
    return <ErrorState error={customer.error} onRetry={() => void customer.refetch()} />;
  if (!customer.data) return <SkeletonBlock />;
  const c = customer.data;

  return (
    <>
      <PageHeader
        crumbs={[{ label: 'Customers', to: '/customers' }, { label: c.name }]}
        title={c.name}
        meta={c.company ?? undefined}
        actions={
          <>
            <ButtonLink to={`/customers/${id}/edit`}>Edit</ButtonLink>
            <ButtonLink to={`/subscriptions/new?customer=${id}`} variant="primary">
              New subscription
            </ButtonLink>
          </>
        }
      />
      <div className="detail">
        <div className="detail__main">
          <Panel title="Subscriptions">
            <DataTable
              caption="Subscriptions"
              query={subs}
              rowKey={(s) => s.id}
              columns={[
                {
                  key: 'n',
                  header: 'Number',
                  cell: (s) => (
                    <Link to={`/subscriptions/${s.id}`} className="fig">
                      {s.number}
                    </Link>
                  ),
                },
                { key: 'p', header: 'Plan', cell: (s) => s.planName },
                {
                  key: 's',
                  header: 'Status',
                  cell: (s) => <SubscriptionStatusTag status={s.status} />,
                },
                {
                  key: 't',
                  header: 'Per period',
                  align: 'end',
                  cell: (s) => <Money value={s.amountTotal} />,
                },
              ]}
              empty={<EmptyState title="No subscriptions yet" />}
            />
          </Panel>
          <Panel title="Invoices">
            <DataTable
              caption="Invoices"
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
                  header: 'Due',
                  cell: (i) => <span className="fig">{formatDate(i.dueDate)}</span>,
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
              empty={<EmptyState title="No invoices yet" />}
            />
          </Panel>
        </div>
        <aside className="detail__side">
          <Panel title="Contact">
            <Facts
              items={[
                [
                  'Email',
                  <a key="e" href={`mailto:${c.email}`}>
                    {c.email}
                  </a>,
                ],
                ['Phone', c.phone ?? 'Not set'],
                ['Address', c.address ?? 'Not set'],
                ['Customer since', formatDate(c.createdAt.slice(0, 10))],
              ]}
            />
          </Panel>
        </aside>
      </div>
    </>
  );
}
