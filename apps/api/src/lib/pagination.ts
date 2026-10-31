import type { ListQuery, Paginated } from '@brightloop/shared';

/** Collects WHERE fragments with numbered parameters, keeping every value parameterised. */
export class SqlFilter {
  readonly params: unknown[] = [];
  private readonly clauses: string[] = [];

  /** `fragment` uses `?` for the value, e.g. add('s.status = ?', status). */
  add(fragment: string, value: unknown): this {
    if (value === undefined || value === null || value === '') return this;
    this.params.push(value);
    this.clauses.push(fragment.replace('?', `$${this.params.length}`));
    return this;
  }

  raw(fragment: string): this {
    this.clauses.push(fragment);
    return this;
  }

  get where(): string {
    return this.clauses.length ? `WHERE ${this.clauses.join(' AND ')}` : '';
  }

  /** Placeholders for LIMIT/OFFSET after the filter values. */
  page(query: Pick<ListQuery, 'page' | 'pageSize'>): string {
    this.params.push(query.pageSize, (query.page - 1) * query.pageSize);
    return `LIMIT $${this.params.length - 1} OFFSET $${this.params.length}`;
  }
}

/** Only whitelisted columns may be sorted on; anything else falls back to the default. */
export function orderBy(
  sort: string | undefined,
  dir: 'asc' | 'desc',
  allowed: Record<string, string>,
  fallback: string,
): string {
  const column = (sort && allowed[sort]) || fallback;
  return `ORDER BY ${column} ${dir === 'asc' ? 'ASC' : 'DESC'}`;
}

export function paginated<T>(
  rows: (T & { totalCount?: number })[],
  query: ListQuery,
): Paginated<T> {
  const total = rows[0]?.totalCount ?? 0;
  const data = rows.map(({ totalCount: _t, ...rest }) => rest as T);
  return { data, meta: { page: query.page, pageSize: query.pageSize, total } };
}
