import { isRecord } from "@trends/shared";

import { callConvexMutation } from "./convex-utils.js";
import { config } from "./config.js";

/**
 * Delete research_signals written under demo-* ingest runs (synthetic demo-seed).
 */
export async function purgeDemoResearchSignals(): Promise<{ deleted: number }> {
  const value = await callConvexMutation("research_signals:deleteByIngestRunPrefix", {
    writeSecret: config.auth.convexWriteSecret,
    ingestRunIdPrefix: "demo-",
  });
  if (!isRecord(value) || typeof value.deleted !== "number") {
    return { deleted: 0 };
  }
  return { deleted: value.deleted };
}
