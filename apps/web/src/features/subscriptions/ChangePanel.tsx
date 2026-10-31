import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ProratedLine } from '@brightloop/shared';
import { Button } from '../../components/Button';
import { Checkbox } from '../../components/Field';
import { Panel } from '../../components/Page';
import { useToast } from '../../components/Toast';
import { ApiError, api } from '../../lib/api';
import { formatDate, formatMoney } from '../../lib/format';
import type { Subscription } from '../../lib/types';

export interface AddonOption {
  id: number;
  name: string;
  salesPrice: number;
  variants: { id: number; attributeName: string; valueName: string; extraPrice: number }[];
}

interface Preview {
  period: { start: string; end: string } | null;
  daysLeft: number;
  daysInPeriod: number;
  charges: ProratedLine[];
  credits: ProratedLine[];
  chargeTotal: number;
  creditTotal: number;
  perPeriod: { before: number; after: number };
  changed: boolean;
}

interface Pick {
  on: boolean;
  quantity: string;
  variantId: string;
}

const key = (productId: number) => String(productId);

/**
 * Change seats and switch add-ons on an active subscription, with the money
 * shown before anything happens: what is charged today for the days left, what
 * comes back as credit, and the new price per period. The preview is the
 * server's own calculation, so the confirmation shows exactly what will be billed.
 */
