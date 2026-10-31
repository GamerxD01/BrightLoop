import type { ApiErrorBody, Paginated } from '@brightloop/shared';

/** Every failed request becomes one of these, with the server's field errors attached. */
export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly fieldErrors: Record<string, string> = {},
    public readonly requestId?: string,
  ) {
    super(message);
  }
}

let onUnauthorized: (() => void) | null = null;
/** The auth provider registers how to react when a session ends mid-use. */
export function setUnauthorizedHandler(handler: () => void) {
  onUnauthorized = handler;
}

type Query = Record<string, string | number | boolean | undefined | null>;

export function toSearch(params: Query = {}): string {
  const sp = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== '') sp.set(key, String(value));
  }
  const s = sp.toString();
  return s ? `?${s}` : '';
}

async function request<T>(method: string, path: string, body?: unknown, query?: Query): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`/api${path}${toSearch(query)}`, {
      method,
      credentials: 'same-origin',
      headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ApiError(
      0,
      'NETWORK',
      'Cannot reach the server. Check your connection and try again.',
    );
  }

  if (res.status === 204) return undefined as T;
  const payload = (await res.json().catch(() => null)) as (ApiErrorBody & { data?: T }) | T | null;

  if (!res.ok) {
    const err = (payload as ApiErrorBody | null)?.error;
    if (res.status === 401 && !path.startsWith('/auth/')) onUnauthorized?.();
    throw new ApiError(
      res.status,
      err?.code ?? 'HTTP_ERROR',
      err?.message ?? `Request failed (${res.status})`,
      err?.fieldErrors ?? {},
      err?.requestId,
    );
  }
  return payload as T;
}

/** Endpoints wrap single records in { data }; lists return { data, meta }. */
export const api = {
  get: <T>(path: string, query?: Query) =>
    request<{ data: T }>('GET', path, undefined, query).then((r) => r.data),
  list: <T>(path: string, query?: Query) => request<Paginated<T>>('GET', path, undefined, query),
  post: <T>(path: string, body?: unknown) =>
    request<{ data: T }>('POST', path, body ?? {}).then((r) => r?.data),
  put: <T>(path: string, body: unknown) =>
    request<{ data: T }>('PUT', path, body).then((r) => r.data),
  patch: <T>(path: string, body: unknown) =>
    request<{ data: T }>('PATCH', path, body).then((r) => r.data),
};
