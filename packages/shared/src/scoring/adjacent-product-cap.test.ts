/**
 * Adjacent-product score cap: keyword/category cap on related_exp / industry_db.
 *
 * Fixtures use invented anonymized work history. No candidate names or resume IDs.
 */
import { describe, expect, it } from "vitest";
import {
  ADJACENT_PRODUCT_INDUSTRY_DB_CAP,
  ADJACENT_PRODUCT_RELATED_EXP_CAP,
  ADJACENT_PRODUCT_SCORE_CAP_REASON,
  applyAdjacentProductScoreCap,
  collectAdjacentProductEvidenceText,
  isAdjacentProductWork,
} from "./adjacent-product-cap.js";
import { computeFinalAiScore } from "./resume-score-semantics.js";

const OVERSCORE_RELATED_EXP = 60;
const OVERSCORE_INDUSTRY_DB = 40;
const OVERSCORE_BAND_MIN = 60;

describe("isAdjacentProductWork", () => {
  it.each([
    { label: "injection-molding machine sales", text: "负责华南注塑机销售与客户开发" },
    { label: "gear-machine sales", text: "齿轮机区域销售，跟进经销商订单" },
    { label: "cutting-tool sales", text: "数控刀具选型与销售，不是整机" },
    { label: "parts / electrical / pneumatic", text: "机床配件、电气柜与气动元件销售" },
    { label: "cnc machine-tool parts (not complete-machine sales)", text: "数控机床配件销售与选型支持" },
  ])("detects $label as adjacent", ({ text }) => {
    expect(isAdjacentProductWork(text)).toBe(true);
  });

  it("does not treat 整机数控机床销售 as adjacent", () => {
    expect(isAdjacentProductWork("负责进口数控机床整机销售与加工中心客户开发")).toBe(false);
  });

  it("lets whole-machine CNC sales win when mixed with tooling mentions", () => {
    expect(
      isAdjacentProductWork("数控机床整机销售，售后可提供刀具选型建议"),
    ).toBe(false);
  });

  it("ignores filter/gender wording with no product evidence", () => {
    expect(isAdjacentProductWork("不考虑加班，期望薪资面议，地区无需求，电话微信同号，女性")).toBe(false);
  });
});

describe("applyAdjacentProductScoreCap", () => {
  it("caps adjacent product so the combined score leaves the whole-machine overscore band", () => {
    const uncapped = computeFinalAiScore(OVERSCORE_RELATED_EXP, OVERSCORE_INDUSTRY_DB);
    expect(uncapped).toBeGreaterThanOrEqual(OVERSCORE_BAND_MIN);

    const result = applyAdjacentProductScoreCap({
      relatedExp: OVERSCORE_RELATED_EXP,
      industryDb: OVERSCORE_INDUSTRY_DB,
      evidenceText: "注塑机销售工程师，负责华东区域经销商",
      market: "CN",
    });

    expect(result.applied).toBe(true);
    expect(result.reason).toBe(ADJACENT_PRODUCT_SCORE_CAP_REASON);
    expect(result.relatedExp).toBeLessThanOrEqual(ADJACENT_PRODUCT_RELATED_EXP_CAP);
    expect(result.industryDb).toBeLessThanOrEqual(ADJACENT_PRODUCT_INDUSTRY_DB_CAP);
    expect(computeFinalAiScore(result.relatedExp, result.industryDb)).toBeLessThan(OVERSCORE_BAND_MIN);
  });

  it("does not cap a real 整机数控机床销售 profile", () => {
    const result = applyAdjacentProductScoreCap({
      relatedExp: 80,
      industryDb: 50,
      evidenceText: "数控机床整机销售，加工中心华南大客户开发",
      market: "CN",
    });
    expect(result.applied).toBe(false);
    expect(result.relatedExp).toBe(80);
    expect(result.industryDb).toBe(50);
  });

  it("does not let pay / location / 不考虑 / wechat-phone change the numeric components", () => {
    const work = "齿轮机销售，覆盖华东经销渠道";
    const withFilters = `${work}。不考虑出差，期望薪资25k，地区无需求，电话微信同号`;
    const base = applyAdjacentProductScoreCap({
      relatedExp: OVERSCORE_RELATED_EXP,
      industryDb: OVERSCORE_INDUSTRY_DB,
      evidenceText: work,
      market: "CN",
    });
    const filtered = applyAdjacentProductScoreCap({
      relatedExp: OVERSCORE_RELATED_EXP,
      industryDb: OVERSCORE_INDUSTRY_DB,
      evidenceText: withFilters,
      market: "CN",
    });
    expect(filtered.relatedExp).toBe(base.relatedExp);
    expect(filtered.industryDb).toBe(base.industryDb);
  });

  it("does not add a 女性 scoring feature", () => {
    const work = "电气配件销售";
    const withGender = `${work}，女性，已婚`;
    const base = applyAdjacentProductScoreCap({
      relatedExp: OVERSCORE_RELATED_EXP,
      industryDb: OVERSCORE_INDUSTRY_DB,
      evidenceText: work,
      market: "CN",
    });
    const gendered = applyAdjacentProductScoreCap({
      relatedExp: OVERSCORE_RELATED_EXP,
      industryDb: OVERSCORE_INDUSTRY_DB,
      evidenceText: withGender,
      market: "CN",
    });
    expect(gendered.relatedExp).toBe(base.relatedExp);
    expect(gendered.industryDb).toBe(base.industryDb);
  });

  it("leaves MY/TH markets unchanged", () => {
    const myResult = applyAdjacentProductScoreCap({
      relatedExp: 80,
      industryDb: 50,
      evidenceText: "注塑机销售",
      market: "MY",
    });
    expect(myResult.applied).toBe(false);
    expect(myResult.relatedExp).toBe(80);
    expect(myResult.industryDb).toBe(50);
  });
});

describe("collectAdjacentProductEvidenceText", () => {
  it("joins non-empty parts and skips blanks", () => {
    expect(collectAdjacentProductEvidenceText(["注塑机销售", "  ", undefined, "华东"])).toBe(
      "注塑机销售 华东",
    );
  });
});
