import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { attributeSchema, formatPercent, paymentTermSchema, taxSchema } from '@brightloop/shared';
import { Button } from '../../components/Button';
import { MoneyField, TextField } from '../../components/Field';
import { PageHeader, Panel } from '../../components/Page';
import { ActiveTag } from '../../components/Status';
import { DataTable, EmptyState } from '../../components/Table';
import { api } from '../../lib/api';
import { useUser } from '../../lib/auth';
import { formatMoney } from '../../lib/format';
import { rupeesToPaise, toInt, useFormSubmit } from '../../lib/forms';
import type { Attribute, PaymentTerm, Tax } from '../../lib/types';

function AddTax() {
  const qc = useQueryClient();
  const [f, setF] = useState({ name: '', rate: '' });
  const { errors, pending, submit, formRef } = useFormSubmit(
    taxSchema,
    (d) => api.post<Tax>('/catalog/taxes', d),
    {
      success: 'Tax added',
      onDone: () => {
        setF({ name: '', rate: '' });
        void qc.invalidateQueries({ queryKey: ['taxes'] });
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
          isActive: true,
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
      <Button type="submit" pending={pending}>
        Add tax
      </Button>
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

function AddAttribute() {
  const qc = useQueryClient();
  const [f, setF] = useState({ name: '', values: [{ name: '', extra: '' }] });
  const { errors, pending, submit, formRef } = useFormSubmit(
    attributeSchema,
    (d) => api.post<Attribute[]>('/catalog/attributes', d),
    {
      success: 'Attribute added',
      onDone: () => {
        setF({ name: '', values: [{ name: '', extra: '' }] });
        void qc.invalidateQueries({ queryKey: ['attributes'] });
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
        <Button onClick={() => setF({ ...f, values: [...f.values, { name: '', extra: '' }] })}>
          Another value
        </Button>
        <Button type="submit" pending={pending}>
          Save attribute
        </Button>
      </div>
    </form>
  );
}

/** Small reference tables the admin sets once: taxes, payment terms, variant attributes. */
export function SettingsPage() {
  const admin = useUser().role === 'admin';
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
            ]}
            empty={<EmptyState title="No taxes yet" />}
          />
          {admin && <AddTax />}
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
            ]}
            empty={<EmptyState title="No attributes yet" />}
          />
          {admin && <AddAttribute />}
        </Panel>
      </div>
    </>
  );
}
