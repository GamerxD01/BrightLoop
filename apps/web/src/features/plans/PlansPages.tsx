import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import { BILLING_PERIODS, LABELS, formatPercent, planSchema, todayIso } from '@brightloop/shared';
import { Button, ButtonLink } from '../../components/Button';
import { Checkbox, MoneyField, SelectField, TextField } from '../../components/Field';
import { Money } from '../../components/Money';
import { PageHeader, Panel } from '../../components/Page';
import { ErrorState, SkeletonBlock } from '../../components/States';
import { ActiveTag } from '../../components/Status';
import { DataTable, EmptyState, type Column } from '../../components/Table';
import { api } from '../../lib/api';
import { useUser } from '../../lib/auth';
import { formatDate, formatPeriod } from '../../lib/format';
import { paiseToRupeesInput, rupeesToPaise, toInt, useFormSubmit } from '../../lib/forms';
import { useLookups } from '../../lib/queries';
import type { Plan } from '../../lib/types';

export function PlansPage() {
  const user = useUser();
  const navigate = useNavigate();
  const query = useQuery({
    queryKey: ['plans'],
    queryFn: () => api.list<Plan>('/plans', { pageSize: 100, sort: 'name', dir: 'asc' }),
    placeholderData: keepPreviousData,
  });
  const columns: Column<Plan>[] = [
    { key: 'name', header: 'Plan', cell: (p) => <Link to={`/plans/${p.id}`}>{p.name}</Link> },
    {
      key: 'period',
      header: 'Bills',
      cell: (p) => formatPeriod(p.billingPeriod, p.billingInterval),
    },
    {
      key: 'min',
      header: 'Min seats',
      align: 'end',
      cell: (p) => <span className="fig">{p.minQuantity}</span>,
    },
    {
      key: 'window',
      header: 'Available',
      cell: (p) => (
        <span className="fig">
          {formatDate(p.startDate)}
          {p.endDate ? ` to ${formatDate(p.endDate)}` : ' onward'}
        </span>
      ),
    },
    {
      key: 'rules',
      header: 'Rules',
      cell: (p) =>
        [
          p.autoClose && 'auto-close',
          p.pausable && 'pause',
          p.closable && 'close early',
          p.renewable && 'renew',
        ]
          .filter(Boolean)
          .join(', ') || 'Not set',
    },
    { key: 'status', header: 'Status', cell: (p) => <ActiveTag active={p.isActive} /> },
    {
      key: 'active',
      header: 'Active subs',
      align: 'end',
      cell: (p) => <span className="fig">{p.activeSubscriptions ?? 0}</span>,
    },
    {
      key: 'price',
      header: 'Price per seat',
      align: 'end',
      cell: (p) => <Money value={p.price} />,
    },
  ];
  return (
    <>
      <PageHeader
        title="Plans"
        actions={
          user.role === 'admin' && (
            <ButtonLink to="/plans/new" variant="primary">
              New plan
            </ButtonLink>
          )
        }
      />
      <DataTable
        caption="Plans"
        columns={columns}
        query={query}
        rowKey={(p) => p.id}
        onRowClick={(p) => navigate(`/plans/${p.id}`)}
        empty={
          <EmptyState title="No plans yet">
            A plan sets the price and how often a subscription bills.
          </EmptyState>
        }
      />
    </>
  );
}

