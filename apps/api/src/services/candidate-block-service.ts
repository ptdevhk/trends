import { isRecord } from "@trends/shared";

import { callConvexQuery } from "./convex-utils.js";
import { config } from "./config.js";

export type CandidateBlockRecord = {
  _id: string;
  identityKey: string;
  workspaceSlug: string;
  reason?: string;
  blockedBy?: string;
  blockedAt: number;
};

const BLOCK_PAGE_SIZE = 500;
const MAX_BLOCK_PAGES = 1_000;

function parseBlock(value: unknown): CandidateBlockRecord | null {
  if (!isRecord(value)) {
    return null;
  }
  const identityKey = typeof value.identityKey === "string" ? value.identityKey.trim() : "";
  if (!identityKey) {
    return null;
  }
  return {
    _id: typeof value._id === "string" ? value._id : String(value._id ?? ""),
    identityKey,
    workspaceSlug: typeof value.workspaceSlug === "string" ? value.workspaceSlug : "",
    ...(typeof value.reason === "string" ? { reason: value.reason } : {}),
    ...(typeof value.blockedBy === "string" ? { blockedBy: value.blockedBy } : {}),
    blockedAt: typeof value.blockedAt === "number" ? value.blockedAt : 0,
  };
}

function mergeBlock(target: Map<string, CandidateBlockRecord>, value: unknown): void {
  const block = parseBlock(value);
  if (!block) {
    return;
  }
  const existing = target.get(block.identityKey);
  if (!existing || block.blockedAt >= existing.blockedAt) {
    target.set(block.identityKey, block);
  }
}

export async function listCandidateBlocks(workspaceSlug: string): Promise<CandidateBlockRecord[]> {
  const byIdentity = new Map<string, CandidateBlockRecord>();
  const seenCursors = new Set<string>();
  let cursor: string | null = null;

  for (let pageNumber = 0; pageNumber < MAX_BLOCK_PAGES; pageNumber += 1) {
    const value = await callConvexQuery("candidate_blocks:list", {
      workspaceSlug,
      paginationOpts: {
        cursor,
        numItems: BLOCK_PAGE_SIZE,
      },
      writeSecret: config.auth.convexWriteSecret,
    });

    // Compatibility for a rolling upgrade where the BFF reaches an older
    // Convex deployment before the paginated query lands.
    if (Array.isArray(value)) {
      value.forEach((item) => mergeBlock(byIdentity, item));
      return Array.from(byIdentity.values());
    }

    if (!isRecord(value) || !Array.isArray(value.page)) {
      throw new Error("Invalid candidate_blocks:list response");
    }
    value.page.forEach((item) => mergeBlock(byIdentity, item));

    if (value.isDone === true) {
      return Array.from(byIdentity.values());
    }

    const nextCursor = typeof value.continueCursor === "string" ? value.continueCursor : "";
    if (!nextCursor || seenCursors.has(nextCursor)) {
      throw new Error("Candidate block pagination did not advance");
    }
    seenCursors.add(nextCursor);
    cursor = nextCursor;
  }

  throw new Error(`Candidate block pagination exceeded ${MAX_BLOCK_PAGES} pages`);
}
