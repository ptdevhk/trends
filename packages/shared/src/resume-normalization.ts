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

type Manual51jobSectionKey = "workHistory" | "education" | "selfIntro";

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

const MANUAL_51JOB_NAME_LABELS = ["姓名", "名称"] as const;
const MANUAL_51JOB_PROFILE_ID_LABELS = ["人才ID", "简历编号", "ID"] as const;
const MANUAL_51JOB_LOCATION_LABELS = ["区域", "现居住地", "现居住", "所在地", "所在地区"] as const;
const MANUAL_51JOB_JOB_INTENTION_LABELS = ["应聘方向", "应聘职位", "期望职位", "意向职位"] as const;
const MANUAL_51JOB_PREFERRED_JOB_INTENTION_LABELS = ["求职意向"] as const;
const MANUAL_51JOB_SALARY_LABELS = ["期望薪资", "薪资要求", "期望工资", "期望月薪", "期望年薪"] as const;
const MANUAL_51JOB_EXPERIENCE_LABELS = ["工作经验", "工作年限", "从业年限", "经验"] as const;
const MANUAL_51JOB_EDUCATION_LABELS = ["最高学历学位", "最高学历", "学历"] as const;
const MANUAL_51JOB_WORK_DESCRIPTION_LABELS = ["工作描述", "职责描述", "工作职责", "主要职责", "工作内容"] as const;
const MANUAL_51JOB_WORK_COMPANY_LABELS = ["公司", "单位", "企业"] as const;
const MANUAL_51JOB_WORK_JOB_TITLE_LABELS = ["职位", "岗位", "职务"] as const;
const MANUAL_51JOB_EDUCATION_INSTITUTION_LABELS = ["学校", "院校"] as const;
const MANUAL_51JOB_EDUCATION_FIELD_LABELS = ["专业", "主修", "专业名称"] as const;
const MANUAL_51JOB_EDUCATION_DESCRIPTION_LABELS = ["专业描述", "在校经历", "学习描述"] as const;
const MANUAL_51JOB_EDUCATION_QUALIFICATION_LABELS = ["学历", "学位"] as const;
const MANUAL_51JOB_SECTION_LABELS: Array<{ key: Manual51jobSectionKey; labels: readonly string[] }> = [
  { key: "workHistory", labels: ["工作经历", "工作经验"] },
  { key: "education", labels: ["教育经历", "教育背景"] },
  { key: "selfIntro", labels: ["个人优势", "自我介绍", "自我评价", "个人简介"] },
];
const MANUAL_51JOB_SECTION_HEADER_SET = new Set(
  MANUAL_51JOB_SECTION_LABELS.flatMap((entry) => entry.labels)
);
const MANUAL_51JOB_COMPANY_PATTERN = /([\u4e00-\u9fa5A-Za-z0-9()（）·.&\-]{2,80}(?:公司|集团|科技|机械|设备|自动化|股份|有限|中心|厂|银行|医院|研究院))/u;
const MANUAL_51JOB_INSTITUTION_PATTERN = /([\u4e00-\u9fa5A-Za-z0-9()（）·.&\-]{2,80}(?:大学|学院|学校|中学|技校|职业技术学院|技术学院|中专))/u;
const MANUAL_51JOB_QUALIFICATION_PATTERN = /(博士研究生|博士|硕士研究生|硕士|研究生|本科|大专|专科|中专|中技|高中)/u;
const MANUAL_51JOB_DATE_RANGE_PATTERN = /(\d{4}(?:[-./年]\d{1,2})?)(?:\s*(?:[~～\-–—]|至|到)+\s*)(至今|目前|今|\d{4}(?:[-./年]\d{1,2})?)/u;
const MANUAL_51JOB_TIMELINE_START_PATTERN = /^\s*\d{4}(?:[-./年]\d{1,2})?(?:\s*(?:[~～\-–—]|至|到)+\s*)(?:至今|目前|今|\d{4}(?:[-./年]\d{1,2})?)/u;
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

