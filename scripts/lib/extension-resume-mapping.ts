export interface ExtensionWorkHistoryEntry {
  raw?: string;
  companyName?: string;
  jobTitle?: string;
  description?: string;
  durationLabel?: string;
  startDate?: string;
  endDate?: string;
  [key: string]: unknown;
}

export interface ExtensionResumeRow {
  profileId?: string;
  seekProfileGuid?: string;
  profileUrl?: string;
  name?: string;
  location?: string | { name?: string; [key: string]: unknown };
  education?: string | { level?: string; name?: string; [key: string]: unknown };
  age?: string | number;
  expectedSalary?: string | number;
  experience?: string;
  jobIntention?: string;
  language?: string;
  activityStatus?: string;
  extractedAt?: string | number;
  pageIndex?: number;
  pageNumber?: number;
  profileType?: string;
  searchProfileId?: string;
  externalId?: string;
  source?: string;
  workHistory?: ExtensionWorkHistoryEntry[] | string;
  selfIntro?: string;
  [key: string]: unknown;
}

export interface ExtensionJsonArtifact {
  metadata?: {
    sourceKey?: string;
    source?: string;
    searchProfileId?: string;
    keyword?: string;
    [key: string]: unknown;
  };
  resumes?: ExtensionResumeRow[];
  [key: string]: unknown;
}

export interface SubmitResumeDocument {
  externalId: string;
  content: Record<string, unknown>;
  hash: string;
  source: string;
  tags: string[];
}

export function extractLocationString(location: unknown): string {
  if (typeof location === "string") {
    return location.trim();
  }
  if (location && typeof location === "object") {
    const locObj = location as Record<string, unknown>;
    if (typeof locObj.name === "string") {
      return locObj.name.trim();
    }
  }
  return "";
}

export function extractEducationString(education: unknown): string {
  if (typeof education === "string") {
    return education.trim();
  }
  if (education && typeof education === "object") {
    const eduObj = education as Record<string, unknown>;
    if (typeof eduObj.level === "string" && eduObj.level.trim()) {
      return eduObj.level.trim();
    }
    if (typeof eduObj.name === "string" && eduObj.name.trim()) {
      return eduObj.name.trim();
    }
  }
  return "";
}

export function resolveRowExternalId(row: ExtensionResumeRow): string {
  const explicit = row.externalId ? String(row.externalId).trim() : "";
  if (explicit) return explicit;

  const profileId = row.profileId ? String(row.profileId).trim() : "";
  if (profileId) return profileId;

  const guid = row.seekProfileGuid ? String(row.seekProfileGuid).trim() : "";
  if (guid) return guid;

  return "";
}

/**
 * Convex submitResumes mutation accepts jsonRecordValidator (v.record(v.string(), jsonL8))
 * for `content`. Downstream pipeline (search_text.ts, resumes_list_projections.ts,
 * work-history-evidence.ts) expects workHistory as an array of NormalizedWorkHistoryEntry
 * objects with fields: { raw, companyName, jobTitle, description, durationLabel, ... }.
 * If workHistory is already an array of entry objects, we clean each entry and pass it
 * through verbatim. If workHistory is a string or non-array, we preserve it as is.
 */
export function normalizeExtensionWorkHistory(
  workHistory: unknown,
): unknown {
  if (Array.isArray(workHistory)) {
    return workHistory
      .filter((entry): entry is Record<string, unknown> => typeof entry === "object" && entry !== null)
      .map((entry) => {
        const item: Record<string, unknown> = {};
        if (typeof entry.raw === "string") item.raw = entry.raw;
        if (typeof entry.companyName === "string") item.companyName = entry.companyName;
        if (typeof entry.jobTitle === "string") item.jobTitle = entry.jobTitle;
        if (typeof entry.description === "string") item.description = entry.description;
        if (typeof entry.durationLabel === "string") item.durationLabel = entry.durationLabel;
        if (typeof entry.startDate === "string") item.startDate = entry.startDate;
        if (typeof entry.endDate === "string") item.endDate = entry.endDate;

        // Retain any other clean string/number fields from the raw collector
        for (const [k, v] of Object.entries(entry)) {
          if (!(k in item) && (typeof v === "string" || typeof v === "number" || typeof v === "boolean")) {
            item[k] = v;
          }
        }
        return item;
      });
  }
  return workHistory;
}
