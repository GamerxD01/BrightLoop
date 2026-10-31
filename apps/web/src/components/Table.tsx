import type { ReactNode } from 'react';
import type { UseQueryResult } from '@tanstack/react-query';
import { EmptyState, ErrorState, SkeletonRows } from './States';

export interface Column<T> {
  key: string;
  header: string;
  cell: (row: T) => ReactNode;
  align?: 'end';
  sortable?: boolean;
  className?: string;
}

interface Props<T> {
  columns: Column<T>[];
  query: UseQueryResult<{ data: T[] } | T[]>;
  rowKey: (row: T) => string | number;
  empty: ReactNode;
  caption: string;
  sort?: string;
  dir?: 'asc' | 'desc';
  onSort?: (key: string) => void;
  onRowClick?: (row: T) => void;
}

/**
 * Every list in the app: one table recipe, with loading, empty, error and full
 * states. A row that opens a record carries a real link in its first cell;
 * the whole row is a click target as a convenience.
 */
export function DataTable<T>({
  columns,
  query,
  rowKey,
  empty,
  caption,
  sort,
  dir,
  onSort,
  onRowClick,
}: Props<T>) {
  const rows: T[] | undefined = Array.isArray(query.data) ? query.data : query.data?.data;

  if (query.isError) return <ErrorState error={query.error} onRetry={() => void query.refetch()} />;
  if (rows && rows.length === 0) return <>{empty}</>;

  return (
    <div className="table-wrap" aria-busy={query.isFetching || undefined}>
      <table className="table">
        <caption className="visually-hidden">{caption}</caption>
        <thead>
          <tr>
            {columns.map((c) => {
              const active = sort === c.key;
              return (
                <th
                  key={c.key}
                  scope="col"
                  className={`${c.align === 'end' ? 'num' : ''} ${c.className ?? ''}`}
                  aria-sort={active ? (dir === 'asc' ? 'ascending' : 'descending') : undefined}
                >
                  {c.sortable && onSort ? (
                    <button type="button" className="th-sort" onClick={() => onSort(c.key)}>
                      {c.header}
                      <span className="th-sort__mark" aria-hidden="true">
                        {active ? (dir === 'asc' ? '↑' : '↓') : ''}
                      </span>
                    </button>
                  ) : (
                    c.header
                  )}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {!rows ? (
            <SkeletonRows columns={columns.length} />
          ) : (
            rows.map((row) => (
              <tr
                key={rowKey(row)}
                className={onRowClick ? 'is-clickable' : undefined}
                onClick={
                  onRowClick
                    ? (e) => {
                        if ((e.target as HTMLElement).closest('a, button')) return;
                        onRowClick(row);
                      }
                    : undefined
                }
              >
                {columns.map((c) => (
                  <td
                    key={c.key}
                    className={`${c.align === 'end' ? 'num' : ''} ${c.className ?? ''}`}
                    data-label={c.header}
                  >
                    {c.cell(row)}
                  </td>
                ))}
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}

export { EmptyState };

export function Pagination({
  page,
  pageSize,
  total,
  onPage,
}: {
  page: number;
  pageSize: number;
  total: number;
  onPage: (page: number) => void;
}) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  if (total === 0) return null;
  const from = (page - 1) * pageSize + 1;
  const to = Math.min(page * pageSize, total);
  return (
    <nav className="pager" aria-label="Pages">
      <span className="pager__count">
        <span className="fig">
          {from.toLocaleString('en-IN')} to {to.toLocaleString('en-IN')}
        </span>{' '}
        of <span className="fig">{total.toLocaleString('en-IN')}</span>
      </span>
      <div className="pager__buttons">
        <button
          type="button"
          className="btn btn--quiet"
          disabled={page <= 1}
          onClick={() => onPage(page - 1)}
        >
          Previous
        </button>
        <span className="pager__page">
          Page <span className="fig">{page}</span> of <span className="fig">{pages}</span>
        </span>
        <button
          type="button"
          className="btn btn--quiet"
          disabled={page >= pages}
          onClick={() => onPage(page + 1)}
        >
          Next
        </button>
      </div>
    </nav>
  );
}
