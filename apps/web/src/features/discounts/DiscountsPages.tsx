import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  discountSchema,
  discountUnavailableReason,
  formatPercent,
  todayIso,
} from '@brightloop/shared';
import { Button, ButtonLink } from '../../components/Button';
import { Checkbox, MoneyField, SelectField, TextField } from '../../components/Field';
import { PageHeader, Panel } from '../../components/Page';
import { ErrorState, SkeletonBlock } from '../../components/States';
import { DataTable, EmptyState, type Column } from '../../components/Table';
import { api } from '../../lib/api';
import { useUser } from '../../lib/auth';
import { formatDate, formatMoney } from '../../lib/format';
import { paiseToRupeesInput, rupeesToPaise, toInt, useFormSubmit } from '../../lib/forms';
import { useLookups } from '../../lib/queries';
import type { Discount } from '../../lib/types';

function DiscountState({ d }: { d: Discount }) {
  const reason = discountUnavailableReason(d, todayIso());
  return (
    <span className={`tag ${reason ? 'tag--closed' : 'tag--plain'}`}>{reason ?? 'In use'}</span>
  );
}

const columns: Column<Discount>[] = [
  { key: 'name', header: 'Discount', cell: (d) => <Link to={`/discounts/${d.id}`}>{d.name}</Link> },
  {
    key: 'value',
    header: 'Takes off',
    cell: (d) => (
      <span className="fig">
        {d.type === 'percentage' ? formatPercent(d.value) : formatMoney(d.value)}
      </span>
    ),
  },
  {
    key: 'scope',
    header: 'Applies to',
    cell: (d) => (d.scope === 'subscription' ? 'Whole subscription' : d.productNames.join(', ')),
  },
  {
    key: 'when',
    header: 'Valid',
    cell: (d) => (
      <span className="fig">
        {formatDate(d.startDate)}
        {d.endDate ? ` to ${formatDate(d.endDate)}` : ' onward'}
      </span>
    ),
  },
  {
    key: 'used',
    header: 'Used',
    align: 'end',
    cell: (d) => (
      <span className="fig">
        {d.timesUsed}
        {d.usageLimit ? ` of ${d.usageLimit}` : ''}
      </span>
    ),
  },
  { key: 'state', header: 'Status', cell: (d) => <DiscountState d={d} /> },
];

export function DiscountsPage() {
  const user = useUser();
  const navigate = useNavigate();
  const query = useQuery({
    queryKey: ['discounts'],
    queryFn: () => api.get<Discount[]>('/discounts'),
  });
  return (
    <>
      <PageHeader
        title="Discounts"
        actions={
          user.role === 'admin' && (
            <ButtonLink to="/discounts/new" variant="primary">
              New discount
            </ButtonLink>
          )
        }
      />
      <DataTable
        caption="Discounts"
        columns={columns}
        query={query}
        rowKey={(d) => d.id}
        onRowClick={(d) => navigate(`/discounts/${d.id}`)}
        empty={
          <EmptyState title="No discount rules yet">
            {user.role === 'admin'
              ? 'Create one, then attach it to a subscription.'
              : 'Only an admin creates discount rules.'}
          </EmptyState>
        }
      />
    </>
  );
}

