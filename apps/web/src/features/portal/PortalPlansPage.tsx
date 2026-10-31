import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { formatPercent, todayIso, type PricingResult } from '@brightloop/shared';
import { Button } from '../../components/Button';
import { Checkbox } from '../../components/Field';
import { PageHeader, Panel } from '../../components/Page';
import { ErrorState, SkeletonBlock } from '../../components/States';
import { useToast } from '../../components/Toast';
import { ApiError, api } from '../../lib/api';
import { formatMoney, formatPeriod } from '../../lib/format';
import type { Plan, Subscription } from '../../lib/types';
import type { AddonOption } from '../subscriptions/ChangePanel';

type Preview = Omit<PricingResult, 'lines'> & {
  lines: (PricingResult['lines'][number] & { description: string })[];
};
interface Pick {
  on: boolean;
  quantity: string;
  variantId: string;
}

/**
 * The customer's shop: choose a plan, seats and add-ons, see the exact first
 * invoice (priced by the server, same engine as billing), and subscribe.
 */
export function PortalPlansPage() {
  const plans = useQuery({
    queryKey: ['portal', 'plans'],
    queryFn: () => api.get<Plan[]>('/portal/plans'),
  });
  const addons = useQuery({
    queryKey: ['portal', 'addons'],
    queryFn: () => api.get<AddonOption[]>('/portal/addons'),
  });
  const [planId, setPlanId] = useState<number | null>(null);
  const plan = plans.data?.find((p) => p.id === planId) ?? null;

  return (
    <>
      <PageHeader title="Plans" />
      <p className="muted plans-intro">
        Pick a plan, choose seats and add-ons, and see your first invoice before you subscribe.
      </p>
      {plans.isPending ? (
        <SkeletonBlock />
      ) : plans.isError ? (
        <ErrorState error={plans.error} />
      ) : (
        <div className="plan-grid" role="radiogroup" aria-label="Plans">
          {plans.data.map((p) => (
            <button
              key={p.id}
              type="button"
              role="radio"
              aria-checked={p.id === planId}
              className={`plan-card stock ${p.id === planId ? 'is-on' : ''}`}
              onClick={() => setPlanId(p.id)}
            >
              <span className="plan-card__name">{p.name}</span>
              <span className="plan-card__price fig">{formatMoney(p.price)}</span>
              <span className="plan-card__per">
                per seat, {formatPeriod(p.billingPeriod, p.billingInterval).toLowerCase()}
              </span>
              <span className="plan-card__rules">
                At least {p.minQuantity} {p.minQuantity === 1 ? 'seat' : 'seats'}
                {p.taxRateBp ? `, plus ${formatPercent(p.taxRateBp)} GST` : ''}
                {p.pausable ? ', can pause' : ''}
                {p.closable ? ', cancel any time' : ', fixed term'}
              </span>
            </button>
          ))}
        </div>
      )}
      {plan && addons.data && <Order key={plan.id} plan={plan} addons={addons.data} />}
    </>
  );
}

