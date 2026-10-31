import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  LABELS,
  formatPercent,
  priceLines,
  subscriptionSchema,
  todayIso,
  type PricingLine,
} from '@brightloop/shared';
import { Button, ButtonLink } from '../../components/Button';
import { CustomerPicker } from '../../components/CustomerPicker';
import { Checkbox, MoneyField, SelectField, TextArea, TextField } from '../../components/Field';
import { Money } from '../../components/Money';
import { PageHeader, Panel } from '../../components/Page';
import { ErrorState, SkeletonBlock } from '../../components/States';
import { api } from '../../lib/api';
import { formatMoney } from '../../lib/format';
import { paiseToRupeesInput, rupeesToPaise, toInt, useFormSubmit } from '../../lib/forms';
import { useLookups } from '../../lib/queries';
import type { Customer, Lookups, Subscription } from '../../lib/types';

interface LineState {
  key: number;
  productId: string;
  variantId: string;
  quantity: string;
  unitPrice: string;
}
interface FormState {
  customer: { id: number; name: string } | null;
  planId: string;
  planQuantity: string;
  startDate: string;
  expiryDate: string;
  paymentTermId: string;
  notes: string;
  lines: LineState[];
  discountIds: number[];
}

let lineKey = 1;
const emptyLine = (): LineState => ({
  key: lineKey++,
  productId: '',
  variantId: '',
  quantity: '1',
  unitPrice: '',
});

function fromSubscription(s: Subscription): FormState {
  return {
    customer: { id: s.customerId, name: s.customerName },
    planId: String(s.planId),
    planQuantity: String(s.lines.find((l) => l.kind === 'plan')?.quantity ?? s.minQuantity),
    startDate: s.startDate,
    expiryDate: s.expiryDate ?? '',
    paymentTermId: String(s.paymentTermId),
    notes: s.notes ?? '',
    lines: s.lines
      .filter((l) => l.kind === 'product')
      .map((l) => ({
        key: lineKey++,
        productId: String(l.productId),
        variantId: l.variantId ? String(l.variantId) : '',
        quantity: String(l.quantity),
        unitPrice: paiseToRupeesInput(l.unitPrice),
      })),
    discountIds: s.discountIds,
  };
}

function toPayload(f: FormState) {
  return {
    customerId: f.customer?.id,
    planId: toInt(f.planId) || undefined,
    templateId: null,
    planQuantity: toInt(f.planQuantity),
    startDate: f.startDate,
    expiryDate: f.expiryDate || null,
    paymentTermId: toInt(f.paymentTermId) || undefined,
    notes: f.notes,
    lines: f.lines
      .filter((l) => l.productId)
      .map((l) => ({
        productId: Number(l.productId),
        variantId: l.variantId ? Number(l.variantId) : null,
        quantity: toInt(l.quantity),
        unitPrice: l.unitPrice.trim() ? rupeesToPaise(l.unitPrice) : null,
      })),
    discountIds: f.discountIds,
  };
}

/**
 * Live preview: the shared pricing engine runs in the browser on every
 * keystroke. The API runs the same function on save, so what you see is
 * what gets stored and invoiced.
 */
function usePreview(f: FormState, lookups: Lookups | undefined) {
  return useMemo(() => {
    if (!lookups) return null;
    const plan = lookups.plans.find((p) => String(p.id) === f.planId);
    const lines: (PricingLine & { description: string })[] = [];
    if (plan) {
      lines.push({
        key: 'plan',
        productId: null,
        description: `${plan.name}, billed ${LABELS.billingPeriod[plan.billingPeriod].toLowerCase()}`,
        quantity: Math.max(0, toInt(f.planQuantity) || 0),
        unitPrice: plan.price,
        taxRateBp: plan.taxRateBp ?? 0,
      });
    }
    for (const l of f.lines) {
      const product = lookups.products.find((p) => String(p.id) === l.productId);
      if (!product) continue;
      const variant = product.variants.find((v) => String(v.id) === l.variantId);
      const custom = l.unitPrice.trim() ? rupeesToPaise(l.unitPrice) : Number.NaN;
      lines.push({
        key: String(l.key),
        productId: product.id,
        description: variant ? `${product.name} (${variant.valueName})` : product.name,
        quantity: Math.max(0, toInt(l.quantity) || 0),
        unitPrice: Number.isFinite(custom)
          ? custom
          : product.salesPrice + (variant?.extraPrice ?? 0),
        taxRateBp: product.taxRateBp ?? 0,
      });
    }
    const rules = lookups.discounts.filter((d) => f.discountIds.includes(d.id));
    const onDate = f.startDate > todayIso() ? f.startDate : todayIso();
    const result = priceLines(lines, rules, onDate);
    return { ...result, descriptions: lines.map((l) => l.description) };
  }, [f, lookups]);
}

