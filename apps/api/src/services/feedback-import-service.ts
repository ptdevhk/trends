import ExcelJS from "exceljs";
import Papa from "papaparse";

import type { CandidateActionType } from "./action-storage.js";
import type {
  ReviewPacketImportStats,
  ReviewPacketItemSnapshot,
  StoredReviewPacketRun,
} from "./review-packet-storage.js";

type CandidateLifecycleStatus =
  | "new"
  | "contacted"
  | "interviewing"
  | "interviewed_pass"
  | "interviewed_reject"
  | "offer"
  | "hired"
  | "withdrawn";

type FeedbackRow = {
  rowNumber: number;
  resumeId: string;
  profileUrl?: string;
  name?: string;
  status?: string;
  action?: string;
  notes?: string;
  referenceNote?: string;
};

type PreparedRow = FeedbackRow & {
  matchedItem: ReviewPacketItemSnapshot;
  matchedByProfileUrl: boolean;
  normalizedStatus?: CandidateLifecycleStatus;
  normalizedAction?: CandidateActionType;
  hasReviewContent: boolean;
  warnings: string[];
};

export type FeedbackImportSummary = {
  fileName: string;
  totalRows: number;
  matchedRows: number;
  importedRows: number;
  reviewedCount: number;
  statusUpdates: number;
  actionUpdates: number;
  noteUpdates: number;
  invalidRows: number;
  duplicateRows: number;
  warningCount: number;
  matchedByProfileUrlCount: number;
  nameMismatchCount: number;
};

export type FeedbackImportResult = {
  summary: FeedbackImportSummary;
  warnings: string[];
  stats: ReviewPacketImportStats;
};

type FeedbackImportCallbacks = {
  upsertCandidateStatus: (params: {
    identityKey: string;
    status: CandidateLifecycleStatus;
    notes?: string;
    updatedBy?: string;
  }) => Promise<void>;
  saveAction: (params: {
    resumeId: string;
    actionType: CandidateActionType;
    actionData?: Record<string, unknown>;
  }) => Promise<void> | void;
};

const REQUIRED_RESUME_ID_HEADERS = new Set(["resumeid", "resume_id"]);
const PROFILE_URL_HEADERS = new Set(["profileurl", "profile_url", "url"]);
const NAME_HEADERS = new Set(["name", "candidate"]);
const STATUS_HEADERS = new Set(["status"]);
const ACTION_HEADERS = new Set(["action", "decision"]);
const NOTES_HEADERS = new Set(["notes", "note", "usercomment", "comment", "remarks"]);
const REFERENCE_NOTE_HEADERS = new Set(["referencenote", "reference_note"]);

function normalizeHeader(value: unknown): string {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
}

function readString(value: unknown): string | undefined {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : undefined;
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }
  return undefined;
}

function normalizeToken(value: string | undefined): string | undefined {
  if (!value) {
    return undefined;
  }
  const trimmed = value.trim().toLowerCase();
  return trimmed.length > 0 ? trimmed : undefined;
}

function normalizeFreeText(value: string | undefined): string {
  return value
    ?.trim()
    .replace(/\s+/g, " ")
    .toLowerCase() ?? "";
}

