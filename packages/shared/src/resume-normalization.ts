import {
  formatLocationHierarchyLabel,
  normalizeLocationHierarchy as normalizeLocationTreeHierarchy,
  type LocationHierarchy,
} from "./location-tree.js";
import { normalizeResumeAnalysisSourceKey, type ResumeAnalysisSourceKey } from "./analysis-key.js";

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
  source?: string;
  profileUrl: string;
  location?: string;
  locationHierarchy?: LocationHierarchy;
  workHistory: ResumeWorkHistoryItem[];
  projectExperience?: ResumeWorkHistoryItem[];
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
const SEEK_HOST_SUFFIX = ".employer.seek.com";

const SOURCE_KEY_TO_COUNTRY: Record<ResumeAnalysisSourceKey, string> = {
  job5156: "中国",
  "51job": "中国",
  seek: "Malaysia",
};

function inferCountryFromSource(source: unknown): string | undefined {
  const key = normalizeResumeAnalysisSourceKey(toTrimmedString(source) || undefined);
  return key ? SOURCE_KEY_TO_COUNTRY[key] : undefined;
}

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

export function normalizeSeekProfileUrlForDisplay(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    return "";
  }

  let parsed: URL | null = null;
  try {
    parsed = new URL(trimmed);
  } catch {
    return trimmed;
  }

  const hostname = parsed.hostname.toLowerCase();
  if (!hostname.endsWith(SEEK_HOST_SUFFIX)) {
    return trimmed;
  }

  // Already in recommended format — return as-is
  if (parsed.pathname.toLowerCase() === "/candidates/recommended") {
    return trimmed;
  }

  // Extract profileId from URL — supports both numeric and UUID formats
  let profileId: string | null = null;

  // Numeric pattern: /candidates/{profileId} or /candidates/profiles/{profileId}/...
  const numericIdMatch = parsed.pathname.match(/\/candidates\/(?:profiles\/)?(\d+)(?:\/|$)/i);
  if (numericIdMatch?.[1]) {
    profileId = numericIdMatch[1];
  }

  // UUID pattern: /candidates/{uuid} (talentsearch mode — no jobId available)
  if (!profileId) {
    const uuidMatch = parsed.pathname.match(/\/candidates\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(?:\/|$)/i);
    if (uuidMatch?.[1]) {
      // Talentsearch UUID URLs pass through — cannot build recommended URL without numeric profileId
      return trimmed;
    }
  }

  if (!profileId) {
    return trimmed;
  }

  // Fallback: direct path format (no jobId available at display time)
  return `https://${hostname}/candidates/${profileId}`;
}

export function normalizeProfileUrlForDisplay(value: unknown, source?: string): string {
  const trimmed = toTrimmedString(value);
  if (!trimmed) {
    return "";
  }

  const loweredSource = source?.toLowerCase();

  if (loweredSource === JOB5156_HOST) {
    return normalizeJob5156ProfileUrlForDisplay(trimmed);
  }

  if (loweredSource?.endsWith(SEEK_HOST_SUFFIX)) {
    return normalizeSeekProfileUrlForDisplay(trimmed);
  }

  // Also handle seek URLs regardless of source (safety net for mixed data)
  try {
    const parsed = new URL(trimmed);
    if (parsed.hostname.toLowerCase().endsWith(SEEK_HOST_SUFFIX)) {
      return normalizeSeekProfileUrlForDisplay(trimmed);
    }
  } catch {
    // Not a valid URL — pass through
  }

  return trimmed;
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
  return [value.country, value.province ?? "", value.city ?? "", value.district ?? ""].join("|");
}

