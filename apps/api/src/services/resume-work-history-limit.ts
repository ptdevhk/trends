import {
  DEFAULT_RESUME_WORK_HISTORY_LIMIT,
  normalizeResumeWorkHistoryLimit,
} from "@trends/shared";
import { callConvexQuery } from "./convex-utils.js";
import { logger } from "./logger.js";

export async function getEffectiveResumeWorkHistoryLimit(): Promise<number> {
  try {
    return normalizeResumeWorkHistoryLimit(
      await callConvexQuery("system_settings:getResumeWorkHistoryLimit", {}),
    );
  } catch (error) {
    logger.error("Failed to load resume work-history limit; using default", error, {
      service: "resume-work-history-limit",
    });
    return DEFAULT_RESUME_WORK_HISTORY_LIMIT;
  }
}
