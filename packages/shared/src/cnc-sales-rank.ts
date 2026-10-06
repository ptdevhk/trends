import { selectLatestWorkHistory } from "./work-history-evidence.js";
import { isBareSalesDutyKeyword, parseKeywordQuery } from "./keyword-query.js";
import { normalizeSearchRoleFilterType } from "./analysis-key.js";

const CNC_QUERY_TOKENS = ["cnc", "数控", "机床"] as const;
const CNC_JOB_TOKENS = ["cnc", "数控", "机床", "加工中心"] as const;
const SALES_JOB_TOKENS = ["销售", "sales", "业务", "account"] as const;
const QA_JOB_TOKENS = ["qa", "qc", "品质", "质量", "quality", "检验"] as const;

// Service-engineer lane (engineer roleType + CNC-like query). Mirrors the sales
// ranker: reorder only, never drop rows.
const SERVICE_JOB_TOKENS = ["service", "服务", "售後", "售后", "維修", "维修", "客服", "บริการ"] as const;
const ENGINEER_JOB_TOKENS = ["engineer", "工程师", "technician", "技术员", "技師", "技师", "วิศวกร", "ช่าง"] as const;
const CNC_SERVICE_ENGINEER_PHRASES = [
  "service engineer",
  "service technician",
  "technical service",
  "工程师",
  "售後",
  "售后",
  "วิศวกรบริการ",
  "技术服务",
  "服務工程師",
  "服务工程师",
] as const;
const CNC_MACHINIST_TOKENS = ["machinist", "operator", "setter", "操作工", "操作员", "机加工", "車床", "车床"] as const;

function haystackFromCurrentJob(workHistory: unknown): string {
  const current = selectLatestWorkHistory(workHistory, { limit: 1 })[0];
  if (!current) {
    return "";
  }
  return [current.jobTitle, current.companyName, current.description, current.raw]
    .filter((part): part is string => typeof part === "string" && part.trim().length > 0)
    .join(" ")
    .toLowerCase();
}

function containsAny(haystack: string, tokens: readonly string[]): boolean {
  return tokens.some((token) => haystack.includes(token));
}

export function isCncLikeSalesSearch(
  query: string | undefined,
  roleFilterType?: string,
): boolean {
  const parsed = parseKeywordQuery(query ?? "");
  const salesRole = normalizeSearchRoleFilterType(roleFilterType) === "sales"
    || parsed.salesDuty === true
    || parsed.keywords.some((keyword) => isBareSalesDutyKeyword(keyword));
  if (!salesRole) {
    return false;
  }
  return parsed.keywords.some((token) =>
    CNC_QUERY_TOKENS.some((cncToken) => token.toLowerCase().includes(cncToken)),
  );
}

/**
 * Rank current CNC/机床 sales above historic-sales QA. Higher is better.
 * Does not drop rows — callers must keep 0-ranked results in the set.
 */
export function currentCncMachineSalesRank(workHistory: unknown): number {
  const haystack = haystackFromCurrentJob(workHistory);
  if (!haystack) {
    return 0;
  }
  const isSales = containsAny(haystack, SALES_JOB_TOKENS);
  const isCnc = containsAny(haystack, CNC_JOB_TOKENS);
  const isQa = containsAny(haystack, QA_JOB_TOKENS);
  if (isSales && isCnc) {
    return 2;
  }
  if (isSales && !isQa) {
    return 1;
  }
  return 0;
}

export function compareCurrentCncMachineSalesRank(leftWorkHistory: unknown, rightWorkHistory: unknown): number {
  return currentCncMachineSalesRank(rightWorkHistory) - currentCncMachineSalesRank(leftWorkHistory);
}

/**
 * True for an engineer-role search whose query is CNC-like and asks for a
 * service-engineer cohort (a service-engineer phrase, or both `service` and
 * `engineer` tokens). False for CN CNC sales queries so the sales ranker is
 * untouched.
 */
export function isCncLikeServiceEngineerSearch(
  query: string | undefined,
  roleFilterType?: string,
): boolean {
  if (normalizeSearchRoleFilterType(roleFilterType) !== "engineer") {
    return false;
  }
  const parsed = parseKeywordQuery(query ?? "");
  const lowered = parsed.keywords.map((keyword) => keyword.toLowerCase());
  const cncLike = lowered.some((token) =>
    CNC_QUERY_TOKENS.some((cncToken) => token.includes(cncToken)),
  );
  if (!cncLike) {
    return false;
  }
  const haystack = lowered.join(" ");
  const hasPhrase = CNC_SERVICE_ENGINEER_PHRASES.some((phrase) => haystack.includes(phrase));
  const hasService = lowered.some((token) => SERVICE_JOB_TOKENS.some((service) => token.includes(service)));
  const hasEngineer = lowered.some((token) => ENGINEER_JOB_TOKENS.some((engineer) => token.includes(engineer)));
  return hasPhrase || (hasService && hasEngineer);
}

/**
 * Rank current service-engineer work above CNC machinists and unrelated
 * white-collar roles. Higher is better. Does not drop rows — callers must keep
 * 0-ranked results in the set.
 */
export function currentCncServiceEngineerRank(workHistory: unknown): number {
  const haystack = haystackFromCurrentJob(workHistory);
  if (!haystack) {
    return 0;
  }
  const isService = containsAny(haystack, SERVICE_JOB_TOKENS);
  const isEngineer = containsAny(haystack, ENGINEER_JOB_TOKENS);
  const isCnc = containsAny(haystack, CNC_JOB_TOKENS);
  const isMachinist = containsAny(haystack, CNC_MACHINIST_TOKENS);
  if (isService && isEngineer && isCnc) {
    return 3;
  }
  if (isService && isEngineer) {
    return 2;
  }
  if (isCnc && isMachinist) {
    return 1;
  }
  return 0;
}

export function compareCurrentCncServiceEngineerRank(leftWorkHistory: unknown, rightWorkHistory: unknown): number {
  return currentCncServiceEngineerRank(rightWorkHistory) - currentCncServiceEngineerRank(leftWorkHistory);
}