function hierarchySpecificity(value: LocationHierarchy): number {
  return [value.province, value.city, value.district].filter((part) => Boolean(part)).length;
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

  if (left.district && right.district && left.district !== right.district) {
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

  // Resumes with unparseable location text still have a known source host that
  // implies country; this fallback prevents them from being invisible to location filters.
  if (candidates.length === 0) {
    const sourceCountry = inferCountryFromSource(record.source ?? record.sourceHost);
    if (sourceCountry) {
      candidates.push({
        hierarchy: { country: sourceCountry, matchedFrom: "source", confidence: "low" },
        priority: 10,
      });
    }
  }

  return candidates;
}

export function normalizeResumeLocationHierarchy(record: Record<string, unknown>, source?: string): LocationHierarchy | undefined {
  const explicitHierarchy = normalizeLocationTreeHierarchy(record.locationHierarchy);
  if (explicitHierarchy) {
    return explicitHierarchy;
  }

  return chooseBestLocationHierarchy(collectLocationHierarchyCandidates({ ...record, source: source ?? record.source }));
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
    source: toTrimmedString(source) || toTrimmedString(record.source),
    profileUrl: normalizeProfileUrlForDisplay(record.profileUrl, source),
    ...(location ? { location } : {}),
    ...(locationHierarchy ? { locationHierarchy } : {}),
    workHistory: normalizeWorkHistory(record.workHistory),
    projectExperience: normalizeWorkHistory(record.projectExperience ?? record.project ?? record.projects),
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

type Manual51jobSectionKey = "workHistory" | "positionExperience" | "education" | "selfIntro";

export type Parsed51jobManualResume = {
  name?: string;
  profileId?: string;
  location?: string;
  jobIntention?: string;
  expectedSalary?: string;
  experience?: string;
  education?: string;
  selfIntro?: string;
  workHistory: ResumeWorkHistoryItem[];
  profileEducation?: ResumeProfileEducationItem[];
  resumeSnippet: ResumeSnippet;
};

export type Manual51jobOptionalField = "jobIntention" | "expectedSalary" | "experience" | "education";
type Manual51jobLabeledWorkField = "company" | "jobTitle" | "description";

const MANUAL_51JOB_NAME_LABELS = ["姓名", "名称"] as const;
const MANUAL_51JOB_PROFILE_ID_LABELS = ["人才ID", "简历编号", "ID"] as const;
const MANUAL_51JOB_LOCATION_LABELS = ["区域", "现居住地", "现居住", "所在地", "所在地区"] as const;
const MANUAL_51JOB_JOB_INTENTION_LABELS = ["应聘方向", "应聘职位", "期望职位", "意向职位"] as const;
const MANUAL_51JOB_PREFERRED_JOB_INTENTION_LABELS = ["求职意向"] as const;
const MANUAL_51JOB_SALARY_LABELS = ["期望薪资", "薪资要求", "期望工资", "期望月薪", "期望年薪"] as const;
const MANUAL_51JOB_EXPERIENCE_LABELS = ["工作经验", "工作年限", "从业年限", "经验"] as const;
const MANUAL_51JOB_EDUCATION_LABELS = ["最高学历学位", "最高学历", "学历"] as const;
const MANUAL_51JOB_WORK_DESCRIPTION_LABELS = ["工作描述", "职责描述", "工作职责", "主要职责", "工作内容", "项目描述"] as const;
const MANUAL_51JOB_WORK_CUSTOMER_LABELS = ["主要客户", "客户"] as const;
const MANUAL_51JOB_WORK_COMPANY_LABELS = ["公司", "单位", "企业", "所属公司"] as const;
const MANUAL_51JOB_WORK_JOB_TITLE_LABELS = ["职位", "岗位", "职务"] as const;
const MANUAL_51JOB_EDUCATION_INSTITUTION_LABELS = ["学校", "院校"] as const;
const MANUAL_51JOB_EDUCATION_FIELD_LABELS = ["专业", "主修", "专业名称"] as const;
const MANUAL_51JOB_EDUCATION_DESCRIPTION_LABELS = ["专业描述", "在校经历", "学习描述"] as const;
const MANUAL_51JOB_EDUCATION_QUALIFICATION_LABELS = ["学历", "学位"] as const;
const MANUAL_51JOB_SECTION_LABELS: Array<{ key: Manual51jobSectionKey; labels: readonly string[] }> = [
  { key: "workHistory", labels: ["工作经历", "工作经验"] },
  { key: "positionExperience", labels: ["岗位经验"] },
  { key: "education", labels: ["教育经历", "教育背景"] },
  { key: "selfIntro", labels: ["个人优势", "自我介绍", "自我评价", "个人简介"] },
];
const MANUAL_51JOB_SECTION_HEADER_SET = new Set(
  MANUAL_51JOB_SECTION_LABELS.flatMap((entry) => entry.labels)
);
const MANUAL_51JOB_COMPANY_PATTERN = /^([\u4e00-\u9fa5A-Za-z0-9()（）·.&\-]{2,80}(?:公司|集团|股份|有限|中心|厂|银行|医院|研究院|研究所|学院|学校|超市))/u;
const MANUAL_51JOB_INSTITUTION_PATTERN = /([\u4e00-\u9fa5A-Za-z0-9()（）·.&\-]{2,80}(?:大学|学院|学校|中学|技校|职业技术学院|技术学院|中专))/u;
const MANUAL_51JOB_QUALIFICATION_PATTERN = /(博士研究生|博士|硕士研究生|硕士|研究生|本科|大专|专科|中专|中技|高中)/u;
const MANUAL_51JOB_DATE_RANGE_PATTERN = /((?:19|20)\d{2}(?:[-./年]\d{1,2})?)(?:\s*(?:[~～\-–—]|至|到)+\s*)(至今|目前|今|(?:19|20)\d{2}(?:[-./年]\d{1,2})?)/u;
const MANUAL_51JOB_TIMELINE_START_PATTERN = /^\s*(?:19|20)\d{2}(?:[-./年]\d{1,2})?(?:\s*(?:[~～\-–—]|至|到)+\s*)(?:至今|目前|今|(?:19|20)\d{2}(?:[-./年]\d{1,2})?)/u;
const MANUAL_51JOB_INLINE_DATE_RANGE_PATTERN = /(?:19|20)\d{2}(?:[-./年]\d{1,2})?(?:\s*(?:[~～\-–—]|至|到)+\s*)(?:至今|目前|今|(?:19|20)\d{2}(?:[-./年]\d{1,2})?)/u;
const MANUAL_51JOB_WORK_HISTORY_PAGE_MARKER_PATTERN = /^--\s*\d+\s+of\s+\d+\s*--$/iu;
const MANUAL_51JOB_NAME_EXCLUSIONS = new Set([
  "活跃时间",
  "最近工作",
  "最高学历",
  "最高学历学位",
  "求职意向",
  "个人优势",
  "工作经历",
  "工作经验",
  "教育经历",
  "专业描述",
  "工作描述",
  "证书",
  "声明",
  "离职",
  "在职",
  "全职",
  "男",
  "女",
  "仅供招聘专用",
  "仅供招聘专用，企业应尽保密义务，禁止外传",
]);
const MANUAL_51JOB_EDUCATION_RANK: Record<string, number> = {
  高中: 1,
  中技: 1,
  中专: 1,
  专科: 2,
  大专: 2,
  本科: 3,
  研究生: 4,
  硕士: 4,
  硕士研究生: 4,
  博士: 5,
  博士研究生: 5,
};
const MANUAL_51JOB_TERMINAL_SECTION_HEADER_PATTERNS = [
  /^技能\s*\/\s*语言$/u,
  /^技能(?:特长)?$/u,
  /^语言(?:能力)?$/u,
  /^证书$/u,
  /^声明$/u,
] as const;
const MANUAL_51JOB_UNREADABLE_CONTROL_CHARACTER_PATTERN = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/gu;
const MANUAL_51JOB_PAGE_MARKER_ONLY_PATTERN = /^--\s*\d+\s+of\s+\d+\s*--$/iu;
const MANUAL_51JOB_TEXT_SIGNAL_PATTERNS = [
  /人才ID/u,
  /求职意向/u,
  /工作经历/u,
  /教育经历/u,
  /现居/u,
  /应聘(?:方向|职位)/u,
  /\d{4}[.-]\d{1,2}\s*[-~至]/u,
] as const;
const MANUAL_51JOB_INLINE_EXPERIENCE_PATTERN = /(\d+(?:\.\d+)?年(?:\d+个月)?(?:工作经验|经验))/u;
const MANUAL_51JOB_INLINE_SALARY_PATTERNS = [
  /(面议|\d+(?:\.\d+)?(?:千|万)(?:[-~到至]\d+(?:\.\d+)?(?:千|万))?(?:\/(?:月|年))?)/u,
  /(面议|\d+(?:\.\d+)?(?:[-~到至]\d+(?:\.\d+)?)(?:千|万)(?:\/(?:月|年))?)/u,
  /(面议|\d{3,5}(?:[-~到至]\d{3,5})?(?:元)?\/(?:月|年))/u,
] as const;
const MANUAL_51JOB_INLINE_LOCATION_EXCLUSION_PATTERN = /^(?:男|女|已婚|未婚|离异|普通公民|群众|中共.*|共青团员|党员|本科|大专|专科|高中|硕士|博士|在职.*|离职.*|随时到岗|一个月内到岗)$/u;
const MANUAL_51JOB_SUMMARY_PRIMARY_LINE_EXCLUDED_LABELS = [
  ...MANUAL_51JOB_NAME_LABELS,
  ...MANUAL_51JOB_PROFILE_ID_LABELS,
  ...MANUAL_51JOB_LOCATION_LABELS,
  ...MANUAL_51JOB_PREFERRED_JOB_INTENTION_LABELS,
  ...MANUAL_51JOB_JOB_INTENTION_LABELS,
  ...MANUAL_51JOB_SALARY_LABELS,
  ...MANUAL_51JOB_EXPERIENCE_LABELS,
  ...MANUAL_51JOB_EDUCATION_LABELS,
] as const;
const MANUAL_51JOB_LABEL_PATTERN_CACHE = new Map<string, RegExp>();

function escapeManual51jobRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function getManual51jobLabelPattern(label: string): RegExp {
  const cachedPattern = MANUAL_51JOB_LABEL_PATTERN_CACHE.get(label);
  if (cachedPattern) {
    return cachedPattern;
  }

  const pattern = new RegExp(`^${escapeManual51jobRegExp(label)}\\s*[：:]\\s*(.*)$`, "u");
  MANUAL_51JOB_LABEL_PATTERN_CACHE.set(label, pattern);
  return pattern;
}

function normalizeManual51jobText(value: string): string {
  return value
    .replace(/\r/g, "\n")
    .replace(/\u0000/g, "")
    .replace(/\u00a0/g, " ")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function stripManual51jobUnreadableControlCharacters(value: string): string {
  return value.replace(MANUAL_51JOB_UNREADABLE_CONTROL_CHARACTER_PATTERN, "");
}

export function hasReadableManual51jobText(value: string): boolean {
  const normalized = normalizeManual51jobText(stripManual51jobUnreadableControlCharacters(value));
  if (!normalized) {
    return false;
  }
  if (MANUAL_51JOB_PAGE_MARKER_ONLY_PATTERN.test(normalized)) {
    return false;
  }

  return MANUAL_51JOB_TEXT_SIGNAL_PATTERNS.some((pattern) => pattern.test(normalized));
}

export function shouldPreferManual51jobOptionalField(
  field: Manual51jobOptionalField,
  existing: unknown,
  parsedValue: unknown,
): boolean {
  const nextValue = typeof parsedValue === "string" ? parsedValue.trim() : "";
  if (!nextValue) {
    return false;
  }

  const currentValue = typeof existing === "string" ? existing.trim() : "";
  if (!currentValue) {
    return true;
  }
  if (currentValue === nextValue) {
    return false;
  }

  if (field === "expectedSalary") {
    const currentLooksSuspicious = /(销售额|业绩)/u.test(currentValue)
      || (!/(?:\/(?:月|年)|面议)/u.test(currentValue) && /万/u.test(currentValue));
    const nextLooksStructured = /(?:\/(?:月|年)|面议)/u.test(nextValue);
    if (currentLooksSuspicious && nextLooksStructured) {
      return true;
    }
  }

  if (field === "jobIntention") {
    const currentParts = currentValue.split(/\s+/u).filter(Boolean);
    const nextParts = nextValue.split(/\s+/u).filter(Boolean);
    if (currentParts.length < nextParts.length) {
      return true;
    }
  }

  if (field === "experience") {
    if (!/工作经验|经验/u.test(currentValue) && /工作经验|经验/u.test(nextValue)) {
      return true;
    }
  }

  if (field === "education") {
    const currentLooksLikeQualification = /博士|硕士|本科|大专|专科|中专|中技|高中/u.test(currentValue);
    const nextLooksLikeQualification = /博士|硕士|本科|大专|专科|中专|中技|高中/u.test(nextValue);
    if (!currentLooksLikeQualification && nextLooksLikeQualification) {
      return true;
    }
  }

  return false;
}

function normalizeManual51jobLine(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function getManual51jobLabeledLineValue(line: string, labels: readonly string[]): string | undefined {
  const normalizedLine = normalizeManual51jobLine(line);
  if (!normalizedLine) {
    return undefined;
  }

  for (const label of labels) {
    if (normalizedLine === label) {
      return "";
    }

    const match = normalizedLine.match(getManual51jobLabelPattern(label));
    if (match) {
      return match[1]?.trim() ?? "";
    }
  }

  return undefined;
}

export function splitManual51jobLines(text: string): string[] {
  if (!text) {
    return [];
  }

  return text.split("\n").map((line) => normalizeManual51jobLine(line));
}

function getManual51jobFollowingLine(
  lines: readonly string[],
  startIndex: number,
  options?: { skip?: (line: string) => boolean },
): string | undefined {
  for (let nextIndex = startIndex + 1; nextIndex < lines.length; nextIndex += 1) {
    const nextLine = lines[nextIndex] || "";
    if (!nextLine) {
      continue;
    }
    if (resolveManual51jobSectionHeader(nextLine)) {
      break;
    }
    if (options?.skip?.(nextLine)) {
      continue;
    }
    return nextLine;
  }

  return undefined;
}

function getManual51jobFieldValueFromLines(lines: readonly string[], labels: readonly string[]): string | undefined {
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] || "";
    const value = getManual51jobLabeledLineValue(line, labels);
    if (value === undefined) {
      continue;
    }
    if (value) {
      return value;
    }

    return getManual51jobFollowingLine(lines, index);
  }

  return undefined;
}

function getManual51jobSectionStartIndex(lines: readonly string[], key: Manual51jobSectionKey): number {
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] || "";
    const sectionHeader = resolveManual51jobSectionHeader(line);
    if (sectionHeader?.key === key) {
      return index;
    }
    if (key === "positionExperience" && /^岗位经验(?:\s|$)/u.test(normalizeManual51jobLine(line))) {
      return index;
    }
  }
  return -1;
}

function getManual51jobSummaryLines(lines: readonly string[]): string[] {
  const workHistoryIndex = getManual51jobSectionStartIndex(lines, "workHistory");
  const cutoff = workHistoryIndex >= 0 ? workHistoryIndex : Math.min(lines.length, 40);
  return lines.slice(0, cutoff).filter(Boolean);
}

function isManual51jobTerminalSectionHeader(line: string): boolean {
  const normalized = normalizeManual51jobLine(line).replace(/[：:]$/u, "");
  if (!normalized) {
    return false;
  }

  return MANUAL_51JOB_TERMINAL_SECTION_HEADER_PATTERNS.some((pattern) => pattern.test(normalized));
}

