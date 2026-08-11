import { resolveConvexUrl } from "../services/resume-import-service.js";
import { isRecord } from "@trends/shared";

export type ConvexPaginatedQueryPage = {
  page: unknown[];
  continueCursor: string;
  isDone: boolean;
};

export function isConvexPaginatedQueryPage(value: unknown): value is ConvexPaginatedQueryPage {
  if (!isRecord(value)) {
    return false;
  }
  return Array.isArray(value.page)
    && typeof value.continueCursor === "string"
    && typeof value.isDone === "boolean";
}

const CONVEX_RETRY_COUNT = 3;
const CONVEX_RETRY_DELAY_MS = 1000;

/**
 * Fetch with bounded retry for transient Convex dev-server connection resets.
 * The local Convex dev backend (used in preview Docker) can reset HTTP
 * connections under heavy mutation load; retrying with backoff prevents
 * cascading 500 errors in the BFF API.
 */
async function fetchWithRetry(
  url: string,
  body: { path: string; args: Record<string, unknown> },
  endpoint: string,
): Promise<Response> {
  let lastError: Error | null = null;
  for (let attempt = 0; attempt < CONVEX_RETRY_COUNT; attempt++) {
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify(body),
      });
      // Non-5xx responses are definitive — return immediately
      if (response.ok || response.status < 500) {
        return response;
      }
      lastError = new Error(`Convex ${endpoint} returned ${response.status}`);
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
    }
    if (attempt < CONVEX_RETRY_COUNT - 1) {
      const delay = CONVEX_RETRY_DELAY_MS * (attempt + 1);
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
  throw lastError ?? new Error(`Convex ${endpoint} failed after ${CONVEX_RETRY_COUNT} retries`);
}

export async function callConvexQuery(pathName: string, args: Record<string, unknown>): Promise<unknown> {
  const convexUrl = resolveConvexUrl().replace(/\/$/, "");
  const response = await fetchWithRetry(`${convexUrl}/api/query`, { path: pathName, args }, "query");

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Convex query failed (${response.status}): ${text}`);
  }

  const payload = await response.json() as {
    status?: string;
    value?: unknown;
    errorMessage?: string;
  };

  if (payload.status !== "success") {
    throw new Error(payload.errorMessage || `Convex query failed for ${pathName}`);
  }

  return payload.value;
}

export async function callConvexMutation(pathName: string, args: Record<string, unknown>): Promise<unknown> {
  const convexUrl = resolveConvexUrl().replace(/\/$/, "");
  const response = await fetchWithRetry(`${convexUrl}/api/mutation`, { path: pathName, args }, "mutation");

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Convex mutation failed (${response.status}): ${text}`);
  }

  const payload = await response.json() as {
    status?: string;
    value?: unknown;
    errorMessage?: string;
  };

  if (payload.status !== "success") {
    throw new Error(payload.errorMessage || `Convex mutation failed for ${pathName}`);
  }

  return payload.value;
}

export async function callConvexAction(pathName: string, args: Record<string, unknown>): Promise<unknown> {
  const convexUrl = resolveConvexUrl().replace(/\/$/, "");
  const response = await fetchWithRetry(`${convexUrl}/api/action`, { path: pathName, args }, "action");

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Convex action failed (${response.status}): ${text}`);
  }

  const payload = await response.json() as {
    status?: string;
    value?: unknown;
    errorMessage?: string;
  };

  if (payload.status !== "success") {
    throw new Error(payload.errorMessage || `Convex action failed for ${pathName}`);
  }

  return payload.value;
}