import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { templateSchema } from '@brightloop/shared';
import { Button, ButtonLink } from '../../components/Button';
import { SelectField, TextArea, TextField } from '../../components/Field';
import { PageHeader, Panel } from '../../components/Page';
import { ErrorState, SkeletonBlock } from '../../components/States';
import { DataTable, EmptyState, type Column } from '../../components/Table';
import { api } from '../../lib/api';
import { toInt, useFormSubmit } from '../../lib/forms';
import { useLookups } from '../../lib/queries';
import type { Template } from '../../lib/types';

const columns: Column<Template>[] = [
  { key: 'name', header: 'Template', cell: (t) => <Link to={`/templates/${t.id}`}>{t.name}</Link> },
  { key: 'plan', header: 'Plan', cell: (t) => t.planName },
  {
    key: 'lines',
    header: 'Includes',
    cell: (t) =>
      t.lines.length ? (
        t.lines
          .map(
            (l) => `${l.quantity} × ${l.productName}${l.variantName ? ` (${l.variantName})` : ''}`,
          )
          .join(', ')
      ) : (
        <span className="muted">The plan only</span>
      ),
  },
  {
    key: 'valid',
    header: 'Quote valid for',
    align: 'end',
    cell: (t) => <span className="fig">{t.validityDays} days</span>,
  },
  { key: 'terms', header: 'Terms', cell: (t) => t.paymentTermName },
];

export function TemplatesPage() {
  const navigate = useNavigate();
  const query = useQuery({
    queryKey: ['templates'],
    queryFn: () => api.get<Template[]>('/templates'),
  });
  return (
    <>
      <PageHeader
        title="Quotation templates"
        actions={
          <ButtonLink to="/templates/new" variant="primary">
            New template
          </ButtonLink>
        }
      />
      <DataTable
        caption="Quotation templates"
        columns={columns}
        query={query}
        rowKey={(t) => t.id}
        onRowClick={(t) => navigate(`/templates/${t.id}`)}
        empty={
          <EmptyState title="No templates yet">
            A template holds a plan and its usual lines, so a quote starts ready.
          </EmptyState>
        }
      />
    </>
  );
}

interface Line {
  key: number;
  productId: string;
  variantId: string;
  quantity: string;
}
let k = 1;

