import {
  formatLocationHierarchyLabel,
  normalizeLocationHierarchy as normalizeLocationTreeHierarchy,
  type LocationHierarchy,
} from "./location-tree.js";

export type ResumeWorkHistoryItem = {
  raw: string;
  companyName?: string;
  jobTitle?: string;
  description?: string;
  startDate?: string;
  endDate?: string;
};

export type ResumeProfileEducationItem = {
  institution?: string;
  qualification?: string;
  fieldOfStudy?: string;
  description?: string;
  startDate?: string;
  endDate?: string;
};

export type ResumeSkillDetail = {
  name: string;
  level?: string;
  yearsOfExperience?: number | string;
};

export type ResumeLanguageDetail = {
  name: string;
  proficiency?: string;
};

export type ResumeLicenceDetail = {
  name: string;
  authority?: string;
  issuedAt?: string;
  expiresAt?: string;
};

export type ResumeSnippet = {
  text: string;
};

export type ResumeIndustry = {
  name: string;
  code?: string;
};

export type ResumeRightToWork = {
  status: string;
  details?: string;
};

export type ResumeDigitalIdentity = {
  linkedinUrl?: string;
  seekProfileUrl?: string;
  portfolioUrl?: string;
  websiteUrl?: string;
};

export type NormalizedResumeFields = {
  profileUrl: string;
  location?: string;
  locationHierarchy?: LocationHierarchy;
  workHistory: ResumeWorkHistoryItem[];
  profileEducation?: ResumeProfileEducationItem[];
  skills?: Array<string | ResumeSkillDetail>;
  languages?: Array<string | ResumeLanguageDetail>;
  licences?: Array<string | ResumeLicenceDetail>;
  resumeSnippet?: string | ResumeSnippet;
  currentIndustry?: string | ResumeIndustry;
  currentSubindustry?: string | ResumeIndustry;
  rightToWork?: string | boolean | ResumeRightToWork;
  digitalIdentity?: string | ResumeDigitalIdentity;
  noticePeriodDays?: number;
};

const JOB5156_HOST = "hr.job5156.com";
const JOB5156_PROFILE_URL_PREFIX = `https://${JOB5156_HOST}/resume/view/`;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function toTrimmedString(value: unknown): string {
  if (typeof value === "string") return value.trim();
  if (value === null || value === undefined) return "";
  return String(value).trim();
}

