import { toSearch } from '../lib/api';

/**
 * Downloads the list as CSV with the filters on screen; paging is dropped so
 * the file holds every matching row.
 */
export function ExportLink({
  entity,
  filters,
}: {
  entity: string;
  filters: Record<string, string>;
}) {
  const { page: _page, ...rest } = filters;
  return (
    <a className="btn btn--secondary" href={`/api/exports/${entity}${toSearch(rest)}`} download>
      Export CSV
    </a>
  );
}
