import { selectLatestWorkHistory } from "./work-history-evidence.js";
import { isBareSalesDutyKeyword, parseKeywordQuery } from "./keyword-query.js";
import { normalizeSearchRoleFilterType } from "./analysis-key.js";

const CNC_QUERY_TOKENS = ["cnc", "数控", "机床"] as const;
const CNC_JOB_TOKENS = ["cnc", "数控", "机床", "加工中心"] as const;
const SALES_JOB_TOKENS = ["销售", "sales", "业务", "account"] as const;
const QA_JOB_TOKENS = ["qa", "qc", "品质", "质量", "quality", "检验"] as const;

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
