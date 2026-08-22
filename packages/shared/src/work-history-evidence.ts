import { isRecord } from "./resume-normalization.js";

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

const RAW_ENGLISH_WORK_HISTORY_DATE_RANGE_PATTERN =
  /((?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+\d{4}\s*[-–—]\s*(?:Present|Current|Now|(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+\d{4})(?:\s*[（(][^)）]+[)）])?)/iu;

const RAW_NUMERIC_WORK_HISTORY_DATE_RANGE_PATTERN =
  /(((?:19|20)\d{2}(?:[-./年]\d{1,2}(?:月)?)?\s*(?:~|至|到|-|–|—)\s*(?:(?:至今|目前|今|present|current|now|ongoing)|(?:19|20)\d{2}(?:[-./年]\d{1,2}(?:月)?)?))(?:\s*[（(][^)）]+[)）])?)/iu;

const RAW_WORK_HISTORY_DURATION_PATTERN = /[（(]([^)）]+)[)）]/u;

function toOptionalString(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const normalized = normalizeWhitespace(value);
  return normalized || undefined;
}

export type NormalizedWorkHistoryEntry = {
  raw: string;
  companyName?: string;
  companyKey?: string;
  jobTitle?: string;
  description?: string;
  startDate?: string;
  endDate?: string;
};

export type WorkHistoryEvidence = {
  lines: string[];
  text: string;
};

export type WorkHistorySelectionOptions = {
  limit?: number;
};

export const DEFAULT_RESUME_WORK_HISTORY_LIMIT = 3;
export const MIN_RESUME_WORK_HISTORY_LIMIT = 1;
export const MAX_RESUME_WORK_HISTORY_LIMIT = 10;
export const LATEST_WORK_HISTORY_LIMIT = DEFAULT_RESUME_WORK_HISTORY_LIMIT;

export function normalizeResumeWorkHistoryLimit(value: unknown): number {
  return typeof value === "number"
    && Number.isInteger(value)
    && value >= MIN_RESUME_WORK_HISTORY_LIMIT
    && value <= MAX_RESUME_WORK_HISTORY_LIMIT
    ? value
    : DEFAULT_RESUME_WORK_HISTORY_LIMIT;
}

function toRawEntries(input: unknown): unknown[] {
  if (Array.isArray(input)) {
    return input;
  }

  if (isRecord(input) && Array.isArray(input.workHistory)) {
    return input.workHistory;
  }

  return [];
}

export function normalizeWorkHistoryEntry(entry: unknown): NormalizedWorkHistoryEntry | null {
  if (typeof entry === "string") {
    const raw = normalizeWhitespace(entry);
    return raw ? { raw } : null;
  }

  if (!isRecord(entry)) {
    return null;
  }

  const raw = toOptionalString(entry.raw) ?? "";
  const companyName = toOptionalString(entry.companyName);
  const companyKey = toOptionalString(entry.companyKey);
  const jobTitle = toOptionalString(entry.jobTitle);
  const description = toOptionalString(entry.description);
  const startDate = toOptionalString(entry.startDate);
  const endDate = toOptionalString(entry.endDate);

  if (!raw && !companyName && !companyKey && !jobTitle && !description && !startDate && !endDate) {
    return null;
  }

  return {
    raw,
    ...(companyName ? { companyName } : {}),
    ...(companyKey ? { companyKey } : {}),
    ...(jobTitle ? { jobTitle } : {}),
    ...(description ? { description } : {}),
    ...(startDate ? { startDate } : {}),
    ...(endDate ? { endDate } : {}),
  };
}

export function getNormalizedWorkHistoryEntries(input: unknown): NormalizedWorkHistoryEntry[] {
  return toRawEntries(input)
    .map((entry) => normalizeWorkHistoryEntry(entry))
    .filter((entry): entry is NormalizedWorkHistoryEntry => entry !== null);
}

type WorkHistoryRecency = {
  primaryDateValue: number | null;
  startDateValue: number | null;
};

const CURRENT_WORK_HISTORY_MARKER = /^(?:至今|目前|今|present|current|now|ongoing)$/iu;

function parseWorkHistoryDateValue(value: string | undefined): number | null {
  const normalized = toOptionalString(value);
  if (!normalized) {
    return null;
  }

  if (CURRENT_WORK_HISTORY_MARKER.test(normalized)) {
    return Number.MAX_SAFE_INTEGER;
  }

  const match = normalized.match(/^((?:19|20)\d{2})(?:[-./年](\d{1,2}))?/u);
  if (!match) {
    return null;
  }

  const year = Number(match[1]);
  const month = Number(match[2] || 12);
  if (!Number.isFinite(year) || !Number.isFinite(month) || month < 1 || month > 12) {
    return null;
  }

  return year * 12 + month;
}

function getWorkHistoryRecency(entry: NormalizedWorkHistoryEntry): WorkHistoryRecency {
  const endDateValue = parseWorkHistoryDateValue(entry.endDate);
  const startDateValue = parseWorkHistoryDateValue(entry.startDate);

  return {
    primaryDateValue: endDateValue ?? startDateValue,
    startDateValue,
  };
}

