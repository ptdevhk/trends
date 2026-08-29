/**
 * Whole-picture registry of active resume score caps.
 * Formula code and the admin console both read this list.
 */
export type ScoreCapMarket = "CN";

export type ScoreCapComponentId = "related_exp" | "industry_db";

export type ScoreCapComponent = {
  id: ScoreCapComponentId;
  cap: number;
};

export type ScoreCapRule = {
  id: string;
  title: string;
  market: ScoreCapMarket;
  matchKeywords: readonly string[];
  excludeLabel: string;
  excludeKeywords: readonly string[];
  components: readonly ScoreCapComponent[];
  relatedExpCap: number;
  industryDbCap: number;
  reason: string;
  active: boolean;
};

export const CN_ADJACENT_PRODUCT_SCORE_CAP_RULE_ID = "cn_adjacent_product_score_cap_v1";
export const ADJACENT_PRODUCT_SCORE_CAP_RULE_ID = CN_ADJACENT_PRODUCT_SCORE_CAP_RULE_ID;
export const ADJACENT_PRODUCT_SCORE_CAP_ID = CN_ADJACENT_PRODUCT_SCORE_CAP_RULE_ID;

export const CN_ADJACENT_PRODUCT_SCORE_CAP_RULE: ScoreCapRule = {
  id: CN_ADJACENT_PRODUCT_SCORE_CAP_RULE_ID,
  title: "刀具/配件/电气/气动/注塑/齿轮机 must not score as 整机机床销售",
  market: "CN",
  matchKeywords: ["刀具", "配件", "电气", "气动", "注塑", "齿轮机"],
  excludeLabel: "整机数控机床销售",
  excludeKeywords: [
    "整机数控",
    "机床整机",
    "整机机床",
    "整机销售",
    "数控机床销售",
    "加工中心销售",
    "cnc机床销售",
    "整机机床销售",
    "整机数控机床销售",
  ],
  components: [
    { id: "related_exp", cap: 45 },
    { id: "industry_db", cap: 20 },
  ],
  relatedExpCap: 45,
  industryDbCap: 20,
  reason: CN_ADJACENT_PRODUCT_SCORE_CAP_RULE_ID,
  active: true,
};

export const SCORE_CAP_RULES: readonly ScoreCapRule[] = [
  CN_ADJACENT_PRODUCT_SCORE_CAP_RULE,
];

export function listActiveScoreCapRules(): ScoreCapRule[] {
  return SCORE_CAP_RULES.filter((rule) => rule.active);
}

export function getScoreCapRuleById(id: string): ScoreCapRule | undefined {
  return SCORE_CAP_RULES.find((rule) => rule.id === id);
}

export function getScoreCapRule(id: string): ScoreCapRule | undefined {
  return getScoreCapRuleById(id);
}

export function getScoreCapComponentCap(
  rule: ScoreCapRule,
  componentId: ScoreCapComponentId,
): number | undefined {
  if (componentId === "related_exp") return rule.relatedExpCap;
  if (componentId === "industry_db") return rule.industryDbCap;
  return rule.components.find((component) => component.id === componentId)?.cap;
}
