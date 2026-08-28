/**
 * Keyword/category cap for adjacent-product CN sales work.
 *
 * Caps related_exp / industry_db when the candidate sold 刀具 / 配件 / 电气 /
 * 气动 / 注塑 / 齿轮机 rather than 整机数控机床销售. This is a lower-only
 * component cap, not a hard reject and not a company-DB ingest.
 *
 * Filters (不考虑 / 薪资 / 地区无需求 / 电话微信) and gender stay out of the
 * numeric score.
 */

export const ADJACENT_PRODUCT_RELATED_EXP_CAP = 45;
export const ADJACENT_PRODUCT_INDUSTRY_DB_CAP = 20;
export const ADJACENT_PRODUCT_SCORE_CAP_REASON = "cn_adjacent_product_score_cap_v1";

const ADJACENT_PRODUCT_KEYWORDS = [
  "刀具",
  "配件",
  "电气",
  "气动",
  "注塑",
  "齿轮机",
] as const;

const WHOLE_MACHINE_CNC_SALES_KEYWORDS = [
  "整机数控",
  "机床整机",
  "整机机床",
  "整机销售",
  "数控机床销售",
  "加工中心销售",
  "cnc机床销售",
] as const;

export type AdjacentProductCapInput = {
  relatedExp: number;
  industryDb: number;
  evidenceText?: string | null;
  market?: string | null;
};

export type AdjacentProductCapResult = {
  relatedExp: number;
  industryDb: number;
  applied: boolean;
  reason?: string;
};

function normalizeEvidenceText(value: string | null | undefined): string {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

function normalizeMarket(market: string | null | undefined): string {
  return typeof market === "string" ? market.trim().toUpperCase() : "";
}

function hasAnyKeyword(text: string, keywords: readonly string[]): boolean {
  return keywords.some((keyword) => text.includes(keyword.toLowerCase()));
}

/**
 * True when work text is adjacent-product (tools/parts/electrical/pneumatic/
 * injection-molding/gear machines) and is not 整机数控机床销售.
 */
export function isAdjacentProductWork(evidenceText: string | null | undefined): boolean {
  const text = normalizeEvidenceText(evidenceText);
  if (!text) {
    return false;
  }
  if (!hasAnyKeyword(text, ADJACENT_PRODUCT_KEYWORDS)) {
    return false;
  }
  return !hasAnyKeyword(text, WHOLE_MACHINE_CNC_SALES_KEYWORDS);
}

export function collectAdjacentProductEvidenceText(
  parts: ReadonlyArray<string | null | undefined>,
): string {
  return parts
    .filter((part): part is string => typeof part === "string" && part.trim().length > 0)
    .join(" ");
}

/**
 * Lower-only cap on the two score components. MY/TH markets are left unchanged.
 */
export function applyAdjacentProductScoreCap(
  input: AdjacentProductCapInput,
): AdjacentProductCapResult {
  const market = normalizeMarket(input.market);
  if (market === "MY" || market === "TH") {
    return {
      relatedExp: input.relatedExp,
      industryDb: input.industryDb,
      applied: false,
    };
  }

  if (!isAdjacentProductWork(input.evidenceText)) {
    return {
      relatedExp: input.relatedExp,
      industryDb: input.industryDb,
      applied: false,
    };
  }

  const relatedExp = Math.min(input.relatedExp, ADJACENT_PRODUCT_RELATED_EXP_CAP);
  const industryDb = Math.min(input.industryDb, ADJACENT_PRODUCT_INDUSTRY_DB_CAP);
  return {
    relatedExp,
    industryDb,
    applied: relatedExp !== input.relatedExp || industryDb !== input.industryDb,
    reason: ADJACENT_PRODUCT_SCORE_CAP_REASON,
  };
}
