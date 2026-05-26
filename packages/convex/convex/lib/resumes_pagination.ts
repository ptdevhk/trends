/**
 * Pagination constants and resolver functions for resume queries.
 *
 * Extracted from resumes.ts to reduce its size and centralize
 * pagination logic used across multiple modules.
 */

// --- Pagination safety constants ---

export const DEFAULT_RESUME_LIMIT = 50;
export const MAX_SAFE_LIST_WITH_INGEST_LIMIT = 2000;
export const MAX_SAFE_LIST_WITH_INGEST_OVERFETCH = 4000;
export const FILTERED_PAGINATE_OVERFETCH_MULTIPLIER = 3;
export const MAX_SAFE_JD_PAGINATE_SCAN = 250;

// Safety margins: half of Convex's 16 MiB read / 32K scan limits.
// Forces automatic page splitting before hitting hard limits.
export const PAGINATE_MAX_BYTES_READ = 8 * 1024 * 1024; // 8 MiB
export const PAGINATE_MAX_ROWS_READ = 16_000;
// Convex enforces 16 MiB total data read per query function.
// Resume docs average ~27KB but some exceed 500KB on later search index pages.
// With post-filter attrition (filtered path), overfetch is needed but output shrinks.
// Without attrition (no-filter path), each doc contributes full size to the read budget.
// 16 × 500KB = ~8MB worst case; 128 × 27KB = ~3.5MB filtered avg — both safe.
export const MAX_SAFE_SEARCH_PAGINATE_SCAN = 128;
export const MAX_SAFE_SEARCH_PAGINATE_SCAN_UNFILTERED = 16;
// Convex search index scans up to 1024 results; 1024 × 27KB = 27MB > 16 MiB.
// Cap .take() path to 400 docs × 30KB = ~12MB, safely under 16 MiB limit.
export const MAX_SAFE_SEARCH_TAKE_LIMIT = 400;

const DEFAULT_RESUME_SCAN_BATCH_SIZE = 25;
export const MAX_RESUME_SCAN_BATCH_SIZE = 50;
const DEFAULT_RESUME_BACKUP_PAGE_SIZE = 25;
const MAX_RESUME_BACKUP_PAGE_SIZE = 25;

// --- Resolver functions ---

export function resolveListWithIngestWindow(requestedLimit: number | undefined): {
    limit: number;
    overfetchLimit: number;
} {
    const limit = Math.min(Math.max(requestedLimit || DEFAULT_RESUME_LIMIT, 1), MAX_SAFE_LIST_WITH_INGEST_LIMIT);
    return {
        limit,
        overfetchLimit: Math.min(Math.max(limit * FILTERED_PAGINATE_OVERFETCH_MULTIPLIER, limit), MAX_SAFE_LIST_WITH_INGEST_OVERFETCH),
    };
}

export function resolveSearchWithTagExpansionTakeLimit(params: {
    limit: number | undefined;
    offset: number | undefined;
    hasFilters: boolean;
    jobDescriptionId?: string;
}): number {
    const { offset, pageLimit, overfetchLimit } = resolveListWithIngestPageWindow(params.limit, params.offset);
    const requestedWindow = offset + pageLimit;

    if (!params.hasFilters && !params.jobDescriptionId?.trim()) {
        return Math.min(overfetchLimit, MAX_SAFE_SEARCH_TAKE_LIMIT);
    }

    return Math.min(
        Math.max(overfetchLimit, requestedWindow, MAX_SAFE_JD_PAGINATE_SCAN),
        MAX_SAFE_SEARCH_TAKE_LIMIT,
    );
}

export function resolveListWithIngestPageWindow(requestedLimit: number | undefined, requestedOffset: number | undefined): {
    offset: number;
    pageLimit: number;
    scanLimit: number;
    overfetchLimit: number;
} {
    const offset = Math.max(Math.trunc(requestedOffset ?? 0), 0);
    const pageLimit = Math.min(Math.max(requestedLimit || DEFAULT_RESUME_LIMIT, 1), MAX_SAFE_LIST_WITH_INGEST_LIMIT);
    const { limit: scanLimit, overfetchLimit } = resolveListWithIngestWindow(offset + pageLimit);
    return {
        offset,
        pageLimit,
        scanLimit,
        overfetchLimit,
    };
}

export function resolvePaginatedResumeOffsetCursor(cursor: string | null | undefined): number {
    if (!cursor) {
        return 0;
    }

    const parsed = Number.parseInt(cursor, 10);
    if (!Number.isFinite(parsed) || parsed <= 0) {
        return 0;
    }

    return parsed;
}

export function resolvePaginatedResumePageLimit(numItems: number | undefined): number {
    if (typeof numItems !== "number" || !Number.isFinite(numItems)) {
        return DEFAULT_RESUME_LIMIT;
    }

    return Math.min(Math.max(Math.trunc(numItems), 1), MAX_SAFE_LIST_WITH_INGEST_LIMIT);
}

export function buildPaginatedOffsetResult<T>(page: T[], total: number, offset: number): {
    page: T[];
    continueCursor: string;
    isDone: boolean;
} {
    const nextOffset = offset + page.length;
    const isDone = nextOffset >= total;
    return {
        page,
        continueCursor: isDone ? "" : String(nextOffset),
        isDone,
    };
}

export function resolveResumeScanBatchSize(requestedLimit: number | undefined): number {
    const normalizedLimit = typeof requestedLimit === "number" && Number.isFinite(requestedLimit)
        ? Math.trunc(requestedLimit)
        : DEFAULT_RESUME_SCAN_BATCH_SIZE;
    return Math.min(Math.max(normalizedLimit, 1), MAX_RESUME_SCAN_BATCH_SIZE);
}

export function resolveResumeBackupPageSize(requestedLimit: number | undefined): number {
    const normalizedLimit = typeof requestedLimit === "number" && Number.isFinite(requestedLimit)
        ? Math.trunc(requestedLimit)
        : DEFAULT_RESUME_BACKUP_PAGE_SIZE;
    return Math.min(Math.max(normalizedLimit, 1), MAX_RESUME_BACKUP_PAGE_SIZE);
}
