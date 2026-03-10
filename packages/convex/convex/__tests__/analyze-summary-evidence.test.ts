import { describe, expect, it } from "vitest";

import { USER_PROMPT_TEMPLATE, normalizeResume } from "../analyze";

describe("analyze summary evidence lane", () => {
  it("reads persisted root-level ingestData evidence from a resume doc", () => {
    const normalized = normalizeResume({
      content: {
        name: "\u6768\u5148\u751F",
        education: "\u5927\u4E13",
        experience: "21\u5E74",
        workHistory: [
          { raw: "2023-02~\u81F3\u4ECA \u6C5F\u95E8\u5E02\u4E1C\u68EE\u6728\u4E1A\u6709\u9650\u516C\u53F8 \u4E1A\u52A1\u5458" },
          { raw: "2015-04~2022-12 \u65B0\u5174\u53BF\u767E\u5229\u4E30\u4E0D\u9508\u94A2\u5236\u54C1\u6709\u9650\u516C\u53F8\u4E1C\u839E\u5206\u5382 CNC\u7F16\u7A0B\u7EC4\u957F" },
        ],
      },
      ingestData: {
        evidenceText:
          "2023-02~\u81F3\u4ECA \u6C5F\u95E8\u5E02\u4E1C\u68EE\u6728\u4E1A\u6709\u9650\u516C\u53F8 \u4E1A\u52A1\u5458\n2015-04~2022-12 \u65B0\u5174\u53BF\u767E\u5229\u4E30\u4E0D\u9508\u94A2\u5236\u54C1\u6709\u9650\u516C\u53F8\u4E1C\u839E\u5206\u5382 cnc\u7F16\u7A0B\u7EC4\u957F",
      },
    } as unknown);

    expect(normalized.name).toBe("\u6768\u5148\u751F");
    expect(normalized.evidenceText).toContain("\u4E1A\u52A1\u5458");
    expect(normalized.evidenceText).toContain("cnc\u7F16\u7A0B\u7EC4\u957F");
    expect(normalized.evidenceText).not.toBe("\u672A\u586B\u5199");
    expect(normalized.verifiedCompanies).toEqual([]);
  });

  it("still falls back to content-level ingestData for direct content payloads", () => {
    const normalized = normalizeResume({
      name: "\u6B66\u5148\u751F",
      education: "\u5927\u4E13",
      workHistory: [{ raw: "2022-11~\u81F3\u4ECA \u91D1\u7EF4\u8C0A \u9500\u552E\u4EE3\u8868" }],
      ingestData: {
        evidenceText: "2022-11~\u81F3\u4ECA \u91D1\u7EF4\u8C0A \u9500\u552E\u4EE3\u8868",
      },
    } as unknown);

    expect(normalized.evidenceText).toBe("2022-11~\u81F3\u4ECA \u91D1\u7EF4\u8C0A \u9500\u552E\u4EE3\u8868");
    expect(normalized.verifiedCompanies).toEqual([]);
  });

  it("keeps the active prompt focused on work-history evidence", () => {
    expect(USER_PROMPT_TEMPLATE).toContain("\u5DE5\u4F5C\u7ECF\u5386\u8BC1\u636E");
    expect(USER_PROMPT_TEMPLATE).toContain("\u5C97\u4F4D\u89D2\u8272\u3001\u884C\u4E1A\u80CC\u666F");
    expect(USER_PROMPT_TEMPLATE).toContain("\u4E0D\u8981\u5199\u201C\u672A\u63D0\u4F9B\u5177\u4F53\u5DE5\u4F5C\u7ECF\u5386\u201D");
  });

  it("returns empty verifiedCompanies when companyHits is absent", () => {
    const normalized = normalizeResume({
      content: {
        name: "\u5E9E\u5148\u751F",
        education: "\u4E2D\u4E13",
        experience: "11\u5E74",
        workHistory: [{ raw: "2018-2024 \u6842\u6797\u798F\u8FBE\u96C6\u56E2 CNC\u64CD\u4F5C\u5458" }],
      },
      ingestData: {
        evidenceText: "2018-2024 \u6842\u6797\u798F\u8FBE\u96C6\u56E2 CNC\u64CD\u4F5C\u5458",
      },
    } as unknown);

    expect(normalized.verifiedCompanies).toEqual([]);
  });

  it("returns populated verifiedCompanies when companyHits present", () => {
    const normalized = normalizeResume({
      content: {
        name: "\u5F20\u5148\u751F",
        education: "\u672C\u79D1",
        experience: "8\u5E74",
        workHistory: [{ raw: "2020-2024 \u5927\u8FDE\u673A\u5E8A\u96C6\u56E2 \u9500\u552E\u7ECF\u7406" }],
      },
      ingestData: {
        evidenceText: "2020-2024 \u5927\u8FDE\u673A\u5E8A\u96C6\u56E2 \u9500\u552E\u7ECF\u7406",
        companyHits: ["\u5927\u8FDE\u673A\u5E8A\u96C6\u56E2", "\u6C88\u9633\u673A\u5E8A"],
      },
    } as unknown);

    expect(normalized.verifiedCompanies).toEqual(["\u5927\u8FDE\u673A\u5E8A\u96C6\u56E2", "\u6C88\u9633\u673A\u5E8A"]);
  });

  it("filters non-string and empty entries from companyHits", () => {
    const normalized = normalizeResume({
      content: { name: "\u6D4B\u8BD5" },
      ingestData: {
        companyHits: ["\u5927\u8FDE\u673A\u5E8A", "", null, 123, "\u6C88\u9633\u673A\u5E8A"],
      },
    } as unknown);

    expect(normalized.verifiedCompanies).toEqual(["\u5927\u8FDE\u673A\u5E8A", "\u6C88\u9633\u673A\u5E8A"]);
  });

  it("prompt template contains {verifiedCompanies} and industry_db rule", () => {
    expect(USER_PROMPT_TEMPLATE).toContain("{verifiedCompanies}");
    expect(USER_PROMPT_TEMPLATE).toContain("industry_db");
    expect(USER_PROMPT_TEMPLATE).toContain("\u884C\u4E1A\u6570\u636E\u5E93\u9A8C\u8BC1\u516C\u53F8");
  });
});