function splitManual51jobLines(text: string): string[] {
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
    const sectionHeader = resolveManual51jobSectionHeader(lines[index] || "");
    if (sectionHeader?.key === key) {
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

  const blocks: string[] = [];
  let current: string[] = [];

  for (const rawLine of normalized.split("\n")) {
    const line = normalizeManual51jobLine(rawLine);
    if (!line) {
      continue;
    }
    if (isManual51jobTerminalSectionHeader(line)) {
      break;
    }

    if (MANUAL_51JOB_TIMELINE_START_PATTERN.test(line) && current.length > 0) {
      const currentHasTimeline = current.some((entry) => MANUAL_51JOB_TIMELINE_START_PATTERN.test(entry));
      if (currentHasTimeline) {
        blocks.push(current.join("\n"));
        current = [line];
        continue;
      }
    }

    current.push(line);
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

function getManual51jobDescriptionLines(
  lines: string[],
  companyName?: string,
  jobTitle?: string,
): string[] {
  const descriptionLines: string[] = [];

  for (let index = 1; index < lines.length; index += 1) {
    const line = normalizeManual51jobLine(lines[index] || "");
    if (!line) {
      continue;
    }

    const labeledDescription = getManual51jobLabeledLineValue(line, MANUAL_51JOB_WORK_DESCRIPTION_LABELS);
    if (labeledDescription !== undefined) {
      if (labeledDescription) {
        descriptionLines.push(labeledDescription);
      }
      continue;
    }

    if (
      getManual51jobLabeledLineValue(line, MANUAL_51JOB_WORK_COMPANY_LABELS) !== undefined
      || getManual51jobLabeledLineValue(line, MANUAL_51JOB_WORK_JOB_TITLE_LABELS) !== undefined
      || MANUAL_51JOB_TIMELINE_START_PATTERN.test(line)
    ) {
      continue;
    }

    if (MANUAL_51JOB_SECTION_HEADER_SET.has(line)) {
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
  return normalized || undefined;
}

function parseManual51jobWorkHistoryBlock(block: string): ResumeWorkHistoryItem | null {
  const lines = block
    .split("\n")
    .map((line) => normalizeManual51jobLine(line))
    .filter(Boolean);
  if (lines.length === 0) {
    return null;
  }

  const raw = lines.join("\n");
  const headerLine = lines[0] || "";
  const dateLineIndex = lines.findIndex((line) => MANUAL_51JOB_TIMELINE_START_PATTERN.test(line));
  const dateRange = extractManual51jobDateRange(resolveManual51jobPrimaryDateLine(lines, headerLine) || raw);
  const companyFromLabel = lines
    .map((line) => getManual51jobLabeledLineValue(line, MANUAL_51JOB_WORK_COMPANY_LABELS))
    .find((value): value is string => Boolean(value));
  const jobTitleFromLabel = lines
    .map((line) => getManual51jobLabeledLineValue(line, MANUAL_51JOB_WORK_JOB_TITLE_LABELS))
    .find((value): value is string => Boolean(value));

  const companyCandidateLines: string[] = [];
  let companyCandidate: string | undefined;
  let companyLineForCandidate: string | undefined;
  let roleLineCandidate: string | undefined;

  for (const [index, line] of lines.entries()) {
    if (index === dateLineIndex) {
      continue;
    }
    if (getManual51jobLabeledLineValue(line, MANUAL_51JOB_WORK_COMPANY_LABELS) !== undefined) {
      continue;
    }
    if (getManual51jobLabeledLineValue(line, MANUAL_51JOB_WORK_JOB_TITLE_LABELS) !== undefined) {
      continue;
    }
    if (getManual51jobLabeledLineValue(line, MANUAL_51JOB_WORK_DESCRIPTION_LABELS) !== undefined) {
      continue;
    }
    if (MANUAL_51JOB_SECTION_HEADER_SET.has(line) || isManual51jobTerminalSectionHeader(line)) {
      continue;
    }

    companyCandidateLines.push(line);

    if (!companyCandidate) {
      const extractedCompany = extractManual51jobCompany(line);
      if (extractedCompany && !/[中心]$/.test(extractedCompany)) {
        companyCandidate = extractedCompany;
        companyLineForCandidate = line;
      }
    }

    if (!roleLineCandidate && line !== headerLine && !extractManual51jobCompany(line) && !MANUAL_51JOB_TIMELINE_START_PATTERN.test(line) && !/[｜|丨]/.test(line)) {
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

  const companyName = companyFromLabel || companyCandidate || extractManual51jobCompany(titleLine);
  const jobTitle = jobTitleFromLabel || (() => {
    if (companyName && companyLineForCandidate?.includes(companyName)) {
      const remainder = cleanManual51jobRemainder(companyLineForCandidate.replace(companyName, " "));
      if (remainder && remainder.length <= 40) {
        return remainder;
      }
    }

    if (roleLineCandidate && roleLineCandidate.length <= 40) {
      return roleLineCandidate;
    }

    if (!companyName) {
      return undefined;
    }
    const remainder = cleanManual51jobRemainder(titleLine.replace(companyName, " "));
    if (!remainder || remainder.length > 40) {
      return undefined;
    }
    return remainder;
  })();
  const description = cleanManual51jobRemainder(getManual51jobDescriptionLines(lines, companyName, jobTitle).join("\n"));

  if (!raw && !companyName && !jobTitle && !description && !dateRange.startDate && !dateRange.endDate) {
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

function getManual51jobWorkHistory(text: string | undefined): ResumeWorkHistoryItem[] {
  if (!text) {
    return [];
  }

  return mergeManual51jobLeadingIdentityBlocks(splitManual51jobBlocks(text), extractManual51jobCompany)
    .map((block) => parseManual51jobWorkHistoryBlock(block))
    .filter((entry): entry is ResumeWorkHistoryItem => entry !== null);
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
  const workHistory = getManual51jobWorkHistory(getManual51jobSectionText(sections, "workHistory"));
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