function decodeURIComponentSafe(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function extractJob5156ResumeId(pathname: string): string | null {
  const oldRouteMatch = pathname.match(/^\/api\/com\/resume\/([^/?#]+)/i);
  if (oldRouteMatch && oldRouteMatch[1]) {
    return decodeURIComponentSafe(oldRouteMatch[1]);
  }

  const viewRouteMatch = pathname.match(/^\/resume\/view\/([^/?#]+)/i);
  if (viewRouteMatch && viewRouteMatch[1]) {
    return decodeURIComponentSafe(viewRouteMatch[1]);
  }

  return null;
}

export function normalizeJob5156ProfileUrlForDisplay(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    return "";
  }

  const directResumeId = extractJob5156ResumeId(trimmed);
  if (directResumeId) {
    return `${JOB5156_PROFILE_URL_PREFIX}${encodeURIComponent(directResumeId)}`;
  }

  let parsed: URL | null = null;
  try {
    parsed = new URL(trimmed);
  } catch {
    try {
      parsed = new URL(`https://${trimmed}`);
    } catch {
      parsed = null;
    }
  }

  if (!parsed || parsed.hostname.toLowerCase() !== JOB5156_HOST) {
    return trimmed;
  }

  const resumeId = extractJob5156ResumeId(parsed.pathname);
  if (!resumeId) {
    return trimmed;
  }

  return `${JOB5156_PROFILE_URL_PREFIX}${encodeURIComponent(resumeId)}`;
}

export function normalizeProfileUrlForDisplay(value: unknown, source?: string): string {
  const trimmed = toTrimmedString(value);
  if (!trimmed) {
    return "";
  }

  if (source?.toLowerCase() !== JOB5156_HOST) {
    return trimmed;
  }

  return normalizeJob5156ProfileUrlForDisplay(trimmed);
}

function normalizeStringOrObject<T>(
  value: unknown,
  map: (record: Record<string, unknown>) => T | null,
): string | T | undefined {
  if (typeof value === "string") {
    const normalized = value.trim();
    return normalized || undefined;
  }
  if (!isRecord(value)) {
    return undefined;
  }
  return map(value) ?? undefined;
}

function normalizeStringOrObjectArray<T>(
  value: unknown,
  map: (record: Record<string, unknown>) => T | null,
): Array<string | T> | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }

  const normalized = value
    .map((entry) => normalizeStringOrObject(entry, map))
    .filter((entry): entry is string | T => entry !== undefined);

  return normalized.length > 0 ? normalized : undefined;
}

function normalizeWorkHistory(value: unknown): ResumeWorkHistoryItem[] {
  if (typeof value === "string") {
    const raw = value.trim();
    return raw ? [{ raw }] : [];
  }
  if (!Array.isArray(value)) return [];

  const normalized: ResumeWorkHistoryItem[] = [];
  for (const entry of value) {
    if (typeof entry === "string") {
      const raw = entry.trim();
      if (raw) {
        normalized.push({ raw });
      }
      continue;
    }
    if (!isRecord(entry)) {
      continue;
    }

    const raw = toTrimmedString(entry.raw);
    const companyName = toTrimmedString(entry.companyName);
    const jobTitle = toTrimmedString(entry.jobTitle);
    const description = toTrimmedString(entry.description);
    const startDate = toTrimmedString(entry.startDate);
    const endDate = toTrimmedString(entry.endDate);

    if (!raw && !companyName && !jobTitle && !description) {
      continue;
    }

    normalized.push({
      raw,
      companyName: companyName || undefined,
      jobTitle: jobTitle || undefined,
      description: description || undefined,
      startDate: startDate || undefined,
      endDate: endDate || undefined,
    });
  }

  return normalized;
}

type RankedLocationHierarchy = {
  hierarchy: LocationHierarchy;
  priority: number;
};

function hierarchySignature(value: LocationHierarchy): string {
  return [value.country, value.province ?? "", value.city ?? ""].join("|");
}

function hierarchySpecificity(value: LocationHierarchy): number {
  return [value.province, value.city].filter((part) => Boolean(part)).length;
}

function areHierarchiesCompatible(left: LocationHierarchy, right: LocationHierarchy): boolean {
  if (left.country !== right.country) {
    return false;
  }

  if (left.province && right.province && left.province !== right.province) {
    return false;
  }

  if (left.city && right.city && left.city !== right.city) {
    return false;
  }

  return true;
}

function chooseBestLocationHierarchy(candidates: RankedLocationHierarchy[]): LocationHierarchy | undefined {
  if (candidates.length === 0) {
    return undefined;
  }

  const deduped = new Map<string, RankedLocationHierarchy>();
  for (const candidate of candidates) {
    const key = hierarchySignature(candidate.hierarchy);
    const existing = deduped.get(key);
    if (!existing || candidate.priority > existing.priority) {
      deduped.set(key, candidate);
    }
  }

  const uniqueCandidates = Array.from(deduped.values());
  for (let leftIndex = 0; leftIndex < uniqueCandidates.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < uniqueCandidates.length; rightIndex += 1) {
      if (!areHierarchiesCompatible(uniqueCandidates[leftIndex].hierarchy, uniqueCandidates[rightIndex].hierarchy)) {
        return undefined;
      }
    }
  }

  uniqueCandidates.sort((left, right) => {
    const specificityDiff = hierarchySpecificity(right.hierarchy) - hierarchySpecificity(left.hierarchy);
    if (specificityDiff !== 0) {
      return specificityDiff;
    }

    if (right.priority !== left.priority) {
      return right.priority - left.priority;
    }

    return hierarchySignature(left.hierarchy).localeCompare(hierarchySignature(right.hierarchy));
  });

  return uniqueCandidates[0]?.hierarchy;
}

function toLocationHierarchyCandidate(
  value: unknown,
  matchedFrom: LocationHierarchy["matchedFrom"],
  priority: number
): RankedLocationHierarchy | undefined {
  const hierarchy = normalizeLocationTreeHierarchy(value);
  if (!hierarchy) {
    return undefined;
  }

  const nextHierarchy: LocationHierarchy = {
    ...hierarchy,
    matchedFrom,
    confidence: "high",
  };

  return {
    hierarchy: nextHierarchy,
    priority,
  };
}

function collectLocationHierarchyCandidates(record: Record<string, unknown>): RankedLocationHierarchy[] {
  const candidates: RankedLocationHierarchy[] = [];
  const pushCandidate = (
    value: unknown,
    matchedFrom: LocationHierarchy["matchedFrom"],
    priority: number
  ) => {
    const candidate = toLocationHierarchyCandidate(value, matchedFrom, priority);
    if (candidate) {
      candidates.push(candidate);
    }
  };

  pushCandidate(record.location, "location", 100);

  if (Array.isArray(record.workHistory)) {
    for (const entry of record.workHistory) {
      if (!isRecord(entry)) {
        if (typeof entry === "string") {
          pushCandidate(entry, "workHistory", 80);
        }
        continue;
      }

      pushCandidate(entry.raw, "workHistory", 80);
      pushCandidate(entry.companyName, "workHistory", 80);
      pushCandidate(entry.description, "workHistory", 80);
    }
  }

  pushCandidate(record.jobIntention, "jobIntention", 60);

  return candidates;
}

export function normalizeResumeLocationHierarchy(record: Record<string, unknown>): LocationHierarchy | undefined {
  const explicitHierarchy = normalizeLocationTreeHierarchy(record.locationHierarchy);
  if (explicitHierarchy) {
    return explicitHierarchy;
  }

  return chooseBestLocationHierarchy(collectLocationHierarchyCandidates(record));
}

function normalizeProfileEducation(value: unknown): ResumeProfileEducationItem[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }

  const normalized: ResumeProfileEducationItem[] = [];
  for (const entry of value) {
    if (!isRecord(entry)) {
      continue;
    }

    const institution = toTrimmedString(entry.institution);
    const qualification = toTrimmedString(entry.qualification);
    const fieldOfStudy = toTrimmedString(entry.fieldOfStudy);
    const description = toTrimmedString(entry.description);
    const startDate = toTrimmedString(entry.startDate);
    const endDate = toTrimmedString(entry.endDate);

    if (!institution && !qualification && !fieldOfStudy && !description) {
      continue;
    }

    normalized.push({
      institution: institution || undefined,
      qualification: qualification || undefined,
      fieldOfStudy: fieldOfStudy || undefined,
      description: description || undefined,
      startDate: startDate || undefined,
      endDate: endDate || undefined,
    });
  }

  return normalized.length > 0 ? normalized : undefined;
}

function normalizeSkillDetail(record: Record<string, unknown>): ResumeSkillDetail | null {
  const name = toTrimmedString(record.name);
  const level = toTrimmedString(record.level);
  const yearsOfExperience = typeof record.yearsOfExperience === "number" || typeof record.yearsOfExperience === "string"
    ? record.yearsOfExperience
    : undefined;

  if (!name) {
    return null;
  }

  return {
    name,
    level: level || undefined,
    yearsOfExperience,
  };
}

function normalizeLanguageDetail(record: Record<string, unknown>): ResumeLanguageDetail | null {
  const name = toTrimmedString(record.name);
  const proficiency = toTrimmedString(record.proficiency);
  if (!name) {
    return null;
  }
  return {
    name,
    proficiency: proficiency || undefined,
  };
}

function normalizeLicenceDetail(record: Record<string, unknown>): ResumeLicenceDetail | null {
  const name = toTrimmedString(record.name);
  const authority = toTrimmedString(record.authority);
  const issuedAt = toTrimmedString(record.issuedAt);
  const expiresAt = toTrimmedString(record.expiresAt);
  if (!name) {
    return null;
  }
  return {
    name,
    authority: authority || undefined,
    issuedAt: issuedAt || undefined,
    expiresAt: expiresAt || undefined,
  };
}

function normalizeSnippet(record: Record<string, unknown>): ResumeSnippet | null {
  const text = toTrimmedString(record.text);
  if (!text) {
    return null;
  }
  return { text };
}

function normalizeIndustry(record: Record<string, unknown>): ResumeIndustry | null {
  const name = toTrimmedString(record.name);
  const code = toTrimmedString(record.code);
  if (!name) {
    return null;
  }
  return {
    name,
    code: code || undefined,
  };
}

function normalizeRightToWork(value: unknown): string | boolean | ResumeRightToWork | undefined {
  if (typeof value === "boolean") {
    return value;
  }
  return normalizeStringOrObject(value, (record) => {
    const status = toTrimmedString(record.status);
    const details = toTrimmedString(record.details);
    if (!status) {
      return null;
    }
    return {
      status,
      details: details || undefined,
    };
  });
}

function normalizeDigitalIdentity(record: Record<string, unknown>): ResumeDigitalIdentity | null {
  const linkedinUrl = toTrimmedString(record.linkedinUrl);
  const seekProfileUrl = toTrimmedString(record.seekProfileUrl);
  const portfolioUrl = toTrimmedString(record.portfolioUrl);
  const websiteUrl = toTrimmedString(record.websiteUrl);

  if (!linkedinUrl && !seekProfileUrl && !portfolioUrl && !websiteUrl) {
    return null;
  }

  return {
    linkedinUrl: linkedinUrl || undefined,
    seekProfileUrl: seekProfileUrl || undefined,
    portfolioUrl: portfolioUrl || undefined,
    websiteUrl: websiteUrl || undefined,
  };
}

function normalizeOptionalNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) {
      return undefined;
    }
    const parsed = Number(trimmed);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return undefined;
}