export function ChangePanel({
  sub,
  addons,
  portal,
}: {
  sub: Subscription;
  addons: AddonOption[];
  portal: boolean;
}) {
  const qc = useQueryClient();
  const toast = useToast();
  const base = `${portal ? '/portal' : ''}/subscriptions/${sub.id}/changes`;
  const planLine = sub.lines.find((l) => l.kind === 'plan');

  const initial = useMemo(() => {
    const picks: Record<string, Pick> = {};
    for (const a of addons) picks[key(a.id)] = { on: false, quantity: '1', variantId: '' };
    for (const l of sub.lines.filter((x) => x.kind === 'product' && x.productId)) {
      picks[key(l.productId!)] = {
        on: true,
        quantity: String(l.quantity),
        variantId: l.variantId ? String(l.variantId) : '',
      };
    }
    return { seats: String(planLine?.quantity ?? sub.minQuantity), picks };
  }, [sub, addons, planLine]);

  const [seats, setSeats] = useState(initial.seats);
  const [picks, setPicks] = useState(initial.picks);
  useEffect(() => {
    setSeats(initial.seats);
    setPicks(initial.picks);
  }, [initial]);

  const payload = useMemo(
    () => ({
      planQuantity: Number(seats) || 0,
      lines: Object.entries(picks)
        .filter(([, p]) => p.on)
        .map(([id, p]) => ({
          productId: Number(id),
          variantId: p.variantId ? Number(p.variantId) : null,
          quantity: Number(p.quantity) || 0,
        })),
    }),
    [seats, picks],
  );

  // Debounced so typing a number asks the server once.
  const [debounced, setDebounced] = useState(payload);
  useEffect(() => {
    const t = window.setTimeout(() => setDebounced(payload), 300);
    return () => window.clearTimeout(t);
  }, [payload]);

  const preview = useQuery({
    queryKey: ['subscription', sub.id, 'change-preview', debounced],
    queryFn: () => api.post<Preview>(`${base}/preview`, debounced),
    retry: false,
    placeholderData: (prev) => prev,
  });

  const apply = useMutation({
    mutationFn: () => api.post<{ chargeTotal: number; creditTotal: number }>(base, payload),
    onSuccess: (r) => {
      const parts = [
        r.chargeTotal ? `${formatMoney(r.chargeTotal)} invoiced for the rest of this period` : '',
        r.creditTotal ? `${formatMoney(r.creditTotal)} added to account credit` : '',
      ].filter(Boolean);
      toast.show(
        parts.length
          ? `Changed. ${parts.join('; ')}.`
          : 'Changed. The new price starts with the next invoice.',
      );
      void qc.invalidateQueries({ queryKey: ['subscription'] });
      void qc.invalidateQueries({ queryKey: ['portal'] });
      void qc.invalidateQueries({ queryKey: ['invoices'] });
      void qc.invalidateQueries({ queryKey: ['credits'] });
    },
    onError: (err) =>
      toast.show(err instanceof ApiError ? err.message : 'The change did not go through', 'error'),
  });

  const p = preview.data;
  const error = preview.error instanceof ApiError ? preview.error : null;
  const fieldError = error ? (Object.values(error.fieldErrors)[0] ?? error.message) : null;

  return (
    <Panel title={portal ? 'Change seats or add-ons' : 'Change mid-period'}>
      <div className="change">
        <div className="change__form">
          <div className="field">
            <label className="field__label" htmlFor="change-seats">
              Seats on {sub.planName}
            </label>
            <input
              id="change-seats"
              className="input input--figure change__seats"
              type="number"
              inputMode="numeric"
              min={sub.minQuantity}
              value={seats}
              aria-invalid={error?.fieldErrors.planQuantity ? true : undefined}
              aria-describedby="change-seats-msg"
              onChange={(e) => setSeats(e.target.value)}
            />
            <p
              id="change-seats-msg"
              className={error?.fieldErrors.planQuantity ? 'field__error' : 'field__hint'}
            >
              {error?.fieldErrors.planQuantity ?? `At least ${sub.minQuantity} on this plan`}
            </p>
          </div>

          <fieldset className="checks change__addons">
            <legend className="field__label">Add-ons</legend>
            {addons.map((a) => {
              const pick = picks[key(a.id)] ?? { on: false, quantity: '1', variantId: '' };
              const set = (patch: Partial<Pick>) =>
                setPicks((all) => ({ ...all, [key(a.id)]: { ...pick, ...patch } }));
              const variant = a.variants.find((v) => String(v.id) === pick.variantId);
              return (
                <div key={a.id} className={`addon ${pick.on ? 'is-on' : ''}`}>
                  <Checkbox
                    label={a.name}
                    hint={`${formatMoney(a.salesPrice + (variant?.extraPrice ?? 0))} each period, before tax`}
                    checked={pick.on}
                    onChange={(e) => set({ on: e.target.checked })}
                  />
                  {pick.on && (
                    <div className="addon__opts">
                      {a.variants.length > 0 && (
                        <select
                          className="input select"
                          aria-label={`${a.name} variant`}
                          value={pick.variantId}
                          onChange={(e) => set({ variantId: e.target.value })}
                        >
                          <option value="">Standard</option>
                          {a.variants.map((v) => (
                            <option key={v.id} value={v.id}>
                              {v.valueName}
                              {v.extraPrice ? ` (+${formatMoney(v.extraPrice)})` : ''}
                            </option>
                          ))}
                        </select>
                      )}
                      <input
                        className="input input--figure addon__qty"
                        type="number"
                        min={1}
                        inputMode="numeric"
                        aria-label={`${a.name} quantity`}
                        value={pick.quantity}
                        onChange={(e) => set({ quantity: e.target.value })}
                      />
                    </div>
                  )}
                </div>
              );
            })}
          </fieldset>
        </div>

        <section
          className="sheet sheet--compact stock change__preview"
          aria-live="polite"
          aria-label="What this change costs"
        >
          <h3 className="sheet__title">What changes</h3>
          {fieldError && !error?.fieldErrors.planQuantity && (
            <p className="field__error">{fieldError}</p>
          )}
          {!p ? (
            <p className="muted">Working out the price…</p>
          ) : !p.changed ? (
            <p className="muted">Adjust seats or add-ons to see the price.</p>
          ) : (
            <>
              <dl className="sheet__totals">
                <div>
                  <dt>Each period now, before discounts</dt>
                  <dd className="fig">{formatMoney(p.perPeriod.before)}</dd>
                </div>
                <div className="sheet__total">
                  <dt>Each period after</dt>
                  <dd className="fig">{formatMoney(p.perPeriod.after)}</dd>
                </div>
              </dl>
              {p.period ? (
                <>
                  <p className="change__period">
                    {p.daysLeft} of {p.daysInPeriod} days left in the period ending{' '}
                    {formatDate(p.period.end)}.
                  </p>
                  {p.charges.length > 0 && (
                    <div className="change__money">
                      <p className="change__head">
                        Invoiced today: <span className="fig">{formatMoney(p.chargeTotal)}</span>
                      </p>
                      <ul>
                        {p.charges.map((c) => (
                          <li key={c.key}>{c.description}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                  {p.credits.length > 0 && (
                    <div className="change__money">
                      <p className="change__head">
                        Credit for unused days:{' '}
                        <span className="fig">{formatMoney(p.creditTotal)}</span>
                      </p>
                      <ul>
                        {p.credits.map((c) => (
                          <li key={c.key}>{c.description}</li>
                        ))}
                      </ul>
                      <p className="muted">Spent automatically on the next invoice.</p>
                    </div>
                  )}
                </>
              ) : (
                <p className="change__period">
                  Nothing has been billed yet, so the new price simply starts with the first
                  invoice.
                </p>
              )}
            </>
          )}
          <Button
            variant="primary"
            disabled={!p?.changed || !!error || preview.isFetching}
            pending={apply.isPending}
            onClick={() => apply.mutate()}
          >
            {portal ? 'Confirm change' : 'Apply change'}
          </Button>
        </section>
      </div>
    </Panel>
  );
}