export function TemplateFormPage() {
  const id = useParams().id;
  const editing = id ? Number(id) : null;
  const navigate = useNavigate();
  const qc = useQueryClient();
  const lookups = useLookups();
  const existing = useQuery({
    queryKey: ['templates', editing],
    queryFn: () => api.get<Template>(`/templates/${editing}`),
    enabled: !!editing,
  });
  const [f, setF] = useState({
    name: '',
    planId: '',
    validityDays: '30',
    paymentTermId: '',
    notes: '',
    lines: [] as Line[],
  });
  useEffect(() => {
    const t = existing.data;
    if (t)
      setF({
        name: t.name,
        planId: String(t.planId),
        validityDays: String(t.validityDays),
        paymentTermId: String(t.paymentTermId),
        notes: t.notes ?? '',
        lines: t.lines.map((l) => ({
          key: k++,
          productId: String(l.productId),
          variantId: l.variantId ? String(l.variantId) : '',
          quantity: String(l.quantity),
        })),
      });
  }, [existing.data]);
  const { errors, pending, submit, formRef } = useFormSubmit(
    templateSchema,
    (data) =>
      editing
        ? api.put<Template>(`/templates/${editing}`, data)
        : api.post<Template>('/templates', data),
    {
      success: 'Template saved',
      onDone: () => {
        void qc.invalidateQueries({ queryKey: ['templates'] });
        void qc.invalidateQueries({ queryKey: ['lookups'] });
        navigate('/templates');
      },
    },
  );
  if ((editing && !existing.data) || !lookups.data)
    return existing.isError ? <ErrorState error={existing.error} /> : <SkeletonBlock />;
  const L = lookups.data;
  const setLine = (key: number, patch: Partial<Line>) =>
    setF({ ...f, lines: f.lines.map((l) => (l.key === key ? { ...l, ...patch } : l)) });

  return (
    <>
      <PageHeader
        crumbs={[
          { label: 'Quotation templates', to: '/templates' },
          { label: editing ? existing.data!.name : 'New' },
        ]}
        title={editing ? existing.data!.name : 'New template'}
      />
      <form
        ref={formRef}
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          void submit({
            name: f.name,
            planId: toInt(f.planId) || undefined,
            validityDays: toInt(f.validityDays),
            paymentTermId: toInt(f.paymentTermId) || undefined,
            notes: f.notes,
            lines: f.lines
              .filter((l) => l.productId)
              .map((l) => ({
                productId: Number(l.productId),
                variantId: l.variantId ? Number(l.variantId) : null,
                quantity: toInt(l.quantity),
              })),
          });
        }}
      >
        <Panel title="Template">
          <div className="form-grid">
            <TextField
              label="Name"
              value={f.name}
              error={errors.name}
              onChange={(e) => setF({ ...f, name: e.target.value })}
            />
            <SelectField
              label="Plan"
              value={f.planId}
              error={errors.planId}
              onChange={(e) => setF({ ...f, planId: e.target.value })}
            >
              <option value="">Choose a plan</option>
              {L.plans.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </SelectField>
            <TextField
              label="Quote valid for (days)"
              type="number"
              inputMode="numeric"
              min={1}
              value={f.validityDays}
              error={errors.validityDays}
              onChange={(e) => setF({ ...f, validityDays: e.target.value })}
            />
            <SelectField
              label="Payment terms"
              value={f.paymentTermId}
              error={errors.paymentTermId}
              onChange={(e) => setF({ ...f, paymentTermId: e.target.value })}
            >
              <option value="">Choose terms</option>
              {L.paymentTerms.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </SelectField>
            <TextArea
              label="Notes for the quote"
              className="span-2"
              value={f.notes}
              error={errors.notes}
              onChange={(e) => setF({ ...f, notes: e.target.value })}
            />
          </div>
        </Panel>
        <Panel
          title="Lines"
          actions={
            <Button
              onClick={() =>
                setF({
                  ...f,
                  lines: [...f.lines, { key: k++, productId: '', variantId: '', quantity: '1' }],
                })
              }
            >
              Add a line
            </Button>
          }
        >
          {f.lines.length === 0 ? (
            <p className="muted">The plan only.</p>
          ) : (
            <div className="lines">
              {f.lines.map((l, i) => {
                const product = L.products.find((p) => String(p.id) === l.productId);
                return (
                  <fieldset key={l.key} className="line line--3">
                    <legend className="visually-hidden">Line {i + 1}</legend>
                    <SelectField
                      label="Product"
                      value={l.productId}
                      error={errors[`lines.${i}.productId`]}
                      onChange={(e) => setLine(l.key, { productId: e.target.value, variantId: '' })}
                    >
                      <option value="">Choose a product</option>
                      {L.products.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name}
                        </option>
                      ))}
                    </SelectField>
                    <SelectField
                      label="Variant"
                      value={l.variantId}
                      disabled={!product?.variants.length}
                      onChange={(e) => setLine(l.key, { variantId: e.target.value })}
                    >
                      <option value="">
                        {product?.variants.length ? 'Standard' : 'No variants'}
                      </option>
                      {product?.variants.map((v) => (
                        <option key={v.id} value={v.id}>
                          {v.valueName}
                        </option>
                      ))}
                    </SelectField>
                    <TextField
                      label="Qty"
                      type="number"
                      inputMode="numeric"
                      min={1}
                      value={l.quantity}
                      error={errors[`lines.${i}.quantity`]}
                      onChange={(e) => setLine(l.key, { quantity: e.target.value })}
                    />
                    <button
                      type="button"
                      className="btn btn--quiet line__remove"
                      onClick={() => setF({ ...f, lines: f.lines.filter((x) => x.key !== l.key) })}
                    >
                      Remove
                    </button>
                  </fieldset>
                );
              })}
            </div>
          )}
        </Panel>
        <div className="form-actions">
          <ButtonLink to="/templates">Cancel</ButtonLink>
          <Button type="submit" variant="primary" pending={pending}>
            Save template
          </Button>
        </div>
      </form>
    </>
  );
}