export function normalizeSharedResumeFields(record: Record<string, unknown>, source?: string): NormalizedResumeFields {
  const locationHierarchy = normalizeResumeLocationHierarchy(record);
  const location = toTrimmedString(record.location) || formatLocationHierarchyLabel(locationHierarchy);

  return {
    profileUrl: normalizeProfileUrlForDisplay(record.profileUrl, source),
    ...(location ? { location } : {}),
    ...(locationHierarchy ? { locationHierarchy } : {}),
    workHistory: normalizeWorkHistory(record.workHistory),
    profileEducation: normalizeProfileEducation(record.profileEducation),
    skills: normalizeStringOrObjectArray(record.skills, normalizeSkillDetail),
    languages: normalizeStringOrObjectArray(record.languages, normalizeLanguageDetail),
    licences: normalizeStringOrObjectArray(record.licences, normalizeLicenceDetail),
    resumeSnippet: normalizeStringOrObject(record.resumeSnippet, normalizeSnippet),
    currentIndustry: normalizeStringOrObject(record.currentIndustry, normalizeIndustry),
    currentSubindustry: normalizeStringOrObject(record.currentSubindustry, normalizeIndustry),
    rightToWork: normalizeRightToWork(record.rightToWork),
    digitalIdentity: normalizeStringOrObject(record.digitalIdentity, normalizeDigitalIdentity),
    noticePeriodDays: normalizeOptionalNumber(record.noticePeriodDays),
  };
}
