import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { attributeSchema, formatPercent, paymentTermSchema, taxSchema } from '@brightloop/shared';
import { Button } from '../../components/Button';
import { Checkbox, MoneyField, TextField } from '../../components/Field';
import { PageHeader, Panel } from '../../components/Page';
import { ActiveTag } from '../../components/Status';
import { DataTable, EmptyState } from '../../components/Table';
import { api } from '../../lib/api';
import { useUser } from '../../lib/auth';
import { formatMoney } from '../../lib/format';
import { rupeesToPaise, toInt, useFormSubmit } from '../../lib/forms';
import type { Attribute, PaymentTerm, Tax } from '../../lib/types';

/** Adds a tax, or edits one when `tax` is given (rename, change the rate, archive). */
function TaxForm({ tax, onDone }: { tax?: Tax | null; onDone: () => void }) {
  const qc = useQueryClient();
  const blank = { name: '', rate: '', isActive: true };
  const [f, setF] = useState(
    tax ? { name: tax.name, rate: String(tax.rateBp / 100), isActive: tax.isActive } : blank,
  );
  const { errors, pending, submit, formRef } = useFormSubmit(
    taxSchema,
    (d) => (tax ? api.put<Tax>(`/catalog/taxes/${tax.id}`, d) : api.post<Tax>('/catalog/taxes', d)),
    {
      success: tax
        ? 'Tax updated. Issued invoices keep the rate they were billed at.'
        : 'Tax added',
      onDone: () => {
        setF(blank);
        void qc.invalidateQueries({ queryKey: ['taxes'] });
        void qc.invalidateQueries({ queryKey: ['lookups'] });
        onDone();
      },
    },
  );
  return (
    <form
      ref={formRef}
      noValidate
      className="inline-form"
      onSubmit={(e) => {
        e.preventDefault();
        void submit({
          name: f.name,
          rateBp: f.rate.trim() ? Math.round(Number(f.rate) * 100) : Number.NaN,
          isActive: f.isActive,
        });
      }}
    >
      <TextField
        label="Tax name"
        value={f.name}
        error={errors.name}
        onChange={(e) => setF({ ...f, name: e.target.value })}
      />
      <TextField
        label="Rate %"
        type="number"
        inputMode="decimal"
        step="0.01"
        value={f.rate}
        error={errors.rateBp}
        onChange={(e) => setF({ ...f, rate: e.target.value })}
      />
      {tax && (
        <Checkbox
          label="In use"
          checked={f.isActive}
          onChange={(e) => setF({ ...f, isActive: e.target.checked })}
        />
      )}
      <Button type="submit" pending={pending}>
        {tax ? 'Save tax' : 'Add tax'}
      </Button>
      {tax && (
        <button type="button" className="btn btn--quiet" onClick={onDone}>
          Cancel
        </button>
      )}
    </form>
  );
}

function AddTerm() {
  const qc = useQueryClient();
  const [f, setF] = useState({ name: '', dueDays: '' });
  const { errors, pending, submit, formRef } = useFormSubmit(
    paymentTermSchema,
    (d) => api.post<PaymentTerm>('/catalog/payment-terms', d),
    {
      success: 'Payment term added',
      onDone: () => {
        setF({ name: '', dueDays: '' });
        void qc.invalidateQueries({ queryKey: ['terms'] });
      },
    },
  );
  return (
    <form
      ref={formRef}
      noValidate
      className="inline-form"
      onSubmit={(e) => {
        e.preventDefault();
        void submit({ name: f.name, dueDays: toInt(f.dueDays) });
      }}
    >
      <TextField
        label="Name"
        value={f.name}
        error={errors.name}
        onChange={(e) => setF({ ...f, name: e.target.value })}
      />
      <TextField
        label="Due after (days)"
        type="number"
        inputMode="numeric"
        value={f.dueDays}
        error={errors.dueDays}
        onChange={(e) => setF({ ...f, dueDays: e.target.value })}
      />
      <Button type="submit" pending={pending}>
        Add term
      </Button>
    </form>
  );
}

/**
 * Adds an attribute, or edits one: rename it, rename values, change what a
 * value adds to the price, add values. Existing subscriptions keep the price
 * they were sold at; new sales use the new extra.
 */