export function SubscriptionFormPage() {
  const params = useParams();
  const editing = params.id ? Number(params.id) : null;
  const navigate = useNavigate();
  const qc = useQueryClient();
  const lookups = useLookups();
  const existing = useQuery({
    queryKey: ['subscription', editing],
    queryFn: () => api.get<Subscription>(`/subscriptions/${editing}`),
    enabled: editing !== null,
  });

  const [f, setF] = useState<FormState>({
    customer: null,
    planId: '',
    planQuantity: '1',
    startDate: todayIso(),
    expiryDate: '',
    paymentTermId: '',
    notes: '',
    lines: [],
    discountIds: [],
  });
  useEffect(() => {
    if (existing.data) setF(fromSubscription(existing.data));
  }, [existing.data]);
  // Arriving from a customer page pre-fills that customer.
  const [search] = useSearchParams();
  const presetCustomer = search.get('customer');
  useEffect(() => {
    if (editing || !presetCustomer) return;
    void api
      .get<Customer>(`/customers/${presetCustomer}`)
      .then((c) => setF((s) => ({ ...s, customer: { id: c.id, name: c.name } })))
      .catch(() => undefined);
  }, [editing, presetCustomer]);
  useEffect(() => {
    if (!editing && lookups.data && !f.paymentTermId && lookups.data.paymentTerms[0]) {
      setF((s) => ({ ...s, paymentTermId: String(lookups.data.paymentTerms[0]!.id) }));
    }
  }, [lookups.data, editing, f.paymentTermId]);

  const preview = usePreview(f, lookups.data);
  const { errors, pending, submit, formRef } = useFormSubmit(
    subscriptionSchema,
    (data) =>
      editing
        ? api.put<Subscription>(`/subscriptions/${editing}`, data)
        : api.post<Subscription>('/subscriptions', data),
    {
      success: editing ? 'Subscription saved' : 'Subscription created as a draft',
      onDone: (s) => {
        void qc.invalidateQueries({ queryKey: ['subscription', s.id] });
        navigate(`/subscriptions/${s.id}`);
      },
    },
  );

  if (lookups.isError)
    return <ErrorState error={lookups.error} onRetry={() => void lookups.refetch()} />;
  if (!lookups.data || (editing && !existing.data)) return <SkeletonBlock lines={10} />;
  const L = lookups.data;
  const plan = L.plans.find((p) => String(p.id) === f.planId);
  const sellablePlans = L.plans.filter((p) => p.isActive || String(p.id) === f.planId);
  const setLine = (key: number, patch: Partial<LineState>) =>
    setF((s) => ({ ...s, lines: s.lines.map((l) => (l.key === key ? { ...l, ...patch } : l)) }));

  return (
    <>
      <PageHeader
        crumbs={[
          { label: 'Subscriptions', to: '/subscriptions' },
          { label: editing ? existing.data!.number : 'New' },
        ]}
        title={editing ? `Edit ${existing.data!.number}` : 'New subscription'}
      />
      <form
        ref={formRef}
        noValidate
        className="detail"
        onSubmit={(e) => {
          e.preventDefault();
          void submit(toPayload(f));
        }}
      >
        <div className="detail__main">
          <Panel title="Customer and plan">
            <div className="form-grid">
              <CustomerPicker
                value={f.customer}
                onChange={(customer) => setF({ ...f, customer })}
                error={errors.customerId}
              />
              <SelectField
                label="Plan"
                value={f.planId}
                error={errors.planId}
                onChange={(e) => {
                  const p = L.plans.find((x) => String(x.id) === e.target.value);
                  setF({
                    ...f,
                    planId: e.target.value,
                    planQuantity: String(Math.max(toInt(f.planQuantity) || 1, p?.minQuantity ?? 1)),
                  });
                }}
              >
                <option value="">Choose a plan</option>
                {sellablePlans.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}, {formatMoney(p.price)}{' '}
                    {LABELS.billingPeriod[p.billingPeriod].toLowerCase()}
                  </option>
                ))}
              </SelectField>
              <TextField
                label="Seats"
                type="number"
                inputMode="numeric"
                min={plan?.minQuantity ?? 1}
                value={f.planQuantity}
                error={errors.planQuantity}
                hint={plan ? `At least ${plan.minQuantity} on this plan` : undefined}
                onChange={(e) => setF({ ...f, planQuantity: e.target.value })}
              />
              <SelectField
                label="Payment terms"
                value={f.paymentTermId}
                error={errors.paymentTermId}
                onChange={(e) => setF({ ...f, paymentTermId: e.target.value })}
              >
                {L.paymentTerms.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </SelectField>
              <TextField
                label="Start date"
                type="date"
                value={f.startDate}
                error={errors.startDate}
                onChange={(e) => setF({ ...f, startDate: e.target.value })}
              />
              <TextField
                label="Expiry date"
                type="date"
                value={f.expiryDate}
                min={f.startDate}
                error={errors.expiryDate}
                hint="Leave empty to run until closed"
                onChange={(e) => setF({ ...f, expiryDate: e.target.value })}
              />
            </div>
          </Panel>

          <Panel
            title="Add-ons"
            actions={
              <Button onClick={() => setF({ ...f, lines: [...f.lines, emptyLine()] })}>
                Add a line
              </Button>
            }
          >
            {f.lines.length === 0 ? (
              <p className="muted">
                The plan alone. Add products such as storage or support as extra lines.
              </p>
            ) : (
              <div className="lines">
                {f.lines.map((l, i) => {
                  const product = L.products.find((p) => String(p.id) === l.productId);
                  const lineIdx = f.lines.filter((x) => x.productId).indexOf(l);
                  const err = (k: string) =>
                    lineIdx >= 0 ? errors[`lines.${lineIdx}.${k}`] : undefined;
                  return (
                    <fieldset key={l.key} className="line">
                      <legend className="visually-hidden">Line {i + 1}</legend>
                      <SelectField
                        label="Product"
                        value={l.productId}
                        error={err('productId')}
                        onChange={(e) =>
                          setLine(l.key, { productId: e.target.value, variantId: '' })
                        }
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
                        error={err('variantId')}
                        disabled={!product?.variants.length}
                        onChange={(e) => setLine(l.key, { variantId: e.target.value })}
                      >
                        <option value="">
                          {product?.variants.length ? 'Standard' : 'No variants'}
                        </option>
                        {product?.variants.map((v) => (
                          <option key={v.id} value={v.id}>
                            {v.attributeName}: {v.valueName}
                            {v.extraPrice ? ` (+${formatMoney(v.extraPrice)})` : ''}
                          </option>
                        ))}
                      </SelectField>
                      <TextField
                        label="Qty"
                        type="number"
                        inputMode="numeric"
                        min={1}
                        value={l.quantity}
                        error={err('quantity')}
                        onChange={(e) => setLine(l.key, { quantity: e.target.value })}
                      />
                      <MoneyField
                        label="Unit price"
                        value={l.unitPrice}
                        error={err('unitPrice')}
                        placeholder={
                          product
                            ? paiseToRupeesInput(
                                product.salesPrice +
                                  (product.variants.find((v) => String(v.id) === l.variantId)
                                    ?.extraPrice ?? 0),
                              )
                            : ''
                        }
                        hint="Catalog price if empty"
                        onChange={(e) => setLine(l.key, { unitPrice: e.target.value })}
                      />
                      <button
                        type="button"
                        className="btn btn--quiet line__remove"
                        aria-label={`Remove line ${i + 1}`}
                        onClick={() =>
                          setF({ ...f, lines: f.lines.filter((x) => x.key !== l.key) })
                        }
                      >
                        Remove
                      </button>
                    </fieldset>
                  );
                })}
              </div>
            )}
          </Panel>

          <Panel title="Discounts">
            {L.discounts.filter((d) => d.isActive).length === 0 ? (
              <p className="muted">No discount rules exist yet.</p>
            ) : (
              <div className="checks">
                {L.discounts
                  .filter((d) => d.isActive || f.discountIds.includes(d.id))
                  .map((d) => (
                    <Checkbox
                      key={d.id}
                      label={d.name}
                      hint={`${d.type === 'percentage' ? formatPercent(d.value) : formatMoney(d.value)} off ${d.scope === 'products' ? d.productNames.join(', ') : 'the subscription'}${d.minQuantity ? `, from ${d.minQuantity} units` : ''}${d.endDate ? `, until ${d.endDate}` : ''}`}
                      checked={f.discountIds.includes(d.id)}
                      onChange={(e) =>
                        setF({
                          ...f,
                          discountIds: e.target.checked
                            ? [...f.discountIds, d.id]
                            : f.discountIds.filter((x) => x !== d.id),
                        })
                      }
                    />
                  ))}
              </div>
            )}
            {errors.discountIds && <p className="field__error">{errors.discountIds}</p>}
          </Panel>

          <Panel title="Internal notes">
            <TextArea
              label="Notes"
              value={f.notes}
              error={errors.notes}
              hint="Not shown to the customer"
              onChange={(e) => setF({ ...f, notes: e.target.value })}
            />
          </Panel>
        </div>

        <aside className="detail__side">
          <div className="sticky">
            <section
              className="sheet sheet--compact stock"
              aria-label="Price preview"
              aria-live="polite"
            >
              <h2 className="sheet__title">Each period</h2>
              {!preview || preview.lines.length === 0 ? (
                <p className="muted">Pick a plan to see the price.</p>
              ) : (
                <>
                  <table className="sheet__lines">
                    <caption className="visually-hidden">Price preview</caption>
                    <tbody>
                      {preview.lines.map((l, i) => (
                        <tr key={l.key}>
                          <td>
                            {preview.descriptions[i]}{' '}
                            <span className="sheet__muted">
                              {l.quantity} × {formatMoney(l.unitPrice)}
                            </span>
                          </td>
                          <td className="num">
                            <Money value={l.subtotal} />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <dl className="sheet__totals">
                    <div>
                      <dt>Subtotal</dt>
                      <dd className="fig">{formatMoney(preview.untaxed)}</dd>
                    </div>
                    {preview.applied.map((a) => (
                      <div key={a.discountId}>
                        <dt>{a.name}</dt>
                        <dd className="fig">−{formatMoney(a.amount)}</dd>
                      </div>
                    ))}
                    <div>
                      <dt>Tax</dt>
                      <dd className="fig">{formatMoney(preview.tax)}</dd>
                    </div>
                    <div className="sheet__total">
                      <dt>First invoice</dt>
                      <dd className="fig">{formatMoney(preview.total)}</dd>
                    </div>
                  </dl>
                  {preview.skipped.length > 0 && (
                    <ul className="sheet__skipped">
                      {preview.skipped.map((s) => (
                        <li key={s.discountId}>
                          {s.name}: {s.reason.toLowerCase()}
                        </li>
                      ))}
                    </ul>
                  )}
                </>
              )}
            </section>
            <div className="form-actions">
              <ButtonLink to={editing ? `/subscriptions/${editing}` : '/subscriptions'}>
                Cancel
              </ButtonLink>
              <Button type="submit" variant="primary" pending={pending}>
                {editing ? 'Save changes' : 'Create draft'}
              </Button>
            </div>
          </div>
        </aside>
      </form>
    </>
  );
}
