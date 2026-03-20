function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

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

export const LATEST_WORK_HISTORY_LIMIT = 3;

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
  const jobTitle = toOptionalString(entry.jobTitle);
  const description = toOptionalString(entry.description);
  const startDate = toOptionalString(entry.startDate);
  const endDate = toOptionalString(entry.endDate);

  if (!raw && !companyName && !jobTitle && !description && !startDate && !endDate) {
    return null;
  }

  return {
    raw,
    companyName,
    jobTitle,
    description,
    startDate,
    endDate,
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
