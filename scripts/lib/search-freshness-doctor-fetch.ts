/**
 * Client timeouts for the search-freshness doctor.
 *
 * Node's global `fetch` is undici. AbortSignal.timeout(600_000) is not enough:
 * undici still applies a default `headersTimeout` / `bodyTimeout` of 300_000 ms.
 * A preferred-path lag scan that spends ~359 s before the first response byte
 * then dies with TypeError "fetch failed" (cause HeadersTimeoutError) and the
 * doctor falls back to an incomplete dry-run window.
 *
 * Pass those undici timeouts on `request()` so they match the AbortSignal
 * ceiling. Do not bump AbortSignal alone.
 */
import { request } from "undici";

/** Undici Agent/Client default for headersTimeout and bodyTimeout. */
export const UNDICI_DEFAULT_FETCH_TIMEOUT_MS = 300_000;

/** Preferred `/api/resumes/search-freshness` wait (prod-restored SQLite lag scan). */
export const SEARCH_FRESHNESS_DOCTOR_FETCH_TIMEOUT_MS = 600_000;

/** Fallback dry-run `trigger-reingest` wait. */
export const SEARCH_FRESHNESS_DOCTOR_FALLBACK_FETCH_TIMEOUT_MS = 420_000;

export function searchFreshnessDoctorUndiciTimeouts(timeoutMs: number): {
  headersTimeout: number;
  bodyTimeout: number;
} {
  return {
    headersTimeout: timeoutMs,
    bodyTimeout: timeoutMs,
  };
}

export type SearchFreshnessDoctorFetchInit = {
  method?: string;
  headers?: Record<string, string>;
  body?: string;
  timeoutMs?: number;
};

export type SearchFreshnessDoctorFetchResponse = {
  ok: boolean;
  status: number;
  json: () => Promise<unknown>;
};

/**
 * Fetch that raises undici headers/body timeouts with the AbortSignal ceiling.
 * Login and golden curls stay on global fetch; only the long lag scans use this.
 */
export async function fetchWithSearchFreshnessDoctorTimeout(
  url: string,
  init: SearchFreshnessDoctorFetchInit = {},
): Promise<SearchFreshnessDoctorFetchResponse> {
  const timeoutMs = init.timeoutMs ?? SEARCH_FRESHNESS_DOCTOR_FETCH_TIMEOUT_MS;
  const { statusCode, body } = await request(url, {
    method: init.method ?? "GET",
    headers: init.headers,
    body: init.body,
    signal: AbortSignal.timeout(timeoutMs),
    ...searchFreshnessDoctorUndiciTimeouts(timeoutMs),
  });
  return {
    ok: statusCode >= 200 && statusCode < 300,
    status: statusCode,
    json: () => body.json(),
  };
}