function compareWorkHistoryRecency(left: WorkHistoryRecency, right: WorkHistoryRecency): number {
  if (
    left.primaryDateValue !== null
    && right.primaryDateValue !== null
    && left.primaryDateValue !== right.primaryDateValue
  ) {
    return right.primaryDateValue - left.primaryDateValue;
  }

  if (
    left.startDateValue !== null
    && right.startDateValue !== null
    && left.startDateValue !== right.startDateValue
  ) {
    return right.startDateValue - left.startDateValue;
  }

  if (left.primaryDateValue !== null && right.primaryDateValue === null) {
    return -1;
  }

  if (left.primaryDateValue === null && right.primaryDateValue !== null) {
    return 1;
  }

  return 0;
}

export function selectLatestWorkHistory(
  input: unknown,
  options?: WorkHistorySelectionOptions,
): NormalizedWorkHistoryEntry[] {
  const limit = Math.max(0, Math.floor(options?.limit ?? LATEST_WORK_HISTORY_LIMIT));
  if (limit === 0) {
    return [];
  }

  return getNormalizedWorkHistoryEntries(input)
    .map((entry, index) => ({
      entry,
      index,
      recency: getWorkHistoryRecency(entry),
    }))
    .sort((left, right) => {
      const recencyComparison = compareWorkHistoryRecency(left.recency, right.recency);
      if (recencyComparison !== 0) {
        return recencyComparison;
      }
      return left.index - right.index;
    })
    .slice(0, limit)
    .map(({ entry }) => entry);
}

export function buildWorkHistoryDateRange(startDate: unknown, endDate: unknown): string {
  const normalizedStartDate = toOptionalString(startDate);
  const normalizedEndDate = toOptionalString(endDate);

  if (normalizedStartDate && normalizedEndDate) {
    return `${normalizedStartDate} ~ ${normalizedEndDate}`;
  }
  return normalizedStartDate || normalizedEndDate || "";
}

export function extractWorkHistoryDurationFromRaw(raw: unknown): string {
  const normalizedRaw = toOptionalString(raw);
  if (!normalizedRaw) {
    return "";
  }

  return normalizedRaw.match(RAW_WORK_HISTORY_DURATION_PATTERN)?.[1]?.trim() || "";
}

export function extractWorkHistoryDateLineFromRaw(raw: unknown): string {
  const normalizedRaw = toOptionalString(raw);
  if (!normalizedRaw) {
    return "";
  }

  for (const pattern of [
    RAW_ENGLISH_WORK_HISTORY_DATE_RANGE_PATTERN,
    RAW_NUMERIC_WORK_HISTORY_DATE_RANGE_PATTERN,
  ]) {
    const match = normalizedRaw.match(pattern)?.[1]?.trim();
    if (match) {
      return normalizeWhitespace(match);
    }
  }

  const duration = extractWorkHistoryDurationFromRaw(normalizedRaw);
  return duration ? `(${duration})` : "";
}

export function buildWorkHistoryDisplayDateLine(entry: unknown): string {
  const normalized = normalizeWorkHistoryEntry(entry);
  if (!normalized) {
    return "";
  }

  const structuredDateRange = buildWorkHistoryDateRange(
    normalized.startDate,
    normalized.endDate,
  );
  if (structuredDateRange) {
    const duration = extractWorkHistoryDurationFromRaw(normalized.raw);
    return duration
      ? `${structuredDateRange} (${duration})`
      : structuredDateRange;
  }

  return extractWorkHistoryDateLineFromRaw(normalized.raw);
}

export function buildWorkHistoryDisplayText(entry: unknown): string {
  const normalized = normalizeWorkHistoryEntry(entry);
  if (!normalized) {
    return "";
  }

  const structured = normalizeWhitespace(
    [
      buildWorkHistoryDisplayDateLine(normalized),
      normalized.companyName,
      normalized.jobTitle,
      normalized.description,
    ]
      .filter((part): part is string => typeof part === "string" && part.length > 0)
      .join(" "),
  );

  return structured || normalized.raw;
}

export function buildWorkHistoryEntryText(entry: unknown): string {
  const normalized = normalizeWorkHistoryEntry(entry);
  if (!normalized) {
    return "";
  }

  const structured = normalizeWhitespace(
    [
      buildWorkHistoryDateRange(normalized.startDate, normalized.endDate),
      normalized.companyName,
      normalized.jobTitle,
      normalized.description,
    ]
      .filter((part): part is string => typeof part === "string" && part.length > 0)
      .join(" ")
  );

  return structured || normalized.raw;
}

export function buildWorkHistoryEvidence(input: unknown): WorkHistoryEvidence {
  const lines = getNormalizedWorkHistoryEntries(input)
    .map((entry) => buildWorkHistoryEntryText(entry))
    .filter((line) => line.length > 0);

  return {
    lines,
    text: lines.join("\n").toLowerCase(),
  };
}

export function buildLatestWorkHistoryEvidence(
  input: unknown,
  options?: WorkHistorySelectionOptions,
): WorkHistoryEvidence {
  const lines = selectLatestWorkHistory(input, options)
    .map((entry) => buildWorkHistoryEntryText(entry))
    .filter((line) => line.length > 0);

  return {
    lines,
    text: lines.join("\n").toLowerCase(),
  };
}