function pickManual51jobPrimaryLine(lines: readonly string[]): string | undefined {
  const candidates = lines
    .map((line) => normalizeManual51jobLine(line))
    .filter((line) => {
      if (!line) {
        return false;
      }
      if (resolveManual51jobSectionHeader(line) || isManual51jobTerminalSectionHeader(line)) {
        return false;
      }
      if (getManual51jobLabeledLineValue(line, MANUAL_51JOB_SUMMARY_PRIMARY_LINE_EXCLUDED_LABELS) !== undefined) {
        return false;
      }
      if (/^\//.test(line) || /^--\s*\d+\s+of\s+\d+\s*--$/i.test(line)) {
        return false;
      }
      if (/^(声明|聊|天|该人才偏好电话)/.test(line)) {
        return false;
      }
      if (/找工作|到岗/u.test(line)) {
        return false;
      }
      if (isLikelyManual51jobResumeName(line)) {
        return false;
      }
      return true;
    });

  return candidates.find((line) => MANUAL_51JOB_INLINE_SALARY_PATTERNS.some((pattern) => pattern.test(line)))
    || candidates[0];
}

function inferManual51jobSummaryExperience(lines: readonly string[]): string | undefined {
  for (const line of lines) {
    const match = normalizeManual51jobLine(line).match(MANUAL_51JOB_INLINE_EXPERIENCE_PATTERN);
    if (match?.[1]) {
      return match[1];
    }
  }
  return undefined;
}

function inferManual51jobSalary(value: string | undefined): string | undefined {
  const normalized = normalizeManual51jobLine(value || "");
  if (!normalized) {
    return undefined;
  }

  const matches = MANUAL_51JOB_INLINE_SALARY_PATTERNS
    .map((pattern) => normalized.match(pattern)?.[1]?.trim())
    .filter((match): match is string => Boolean(match));
  if (matches.length === 0) {
    return undefined;
  }

  matches.sort((left, right) => {
    const rangeDiff = Number(right.includes("-") || right.includes("~") || right.includes("到") || right.includes("至"))
      - Number(left.includes("-") || left.includes("~") || left.includes("到") || left.includes("至"));
    if (rangeDiff !== 0) {
      return rangeDiff;
    }
    return right.length - left.length;
  });

  return matches[0];
}

function inferManual51jobSummarySalary(lines: readonly string[]): string | undefined {
  for (const line of lines) {
    const salary = inferManual51jobSalary(line);
    if (salary) {
      return salary;
    }
  }
  return undefined;
}

function splitManual51jobSummarySegments(value: string | undefined): string[] {
  if (!value) {
    return [];
  }
  return value
    .split(/[\t｜|丨]+/)
    .map((segment) => normalizeManual51jobLine(segment))
    .filter(Boolean);
}

function resolveManual51jobJobIntentionLine(lines: readonly string[]): string | undefined {
  const labelGroups = [MANUAL_51JOB_PREFERRED_JOB_INTENTION_LABELS, MANUAL_51JOB_JOB_INTENTION_LABELS] as const;

  for (const labels of labelGroups) {
    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index] || "";
      const value = getManual51jobLabeledLineValue(line, labels);
      if (value === undefined) {
        continue;
      }
      if (value) {
        return value;
      }

      return getManual51jobFollowingLine(lines, index, {
        skip: (nextLine) => /^求职偏好/.test(nextLine),
      });
    }
  }

  return undefined;
}

function inferManual51jobInlineLocation(text: string): string | undefined {
  const explicitMatch = text.match(/现居(?:住地|住)?[·:：]?\s*([^\n\t｜|]{1,40})/u);
  if (explicitMatch?.[1]) {
    const location = normalizeManual51jobLine(explicitMatch[1]);
    if (location) {
      return location;
    }
  }

  const lines = splitManual51jobLines(text);
  const preferredHeaderIndex = lines.findIndex((line) => /(?:^|\s)(?:男|女)\s*[｜|丨]/u.test(line) && MANUAL_51JOB_INLINE_EXPERIENCE_PATTERN.test(line));
  const candidateLines = preferredHeaderIndex >= 0
    ? [lines[preferredHeaderIndex] || ""]
    : lines.slice(0, 12);

  for (const line of candidateLines) {
    const segments = splitManual51jobSummarySegments(line);
    for (const segment of segments) {
      if (!segment || MANUAL_51JOB_INLINE_LOCATION_EXCLUSION_PATTERN.test(segment)) {
        continue;
      }
      if (MANUAL_51JOB_INLINE_EXPERIENCE_PATTERN.test(segment)) {
        continue;
      }
      if (MANUAL_51JOB_INLINE_SALARY_PATTERNS.some((pattern) => pattern.test(segment))) {
        continue;
      }
      if (/\d{11}|@|活跃时间|人才ID|求职意向|工作经历|教育经历/u.test(segment)) {
        continue;
      }
      if (/[（(].*[）)]/.test(segment)) {
        continue;
      }
      const hierarchy = normalizeLocationTreeHierarchy(segment);
      if (hierarchy) {
        return normalizeManual51jobLine(segment);
      }
    }
  }

  return undefined;
}

function resolveManual51jobSectionHeader(line: string): { key: Manual51jobSectionKey; remainder?: string } | null {
  const normalizedLine = normalizeManual51jobLine(line);
  if (!normalizedLine) {
    return null;
  }

  for (const entry of MANUAL_51JOB_SECTION_LABELS) {
    for (const label of entry.labels) {
      if (normalizedLine === label) {
        return { key: entry.key };
      }

      const match = normalizedLine.match(getManual51jobLabelPattern(label));
      if (match) {
        const remainder = match[1]?.trim();
        return remainder ? { key: entry.key, remainder } : { key: entry.key };
      }
    }
  }

  return null;
}

function collectManual51jobSections(text: string): Partial<Record<Manual51jobSectionKey, string[]>> {
  const sections: Partial<Record<Manual51jobSectionKey, string[]>> = {};
  let currentKey: Manual51jobSectionKey | null = null;

  for (const rawLine of normalizeManual51jobText(text).split("\n")) {
    const normalizedLine = normalizeManual51jobLine(rawLine);
    if (/^岗位经验(?:\s|$)/u.test(normalizedLine)) {
      currentKey = "positionExperience";
      sections[currentKey] = [];
      const remainder = normalizedLine.replace(/^岗位经验[\s：:]*/u, "").trim();
      if (remainder) {
        sections[currentKey]?.push(remainder);
      }
      continue;
    }

    const sectionHeader = resolveManual51jobSectionHeader(rawLine);
    if (sectionHeader) {
      currentKey = sectionHeader.key;
      sections[currentKey] = [];
      if (sectionHeader.remainder) {
        sections[currentKey]?.push(sectionHeader.remainder);
      }
      continue;
    }

    if (currentKey) {
      sections[currentKey]?.push(rawLine);
    }
  }

  return sections;
}

function getManual51jobSectionText(
  sections: Partial<Record<Manual51jobSectionKey, string[]>>,
  key: Manual51jobSectionKey,
): string | undefined {
  const lines = sections[key]
    ?.map((line) => normalizeManual51jobLine(line))
    .filter((line) => Boolean(line));
  if (!lines || lines.length === 0) {
    return undefined;
  }
  const filteredLines = lines.filter((line) => !isManual51jobTerminalSectionHeader(line));
  if (filteredLines.length === 0) {
    return undefined;
  }
  const normalized = normalizeManual51jobText(filteredLines.join("\n"));
  return normalized || undefined;
}

function normalizeManual51jobDate(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    return "";
  }
  if (["至今", "目前", "今"].includes(trimmed)) {
    return "至今";
  }

  return trimmed
    .replace(/[./]/g, "-")
    .replace(/年/g, "-")
    .replace(/月/g, "")
    .replace(/日/g, "")
    .replace(/\s+/g, "")
    .replace(/-{2,}/g, "-")
    .replace(/^-|-$/g, "");
}

function resolveManual51jobPrimaryDateLine(lines: readonly string[], fallback: string): string {
  const dateLineIndex = lines.findIndex((line) => MANUAL_51JOB_TIMELINE_START_PATTERN.test(line));
  return dateLineIndex >= 0 ? (lines[dateLineIndex] || "") : fallback;
}

function extractManual51jobDateRange(text: string): {
  matchedText?: string;
  startDate?: string;
  endDate?: string;
} {
  const match = text.match(MANUAL_51JOB_DATE_RANGE_PATTERN);
  if (!match) {
    return {};
  }

  const startDate = normalizeManual51jobDate(match[1] || "");
  const endDate = normalizeManual51jobDate(match[2] || "");

  return {
    matchedText: match[0],
    ...(startDate ? { startDate } : {}),
    ...(endDate ? { endDate } : {}),
  };
}

