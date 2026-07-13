import { isRecord } from "@trends/shared";

import { config } from "./config.js";
import { callConvexQuery, isConvexPaginatedQueryPage } from "./convex-utils.js";

const STATUS_PAGE_SIZE = 500;
const MAX_STATUS_PAGES = 1_000;

export async function listCandidateStatuses(
  workspaceSlug: string,
): Promise<Array<Record<string, unknown>>> {
  const statuses: Array<Record<string, unknown>> = [];
  const seenCursors = new Set<string>();
  let cursor: string | null = null;

  for (let pageNumber = 0; pageNumber < MAX_STATUS_PAGES; pageNumber += 1) {
    const value = await callConvexQuery("candidate_status:listPage", {
      workspaceSlug,
      paginationOpts: {
        cursor,
        numItems: STATUS_PAGE_SIZE,
      },
      writeSecret: config.auth.convexWriteSecret,
    });

    // Retain rolling-upgrade compatibility if an older server temporarily
    // returns the legacy array shape for this query.
    if (Array.isArray(value)) {
      for (const item of value) {
        if (!isRecord(item)) {
          throw new Error("Invalid candidate status row");
        }
        statuses.push(item);
      }
      return statuses;
    }

    if (!isConvexPaginatedQueryPage(value)) {
      throw new Error("Invalid candidate_status:listPage response");
    }
    for (const item of value.page) {
      if (!isRecord(item)) {
        throw new Error("Invalid candidate status row");
      }
      statuses.push(item);
    }

    if (value.isDone) {
      return statuses;
    }
    const nextCursor = value.continueCursor.trim();
    if (!nextCursor || seenCursors.has(nextCursor)) {
      throw new Error("Candidate status pagination did not advance");
    }
    seenCursors.add(nextCursor);
    cursor = nextCursor;
  }

  throw new Error(`Candidate status pagination exceeded ${MAX_STATUS_PAGES} pages`);
}
