// Keep the transport code available even when the API is tested against a
// previously built shared package.  The value is intentionally identical to
// the shared contract constant.
export const INDUSTRY_REVIEW_STALE_CODE = "INDUSTRY_REVIEW_STALE" as const;
export const INDUSTRY_REVIEW_NOT_OPEN_CODE = "INDUSTRY_REVIEW_NOT_OPEN" as const;

export class IndustryReviewStaleError extends Error {
  readonly code: typeof INDUSTRY_REVIEW_STALE_CODE;
  readonly reason: string;

  constructor(reason = "The review packet is stale; refresh before deciding.") {
    const normalizedReason = reason.trim() || "The review packet is stale; refresh before deciding.";
    super(`${INDUSTRY_REVIEW_STALE_CODE}: ${normalizedReason}`);
    this.name = "IndustryReviewStaleError";
    this.code = INDUSTRY_REVIEW_STALE_CODE;
    this.reason = normalizedReason;
  }
}

/**
 * The proposal moved to a terminal/decided state between the review UI and
 * the write (e.g. identity resolution on an already-approved proposal).
 * Distinct from staleness: the packet is fresh, the state is not writable.
 */
export class IndustryReviewNotOpenError extends Error {
  readonly code: typeof INDUSTRY_REVIEW_NOT_OPEN_CODE;
  readonly reason: string;

  constructor(reason = "The proposal is not open for this review action.") {
    const normalizedReason = reason.trim() || "The proposal is not open for this review action.";
    super(`${INDUSTRY_REVIEW_NOT_OPEN_CODE}: ${normalizedReason}`);
    this.name = "IndustryReviewNotOpenError";
    this.code = INDUSTRY_REVIEW_NOT_OPEN_CODE;
    this.reason = normalizedReason;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object";
}

export function isIndustryReviewStaleError(error: unknown): boolean {
  if (error instanceof IndustryReviewStaleError) return true;
  if (isRecord(error) && error.code === INDUSTRY_REVIEW_STALE_CODE) return true;
  if (!(error instanceof Error)) return false;
  return (
    error.message === INDUSTRY_REVIEW_STALE_CODE ||
    // The Convex local backend wraps function errors as
    // "[Request ID: <id>] Server Error\nUncaught Error: <message>\n<stack>",
    // so a bare prefix never appears at the start of the transport message.
    // Match the code anywhere (it is distinctive enough to be unambiguous).
    error.message.includes(`${INDUSTRY_REVIEW_STALE_CODE}:`)
  );
}

export function industryReviewStaleReason(error: unknown): string {
  if (error instanceof IndustryReviewStaleError) return error.reason;
  if (error instanceof Error) {
    const prefix = `${INDUSTRY_REVIEW_STALE_CODE}:`;
    const marker = error.message.lastIndexOf(prefix);
    if (marker !== -1) {
      // Strip the transport wrapper and any trailing stack line.
      const reason = error.message.slice(marker + prefix.length).trim().split("\n")[0].trim();
      return reason || error.message;
    }
    return error.message;
  }
  return String(error);
}

export function isIndustryReviewNotOpenError(error: unknown): boolean {
  if (error instanceof IndustryReviewNotOpenError) return true;
  if (isRecord(error) && error.code === INDUSTRY_REVIEW_NOT_OPEN_CODE) return true;
  if (!(error instanceof Error)) return false;
  // The Convex local backend wraps function errors; the convex mutation
  // throws "Proposal is not open for <action>: <status>" (also reachable as
  // "Proposal is not open: <status>" on the resolve path).
  return /Proposal is not open/.test(error.message);
}

export function industryReviewNotOpenReason(error: unknown): string {
  if (error instanceof IndustryReviewNotOpenError) return error.reason;
  if (error instanceof Error) {
    const match = error.message.match(/Proposal is not open[^\n]*/);
    return match ? match[0].trim() : error.message;
  }
  return String(error);
}