function AttributeForm({
  attribute,
  onDone,
}: {
  attribute?: Attribute | null;
  onDone: () => void;
}) {
  const qc = useQueryClient();
  const blank = {
    name: '',
    values: [{ id: undefined as number | undefined, name: '', extra: '' }],
  };
  const [f, setF] = useState(
    attribute
      ? {
          name: attribute.name,
          values: attribute.values.map((v) => ({
            id: v.id as number | undefined,
            name: v.name,
            extra: v.extraPrice ? String(v.extraPrice / 100) : '',
          })),
        }
      : blank,
  );
  const { errors, pending, submit, formRef } = useFormSubmit(
    attributeSchema,
    (d) =>
      attribute
        ? api.put<Attribute[]>(`/catalog/attributes/${attribute.id}`, d)
        : api.post<Attribute[]>('/catalog/attributes', d),
    {
      success: attribute ? 'Attribute updated' : 'Attribute added',
      onDone: () => {
        setF(blank);
        void qc.invalidateQueries({ queryKey: ['attributes'] });
        void qc.invalidateQueries({ queryKey: ['lookups'] });
        onDone();
      },
    },
  );
  return (
    <form
      ref={formRef}
      noValidate
      className="stack"
      onSubmit={(e) => {
        e.preventDefault();
        void submit({
          name: f.name,
          values: f.values.map((v) => ({
            ...(v.id ? { id: v.id } : {}),
            name: v.name,
            extraPrice: v.extra ? rupeesToPaise(v.extra) : 0,
          })),
        });
      }}
    >
      <TextField
        label="Attribute"
        hint="For example Brand or Region"
        value={f.name}
        error={errors.name}
        onChange={(e) => setF({ ...f, name: e.target.value })}
      />
      {f.values.map((v, i) => (
        <div key={i} className="inline-form">
          <TextField
            label={`Value ${i + 1}`}
            value={v.name}
            error={errors[`values.${i}.name`]}
            onChange={(e) =>
              setF({
                ...f,
                values: f.values.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)),
              })
            }
          />
          <MoneyField
            label="Adds to price"
            value={v.extra}
            error={errors[`values.${i}.extraPrice`]}
            onChange={(e) =>
              setF({
                ...f,
                values: f.values.map((x, j) => (j === i ? { ...x, extra: e.target.value } : x)),
              })
            }
          />
        </div>
      ))}
      <div className="form-actions form-actions--start">
        <Button
          onClick={() =>
            setF({ ...f, values: [...f.values, { id: undefined, name: '', extra: '' }] })
          }
        >
          Another value
        </Button>
        <Button type="submit" pending={pending}>
          Save attribute
        </Button>
        {attribute && (
          <button type="button" className="btn btn--quiet" onClick={onDone}>
            Cancel
          </button>
        )}
      </div>
    </form>
  );
}

/** Small reference tables the admin sets once: taxes, payment terms, variant attributes. */
export function SettingsPage() {
  const admin = useUser().role === 'admin';
  const [editingTax, setEditingTax] = useState<Tax | null>(null);
  const [editingAttribute, setEditingAttribute] = useState<Attribute | null>(null);
  const taxes = useQuery({ queryKey: ['taxes'], queryFn: () => api.get<Tax[]>('/catalog/taxes') });
  const terms = useQuery({
    queryKey: ['terms'],
    queryFn: () => api.get<PaymentTerm[]>('/catalog/payment-terms'),
  });
  const attributes = useQuery({
    queryKey: ['attributes'],
    queryFn: () => api.get<Attribute[]>('/catalog/attributes'),
  });
  return (
    <>
      <PageHeader title="Taxes and terms" />
      <div className="settings">
        <Panel title="Taxes">
          <DataTable
            caption="Taxes"
            query={taxes}
            rowKey={(t) => t.id}
            columns={[
              { key: 'n', header: 'Name', cell: (t) => t.name },
              { key: 's', header: 'Status', cell: (t) => <ActiveTag active={t.isActive} /> },
              {
                key: 'r',
                header: 'Rate',
                align: 'end',
                cell: (t) => <span className="fig">{formatPercent(t.rateBp)}</span>,
              },
              ...(admin
                ? [
                    {
                      key: 'e',
                      header: 'Edit',
                      align: 'end' as const,
                      cell: (t: Tax) => (
                        <button
                          type="button"
                          className="btn btn--quiet"
                          onClick={() => setEditingTax(t)}
                        >
                          Edit
                        </button>
                      ),
                    },
                  ]
                : []),
            ]}
            empty={<EmptyState title="No taxes yet" />}
          />
          {admin && (
            <TaxForm
              key={editingTax?.id ?? 'new'}
              tax={editingTax}
              onDone={() => setEditingTax(null)}
            />
          )}
        </Panel>
        <Panel title="Payment terms">
          <DataTable
            caption="Payment terms"
            query={terms}
            rowKey={(t) => t.id}
            columns={[
              { key: 'n', header: 'Name', cell: (t) => t.name },
              {
                key: 'd',
                header: 'Due after',
                align: 'end',
                cell: (t) => <span className="fig">{t.dueDays} days</span>,
              },
            ]}
            empty={<EmptyState title="No payment terms yet" />}
          />
          {admin && <AddTerm />}
        </Panel>
        <Panel title="Variant attributes" className="span-2">
          <DataTable
            caption="Attributes"
            query={attributes}
            rowKey={(a) => a.id}
            columns={[
              { key: 'n', header: 'Attribute', cell: (a) => a.name },
              {
                key: 'v',
                header: 'Values',
                cell: (a) =>
                  a.values
                    .map(
                      (v) => `${v.name}${v.extraPrice ? ` (+${formatMoney(v.extraPrice)})` : ''}`,
                    )
                    .join(', '),
              },
              ...(admin
                ? [
                    {
                      key: 'e',
                      header: 'Edit',
                      align: 'end' as const,
                      cell: (a: Attribute) => (
                        <button
                          type="button"
                          className="btn btn--quiet"
                          onClick={() => setEditingAttribute(a)}
                        >
                          Edit
                        </button>
                      ),
                    },
                  ]
                : []),
            ]}
            empty={<EmptyState title="No attributes yet" />}
          />
          {admin && (
            <AttributeForm
              key={editingAttribute?.id ?? 'new'}
              attribute={editingAttribute}
              onDone={() => setEditingAttribute(null)}
            />
          )}
        </Panel>
      </div>
    </>
  );
}
