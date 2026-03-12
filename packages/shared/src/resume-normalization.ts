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
  return {
    profileUrl: normalizeProfileUrlForDisplay(record.profileUrl, source),
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
