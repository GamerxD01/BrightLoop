import type { ReactNode } from 'react';
import { ApiError } from '../lib/api';
import { Button } from './Button';

/** Skeleton rows in the shape of the table that is loading. */
export function SkeletonRows({ columns, rows = 6 }: { columns: number; rows?: number }) {
  return (
    <>
      {Array.from({ length: rows }, (_, r) => (
        <tr key={r} className="skeleton-row" aria-hidden="true">
          {Array.from({ length: columns }, (_, c) => (
            <td key={c}>
              <span className="skeleton" style={{ width: `${45 + ((r * 7 + c * 13) % 45)}%` }} />
            </td>
          ))}
        </tr>
      ))}
    </>
  );
}

export function SkeletonBlock({ lines = 4 }: { lines?: number }) {
  return (
    <div className="skeleton-block" aria-busy="true" aria-label="Loading">
      {Array.from({ length: lines }, (_, i) => (
        <span key={i} className="skeleton" style={{ width: `${90 - i * 12}%` }} />
      ))}
    </div>
  );
}

export function EmptyState({
  title,
  children,
  action,
}: {
  title: string;
  children?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="state">
      <h3>{title}</h3>
      {children && <p className="state__text">{children}</p>}
      {action}
    </div>
  );
}

export function ErrorState({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const message =
    error instanceof ApiError ? error.message : 'Something went wrong while loading this.';
  const requestId = error instanceof ApiError ? error.requestId : undefined;
  return (
    <div className="state state--error" role="alert">
      <h3>This could not load</h3>
      <p className="state__text">
        {message}
        {requestId && <span className="state__ref"> Reference {requestId.slice(0, 8)}.</span>}
      </p>
      {onRetry && <Button onClick={onRetry}>Try again</Button>}
    </div>
  );
}
