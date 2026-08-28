import { describe, expect, it } from "vitest";
import {
  ADJACENT_PRODUCT_SCORE_CAP_RULE_ID,
  CN_ADJACENT_PRODUCT_SCORE_CAP_RULE,
  SCORE_CAP_RULES,
  getScoreCapRule,
  listActiveScoreCapRules,
} from "./score-cap-rules.js";

describe("SCORE_CAP_RULES", () => {
  it("includes the CN adjacent-product cap as the first active rule", () => {
    const rule = getScoreCapRule(ADJACENT_PRODUCT_SCORE_CAP_RULE_ID);
    expect(rule).toBeDefined();
    expect(SCORE_CAP_RULES[0]).toEqual(CN_ADJACENT_PRODUCT_SCORE_CAP_RULE);
    expect(rule).toMatchObject({
      id: ADJACENT_PRODUCT_SCORE_CAP_RULE_ID,
      market: "CN",
      relatedExpCap: 45,
      industryDbCap: 20,
      reason: ADJACENT_PRODUCT_SCORE_CAP_RULE_ID,
      active: true,
    });
    expect(rule?.matchKeywords).toEqual(["刀具", "配件", "电气", "气动", "注塑", "齿轮机"]);
    expect(rule?.title).toContain("刀具/配件/电气/气动/注塑/齿轮机");
    expect(rule?.title).toContain("整机机床销售");
    expect(rule?.excludeLabel).toMatch(/整机(数控)?机床销售/);
    expect(rule?.excludeKeywords).toContain("整机机床销售");
    expect(rule?.excludeKeywords).toContain("整机数控机床销售");
  });

  it("exposes the same rule through listActiveScoreCapRules", () => {
    const active = listActiveScoreCapRules();
    expect(active).toContainEqual(CN_ADJACENT_PRODUCT_SCORE_CAP_RULE);
    expect(active.every((rule) => rule.active)).toBe(true);
    expect(active[0]?.matchKeywords.join("/")).toBe("刀具/配件/电气/气动/注塑/齿轮机");
  });
});