function splitManual51jobBlocks(text: string): string[] {
  const normalized = normalizeManual51jobText(text);
  if (!normalized) {
    return [];
  }

  const lines = normalized
    .split("\n")
    .map((rawLine) => normalizeManual51jobLine(rawLine))
    .filter(Boolean);
  const blocks: string[] = [];
  let current: string[] = [];
  let currentHasTimeline = false;
  let currentHasCompanyCandidate = false;
  let capturingCustomerList = false;

  for (const [index, line] of lines.entries()) {
    if (isManual51jobTerminalSectionHeader(line)) {
      break;
    }

    const nextLine = lines[index + 1];
    const customerLabelValue = getManual51jobLabeledLineValue(line, MANUAL_51JOB_WORK_CUSTOMER_LABELS);
    if (customerLabelValue !== undefined) {
      capturingCustomerList = true;
    }

    const separatedCompanyCandidate = extractManual51jobCompanyCandidate(line);
    if (
      !capturingCustomerList
      && current.length > 0
      && currentHasTimeline
      && currentHasCompanyCandidate
      && nextLine
      && MANUAL_51JOB_TIMELINE_START_PATTERN.test(nextLine)
      && separatedCompanyCandidate
      && hasManual51jobSeparatedCompanyCandidate(line, separatedCompanyCandidate)
    ) {
      blocks.push(current.join("\n"));
      current = [line];
      currentHasTimeline = false;
      currentHasCompanyCandidate = true;
      continue;
    }

    if (MANUAL_51JOB_TIMELINE_START_PATTERN.test(line) && current.length > 0 && currentHasTimeline) {
      blocks.push(current.join("\n"));
      current = [line];
      currentHasTimeline = true;
      currentHasCompanyCandidate = false;
      capturingCustomerList = false;
      continue;
    }

    current.push(line);
    if (separatedCompanyCandidate) {
      currentHasCompanyCandidate = true;
    }
    if (MANUAL_51JOB_TIMELINE_START_PATTERN.test(line)) {
      currentHasTimeline = true;
      capturingCustomerList = false;
      continue;
    }

    if (capturingCustomerList && (MANUAL_51JOB_SECTION_HEADER_SET.has(line) || classifyManual51jobLabeledWorkField(line))) {
      capturingCustomerList = false;
    }
  }

  if (current.length > 0) {
    blocks.push(current.join("\n"));
  }

  return blocks;
}

function hasManual51jobTimelineLine(block: string): boolean {
  return block.split("\n").some((line) => MANUAL_51JOB_TIMELINE_START_PATTERN.test(normalizeManual51jobLine(line)));
}

function mergeManual51jobLeadingIdentityBlocks(
  blocks: string[],
  resolveIdentity: (line: string) => string | undefined,
): string[] {
  const merged: string[] = [];

  for (let index = 0; index < blocks.length; index += 1) {
    const currentBlock = blocks[index] || "";
    const currentLines = currentBlock.split("\n").map((line) => normalizeManual51jobLine(line)).filter(Boolean);
    const nextBlock = blocks[index + 1] || "";
    if (
      currentLines.length === 1
      && !hasManual51jobTimelineLine(currentBlock)
      && resolveIdentity(currentLines[0] || "")
      && nextBlock
      && hasManual51jobTimelineLine(nextBlock)
    ) {
      merged.push(`${currentLines[0]}\n${nextBlock}`);
      index += 1;
      continue;
    }

    merged.push(currentBlock);
  }

  return merged;
}

function classifyManual51jobLabeledWorkField(
  line: string,
): { field: Manual51jobLabeledWorkField; value: string } | { field: Manual51jobLabeledWorkField; value?: undefined } | undefined {
  const labeledCompany = getManual51jobLabeledLineValue(line, MANUAL_51JOB_WORK_COMPANY_LABELS);
  if (labeledCompany !== undefined) {
    return labeledCompany ? { field: "company", value: labeledCompany } : { field: "company" };
  }

  const labeledJobTitle = getManual51jobLabeledLineValue(line, MANUAL_51JOB_WORK_JOB_TITLE_LABELS);
  if (labeledJobTitle !== undefined) {
    return labeledJobTitle ? { field: "jobTitle", value: labeledJobTitle } : { field: "jobTitle" };
  }

  const labeledDescription = getManual51jobLabeledLineValue(line, MANUAL_51JOB_WORK_DESCRIPTION_LABELS);
  if (labeledDescription !== undefined) {
    return labeledDescription ? { field: "description", value: labeledDescription } : { field: "description" };
  }

  return undefined;
}

function getManual51jobDescriptionLines(
  lines: string[],
  companyName?: string,
  jobTitle?: string,
): string[] {
  const descriptionLines: string[] = [];
  let pendingLabeledField: Manual51jobLabeledWorkField | undefined;
  let capturingCustomerList = false;

  for (let index = 1; index < lines.length; index += 1) {
    const line = normalizeManual51jobLine(lines[index] || "");
    if (!line) {
      continue;
    }

    const customerLabelValue = getManual51jobLabeledLineValue(line, MANUAL_51JOB_WORK_CUSTOMER_LABELS);
    if (customerLabelValue !== undefined) {
      capturingCustomerList = true;
      descriptionLines.push(customerLabelValue || normalizeManual51jobLine(line).replace(/[：:]$/u, ""));
      continue;
    }

    const labeledField = classifyManual51jobLabeledWorkField(line);
    if (labeledField) {
      capturingCustomerList = false;
      if (labeledField.value) {
        if (labeledField.field === "description") {
          descriptionLines.push(labeledField.value);
        }
      } else {
        pendingLabeledField = labeledField.field;
      }
      continue;
    }

    if (capturingCustomerList) {
      if (MANUAL_51JOB_TIMELINE_START_PATTERN.test(line) || MANUAL_51JOB_SECTION_HEADER_SET.has(line) || isManual51jobTerminalSectionHeader(line)) {
        capturingCustomerList = false;
      } else {
        descriptionLines.push(line);
        continue;
      }
    }

    if (pendingLabeledField) {
      const field = pendingLabeledField;
      pendingLabeledField = undefined;
      if (field === "description") {
        descriptionLines.push(line);
      }
      continue;
    }

    if (MANUAL_51JOB_TIMELINE_START_PATTERN.test(line)) {
      continue;
    }

    if (MANUAL_51JOB_SECTION_HEADER_SET.has(line) || isManual51jobTerminalSectionHeader(line)) {
      continue;
    }

    if (looksLikeManual51jobWorkHistoryNoise(line)) {
      continue;
    }

    if (MANUAL_51JOB_WORK_HISTORY_PAGE_MARKER_PATTERN.test(line) || line === "/") {
      continue;
    }

    if (companyName && extractManual51jobCompany(line) === companyName) {
      continue;
    }

    if (jobTitle && cleanManual51jobRemainder(line) === jobTitle) {
      continue;
    }

    descriptionLines.push(line);
  }

  return descriptionLines;
}

function extractManual51jobCompany(value: string): string | undefined {
  const match = normalizeManual51jobLine(value).match(MANUAL_51JOB_COMPANY_PATTERN);
  return match?.[1]?.trim() || undefined;
}

function extractManual51jobCompanyCandidate(value: string): string | undefined {
  const extracted = extractManual51jobCompany(value);
  if (!extracted || /[中心]$/.test(extracted) || !isLikelyManual51jobCompanyName(extracted)) {
    return undefined;
  }

  const remainder = cleanManual51jobJobTitleCandidate(value.replace(extracted, " "));
  if (!remainder) {
    return extracted;
  }

  return remainder.length <= 40 && isLikelyManual51jobJobTitle(remainder) ? extracted : undefined;
}

function extractManual51jobInstitution(value: string): string | undefined {
  const match = normalizeManual51jobLine(value).match(MANUAL_51JOB_INSTITUTION_PATTERN);
  return match?.[1]?.trim() || undefined;
}

function extractManual51jobQualification(value: string): string | undefined {
  const match = normalizeManual51jobLine(value).match(MANUAL_51JOB_QUALIFICATION_PATTERN);
  return match?.[1]?.trim() || undefined;
}

function cleanManual51jobRemainder(value: string): string | undefined {
  const normalized = normalizeManual51jobLine(
    value
      .replace(/[|｜丨]/g, " ")
      .replace(/[：:]/g, " ")
      .replace(/[()（）]/g, " ")
      .replace(/[，,。；;]/g, " ")
  );
  if (!normalized) {
    return undefined;
  }

  const trimmed = normalized.replace(/[：:]+$/u, "").trim();
  return trimmed || undefined;
}

function cleanManual51jobJobTitleCandidate(value: string): string | undefined {
  const normalized = cleanManual51jobRemainder(value);
  if (!normalized) {
    return undefined;
  }

  const stripped = normalized
    .replace(/^(?:台资企业|德资企业|日资企业|韩资企业|港资企业|民营|外资(?:（[^）]+）)?|外企|合资(?:企业)?|创业公司|已上市)(?:\s+|$)/u, "")
    .replace(/(?:^|\s+)(?:台资企业|德资企业|日资企业|韩资企业|港资企业|民营|外资(?:（[^）]+）)?|外企|合资(?:企业)?|创业公司|已上市)$/u, "")
    .trim();
  return stripped || undefined;
}

function isLikelyManual51jobPositionExperienceJobTitle(value: string | undefined): value is string {
  if (!value || !isLikelyManual51jobJobTitle(value)) {
    return false;
  }

  return /(?:CNC|cnc|数控|销售|工程师|经理|主管|总监|专员|代表|助理|编程|操机|跟单|客服|业务|技术|顾问|主任|文员|采购|会计|店长|班长|组长|系长|车工|钳工|普工|设计|开发)$/u.test(value);
}

function looksLikeManual51jobDuration(value: string): boolean {
  const normalized = normalizeManual51jobLine(value).replace(/[()（）]/g, "");
  if (!normalized) {
    return false;
  }
  return /^(?:\d+年(?:\d+个?月)?|\d+个?月|\d+月)$/u.test(normalized);
}

function looksLikeManual51jobBoilerplate(value: string): boolean {
  const normalized = normalizeManual51jobLine(value);
  if (!normalized) {
    return false;
  }
  return /^(?:声明[:：]|以上人才信息仅供|一经发现|仅供招聘专用|操作时间[:：]?|该人才偏好电话|有企业近期电话联系过该人才|推荐您电话沟通)/u.test(normalized)
    || /(?:禁止用于其他任何用途|暂停或终止服务)/u.test(normalized);
}