function parseJob5156ResumeId(pathname: string): string | null {
  const oldRouteMatch = pathname.match(/^\/api\/com\/resume\/([^/?#]+)/i);
  if (oldRouteMatch?.[1]) {
    return decodeURIComponent(oldRouteMatch[1]);
  }

  const viewRouteMatch = pathname.match(/^\/resume\/view\/([^/?#]+)/i);
  if (viewRouteMatch?.[1]) {
    return decodeURIComponent(viewRouteMatch[1]);
  }

  return null;
}

function normalizeUrlForIdentity(parsed: URL): string {
  const path = parsed.pathname.replace(/\/+$/, "") || "/";
  const sortedParams = Array.from(parsed.searchParams.entries())
    .filter(([key]) => !key.toLowerCase().startsWith("utm_"))
    .sort(([leftKey, leftValue], [rightKey, rightValue]) => {
      if (leftKey === rightKey) {
        return leftValue.localeCompare(rightValue);
      }
      return leftKey.localeCompare(rightKey);
    });

  const query = sortedParams.length > 0
    ? `?${sortedParams
      .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
      .join("&")}`
    : "";

  return `${parsed.hostname.toLowerCase()}${path}${query}`.toLowerCase();
}

function parseUrlLike(value: string): URL | null {
  try {
    return new URL(value);
  } catch {
    try {
      return new URL(`https://${value}`);
    } catch {
      return null;
    }
  }
}

export function normalizeProfileIdentityKey(value: string | undefined, source?: string): string | undefined {
  if (!value) {
    return undefined;
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return undefined;
  }

  const directResumeId = parseJob5156ResumeId(trimmed);
  if (directResumeId) {
    return `profileUrl:hr.job5156.com/api/com/resume/${encodeURIComponent(directResumeId)}`.toLowerCase();
  }

  const parsed = parseUrlLike(trimmed);
  if (!parsed) {
    const fallback = trimmed
      .toLowerCase()
      .replace(/^https?:\/\//, "")
      .replace(/#.*$/, "")
      .replace(/\/+$/, "");
    return fallback ? `profileUrl:${fallback}` : undefined;
  }

  const hostname = parsed.hostname.toLowerCase();
  if (hostname === "hr.job5156.com") {
    const resumeId = parseJob5156ResumeId(parsed.pathname);
    if (resumeId) {
      return `profileUrl:hr.job5156.com/api/com/resume/${encodeURIComponent(resumeId)}`.toLowerCase();
    }
  }

  const normalizedSource = source?.trim().toLowerCase();
  const isSeekHost = hostname.endsWith(".employer.seek.com") || normalizedSource?.endsWith(".employer.seek.com");
  if (isSeekHost) {
    const openProfileId = parsed.searchParams.get("openProfileId");
    if (openProfileId && /^\d+$/.test(openProfileId)) {
      return `profileUrl:${hostname}/candidates/${openProfileId}`.toLowerCase();
    }

    const profileIdMatch = parsed.pathname.match(/\/candidates\/(?:profiles\/)?(\d+)(?:\/|$)/i);
    if (profileIdMatch?.[1]) {
      return `profileUrl:${hostname}/candidates/${profileIdMatch[1]}`.toLowerCase();
    }
  }

  return `profileUrl:${normalizeUrlForIdentity(parsed)}`;
}

function normalizeStatus(value: string | undefined): CandidateLifecycleStatus | undefined {
  const normalized = normalizeToken(value);
  switch (normalized) {
    case "new":
    case "contacted":
    case "interviewing":
    case "interviewed_pass":
    case "interviewed_reject":
    case "offer":
    case "hired":
    case "withdrawn":
      return normalized;
    default:
      return undefined;
  }
}

function normalizeAction(value: string | undefined): CandidateActionType | undefined {
  const normalized = normalizeToken(value);
  switch (normalized) {
    case "star":
    case "shortlist":
    case "reject":
    case "archive":
    case "note":
    case "contact":
      return normalized;
    default:
      return undefined;
  }
}

function buildHeaderIndex(headers: unknown[]): Map<string, number> {
  const index = new Map<string, number>();
  headers.forEach((header, headerIndex) => {
    const normalized = normalizeHeader(header);
    if (!normalized) {
      return;
    }
    if (!index.has(normalized)) {
      index.set(normalized, headerIndex);
    }
  });
  return index;
}

function findHeader(index: Map<string, number>, candidates: ReadonlySet<string>): number {
  for (const candidate of candidates) {
    const found = index.get(candidate);
    if (typeof found === "number") {
      return found;
    }
  }
  return -1;
}

function toFeedbackRowFromValues(values: unknown[], rowNumber: number, headerIndex: Map<string, number>): FeedbackRow {
  const readAt = (candidates: ReadonlySet<string>): string | undefined => {
    const index = findHeader(headerIndex, candidates);
    return index >= 0 ? readString(values[index]) : undefined;
  };

  return {
    rowNumber,
    resumeId: readAt(REQUIRED_RESUME_ID_HEADERS) ?? "",
    profileUrl: readAt(PROFILE_URL_HEADERS),
    name: readAt(NAME_HEADERS),
    status: readAt(STATUS_HEADERS),
    action: readAt(ACTION_HEADERS),
    notes: readAt(NOTES_HEADERS),
    referenceNote: readAt(REFERENCE_NOTE_HEADERS),
  };
}

function parseCsvRows(buffer: Uint8Array): FeedbackRow[] {
  const parsed = Papa.parse<string[]>(Buffer.from(buffer).toString("utf8"), {
    skipEmptyLines: true,
  });

  const rows = Array.isArray(parsed.data) ? parsed.data : [];
  const headerIndex = buildHeaderIndex(rows[0] ?? []);
  if (findHeader(headerIndex, REQUIRED_RESUME_ID_HEADERS) === -1) {
    throw new Error("Feedback import requires a Resume ID column");
  }

  return rows
    .slice(1)
    .map((row, index) => toFeedbackRowFromValues(row, index + 2, headerIndex))
    .filter((row) =>
      row.resumeId
      || row.profileUrl
      || row.name
      || row.status
      || row.action
      || row.notes
      || row.referenceNote
    );
}

async function parseXlsxRows(buffer: Uint8Array): Promise<FeedbackRow[]> {
  const workbook = new ExcelJS.Workbook();
  const arrayBuffer = Uint8Array.from(buffer).buffer;
  await workbook.xlsx.load(arrayBuffer);
  const sheet = workbook.worksheets[0];
  if (!sheet) {
    return [];
  }

  const headerRow = (sheet.getRow(1).values as unknown[]) ?? [];
  const headerIndex = buildHeaderIndex(headerRow);
  if (findHeader(headerIndex, REQUIRED_RESUME_ID_HEADERS) === -1) {
    throw new Error("Feedback import requires a Resume ID column");
  }

  const rows: FeedbackRow[] = [];
  sheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) {
      return;
    }
    const values = (row.values as unknown[]) ?? [];
    const nextRow = toFeedbackRowFromValues(values, rowNumber, headerIndex);
    if (
      nextRow.resumeId
      || nextRow.profileUrl
      || nextRow.name
      || nextRow.status
      || nextRow.action
      || nextRow.notes
      || nextRow.referenceNote
    ) {
      rows.push(nextRow);
    }
  });

  return rows;
}

async function parseFeedbackRows(fileName: string, buffer: Uint8Array): Promise<FeedbackRow[]> {
  const normalized = fileName.trim().toLowerCase();
  if (normalized.endsWith(".xlsx")) {
    return await parseXlsxRows(buffer);
  }
  if (normalized.endsWith(".csv")) {
    return parseCsvRows(buffer);
  }
  throw new Error("Unsupported feedback file type. Expected .csv or .xlsx");
}

export class FeedbackImportService {
  async importFeedback(params: {
    run: StoredReviewPacketRun;
    fileName: string;
    buffer: Uint8Array;
    updatedBy?: string;
    callbacks: FeedbackImportCallbacks;
  }): Promise<FeedbackImportResult> {
    const rows = await parseFeedbackRows(params.fileName, params.buffer);
    const itemByResumeId = new Map(params.run.items.map((item) => [item.resumeId, item]));
    const itemByProfileIdentity = new Map(
      params.run.items
        .map((item) => {
          const key = normalizeProfileIdentityKey(item.profileUrl, item.source);
          return key ? [key, item] as const : null;
        })
        .filter((item): item is readonly [string, ReviewPacketItemSnapshot] => item !== null)
    );

    const warnings: string[] = [];
    const preparedByResumeId = new Map<string, PreparedRow>();

    let matchedRows = 0;
    let invalidRows = 0;
    let duplicateRows = 0;
    let matchedByProfileUrlCount = 0;
    let nameMismatchCount = 0;

    for (const row of rows) {
      const rowWarnings: string[] = [];
      const resumeMatch = row.resumeId ? itemByResumeId.get(row.resumeId) : undefined;
      const profileIdentityKey = normalizeProfileIdentityKey(row.profileUrl);
      const profileMatch = profileIdentityKey
        ? itemByProfileIdentity.get(profileIdentityKey)
        : undefined;

      if (resumeMatch && profileMatch && resumeMatch.resumeId !== profileMatch.resumeId) {
        invalidRows += 1;
        warnings.push(
          `Row ${row.rowNumber}: Resume ID ${row.resumeId} conflicts with Profile URL ${row.profileUrl ?? ""}.`
        );
        continue;
      }

      const matchedItem = resumeMatch ?? profileMatch;
      const matchedByProfileUrl = !resumeMatch && Boolean(profileMatch);
      if (!matchedItem) {
        invalidRows += 1;
        warnings.push(`Row ${row.rowNumber}: ${row.resumeId || row.profileUrl || "Unknown row"} does not belong to review packet ${params.run.id}.`);
        continue;
      }

      matchedRows += 1;
      if (matchedByProfileUrl) {
        matchedByProfileUrlCount += 1;
        rowWarnings.push(`Row ${row.rowNumber}: matched ${matchedItem.resumeId} by Profile URL fallback.`);
      }

      const normalizedStatus = normalizeStatus(row.status);
      if (row.status && !normalizedStatus) {
        rowWarnings.push(`Row ${row.rowNumber}: ignored unsupported status "${row.status}".`);
      }

      const normalizedAction = normalizeAction(row.action);
      if (row.action && !normalizedAction) {
        rowWarnings.push(`Row ${row.rowNumber}: ignored unsupported action "${row.action}".`);
      }

      if (row.name && matchedItem.name && normalizeFreeText(row.name) !== normalizeFreeText(matchedItem.name)) {
        nameMismatchCount += 1;
        rowWarnings.push(`Row ${row.rowNumber}: imported ${matchedItem.resumeId} despite edited Name "${row.name}".`);
      }

      const hasReviewContent = Boolean(normalizedStatus || normalizedAction || row.notes || row.referenceNote);
      const prepared: PreparedRow = {
        ...row,
        matchedItem,
        matchedByProfileUrl,
        normalizedStatus,
        normalizedAction,
        hasReviewContent,
        warnings: rowWarnings,
      };

      const existing = preparedByResumeId.get(matchedItem.resumeId);
      if (existing) {
        duplicateRows += 1;
        warnings.push(`Row ${row.rowNumber}: duplicate feedback for ${matchedItem.resumeId}; using the latest non-empty review row.`);
        if (prepared.hasReviewContent || !existing.hasReviewContent) {
          preparedByResumeId.set(matchedItem.resumeId, prepared);
        }
      } else {
        preparedByResumeId.set(matchedItem.resumeId, prepared);
      }
    }

    let reviewedCount = 0;
    let statusUpdates = 0;
    let actionUpdates = 0;
    let noteUpdates = 0;
    const reviewedResumeIds = new Set(params.run.stats?.import?.reviewedResumeIds ?? []);

    for (const prepared of preparedByResumeId.values()) {
      warnings.push(...prepared.warnings);
      if (!prepared.hasReviewContent) {
        continue;
      }

      reviewedCount += 1;
      reviewedResumeIds.add(prepared.matchedItem.resumeId);

      if (prepared.normalizedStatus) {
        await params.callbacks.upsertCandidateStatus({
          identityKey: prepared.matchedItem.identityKey,
          status: prepared.normalizedStatus,
          notes: prepared.notes,
          updatedBy: params.updatedBy,
        });
        statusUpdates += 1;
      }

      if (prepared.normalizedAction) {
        await params.callbacks.saveAction({
          resumeId: prepared.matchedItem.resumeId,
          actionType: prepared.normalizedAction,
          actionData: {
            importedBy: params.updatedBy,
            reviewPacketRunId: params.run.id,
            notes: prepared.notes,
            referenceNote: prepared.referenceNote,
            matchedBy: prepared.matchedByProfileUrl ? "profile_url_fallback" : "resume_id",
          },
        });
        actionUpdates += 1;
      } else if (prepared.notes || prepared.referenceNote) {
        await params.callbacks.saveAction({
          resumeId: prepared.matchedItem.resumeId,
          actionType: "note",
          actionData: {
            importedBy: params.updatedBy,
            reviewPacketRunId: params.run.id,
            notes: prepared.notes,
            referenceNote: prepared.referenceNote,
            matchedBy: prepared.matchedByProfileUrl ? "profile_url_fallback" : "resume_id",
          },
        });
        noteUpdates += 1;
      }
    }

    const importedRows = reviewedCount;
    const warningCount = warnings.length;
    const importedAt = new Date().toISOString();
    const stats: ReviewPacketImportStats = {
      importedAt,
      fileName: params.fileName,
      totalRows: rows.length,
      matchedRows,
      importedRows,
      reviewedCount: reviewedResumeIds.size,
      statusUpdates,
      actionUpdates,
      noteUpdates,
      invalidRows,
      duplicateRows,
      warningCount,
      matchedByProfileUrlCount,
      nameMismatchCount,
      reviewedResumeIds: Array.from(reviewedResumeIds).sort(),
      warnings,
    };

    return {
      summary: {
        fileName: params.fileName,
        totalRows: rows.length,
        matchedRows,
        importedRows,
        reviewedCount,
        statusUpdates,
        actionUpdates,
        noteUpdates,
        invalidRows,
        duplicateRows,
        warningCount,
        matchedByProfileUrlCount,
        nameMismatchCount,
      },
      warnings,
      stats,
    };
  }
}
