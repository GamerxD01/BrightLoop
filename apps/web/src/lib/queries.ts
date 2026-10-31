import { useQuery } from '@tanstack/react-query';
import { api } from './api';
import type { Lookups } from './types';

/** Reference data every back-office form needs; refreshed when the catalog changes. */
export function useLookups() {
  return useQuery({
    queryKey: ['lookups'],
    queryFn: () => api.get<Lookups>('/lookups'),
    staleTime: 60_000,
  });
}