export function DiscountFormPage() {
  const user = useUser();
  const id = useParams().id;
  const editing = id ? Number(id) : null;
  const readOnly = user.role !== 'admin';
  const navigate = useNavigate();
  const qc = useQueryClient();
  const lookups = useLookups();
  const existing = useQuery({
    queryKey: ['discounts', editing],
    queryFn: () => api.get<Discount>(`/discounts/${editing}`),
    enabled: !!editing,
  });
  const [f, setF] = useState({
    name: '',
    type: 'percentage',
    value: '',
    scope: 'subscription',
    productIds: [] as number[],
    minAmount: '',
    minQuantity: '0',
    startDate: todayIso(),
    endDate: '',
    usageLimit: '',
    isActive: true,
  });
  useEffect(() => {
    const d = existing.data;
    if (d)
      setF({
        name: d.name,
        type: d.type,
        value: d.type === 'percentage' ? String(d.value / 100) : paiseToRupeesInput(d.value),
        scope: d.scope,
        productIds: d.productIds,
        minAmount: d.minAmount ? paiseToRupeesInput(d.minAmount) : '',
        minQuantity: String(d.minQuantity),
        startDate: d.startDate,
        endDate: d.endDate ?? '',
        usageLimit: d.usageLimit ? String(d.usageLimit) : '',
        isActive: d.isActive,
      });
  }, [existing.data]);
  const { errors, pending, submit, formRef } = useFormSubmit(
    discountSchema,
    (data) =>
      editing
        ? api.put<Discount>(`/discounts/${editing}`, data)
        : api.post<Discount>('/discounts', data),
    {
      success: 'Discount saved',
      onDone: () => {
        void qc.invalidateQueries({ queryKey: ['discounts'] });
        void qc.invalidateQueries({ queryKey: ['lookups'] });
        navigate('/discounts');
      },
    },
  );
  if ((editing && !existing.data) || !lookups.data)
    return existing.isError ? <ErrorState error={existing.error} /> : <SkeletonBlock />;

  return (
    <>
      <PageHeader
        crumbs={[
          { label: 'Discounts', to: '/discounts' },
          { label: editing ? existing.data!.name : 'New' },
        ]}
        title={editing ? existing.data!.name : 'New discount'}
        meta={
          editing
            ? `Used ${existing.data!.timesUsed} time${existing.data!.timesUsed === 1 ? '' : 's'}`
            : undefined
        }
      />
      <form
        ref={formRef}
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          const value =
            f.type === 'percentage' ? Math.round(Number(f.value) * 100) : rupeesToPaise(f.value);
          void submit({
            ...f,
            value: f.value.trim() === '' ? Number.NaN : value,
            minAmount: f.minAmount ? rupeesToPaise(f.minAmount) : 0,
            minQuantity: toInt(f.minQuantity) || 0,
            endDate: f.endDate || null,
            usageLimit: f.usageLimit ? toInt(f.usageLimit) : null,
          });
        }}
      >
        <fieldset disabled={readOnly} className="bare">
          <Panel title="Rule">
            <div className="form-grid">
              <TextField
                label="Name"
                value={f.name}
                error={errors.name}
                onChange={(e) => setF({ ...f, name: e.target.value })}
              />
              <SelectField
                label="Kind"
                value={f.type}
                error={errors.type}
                onChange={(e) => setF({ ...f, type: e.target.value, value: '' })}
              >
                <option value="percentage">Percentage</option>
                <option value="fixed">Fixed amount</option>
              </SelectField>
              {f.type === 'percentage' ? (
                <TextField
                  label="Percent off"
                  type="number"
                  inputMode="decimal"
                  min={0}
                  max={100}
                  step="0.01"
                  value={f.value}
                  error={errors.value}
                  onChange={(e) => setF({ ...f, value: e.target.value })}
                />
              ) : (
                <MoneyField
                  label="Amount off"
                  value={f.value}
                  error={errors.value}
                  onChange={(e) => setF({ ...f, value: e.target.value })}
                />
              )}
              <SelectField
                label="Applies to"
                value={f.scope}
                error={errors.scope}
                onChange={(e) => setF({ ...f, scope: e.target.value })}
              >
                <option value="subscription">The whole subscription</option>
                <option value="products">Specific products</option>
              </SelectField>
              <MoneyField
                label="Minimum purchase"
                value={f.minAmount}
                error={errors.minAmount}
                hint="Optional"
                onChange={(e) => setF({ ...f, minAmount: e.target.value })}
              />
              <TextField
                label="Minimum quantity"
                type="number"
                inputMode="numeric"
                min={0}
                value={f.minQuantity}
                error={errors.minQuantity}
                onChange={(e) => setF({ ...f, minQuantity: e.target.value })}
              />
              <TextField
                label="Starts"
                type="date"
                value={f.startDate}
                error={errors.startDate}
                onChange={(e) => setF({ ...f, startDate: e.target.value })}
              />
              <TextField
                label="Ends"
                type="date"
                value={f.endDate}
                min={f.startDate}
                error={errors.endDate}
                hint="Leave empty for no end"
                onChange={(e) => setF({ ...f, endDate: e.target.value })}
              />
              <TextField
                label="Use limit"
                type="number"
                inputMode="numeric"
                min={1}
                value={f.usageLimit}
                error={errors.usageLimit}
                hint="Invoices it may appear on; empty for no limit"
                onChange={(e) => setF({ ...f, usageLimit: e.target.value })}
              />
              <div className="field">
                <span className="field__label">Status</span>
                <Checkbox
                  label="Active"
                  checked={f.isActive}
                  onChange={(e) => setF({ ...f, isActive: e.target.checked })}
                />
              </div>
            </div>
          </Panel>
          {f.scope === 'products' && (
            <Panel title="Products">
              <div className="checks checks--cols">
                {lookups.data.products.map((p) => (
                  <Checkbox
                    key={p.id}
                    label={p.name}
                    checked={f.productIds.includes(p.id)}
                    onChange={(e) =>
                      setF({
                        ...f,
                        productIds: e.target.checked
                          ? [...f.productIds, p.id]
                          : f.productIds.filter((x) => x !== p.id),
                      })
                    }
                  />
                ))}
              </div>
              {errors.productIds && <p className="field__error">{errors.productIds}</p>}
            </Panel>
          )}
        </fieldset>
        {!readOnly && (
          <div className="form-actions">
            <ButtonLink to="/discounts">Cancel</ButtonLink>
            <Button type="submit" variant="primary" pending={pending}>
              Save discount
            </Button>
          </div>
        )}
      </form>
    </>
  );
}
