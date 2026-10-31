import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { api } from '../lib/api';

export interface BrandInfo {
  brandName: string;
  legalName: string;
  hasLogo: boolean;
  version: number;
}

/** Public brand details; refreshed live when the admin edits the company profile. */
export function useBrand() {
  return useQuery({
    queryKey: ['brand'],
    queryFn: () => api.get<BrandInfo>('/brand'),
    staleTime: 5 * 60_000,
  });
}

/**
 * The mark: an open loop (billing that comes round again) with one coral dot
 * where it closes, the same coral that marks a settled invoice.
 */
export function BrandMark({ size = 24, className = '' }: { size?: number; className?: string }) {
  return (
    <svg
      className={`brand-mark ${className}`}
      width={size}
      height={size}
      viewBox="0 0 32 32"
      aria-hidden="true"
      focusable="false"
    >
      <path
        d="M21.6 7.8 A10 10 0 1 1 13.1 6.4"
        fill="none"
        stroke="var(--color-ink)"
        strokeWidth="4"
        strokeLinecap="round"
      />
      <circle cx="17.6" cy="6.3" r="2.6" fill="var(--color-paid)" />
    </svg>
  );
}

/** The company's uploaded logo when there is one, otherwise the mark and name. */
export function Wordmark({ to = '/', label }: { to?: string; label?: string }) {
  const brand = useBrand().data;
  const name = brand?.brandName ?? 'Brightloop';
  return (
    <Link to={to} className="wordmark" aria-label={label ?? `${name} home`}>
      {brand?.hasLogo ? (
        <img
          className="wordmark__logo"
          src={`/api/brand/logo?v=${brand.version}`}
          alt=""
          width={140}
          height={32}
        />
      ) : (
        <>
          <BrandMark size={22} />
          <span>{name}</span>
        </>
      )}
    </Link>
  );
}
