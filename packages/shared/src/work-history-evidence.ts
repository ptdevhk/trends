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
  const lines = toRawEntries(input)
    .map((entry) => buildWorkHistoryEntryText(entry))
    .filter((line) => line.length > 0);

  return {
    lines,
    text: lines.join("\n").toLowerCase(),
  };
}