function looksLikeManual51jobEducationOrTrainingText(value: string): boolean {
  const normalized = normalizeManual51jobLine(value);
  if (!normalized) {
    return false;
  }
  return /(?:大学|学院|学校|中学|技校|职业技术学院|技术学院|中专|本科|大专|硕士|博士|双一流|985|211|培训机构|驾驶证|毕业论文|课程|主修|专业方向|英语\s|日语\s|韩语\s|简单沟通\/读写|工作分析)/u.test(normalized);
}

export function looksLikeManual51jobWorkHistoryNoise(value: string): boolean {
  const normalized = normalizeManual51jobLine(value).replace(/[：:]$/u, "");
  if (!normalized) {
    return true;
  }
  if (MANUAL_51JOB_WORK_HISTORY_PAGE_MARKER_PATTERN.test(normalized) || normalized === "/") {
    return true;
  }
  if (/^(?:聊|天|聊\s*天)$/u.test(normalized)) {
    return true;
  }
  if (looksLikeManual51jobBoilerplate(normalized)) {
    return true;
  }
  if (/^(?:声明|技能\s*\/\s*语言|技能|语言|证书|作品集|项目经验|项目描述|工作描述|职责描述|工作职责|工作内容|所属公司|岗位经验|走心机|加工中心|加工)$/u.test(normalized)) {
    return true;
  }
  return false;
}

export function isLikelyManual51jobCompanyName(value: string): boolean {
  const normalized = normalizeManual51jobLine(value);
  if (!normalized || normalized.length > 80) {
    return false;
  }
  if (looksLikeManual51jobWorkHistoryNoise(normalized) || looksLikeManual51jobDuration(normalized)) {
    return false;
  }
  if (MANUAL_51JOB_INLINE_DATE_RANGE_PATTERN.test(normalized)) {
    return false;
  }
  if (/\d{2,}/u.test(normalized)) {
    return false;
  }
  if (/[：:；;，,。！？]/u.test(normalized)) {
    return false;
  }
  if (looksLikeManual51jobEducationOrTrainingText(normalized)) {
    return false;
  }
  if (normalized.endsWith("中心") && !/(?:公司|集团|有限|股份|银行|医院|研究院|研究所|厂)/u.test(normalized)) {
    return false;
  }
  if (/^(?:在该公司|通过公司|参与公司|主要涉及公司)$/u.test(normalized)) {
    return false;
  }
  if (/^(?:熟悉|了解|掌握|负责|参与|主要|通过|在该|具备)/u.test(normalized)) {
    return false;
  }
  return true;
}

export function isLikelyManual51jobJobTitle(value: string): boolean {
  const normalized = normalizeManual51jobLine(value);
  if (!normalized || normalized.length > 60) {
    return false;
  }
  if (looksLikeManual51jobWorkHistoryNoise(normalized) || looksLikeManual51jobDuration(normalized)) {
    return false;
  }
  if (MANUAL_51JOB_INLINE_DATE_RANGE_PATTERN.test(normalized)) {
    return false;
  }
  if (/\d{2,}/u.test(normalized)) {
    return false;
  }
  if (/[，,。；;：:！？]/u.test(normalized)) {
    return false;
  }
  if (/^[0-9一二三四五六七八九十]+[.、．]/u.test(normalized)) {
    return false;
  }
  if (looksLikeManual51jobEducationOrTrainingText(normalized)) {
    return false;
  }
  if (extractManual51jobCompany(normalized) === normalized && isLikelyManual51jobCompanyName(normalized)) {
    return false;
  }
  if (/^(?:在该公司|通过公司)$/u.test(normalized)) {
    return false;
  }
  if (/^(?:熟悉|了解|掌握|负责|参与|主要|通过|在该|具备)/u.test(normalized)) {
    return false;
  }
  if (/^[\u4e00-\u9fa5A-Za-z]$/u.test(normalized)) {
    return false;
  }
  return true;
}

function sanitizeManual51jobWorkHistoryLines(lines: string[]): string[] {
  const counts = new Map<string, number>();
  for (const line of lines) {
    counts.set(line, (counts.get(line) || 0) + 1);
  }

  return lines.filter((line) => {
    if (looksLikeManual51jobBoilerplate(line)) {
      return false;
    }
    if ((counts.get(line) || 0) >= 4 && !MANUAL_51JOB_TIMELINE_START_PATTERN.test(line)) {
      return false;
    }
    return true;
  });
}

function parseManual51jobWorkHistoryBlock(block: string): ResumeWorkHistoryItem | null {
  const lines = sanitizeManual51jobWorkHistoryLines(
    block
      .split("\n")
      .map((line) => normalizeManual51jobLine(line))
      .filter(Boolean)
  );
  if (lines.length === 0) {
    return null;
  }

  const raw = lines.join("\n");
  const headerLine = lines[0] || "";
  const dateLineIndex = lines.findIndex((line) => MANUAL_51JOB_TIMELINE_START_PATTERN.test(line));
  const dateRange = extractManual51jobDateRange(resolveManual51jobPrimaryDateLine(lines, headerLine) || raw);
  const companyFromLabel = getManual51jobFieldValueFromLines(lines, MANUAL_51JOB_WORK_COMPANY_LABELS);
  const jobTitleFromLabel = getManual51jobFieldValueFromLines(lines, MANUAL_51JOB_WORK_JOB_TITLE_LABELS);

  let pendingLabeledField: Manual51jobLabeledWorkField | undefined;
  let capturingCustomerList = false;
  let companyCandidate: string | undefined;
  let companyLineForCandidate: string | undefined;
  let roleLineCandidate: string | undefined;

  for (const [index, line] of lines.entries()) {
    if (index === dateLineIndex) {
      continue;
    }

    const customerLabelValue = getManual51jobLabeledLineValue(line, MANUAL_51JOB_WORK_CUSTOMER_LABELS);
    if (customerLabelValue !== undefined) {
      pendingLabeledField = undefined;
      capturingCustomerList = true;
      continue;
    }

    const labeledField = classifyManual51jobLabeledWorkField(line);
    if (labeledField) {
      capturingCustomerList = false;
      if (!labeledField.value) {
        pendingLabeledField = labeledField.field;
      }
      continue;
    }

    if (capturingCustomerList) {
      if (MANUAL_51JOB_TIMELINE_START_PATTERN.test(line) || MANUAL_51JOB_SECTION_HEADER_SET.has(line) || isManual51jobTerminalSectionHeader(line)) {
        capturingCustomerList = false;
      } else {
        continue;
      }
    }

    if (pendingLabeledField) {
      pendingLabeledField = undefined;
      continue;
    }
    if (MANUAL_51JOB_SECTION_HEADER_SET.has(line) || isManual51jobTerminalSectionHeader(line)) {
      continue;
    }
    if (looksLikeManual51jobWorkHistoryNoise(line)) {
      continue;
    }

    if (!companyCandidate) {
      const extractedCompany = extractManual51jobCompanyCandidate(line);
      if (extractedCompany) {
        companyCandidate = extractedCompany;
        companyLineForCandidate = line;
      }
    }

    if (!roleLineCandidate && line !== headerLine && !extractManual51jobCompanyCandidate(line) && !MANUAL_51JOB_TIMELINE_START_PATTERN.test(line) && !/[｜|丨]/.test(line)) {
      roleLineCandidate = line;
    }
  }

  let titleLine = headerLine;
  if (dateRange.matchedText) {
    titleLine = normalizeManual51jobLine(titleLine.replace(dateRange.matchedText, " "));
  }
  if (!titleLine && lines.length > 1) {
    titleLine = lines[1] || "";
  }

  const companyName = (() => {
    if (companyFromLabel && isLikelyManual51jobCompanyName(companyFromLabel)) {
      return companyFromLabel;
    }
    if (companyCandidate && isLikelyManual51jobCompanyName(companyCandidate)) {
      return companyCandidate;
    }

    if (dateRange.startDate || dateRange.endDate) {
      const extracted = extractManual51jobCompanyCandidate(titleLine);
      if (extracted && isLikelyManual51jobCompanyName(extracted)) {
        return extracted;
      }
    }

    return undefined;
  })();
  const jobTitle = (() => {
    if (jobTitleFromLabel && isLikelyManual51jobJobTitle(jobTitleFromLabel)) {
      return jobTitleFromLabel;
    }

    const remainderFromCompanyLine = (() => {
      if (!companyName || !companyLineForCandidate?.includes(companyName)) {
        return undefined;
      }
      const remainder = cleanManual51jobJobTitleCandidate(companyLineForCandidate.replace(companyName, " "));
      if (!remainder || remainder.length > 40) {
        return undefined;
      }
      return isLikelyManual51jobJobTitle(remainder) ? remainder : undefined;
    })();
    if (remainderFromCompanyLine) {
      return remainderFromCompanyLine;
    }

    if (roleLineCandidate && roleLineCandidate.length <= 40 && isLikelyManual51jobJobTitle(roleLineCandidate)) {
      return roleLineCandidate;
    }

    if (!companyName) {
      return undefined;
    }
    const remainder = cleanManual51jobJobTitleCandidate(titleLine.replace(companyName, " "));
    if (!remainder || remainder.length > 40) {
      return undefined;
    }
    return isLikelyManual51jobJobTitle(remainder) ? remainder : undefined;
  })();
  const description = cleanManual51jobRemainder(getManual51jobDescriptionLines(lines, companyName, jobTitle).join("\n"));

  if (!companyName && !jobTitle) {
    return null;
  }

  if (!companyName && jobTitle && looksLikeManual51jobEducationOrTrainingText([jobTitle, description || ""].join(" "))) {
    return null;
  }

  return {
    raw,
    ...(companyName ? { companyName } : {}),
    ...(jobTitle ? { jobTitle } : {}),
    ...(description ? { description } : {}),
    ...(dateRange.startDate ? { startDate: dateRange.startDate } : {}),
    ...(dateRange.endDate ? { endDate: dateRange.endDate } : {}),
  };
}

