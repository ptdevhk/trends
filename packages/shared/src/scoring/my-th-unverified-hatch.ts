import { FALLBACK_INDUSTRY_KEYWORDS } from "../job-description-content.js";

/**
 * MY/TH unverified-employer hatch: treat a direct sales or engineer role as
 * partial related-exp coverage when the company/title is machine-tool/CNC
 * relevant even though industry-DB years are zero.
 *
 * Production machinist/operator titles and cross-industry employers
 * (insurance, retail, medical, oil & gas, HVAC) stay on coverage `none`.
 */

const MACHINERY_HATCH_KEYWORDS = [
  ...FALLBACK_INDUSTRY_KEYWORDS.machinery.map((keyword) => keyword.toLowerCase()),
  "machine tool",
  "machine tools",
  "machines tools",
  "machining",
  "fanuc",
  "mazak",
  "yamazaki",
  "yamazen",
  "amada",
  "haas",
  "makino",
  "syntec",
  "tongtai",
  "jingdiao",
  "okuma",
  "dmg mori",
  "lathe",
  "milling",
  "wire cut",
  "wire-cut",
  "edm",
  "machines",
  "technics",
  "tools & engineering",
  "tools and engineering",
];

const SERVICE_ENGINEER_TITLE_KEYWORDS = [
  "service engineer",
  "services engineer",
  "field service",
  "application engineer",
  "service manager",
  "technical team",
  "sales & service",
  "sales and service",
];

const CUSTOMER_SERVICE_TITLE_KEYWORDS = [
  "customer service",
  "customer-service",
];

const DOMAIN_IRRELEVANT_KEYWORDS = [
  "保险", "人寿", "金融", "投资", "证券", "银行", "理财",
  "房地产", "地产", "置业", "房产",
  "教育", "培训", "学校",
  "医疗", "医院", "医药",
  "insurance", "assurance", "takaful",
  "finance", "financial", "investment", "bank",
  "real estate", "property",
  "7-eleven", "7 eleven", "seven eleven",
  "retail", "stationery", "lost and found",
  "oil & gas", "oil and gas", "wellhead", "offshore",
  "hvac", "water treatment",
  "petro", "technip",
  "medical",
  "customer service",
];

const MACHINIST_TITLE_KEYWORDS = [
  "machinist",
  "operator",
  "setter",
  "操作工",
  "操作员",
  "机加工",
  "cnc programmer",
];

export function isDomainIrrelevantHatchText(text: string): boolean {
  const haystack = text.toLowerCase();
  return DOMAIN_IRRELEVANT_KEYWORDS.some((keyword) => haystack.includes(keyword));
}

export function hasMachineryHatchText(text: string): boolean {
  const haystack = text.toLowerCase();
  return MACHINERY_HATCH_KEYWORDS.some((keyword) => haystack.includes(keyword));
}

export function isProductionMachinistTitle(title: string | undefined): boolean {
  const haystack = (title ?? "").toLowerCase();
  if (!haystack.trim()) {
    return false;
  }
  return MACHINIST_TITLE_KEYWORDS.some((keyword) => haystack.includes(keyword));
}

export function isCustomerServiceTitle(title: string | undefined): boolean {
  const haystack = (title ?? "").toLowerCase();
  if (!haystack.trim()) {
    return false;
  }
  return CUSTOMER_SERVICE_TITLE_KEYWORDS.some((keyword) => haystack.includes(keyword));
}

export function isServiceEngineerLikeTitle(title: string | undefined): boolean {
  const haystack = (title ?? "").toLowerCase();
  if (!haystack.trim()) {
    return false;
  }
  if (isCustomerServiceTitle(haystack)) {
    return false;
  }
  return SERVICE_ENGINEER_TITLE_KEYWORDS.some((keyword) => haystack.includes(keyword));
}

export function buildHatchEntryText(entry: {
  companyName?: string;
  jobTitle?: string;
  matchedSignals?: string[];
}): string {
  const parts = [
    entry.companyName,
    entry.jobTitle,
    ...(Array.isArray(entry.matchedSignals) ? entry.matchedSignals : []),
  ];
  return parts
    .filter((part): part is string => typeof part === "string" && part.trim().length > 0)
    .join(" ")
    .toLowerCase();
}

/**
 * True when this work entry should lift an unverified MY/TH resume from
 * related-exp coverage `none` to `partial`.
 */
export function isMyThDomainRelevantUnverifiedEntry(entry: {
  directRoleMatch?: boolean;
  companyName?: string;
  jobTitle?: string;
  matchedSignals?: string[];
  extraText?: string;
}): boolean {
  if (entry.directRoleMatch !== true) {
    return false;
  }
  if (isProductionMachinistTitle(entry.jobTitle)) {
    return false;
  }
  if (isCustomerServiceTitle(entry.jobTitle)) {
    return false;
  }
  const text = buildHatchEntryText(entry);
  const extra = typeof entry.extraText === "string" ? entry.extraText : "";
  if (isDomainIrrelevantHatchText(text)) {
    return false;
  }
  if (hasMachineryHatchText(text)) {
    return true;
  }
  // Whole-resume evidence may mention CNC from an unrelated job. Only use it
  // to hatch titles that already look like field service / service manager.
  return isServiceEngineerLikeTitle(entry.jobTitle) && hasMachineryHatchText(extra);
}
