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

export async function callConvexQuery(pathName: string, args: Record<string, unknown>): Promise<unknown> {
  const convexUrl = resolveConvexUrl().replace(/\/$/, "");
  const response = await fetch(`${convexUrl}/api/query`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({
      path: pathName,
      args,
    }),
  });

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
  const response = await fetch(`${convexUrl}/api/mutation`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({
      path: pathName,
      args,
    }),
  });

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
  const response = await fetch(`${convexUrl}/api/action`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({
      path: pathName,
      args,
    }),
  });

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