function normalizeManual51jobWorkHistoryComparableValue(value: string | undefined): string {
  return normalizeManual51jobLine((value || "").replace(/[，,。；;：:！!？?（）()]/g, " "));
}

function hasManual51jobProjectAugmentingLabels(raw: string | undefined): boolean {
  return /(?:^|\n)(?:项目经验|所属公司|项目描述)[:：]?/u.test(raw || "");
}

function isManual51jobProjectAugmentingDuplicateEntryPair(
  left: ResumeWorkHistoryItem,
  right: ResumeWorkHistoryItem,
): boolean {
  const leftAugmenting = hasManual51jobProjectAugmentingLabels(left.raw);
  const rightAugmenting = hasManual51jobProjectAugmentingLabels(right.raw);
  if (!leftAugmenting && !rightAugmenting) {
    return false;
  }

  const companyCompatible = !left.companyName || !right.companyName || left.companyName === right.companyName;
  const titleCompatible = !left.jobTitle || !right.jobTitle || left.jobTitle === right.jobTitle;
  return companyCompatible && titleCompatible;
}

function hasManual51jobSeparatedCompanyCandidate(line: string, companyName: string): boolean {
  return line === companyName || line.startsWith(`${companyName} `);
}

function isManual51jobEducationBoundaryLine(line: string): boolean {
  return Boolean(extractManual51jobInstitution(line))
    || Boolean(extractManual51jobQualification(line))
    || /^专业描述[:：]?$/u.test(line)
    || /^培训机构[:：]?/u.test(line);
}

function isManual51jobCrossPageNoiseLine(line: string): boolean {
  return MANUAL_51JOB_WORK_HISTORY_PAGE_MARKER_PATTERN.test(line)
    || line === "/"
    || /^(?:聊|天|聊\s*天)$/u.test(line)
    || looksLikeManual51jobBoilerplate(line);
}

function getManual51jobWorkHistoryDateRangesFromLines(
  lines: string[],
): Array<Pick<ResumeWorkHistoryItem, "startDate" | "endDate">> {
  const ranges: Array<Pick<ResumeWorkHistoryItem, "startDate" | "endDate">> = [];
  const seen = new Set<string>();
  let pendingEducationDateBoundary = false;
  for (const line of lines) {
    if (ranges.length > 0 && isManual51jobCrossPageNoiseLine(line)) {
      return ranges;
    }

    if (ranges.length > 0 && isManual51jobEducationBoundaryLine(line)) {
      pendingEducationDateBoundary = true;
      continue;
    }

    const range = extractManual51jobDateRange(line);
    if (!range.matchedText || (!range.startDate && !range.endDate)) {
      continue;
    }

    if (ranges.length > 0 && pendingEducationDateBoundary) {
      return ranges;
    }

    const remainder = cleanManual51jobRemainder(line.replace(range.matchedText, " "));
    if (remainder && looksLikeManual51jobEducationOrTrainingText(remainder)) {
      continue;
    }

    const key = `${range.startDate || ""}|${range.endDate || ""}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    ranges.push({
      ...(range.startDate ? { startDate: range.startDate } : {}),
      ...(range.endDate ? { endDate: range.endDate } : {}),
    });
  }

  return ranges;
}

function hasManual51jobCrossPageWorkHistoryNoiseInLines(lines: string[]): boolean {
  return lines.some((line) => isManual51jobCrossPageNoiseLine(line));
}

function getManual51jobCrossPageWorkHistoryDateRangesFromLines(
  lines: string[],
  expectedCount: number,
): Array<Pick<ResumeWorkHistoryItem, "startDate" | "endDate">> {
  const ranges: Array<Pick<ResumeWorkHistoryItem, "startDate" | "endDate">> = [];
  const trailingRanges: Array<Pick<ResumeWorkHistoryItem, "startDate" | "endDate">> = [];
  const seen = new Set<string>();
  let capturingTrailingRanges = false;

  for (const line of lines) {
    if (isManual51jobCrossPageNoiseLine(line)) {
      continue;
    }

    if (ranges.length > 0 && isManual51jobEducationBoundaryLine(line)) {
      capturingTrailingRanges = true;
      continue;
    }

    const range = extractManual51jobDateRange(line);
    if (!range.matchedText || (!range.startDate && !range.endDate)) {
      continue;
    }

    const remainder = cleanManual51jobRemainder(line.replace(range.matchedText, " "));
    if (remainder && looksLikeManual51jobEducationOrTrainingText(remainder)) {
      continue;
    }

    const key = `${range.startDate || ""}|${range.endDate || ""}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);

    const nextRange = {
      ...(range.startDate ? { startDate: range.startDate } : {}),
      ...(range.endDate ? { endDate: range.endDate } : {}),
    };

    if (capturingTrailingRanges) {
      trailingRanges.push(nextRange);
      continue;
    }

    ranges.push(nextRange);
    if (ranges.length >= expectedCount) {
      return ranges.slice(0, expectedCount);
    }
  }

  if (ranges.length >= expectedCount) {
    return ranges.slice(0, expectedCount);
  }

  const remaining = expectedCount - ranges.length;
  if (trailingRanges.length < remaining) {
    return [];
  }

  return [...ranges, ...trailingRanges.slice(-remaining)];
}

type Manual51jobStructuredCompanyTitleEntryOptions = {
  allowBroadJobTitles?: boolean;
};

function getManual51jobStructuredCompanyTitleEntriesFromLines(
  lines: string[],
  options?: Manual51jobStructuredCompanyTitleEntryOptions,
): ResumeWorkHistoryItem[] {
  const allowBroadJobTitles = options?.allowBroadJobTitles === true;
  const entries: ResumeWorkHistoryItem[] = [];
  let pendingCompanyLine: string | undefined;

  for (const line of lines) {
    if (!line) {
      continue;
    }
    if (resolveManual51jobSectionHeader(line) || isManual51jobTerminalSectionHeader(line)) {
      break;
    }
    if (looksLikeManual51jobWorkHistoryNoise(line) || looksLikeManual51jobEducationOrTrainingText(line) || MANUAL_51JOB_TIMELINE_START_PATTERN.test(line)) {
      pendingCompanyLine = undefined;
      continue;
    }

    const companyName = extractManual51jobCompanyCandidate(line);
    const jobTitleCandidate = companyName ? cleanManual51jobJobTitleCandidate(line.replace(companyName, " ")) : undefined;
    const jobTitle = jobTitleCandidate && (
      isLikelyManual51jobPositionExperienceJobTitle(jobTitleCandidate)
      || (allowBroadJobTitles && isLikelyManual51jobJobTitle(jobTitleCandidate))
    )
      ? jobTitleCandidate
      : undefined;

    if (companyName && jobTitle) {
      entries.push({
        raw: line,
        companyName,
        jobTitle,
      });
      pendingCompanyLine = undefined;
      continue;
    }

    if (companyName && hasManual51jobSeparatedCompanyCandidate(line, companyName)) {
      pendingCompanyLine = line;
      continue;
    }

    if (pendingCompanyLine) {
      const pendingCompany = extractManual51jobCompanyCandidate(pendingCompanyLine);
      if (pendingCompany) {
        const pendingTitle = cleanManual51jobJobTitleCandidate(line);
        const isAllowedPendingTitle = pendingTitle && (
          isLikelyManual51jobPositionExperienceJobTitle(pendingTitle)
          || (allowBroadJobTitles && isLikelyManual51jobJobTitle(pendingTitle))
        );
        if (isAllowedPendingTitle) {
          entries.push({
            raw: `${pendingCompanyLine}\n${line}`,
            companyName: pendingCompany,
            jobTitle: pendingTitle,
          });
          pendingCompanyLine = undefined;
          continue;
        }
      }
    }

    pendingCompanyLine = undefined;
  }

  return entries;
}

function doManual51jobStructuredWorkHistoryEntriesAlign(
  left: ResumeWorkHistoryItem[],
  right: ResumeWorkHistoryItem[],
): boolean {
  if (left.length === 0 || left.length !== right.length) {
    return false;
  }

  return left.every((entry, index) => {
    const other = right[index];
    if (!other) {
      return false;
    }

    const companyCompatible = !entry.companyName || !other.companyName || entry.companyName === other.companyName;
    const titleCompatible = !entry.jobTitle || !other.jobTitle || entry.jobTitle === other.jobTitle;
    return companyCompatible && titleCompatible;
  });
}

function rebuildManual51jobWorkHistoryFromStructuredEntries(
  structuredEntries: ResumeWorkHistoryItem[],
  dateRanges: Array<Pick<ResumeWorkHistoryItem, "startDate" | "endDate">>,
): ResumeWorkHistoryItem[] {
  if (structuredEntries.length === 0 || dateRanges.length === 0 || structuredEntries.length !== dateRanges.length) {
    return [];
  }

  return structuredEntries.map((entry, index) => ({
    ...entry,
    ...(dateRanges[index]?.startDate ? { startDate: dateRanges[index]?.startDate } : {}),
    ...(dateRanges[index]?.endDate ? { endDate: dateRanges[index]?.endDate } : {}),
  }));
}

