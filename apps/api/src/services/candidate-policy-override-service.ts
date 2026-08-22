import { isRecord } from "@trends/shared";

import { callConvexQuery } from "./convex-utils.js";
import { config } from "./config.js";

export type CandidatePolicyOverrideRecord = {
  _id: string;
  workspaceSlug: string;
  resumeId: string;
  resumeIdentity: string;
  companyKey: string;
  effect: string;
  reason?: string;
  authorizedBy?: string;
  createdAt: number;
  updatedAt: number;
};

const OVERRIDE_PAGE_SIZE = 500;
const MAX_OVERRIDE_PAGES = 1_000;

function parseOverride(value: unknown): CandidatePolicyOverrideRecord | null {
  if (!isRecord(value)) {
    return null;
  }
  const resumeIdentity = typeof value.resumeIdentity === "string" ? value.resumeIdentity.trim() : "";
  const companyKey = typeof value.companyKey === "string" ? value.companyKey.trim() : "";
  if (!resumeIdentity || !companyKey) {
    return null;
  }
  return {
    _id: typeof value._id === "string" ? value._id : String(value._id ?? ""),
    workspaceSlug: typeof value.workspaceSlug === "string" ? value.workspaceSlug : "",
    resumeId: typeof value.resumeId === "string" ? value.resumeId : String(value.resumeId ?? ""),
    resumeIdentity,
    companyKey,
    effect: typeof value.effect === "string" ? value.effect : "allow",
    ...(typeof value.reason === "string" ? { reason: value.reason } : {}),
    ...(typeof value.authorizedBy === "string" ? { authorizedBy: value.authorizedBy } : {}),
    createdAt: typeof value.createdAt === "number" ? value.createdAt : 0,
    updatedAt: typeof value.updatedAt === "number" ? value.updatedAt : 0,
  };
}

function mergeOverride(target: Map<string, CandidatePolicyOverrideRecord>, value: unknown): void {
  const override = parseOverride(value);
  if (!override) {
    return;
  }
  const key = `${override.resumeIdentity}::${override.companyKey}`;
  const existing = target.get(key);
  if (!existing || override.updatedAt >= existing.updatedAt) {
    target.set(key, override);
  }
}

export async function listCandidatePolicyOverrides(
  workspaceSlug: string
): Promise<CandidatePolicyOverrideRecord[]> {
  const byKey = new Map<string, CandidatePolicyOverrideRecord>();
  const seenCursors = new Set<string>();
  let cursor: string | null = null;

  for (let pageNumber = 0; pageNumber < MAX_OVERRIDE_PAGES; pageNumber += 1) {
    const value = await callConvexQuery("candidate_policy_overrides:list", {
      workspaceSlug,
      paginationOpts: {
        cursor,
        numItems: OVERRIDE_PAGE_SIZE,
      },
      writeSecret: config.auth.convexWriteSecret,
    });

    if (Array.isArray(value)) {
      value.forEach((item) => mergeOverride(byKey, item));
      return Array.from(byKey.values());
    }

    if (!isRecord(value) || !Array.isArray(value.page)) {
      throw new Error("Invalid candidate_policy_overrides:list response");
    }
    value.page.forEach((item) => mergeOverride(byKey, item));

    if (value.isDone === true) {
      return Array.from(byKey.values());
    }

    const nextCursor = typeof value.continueCursor === "string" ? value.continueCursor : "";
    if (!nextCursor || seenCursors.has(nextCursor)) {
      throw new Error("Candidate policy override pagination did not advance");
    }
    seenCursors.add(nextCursor);
    cursor = nextCursor;
  }

  throw new Error(`Candidate policy override pagination exceeded ${MAX_OVERRIDE_PAGES} pages`);
}