export function PlanFormPage() {
  const user = useUser();
  const id = useParams().id;
  const editing = id ? Number(id) : null;
  const readOnly = user.role !== 'admin';
  const navigate = useNavigate();
  const qc = useQueryClient();
  const lookups = useLookups();
  const existing = useQuery({
    queryKey: ['plans', editing],
    queryFn: () => api.get<Plan>(`/plans/${editing}`),
    enabled: !!editing,
  });
  const [f, setF] = useState({
    name: '',
    price: '',
    billingPeriod: 'monthly',
    billingInterval: '1',
    minQuantity: '1',
    startDate: todayIso(),
    endDate: '',
    taxId: '',
    autoClose: false,
    closable: true,
    pausable: false,
    renewable: true,
    isActive: true,
  });
  useEffect(() => {
    const p = existing.data;
    if (p)
      setF({
        name: p.name,
        price: paiseToRupeesInput(p.price),
        billingPeriod: p.billingPeriod,
        billingInterval: String(p.billingInterval),
        minQuantity: String(p.minQuantity),
        startDate: p.startDate,
        endDate: p.endDate ?? '',
        taxId: p.taxId ? String(p.taxId) : '',
        autoClose: p.autoClose,
        closable: p.closable,
        pausable: p.pausable,
        renewable: p.renewable,
        isActive: p.isActive,
      });
  }, [existing.data]);
  const { errors, pending, submit, formRef } = useFormSubmit(
    planSchema,
    (data) => (editing ? api.put<Plan>(`/plans/${editing}`, data) : api.post<Plan>('/plans', data)),
    {
      success: 'Plan saved',
      onDone: (p) => {
        void qc.invalidateQueries({ queryKey: ['plans'] });
        navigate(`/plans/${p.id}`);
      },
    },
  );
  if ((editing && !existing.data) || !lookups.data)
    return existing.isError ? <ErrorState error={existing.error} /> : <SkeletonBlock />;

  return (
    <>
      <PageHeader
        crumbs={[
          { label: 'Plans', to: '/plans' },
          { label: editing ? existing.data!.name : 'New' },
        ]}
        title={editing ? existing.data!.name : 'New plan'}
      />
      <form
        ref={formRef}
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          void submit({
            ...f,
            price: rupeesToPaise(f.price),
            billingInterval: toInt(f.billingInterval),
            minQuantity: toInt(f.minQuantity),
            endDate: f.endDate || null,
            taxId: f.taxId ? Number(f.taxId) : null,
          });
        }}
      >
        <fieldset disabled={readOnly} className="bare">
          <Panel title="Pricing">
            <div className="form-grid">
              <TextField
                label="Name"
                value={f.name}
                error={errors.name}
                onChange={(e) => setF({ ...f, name: e.target.value })}
              />
              <MoneyField
                label="Price per seat, per period"
                value={f.price}
                error={errors.price}
                onChange={(e) => setF({ ...f, price: e.target.value })}
              />
              <SelectField
                label="Bills"
                value={f.billingPeriod}
                error={errors.billingPeriod}
                onChange={(e) => setF({ ...f, billingPeriod: e.target.value })}
              >
                {BILLING_PERIODS.map((p) => (
                  <option key={p} value={p}>
                    {LABELS.billingPeriod[p]}
                  </option>
                ))}
              </SelectField>
              <TextField
                label="Every"
                type="number"
                inputMode="numeric"
                min={1}
                value={f.billingInterval}
                error={errors.billingInterval}
                hint={`1 bills ${LABELS.billingPeriod[f.billingPeriod as 'monthly'].toLowerCase()}; 3 every third period`}
                onChange={(e) => setF({ ...f, billingInterval: e.target.value })}
              />
              <TextField
                label="Minimum seats"
                type="number"
                inputMode="numeric"
                min={1}
                value={f.minQuantity}
                error={errors.minQuantity}
                onChange={(e) => setF({ ...f, minQuantity: e.target.value })}
              />
              <SelectField
                label="Tax"
                value={f.taxId}
                error={errors.taxId}
                onChange={(e) => setF({ ...f, taxId: e.target.value })}
              >
                <option value="">No tax</option>
                {lookups.data.taxes.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name} ({formatPercent(t.rateBp)})
                  </option>
                ))}
              </SelectField>
              <TextField
                label="Available from"
                type="date"
                value={f.startDate}
                error={errors.startDate}
                onChange={(e) => setF({ ...f, startDate: e.target.value })}
              />
              <TextField
                label="Available until"
                type="date"
                value={f.endDate}
                min={f.startDate}
                error={errors.endDate}
                hint="Leave empty for no end"
                onChange={(e) => setF({ ...f, endDate: e.target.value })}
              />
            </div>
          </Panel>
          <Panel title="What subscriptions on this plan may do">
            <div className="checks">
              <Checkbox
                label="Close on its own at expiry"
                hint="The billing run closes it when the expiry date passes"
                checked={f.autoClose}
                onChange={(e) => setF({ ...f, autoClose: e.target.checked })}
              />
              <Checkbox
                label="Can be closed early"
                checked={f.closable}
                onChange={(e) => setF({ ...f, closable: e.target.checked })}
              />
              <Checkbox
                label="Can be paused"
                hint="Paused periods are not billed"
                checked={f.pausable}
                onChange={(e) => setF({ ...f, pausable: e.target.checked })}
              />
              <Checkbox
                label="Can be renewed"
                checked={f.renewable}
                onChange={(e) => setF({ ...f, renewable: e.target.checked })}
              />
              <Checkbox
                label="Open for new subscriptions"
                checked={f.isActive}
                onChange={(e) => setF({ ...f, isActive: e.target.checked })}
              />
            </div>
          </Panel>
        </fieldset>
        {!readOnly && (
          <div className="form-actions">
            <ButtonLink to="/plans">Cancel</ButtonLink>
            <Button type="submit" variant="primary" pending={pending}>
              Save plan
            </Button>
          </div>
        )}
      </form>
    </>
  );
}