function mergeManual51jobDuplicateWorkHistoryEntry(
  left: ResumeWorkHistoryItem,
  right: ResumeWorkHistoryItem,
): ResumeWorkHistoryItem {
  const leftDescription = left.description || "";
  const rightDescription = right.description || "";
  const preferredDescription = rightDescription.length > leftDescription.length ? right.description : left.description;
  const preferredRaw = (right.raw?.length || 0) > (left.raw?.length || 0) ? right.raw : left.raw;

  return {
    raw: preferredRaw,
    ...(left.companyName || right.companyName ? { companyName: left.companyName || right.companyName } : {}),
    ...(left.jobTitle || right.jobTitle ? { jobTitle: left.jobTitle || right.jobTitle } : {}),
    ...(preferredDescription ? { description: preferredDescription } : {}),
    ...(left.startDate || right.startDate ? { startDate: left.startDate || right.startDate } : {}),
    ...(left.endDate || right.endDate ? { endDate: left.endDate || right.endDate } : {}),
  };
}

function areLikelyDuplicateManual51jobWorkHistoryEntries(
  left: ResumeWorkHistoryItem,
  right: ResumeWorkHistoryItem,
): boolean {
  if (!left.startDate || !right.startDate || !left.endDate || !right.endDate) {
    return false;
  }
  if (left.startDate !== right.startDate || left.endDate !== right.endDate) {
    return false;
  }
  if (isManual51jobProjectAugmentingDuplicateEntryPair(left, right)) {
    return true;
  }

  const companyCompatible = !left.companyName || !right.companyName || left.companyName === right.companyName;
  const titleCompatible = !left.jobTitle || !right.jobTitle || left.jobTitle === right.jobTitle;
  if (!companyCompatible || !titleCompatible) {
    return false;
  }

  const leftDescription = normalizeManual51jobWorkHistoryComparableValue(left.description);
  const rightDescription = normalizeManual51jobWorkHistoryComparableValue(right.description);
  const leftRaw = left.raw || "";
  const rightRaw = right.raw || "";
  const projectAugmentingPair = hasManual51jobProjectAugmentingLabels(leftRaw) || hasManual51jobProjectAugmentingLabels(rightRaw);

  if (!leftDescription || !rightDescription) {
    return !projectAugmentingPair;
  }

  return leftDescription === rightDescription || leftDescription.includes(rightDescription) || rightDescription.includes(leftDescription);
}

function getManual51jobWorkHistory(text: string | undefined): ResumeWorkHistoryItem[] {
  if (!text) {
    return [];
  }

  const parsed = mergeManual51jobLeadingIdentityBlocks(splitManual51jobBlocks(text), extractManual51jobCompany)
    .map((block) => parseManual51jobWorkHistoryBlock(block))
    .filter((entry): entry is ResumeWorkHistoryItem => entry !== null);

  const unique: ResumeWorkHistoryItem[] = [];
  for (const entry of parsed) {
    const duplicateIndex = unique.findIndex((existing) => areLikelyDuplicateManual51jobWorkHistoryEntries(existing, entry));
    if (duplicateIndex >= 0) {
      unique[duplicateIndex] = mergeManual51jobDuplicateWorkHistoryEntry(unique[duplicateIndex]!, entry);
      continue;
    }
    unique.push(entry);
  }

  return unique;
}

function parseManual51jobEducationBlock(block: string): ResumeProfileEducationItem | null {
  const lines = block
    .split("\n")
    .map((line) => normalizeManual51jobLine(line))
    .filter(Boolean);
  if (lines.length === 0) {
    return null;
  }

  const headerLine = lines[0] || "";
  const dateLineIndex = lines.findIndex((line) => MANUAL_51JOB_TIMELINE_START_PATTERN.test(line));
  const dateRange = extractManual51jobDateRange(resolveManual51jobPrimaryDateLine(lines, headerLine) || block);
  const institutionFromLabel = lines
    .map((line) => getManual51jobLabeledLineValue(line, MANUAL_51JOB_EDUCATION_INSTITUTION_LABELS))
    .find((value): value is string => Boolean(value));
  const qualificationFromLabel = lines
    .map((line) => getManual51jobLabeledLineValue(line, MANUAL_51JOB_EDUCATION_QUALIFICATION_LABELS))
    .find((value): value is string => Boolean(value));
  const fieldFromLabel = lines
    .map((line) => getManual51jobLabeledLineValue(line, MANUAL_51JOB_EDUCATION_FIELD_LABELS))
    .find((value): value is string => Boolean(value));
  const descriptionFromLabel = lines
    .map((line) => getManual51jobLabeledLineValue(line, MANUAL_51JOB_EDUCATION_DESCRIPTION_LABELS))
    .find((value): value is string => Boolean(value));

  const candidateLines = lines.filter((line, index) => {
    if (index === dateLineIndex) {
      return false;
    }
    if (getManual51jobLabeledLineValue(line, MANUAL_51JOB_EDUCATION_INSTITUTION_LABELS) !== undefined) {
      return false;
    }
    if (getManual51jobLabeledLineValue(line, MANUAL_51JOB_EDUCATION_FIELD_LABELS) !== undefined) {
      return false;
    }
    if (getManual51jobLabeledLineValue(line, MANUAL_51JOB_EDUCATION_QUALIFICATION_LABELS) !== undefined) {
      return false;
    }
    if (getManual51jobLabeledLineValue(line, MANUAL_51JOB_EDUCATION_DESCRIPTION_LABELS) !== undefined) {
      return false;
    }
    if (isManual51jobTerminalSectionHeader(line)) {
      return false;
    }
    return true;
  });

  let titleLine = headerLine;
  if (dateRange.matchedText) {
    titleLine = normalizeManual51jobLine(titleLine.replace(dateRange.matchedText, " "));
  }
  if (!titleLine && lines.length > 1) {
    titleLine = lines[1] || "";
  }

  const institution = institutionFromLabel
    || candidateLines.map((line) => extractManual51jobInstitution(line)).find((value): value is string => Boolean(value))
    || extractManual51jobInstitution(titleLine);
  const qualification = qualificationFromLabel
    || candidateLines.map((line) => extractManual51jobQualification(line)).find((value): value is string => Boolean(value))
    || extractManual51jobQualification(titleLine);
  const fieldOfStudy = fieldFromLabel || (() => {
    const fieldLine = candidateLines.find((line) => line !== institution && line !== qualification);
    if (fieldLine && !extractManual51jobInstitution(fieldLine) && !extractManual51jobQualification(fieldLine)) {
      return cleanManual51jobRemainder(fieldLine);
    }
    if (!titleLine) {
      return undefined;
    }
    let remainder = titleLine;
    if (institution) {
      remainder = remainder.replace(institution, " ");
    }
    if (qualification) {
      remainder = remainder.replace(qualification, " ");
    }
    return cleanManual51jobRemainder(remainder);
  })();
  const description = cleanManual51jobRemainder(
    [
      descriptionFromLabel,
      ...lines.slice(1).filter((line) => {
        return getManual51jobLabeledLineValue(line, MANUAL_51JOB_EDUCATION_INSTITUTION_LABELS) === undefined
          && getManual51jobLabeledLineValue(line, MANUAL_51JOB_EDUCATION_FIELD_LABELS) === undefined
          && getManual51jobLabeledLineValue(line, MANUAL_51JOB_EDUCATION_QUALIFICATION_LABELS) === undefined
          && !isManual51jobTerminalSectionHeader(line);
      }),
    ].filter(Boolean).join("\n")
  );

  if (!institution && !qualification && !fieldOfStudy && !description) {
    return null;
  }

  return {
    ...(institution ? { institution } : {}),
    ...(qualification ? { qualification } : {}),
    ...(fieldOfStudy ? { fieldOfStudy } : {}),
    ...(description ? { description } : {}),
    ...(dateRange.startDate ? { startDate: dateRange.startDate } : {}),
    ...(dateRange.endDate ? { endDate: dateRange.endDate } : {}),
  };
}

function getManual51jobProfileEducation(text: string | undefined): ResumeProfileEducationItem[] | undefined {
  if (!text) {
    return undefined;
  }

  const normalized = mergeManual51jobLeadingIdentityBlocks(splitManual51jobBlocks(text), extractManual51jobInstitution)
    .map((block) => parseManual51jobEducationBlock(block))
    .filter((entry): entry is ResumeProfileEducationItem => entry !== null);

  return normalized.length > 0 ? normalized : undefined;
}

function pickManual51jobEducation(profileEducation: ResumeProfileEducationItem[] | undefined): string | undefined {
  if (!profileEducation || profileEducation.length === 0) {
    return undefined;
  }

  const qualifications = profileEducation
    .map((entry) => extractManual51jobQualification(entry.qualification || ""))
    .filter((value): value is string => Boolean(value));
  if (qualifications.length === 0) {
    return undefined;
  }

  return qualifications.sort((left, right) => {
    const leftRank = MANUAL_51JOB_EDUCATION_RANK[left] || 0;
    const rightRank = MANUAL_51JOB_EDUCATION_RANK[right] || 0;
    return rightRank - leftRank;
  })[0];
}

function inferManual51jobFilenameResumeName(entryPath: string | undefined): string | undefined {
  if (!entryPath) {
    return undefined;
  }

  const basename = entryPath
    .split(/[\\/]/)
    .pop()
    ?.replace(/\.[^.]+$/, "")
    .replace(/^51job[_-]?/i, "")
    .trim();
  const normalized = basename?.replace(/\([^)]*\)/g, "").trim();
  return normalized || undefined;
}

