import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { EventType } from '@brightloop/shared';

/** Which cached queries each server event makes stale. */
const INVALIDATES: Record<EventType, string[]> = {
  'subscription.changed': [
    'subscriptions',
    'subscription',
    'dashboard',
    'customers',
    'billing',
    'portal',
  ],
  'invoice.changed': [
    'invoices',
    'invoice',
    'subscription',
    'dashboard',
    'customers',
    'billing',
    'portal',
  ],
  'payment.recorded': ['payments', 'invoices', 'invoice', 'dashboard', 'customers', 'portal'],
  'billing.progress': ['automation'],
  'catalog.changed': ['lookups', 'products', 'plans', 'taxes', 'attributes'],
};

export type LiveState = 'connecting' | 'live' | 'offline';

export interface BillingProgress {
  processed: number;
  total: number;
  invoices: number;
  done?: boolean;
}

/**
 * One EventSource per signed-in tab. Each server event invalidates the
 * matching queries, so every open list, detail and dashboard refetches
 * on its own. The browser reconnects automatically.
 */
export function useRealtime(enabled: boolean): LiveState {
  const qc = useQueryClient();
  const [state, setState] = useState<LiveState>('connecting');

  useEffect(() => {
    if (!enabled) return;
    const source = new EventSource('/api/events', { withCredentials: true });
    source.addEventListener('ready', () => setState('live'));
    source.onerror = () =>
      setState(source.readyState === EventSource.CLOSED ? 'offline' : 'connecting');

    let pending = new Set<string>();
    let timer: number | undefined;
    const flush = () => {
      for (const key of pending) void qc.invalidateQueries({ queryKey: [key] });
      pending = new Set();
      timer = undefined;
    };

    for (const type of Object.keys(INVALIDATES) as EventType[]) {
      source.addEventListener(type, (event) => {
        if (type === 'billing.progress') {
          qc.setQueryData(
            ['billing-progress'],
            JSON.parse((event as MessageEvent).data) as BillingProgress,
          );
          return;
        }
        // Coalesce bursts (a billing run emits many) into one refetch per key.
        INVALIDATES[type].forEach((key) => pending.add(key));
        timer ??= window.setTimeout(flush, 250);
      });
    }
    return () => {
      source.close();
      if (timer) window.clearTimeout(timer);
    };
  }, [enabled, qc]);

  return state;
}