function Order({ plan, addons }: { plan: Plan; addons: AddonOption[] }) {
  const navigate = useNavigate();
  const toast = useToast();
  const qc = useQueryClient();
  const [seats, setSeats] = useState(String(plan.minQuantity));
  const [startDate, setStartDate] = useState(todayIso());
  const [picks, setPicks] = useState<Record<number, Pick>>({});

  const payload = useMemo(
    () => ({
      planId: plan.id,
      planQuantity: Number(seats) || 0,
      startDate,
      lines: Object.entries(picks)
        .filter(([, p]) => p.on)
        .map(([id, p]) => ({
          productId: Number(id),
          variantId: p.variantId ? Number(p.variantId) : null,
          quantity: Number(p.quantity) || 0,
        })),
    }),
    [plan.id, seats, startDate, picks],
  );
  const [debounced, setDebounced] = useState(payload);
  useEffect(() => {
    const t = window.setTimeout(() => setDebounced(payload), 300);
    return () => window.clearTimeout(t);
  }, [payload]);

  const preview = useQuery({
    queryKey: ['portal', 'order-preview', debounced],
    queryFn: () => api.post<Preview>('/portal/subscribe/preview', debounced),
    retry: false,
    placeholderData: (prev) => prev,
  });
  const error = preview.error instanceof ApiError ? preview.error : null;
  const fieldError = error ? (Object.values(error.fieldErrors)[0] ?? error.message) : null;

  const subscribe = useMutation({
    mutationFn: () => api.post<Subscription>('/portal/subscribe', payload),
    onSuccess: (s) => {
      toast.show(
        s.status === 'active'
          ? `Subscribed. ${s.number} has started; its first invoice is on its way.`
          : `Subscribed. ${s.number} starts on its start date.`,
      );
      void qc.invalidateQueries({ queryKey: ['portal'] });
      navigate(`/portal/subscriptions/${s.id}`);
    },
    onError: (err) =>
      toast.show(err instanceof ApiError ? err.message : 'That did not go through', 'error'),
  });

  const p = preview.data;
  return (
    <Panel title={`Your ${plan.name} subscription`}>
      <div className="change">
        <div className="change__form">
          <div className="inline-form">
            <div className="field">
              <label className="field__label" htmlFor="order-seats">
                Seats
              </label>
              <input
                id="order-seats"
                className="input input--figure change__seats"
                type="number"
                inputMode="numeric"
                min={plan.minQuantity}
                value={seats}
                aria-invalid={error?.fieldErrors.planQuantity ? true : undefined}
                aria-describedby="order-seats-msg"
                onChange={(e) => setSeats(e.target.value)}
              />
              <p
                id="order-seats-msg"
                className={error?.fieldErrors.planQuantity ? 'field__error' : 'field__hint'}
              >
                {error?.fieldErrors.planQuantity ?? `At least ${plan.minQuantity} on this plan`}
              </p>
            </div>
            <div className="field">
              <label className="field__label" htmlFor="order-start">
                Start date
              </label>
              <input
                id="order-start"
                className="input"
                type="date"
                min={todayIso()}
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
              />
              <p className="field__hint">Today starts it at once</p>
            </div>
          </div>
          <fieldset className="checks change__addons">
            <legend className="field__label">Add-ons</legend>
            {addons.map((a) => {
              const pick = picks[a.id] ?? { on: false, quantity: '1', variantId: '' };
              const set = (patch: Partial<Pick>) =>
                setPicks((all) => ({ ...all, [a.id]: { ...pick, ...patch } }));
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
          aria-label="Your first invoice"
        >
          <h3 className="sheet__title">Each period</h3>
          {fieldError ? (
            <p className="field__error">{fieldError}</p>
          ) : !p ? (
            <p className="muted">Working out the price…</p>
          ) : (
            <>
              <ul className="order__lines">
                {p.lines.map((l, i) => (
                  <li key={i}>
                    <span>{l.description}</span>
                    <span className="fig">{formatMoney(l.subtotal)}</span>
                  </li>
                ))}
              </ul>
              <dl className="sheet__totals">
                <div>
                  <dt>Subtotal</dt>
                  <dd className="fig">{formatMoney(p.untaxed)}</dd>
                </div>
                <div>
                  <dt>GST</dt>
                  <dd className="fig">{formatMoney(p.tax)}</dd>
                </div>
                <div className="sheet__total">
                  <dt>First invoice</dt>
                  <dd className="fig">{formatMoney(p.total)}</dd>
                </div>
              </dl>
            </>
          )}
          <Button
            type="button"
            pending={subscribe.isPending}
            disabled={!p || !!error || preview.isFetching}
            onClick={() => subscribe.mutate()}
          >
            Subscribe
          </Button>
        </section>
      </div>
    </Panel>
  );
}