function isLikelyManual51jobResumeName(value: string): boolean {
  if (!value || value.length > 20) {
    return false;
  }
  if (/\d/.test(value) || /[：:｜|丨/]/.test(value) || /[()（）]/.test(value)) {
    return false;
  }

  const normalized = value.replace(/\s+/g, "");
  if (MANUAL_51JOB_NAME_EXCLUSIONS.has(normalized)) {
    return false;
  }

  return /\p{Script=Han}|[A-Za-z]/u.test(normalized);
}

function inferManual51jobResumeName(lines: readonly string[], entryPath?: string): string | undefined {
  const filenameCandidate = inferManual51jobFilenameResumeName(entryPath);

  for (const line of lines.slice(0, 12)) {
    const firstToken = line.split(/[\s|｜丨]/).find(Boolean)?.trim();
    if (firstToken && isLikelyManual51jobResumeName(firstToken)) {
      return firstToken;
    }
  }

  return filenameCandidate;
}

function inferManual51jobProfileId(lines: readonly string[], entryPath?: string): string | undefined {
  const entryMatch = entryPath?.match(/\((\d{6,})\)/);
  if (entryMatch?.[1]) {
    return entryMatch[1];
  }

  const labeledValue = getManual51jobFieldValueFromLines(lines, MANUAL_51JOB_PROFILE_ID_LABELS);
  const match = labeledValue?.match(/\d{6,}/);
  return match?.[0] || undefined;
}

export function parse51jobManualResume(args: {
  text: string;
  entryPath?: string;
  fallbackName?: string;
  fallbackProfileId?: string;
}): Parsed51jobManualResume {
  const text = normalizeManual51jobText(args.text);
  const lines = splitManual51jobLines(text);
  const summaryLines = getManual51jobSummaryLines(lines);
  const sections = collectManual51jobSections(text);
  const workHistorySectionText = getManual51jobSectionText(sections, "workHistory");
  const positionExperienceSectionText = getManual51jobSectionText(sections, "positionExperience");
  const workHistorySectionLines = workHistorySectionText ? splitManual51jobLines(workHistorySectionText) : [];
  const positionExperienceSectionLines = positionExperienceSectionText ? splitManual51jobLines(positionExperienceSectionText) : [];
  const primaryWorkHistory = getManual51jobWorkHistory(workHistorySectionText);
  let workHistory = primaryWorkHistory;

  let positionExperienceEntries: ResumeWorkHistoryItem[] = [];
  let workHistoryDateRanges: Array<Pick<ResumeWorkHistoryItem, "startDate" | "endDate">> = [];
  let shouldEvaluateStructuredFallback = primaryWorkHistory.length === 0;

  if (!shouldEvaluateStructuredFallback && workHistorySectionLines.length > 0) {
    workHistoryDateRanges = getManual51jobWorkHistoryDateRangesFromLines(workHistorySectionLines);
    shouldEvaluateStructuredFallback = workHistoryDateRanges.length > primaryWorkHistory.length
      || Boolean(positionExperienceSectionLines.length > 0 && hasManual51jobCrossPageWorkHistoryNoiseInLines(workHistorySectionLines));
  }

  if (shouldEvaluateStructuredFallback) {
    if (workHistoryDateRanges.length === 0) {
      workHistoryDateRanges = getManual51jobWorkHistoryDateRangesFromLines(workHistorySectionLines);
    }
    if (positionExperienceSectionLines.length > 0) {
      positionExperienceEntries = getManual51jobStructuredCompanyTitleEntriesFromLines(positionExperienceSectionLines);
    }
    const workHistoryStructuredEntries = getManual51jobStructuredCompanyTitleEntriesFromLines(workHistorySectionLines);
    const rebuiltPositionExperienceWorkHistory = rebuildManual51jobWorkHistoryFromStructuredEntries(
      positionExperienceEntries,
      workHistoryDateRanges,
    );
    const rebuiltWorkHistoryStructuredFallback = rebuildManual51jobWorkHistoryFromStructuredEntries(
      workHistoryStructuredEntries,
      workHistoryDateRanges,
    );
    const rebuiltCombinedStructuredFallback = rebuiltPositionExperienceWorkHistory.length === 0
      && rebuiltWorkHistoryStructuredFallback.length === 0
      && positionExperienceEntries.length > 0
      && workHistoryStructuredEntries.length > 0
      ? rebuildManual51jobWorkHistoryFromStructuredEntries(
        [...positionExperienceEntries, ...workHistoryStructuredEntries],
        workHistoryDateRanges,
      )
      : [];
    const fallbackCandidates = [
      rebuiltPositionExperienceWorkHistory,
      rebuiltWorkHistoryStructuredFallback,
      rebuiltCombinedStructuredFallback,
    ];
    const bestStructuredFallback = fallbackCandidates.sort((left, right) => right.length - left.length)[0] || [];
    const positionExperienceWorkHistory = positionExperienceSectionText
      ? getManual51jobWorkHistory(positionExperienceSectionText)
      : [];
    const alignedDetailedPositionExperienceWorkHistory = doManual51jobStructuredWorkHistoryEntriesAlign(
      rebuiltPositionExperienceWorkHistory,
      positionExperienceWorkHistory,
    )
      ? rebuiltPositionExperienceWorkHistory.map((entry, index) => mergeManual51jobDuplicateWorkHistoryEntry(
        entry,
        positionExperienceWorkHistory[index]!,
      ))
      : [];
    const crossPageCombinedStructuredEntries = (
      positionExperienceEntries.length > 0
      && workHistorySectionLines.length > 0
      && hasManual51jobCrossPageWorkHistoryNoiseInLines(workHistorySectionLines)
    )
      ? [
        ...positionExperienceEntries,
        ...getManual51jobStructuredCompanyTitleEntriesFromLines(workHistorySectionLines, { allowBroadJobTitles: true }),
      ]
      : [];
    const crossPageWorkHistoryDateRanges = crossPageCombinedStructuredEntries.length > primaryWorkHistory.length
      ? getManual51jobCrossPageWorkHistoryDateRangesFromLines(workHistorySectionLines, crossPageCombinedStructuredEntries.length)
      : [];
    const rebuiltCrossPagePositionExperienceWorkHistory = rebuildManual51jobWorkHistoryFromStructuredEntries(
      crossPageCombinedStructuredEntries,
      crossPageWorkHistoryDateRanges,
    );

    if (
      alignedDetailedPositionExperienceWorkHistory.length > 0
      && alignedDetailedPositionExperienceWorkHistory.length === bestStructuredFallback.length
    ) {
      workHistory = alignedDetailedPositionExperienceWorkHistory;
    } else if (bestStructuredFallback.length > primaryWorkHistory.length) {
      workHistory = bestStructuredFallback;
    } else if (rebuiltCrossPagePositionExperienceWorkHistory.length > primaryWorkHistory.length) {
      workHistory = rebuiltCrossPagePositionExperienceWorkHistory;
    } else if (primaryWorkHistory.length === 0 && positionExperienceSectionText) {
      workHistory = positionExperienceWorkHistory.length > 0 ? positionExperienceWorkHistory : positionExperienceEntries;
    }
  }
  const profileEducation = getManual51jobProfileEducation(getManual51jobSectionText(sections, "education"));
  const name = getManual51jobFieldValueFromLines(lines, MANUAL_51JOB_NAME_LABELS)
    || inferManual51jobResumeName(lines, args.entryPath)
    || args.fallbackName;
  const profileId = inferManual51jobProfileId(lines, args.entryPath) || args.fallbackProfileId;
  const inlineLocation = inferManual51jobInlineLocation(text);
  const location = getManual51jobFieldValueFromLines(lines, MANUAL_51JOB_LOCATION_LABELS)
    || inlineLocation;
  const primaryJobIntention = resolveManual51jobJobIntentionLine(lines);
  const primaryExpectedSalary = getManual51jobFieldValueFromLines(lines, MANUAL_51JOB_SALARY_LABELS);
  const primaryExperience = getManual51jobFieldValueFromLines(lines, MANUAL_51JOB_EXPERIENCE_LABELS);
  const primaryJobIntentionSalary = inferManual51jobSalary(primaryJobIntention);
  const summaryPrimaryLine = pickManual51jobPrimaryLine(summaryLines);
  const summarySegments = splitManual51jobSummarySegments(summaryPrimaryLine);
  const summarySalary = inferManual51jobSummarySalary(summaryLines);
  const summarySegmentSalary = summarySegments.find((segment) => MANUAL_51JOB_INLINE_SALARY_PATTERNS.some((pattern) => pattern.test(segment)));
  const jobIntention = primaryJobIntention
    || summarySegments.find((segment) => !MANUAL_51JOB_INLINE_SALARY_PATTERNS.some((pattern) => pattern.test(segment)));
  const expectedSalary = primaryExpectedSalary
    || primaryJobIntentionSalary
    || summarySegmentSalary
    || summarySalary;
  const experience = primaryExperience || inferManual51jobSummaryExperience(summaryLines);
  const education = getManual51jobFieldValueFromLines(lines, MANUAL_51JOB_EDUCATION_LABELS)
    || pickManual51jobEducation(profileEducation)
    || extractManual51jobQualification(summaryLines.join(" "));
  const selfIntro = cleanManual51jobRemainder(getManual51jobSectionText(sections, "selfIntro") || "");

  return {
    ...(name ? { name } : {}),
    ...(profileId ? { profileId } : {}),
    ...(location ? { location } : {}),
    ...(jobIntention ? { jobIntention } : {}),
    ...(expectedSalary ? { expectedSalary } : {}),
    ...(experience ? { experience } : {}),
    ...(education ? { education } : {}),
    ...(selfIntro ? { selfIntro } : {}),
    workHistory,
    ...(profileEducation ? { profileEducation } : {}),
    resumeSnippet: { text },
  };
}
