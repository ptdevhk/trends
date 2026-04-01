import { normalizeResumeText } from "./resume-text-utils";

export const JOB51_SAFE_LIMIT = 50;

export const JOB51_SAFE_MAX_PAGES = 1;

export const JOB51_DETAIL_FETCH_DELAY_MS = 5000;

export const JOB51_DETAIL_FETCH_UNSAFE_DELAY_MS = 1000;

export function hasJob51UnsafeLimitsOverride(search = "") {
  const params = new URLSearchParams(search || "");
  return params.get("tr_unsafe_limits") === "1";
}

export function resolveJob51CollectionLimits(limit, maxPages, search = "") {
  if (hasJob51UnsafeLimitsOverride(search)) {
    return {
      limit: limit > 0 ? limit : JOB51_SAFE_LIMIT,
      maxPages: maxPages > 0 ? maxPages : JOB51_SAFE_MAX_PAGES,
    };
  }
  return {
    limit: limit > 0 ? Math.min(limit, JOB51_SAFE_LIMIT) : JOB51_SAFE_LIMIT,
    maxPages:
      maxPages > 0
        ? Math.min(maxPages, JOB51_SAFE_MAX_PAGES)
        : JOB51_SAFE_MAX_PAGES,
  };
}

export function resolveJob51DetailFetchDelayMs(search = "") {
  return hasJob51UnsafeLimitsOverride(search)
    ? JOB51_DETAIL_FETCH_UNSAFE_DELAY_MS
    : JOB51_DETAIL_FETCH_DELAY_MS;
}

export function resolveJob51AutoSyncDetailWaitMode(search = "") {
  const params = new URLSearchParams(search || "");
  const mode = normalizeResumeText(params.get("tr_job51_detail_wait") || "")
    .toLowerCase();
  if (mode === "page1" || mode === "all") {
    return mode;
  }
  return "background";
}
