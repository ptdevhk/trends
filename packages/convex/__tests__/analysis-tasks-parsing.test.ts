import { describe, expect, it } from "vitest";

// These functions are not exported, so we test them indirectly
// by importing the module and using internal behavior.
// For now, test the exported normalizeKeywords and extractKeywords
// by verifying their behavior through the idempotency key construction.

import {
  buildAnalysisDispatchIdempotencyKey,
  buildRelatedExpCtxArg,
  classifyResumes,
} from "../convex/analysis_tasks";

// We'll also directly test normalizeKeywords and extractKeywords
// by duplicating their logic in tests (since they're simple pure functions)
// and verifying the expected behavior matches what the idempotency key depends on.

describe("normalizeKeywords behavior (via idempotency key)", () => {
  it("treats case-insensitive keywords as equivalent", () => {
    const keyA = buildAnalysisDispatchIdempotencyKey({
      keywords: ["CNC", "Sales"],
      resumeIds: ["resume:1"],
    });
    const keyB = buildAnalysisDispatchIdempotencyKey({
      keywords: ["cnc", "sales"],
      resumeIds: ["resume:1"],
    });
    // normalizeKeywords lowercases and deduplicates — should produce same key
    expect(keyA).toBe(keyB);
  });

  it("deduplicates repeated keywords", () => {
    const keyA = buildAnalysisDispatchIdempotencyKey({
      keywords: ["cnc", "cnc", "sales"],
      resumeIds: ["resume:1"],
    });
    const keyB = buildAnalysisDispatchIdempotencyKey({
      keywords: ["cnc", "sales"],
      resumeIds: ["resume:1"],
    });
    expect(keyA).toBe(keyB);
  });

  it("trims whitespace from keywords", () => {
    const keyA = buildAnalysisDispatchIdempotencyKey({
      keywords: [" cnc ", " sales "],
      resumeIds: ["resume:1"],
    });
    const keyB = buildAnalysisDispatchIdempotencyKey({
      keywords: ["cnc", "sales"],
      resumeIds: ["resume:1"],
    });
    expect(keyA).toBe(keyB);
  });

  it("filters empty keywords after trim", () => {
    const keyA = buildAnalysisDispatchIdempotencyKey({
      keywords: ["cnc", "", " ", "sales"],
      resumeIds: ["resume:1"],
    });
    const keyB = buildAnalysisDispatchIdempotencyKey({
      keywords: ["cnc", "sales"],
      resumeIds: ["resume:1"],
    });
    expect(keyA).toBe(keyB);
  });
});

describe("buildRelatedExpCtxArg", () => {
  it("returns undefined when a task has no related_exp context", () => {
    const result = buildRelatedExpCtxArg(
      { ingestData: { roleSignals: [] } },
      {},
    );

    expect(result).toBeUndefined();
  });

  it("extracts direct role match and industry-verified years from matching role signals", () => {
    const result = buildRelatedExpCtxArg(
      {
        ingestData: {
          roleSignals: [
            {
              type: "technical",
              matchedSignals: ["engineer"],
              signalCount: 1,
              occurrences: 1,
              years: 4,
              industryVerifiedRelevantYears: 4,
              matchedWorkEntries: [
                {
                  companyName: "CNC Automation Ltd",
                  jobTitle: "Service Engineer",
                  years: 4,
                  industryVerified: true,
                  matchedSignals: ["engineer"],
                  directRoleMatch: true,
                },
              ],
              verifyIn: "workHistory",
            },
            {
              type: "sales",
              matchedSignals: ["sales"],
              signalCount: 1,
              occurrences: 1,
              years: 2,
              industryVerifiedRelevantYears: 1.5,
              matchedWorkEntries: [
                {
                  companyName: "CNC Machines Co",
                  jobTitle: "Sales Manager",
                  years: 1.5,
                  industryVerified: true,
                  matchedSignals: ["sales"],
                  directRoleMatch: true,
                },
              ],
              verifyIn: "workHistory",
            },
          ],
        },
      },
      {
        roleFilterType: "sales",
        minRoleYears: 1,
        market: "CN",
        locale: "zh",
      },
    );

    expect(result).toEqual({
      context: {
        roleFilterType: "sales",
        minRoleYears: 1,
        market: "CN",
        locale: "zh",
      },
      ingestEvidence: {
        directRoleMatch: true,
        industryVerifiedRelevantYears: 1.5,
        matchedWorkEntries: ["Sales Manager @ CNC Machines Co (1.5y)"],
      },
    });
  });

  it("still returns empty evidence when context is present but ingest role signals are missing", () => {
    const result = buildRelatedExpCtxArg(
      { ingestData: {} },
      {
        roleFilterType: "sales",
        minRoleYears: 1,
        market: "CN",
      },
    );

    expect(result).toEqual({
      context: {
        roleFilterType: "sales",
        minRoleYears: 1,
        market: "CN",
      },
      ingestEvidence: {
        directRoleMatch: false,
        industryVerifiedRelevantYears: 0,
        matchedWorkEntries: [],
      },
    });
  });
});

// Test extractKeywords logic (duplicated as pure function for unit testing)
describe("extractKeywords logic", () => {
  // Mirrors analysis_tasks.ts:144-147
  function extractKeywords(input: string): string[] {
    const matched = input.toLowerCase().match(/[\u4e00-\u9fa5a-z0-9]{2,}/g) ?? [];
    return [...new Set(matched)];
  }

  it("extracts CJK and alphanumeric tokens of length >= 2", () => {
    const result = extractKeywords("CNC 销售工程师 lathe");
    expect(result).toContain("cnc");
    expect(result).toContain("销售工程师");
    expect(result).toContain("lathe");
  });

  it("deduplicates tokens", () => {
    const result = extractKeywords("CNC CNC sales sales");
    expect(result.filter((k) => k === "cnc")).toHaveLength(1);
    expect(result.filter((k) => k === "sales")).toHaveLength(1);
  });

  it("skips single-character tokens", () => {
    const result = extractKeywords("a b CNC");
    expect(result).not.toContain("a");
    expect(result).not.toContain("b");
    expect(result).toContain("cnc");
  });

  it("returns empty array for empty string", () => {
    expect(extractKeywords("")).toEqual([]);
  });
});

// Test normalizeKeywords logic (duplicated as pure function for unit testing)
describe("normalizeKeywords logic", () => {
  // Mirrors analysis_tasks.ts:149-157
  function normalizeKeywords(keywords: string[]): string[] {
    return Array.from(
      new Set(
        keywords
          .map((keyword) => keyword.trim().toLowerCase())
          .filter((keyword) => keyword.length > 0)
      )
    );
  }

  it("lowercases and trims keywords", () => {
    expect(normalizeKeywords([" CNC ", "SALES"])).toEqual(["cnc", "sales"]);
  });

  it("deduplicates after normalization", () => {
    expect(normalizeKeywords(["CNC", "cnc", "Sales", "sales"])).toEqual(["cnc", "sales"]);
  });

  it("removes empty strings after trim", () => {
    expect(normalizeKeywords(["cnc", "", " ", "sales"])).toEqual(["cnc", "sales"]);
  });

  it("returns empty array for all-empty input", () => {
    expect(normalizeKeywords(["", " ", "  "])).toEqual([]);
  });
});

// Test classifyResumes logic against the exported helper.
describe("classifyResumes skip-threshold logic", () => {
  it("analyzes all resumes when keywords are empty", () => {
    const resumes = [{ name: "A" }, { name: "B" }];
    const result = classifyResumes(resumes, []);
    expect(result.toAnalyze).toHaveLength(2);
    expect(result.toSkip).toHaveLength(0);
  });

  it("handles a mixed set of keyword matches and skips the zero-match resume", () => {
    const resumes = [
      { name: "张某", selfIntro: "保险销售" },
      { name: "李某", selfIntro: "质量检验员" },
    ];
    // One resume matches the threshold; the other remains a zero-match skip case.
    const result = classifyResumes(resumes, ["cnc", "机床", "加工中心", "机械", "设备", "数控", "车床", "销售", "业务", "cmm"]);
    expect(result.toAnalyze).toHaveLength(1);
    expect(result.toSkip).toHaveLength(1);
  });

  it("skips resumes with zero keyword matches (clear case)", () => {
    const resumes = [
      { name: "张某", selfIntro: "CNC操作员 机床维修" },
      { name: "王某", selfIntro: "律师 法律顾问" },
    ];
    const result = classifyResumes(resumes, ["cnc", "机床", "机械"]);
    // 张某 matches cnc + 机床 = 2/3 → 67 → analyze
    // 王某 matches 0/3 → 0 → skip
    expect(result.toAnalyze).toHaveLength(1);
    expect(result.toSkip).toHaveLength(1);
    expect(result.toAnalyze[0].name).toBe("张某");
  });

  it("keeps resume matching at least 10% of keywords", () => {
    const resumes = [
      { name: "李某", selfIntro: "销售经理" },
    ];
    const result = classifyResumes(resumes, ["cnc", "机床", "机械", "设备", "数控", "车床", "加工中心", "销售", "业务", "cmm"]);
    // "销售经理" matches "销售" → 1/10 = 10% → exactly threshold → analyze
    expect(result.toAnalyze).toHaveLength(1);
    expect(result.toSkip).toHaveLength(0);
  });

  it("skips resume matching below 10% of keywords", () => {
    const resumes = [
      { name: "赵某", selfIntro: "机械操作" },
    ];
    const result = classifyResumes(resumes, ["cnc", "机床", "机械", "设备", "数控", "车床", "加工中心", "销售", "业务", "cmm", "测量"]);
    // "机械操作" matches "机械" → 1/11 ≈ 9% → below 10 → skip
    expect(result.toAnalyze).toHaveLength(0);
    expect(result.toSkip).toHaveLength(1);
  });

  it("keeps a low-keyword-match resume when related experience context has supporting evidence", () => {
    const resumes = [
      {
        name: "赵先生",
        ingestData: {
          roleSignals: [
            {
              type: "sales",
              matchedSignals: ["客户开发"],
              signalCount: 1,
              occurrences: 1,
              years: 3,
              industryVerifiedRelevantYears: 2,
              matchedWorkEntries: [
                {
                  companyName: "富士电机（中国）有限公司深圳分公司",
                  jobTitle: "销售主管",
                  years: 2,
                  industryVerified: true,
                  matchedSignals: ["客户开发"],
                  directRoleMatch: true,
                },
              ],
              verifyIn: "workHistory",
            },
          ],
        },
      },
    ];

    const result = classifyResumes(resumes, ["cnc", "lathe"], {
      roleFilterType: "sales",
      minRoleYears: 1,
      market: "CN",
    });

    expect(result.toAnalyze).toHaveLength(1);
    expect(result.toSkip).toHaveLength(0);
    expect(result.toAnalyze[0].name).toBe("赵先生");
  });
});

// Test unwrapLlmResult / parseLlmResult logic (duplicated as pure functions)
describe("unwrapLlmResult logic", () => {
  function isObject(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null;
  }

  function unwrapLlmResult(value: unknown): Record<string, unknown> | null {
    if (!isObject(value)) return null;
    if (value.score !== undefined) return value;
    for (const key of ["result", "data", "analysis", "response", "output"]) {
      const nested = value[key];
      if (isObject(nested) && nested.score !== undefined) return nested;
    }
    for (const nested of Object.values(value)) {
      if (isObject(nested) && nested.score !== undefined) return nested;
    }
    return null;
  }

  it("returns top-level object when score is present", () => {
    const input = { score: 85, summary: "good" };
    expect(unwrapLlmResult(input)).toEqual(input);
  });

  it("unwraps from 'result' key", () => {
    const inner = { score: 70, summary: "ok" };
    expect(unwrapLlmResult({ result: inner })).toEqual(inner);
  });

  it("unwraps from 'data' key", () => {
    const inner = { score: 60, summary: "decent" };
    expect(unwrapLlmResult({ data: inner })).toEqual(inner);
  });

  it("scans one level for any object with score", () => {
    const inner = { score: 50 };
    expect(unwrapLlmResult({ customKey: inner })).toEqual(inner);
  });

  it("returns null when no score found", () => {
    expect(unwrapLlmResult({ foo: "bar" })).toBeNull();
  });

  it("returns null for non-object input", () => {
    expect(unwrapLlmResult("string")).toBeNull();
    expect(unwrapLlmResult(null)).toBeNull();
    expect(unwrapLlmResult(42)).toBeNull();
  });
});

describe("parseLlmResult logic (toNumber + word numbers)", () => {
  const WORD_NUMBERS: Record<string, number> = {
    zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7,
    eight: 8, nine: 9, ten: 10, fifteen: 15, twenty: 20, twenty5: 25,
    thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80,
    ninety: 90, hundred: 100,
  };

  function toNumber(value: unknown): number | null {
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value === "string") {
      const parsed = Number(value);
      if (Number.isFinite(parsed)) return parsed;
      const lower = value.trim().toLowerCase();
      if (WORD_NUMBERS[lower] !== undefined) return WORD_NUMBERS[lower];
      const parts = lower.split(/[-\s]+/);
      if (parts.length === 2 && WORD_NUMBERS[parts[0]] !== undefined && WORD_NUMBERS[parts[1]] !== undefined) {
        return WORD_NUMBERS[parts[0]] + WORD_NUMBERS[parts[1]];
      }
    }
    return null;
  }

  it("parses numeric score directly", () => {
    expect(toNumber(85)).toBe(85);
  });

  it("parses string number", () => {
    expect(toNumber("70")).toBe(70);
  });

  it("parses English word numbers", () => {
    expect(toNumber("seventy")).toBe(70);
    expect(toNumber("eighty")).toBe(80);
    expect(toNumber("fifty")).toBe(50);
  });

  it("parses compound English word numbers", () => {
    expect(toNumber("seventy-five")).toBe(75);
    expect(toNumber("eighty five")).toBe(85);
  });

  it("returns null for non-numeric strings", () => {
    expect(toNumber("good")).toBeNull();
  });

  it("returns 0 for empty string (Number('') === 0)", () => {
    expect(toNumber("")).toBe(0);
  });

  it("returns null for NaN and Infinity", () => {
    expect(toNumber(NaN)).toBeNull();
    expect(toNumber(Infinity)).toBeNull();
  });
});

// Test parseLlmResult integration (duplicated from analysis_tasks.ts:119-142)
describe("parseLlmResult integration", () => {
  function isObject(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null;
  }

  const WORD_NUMBERS: Record<string, number> = {
    zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7,
    eight: 8, nine: 9, ten: 10, fifteen: 15, twenty: 20, twenty5: 25,
    thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80,
    ninety: 90, hundred: 100,
  };

  function toNumber(value: unknown): number | null {
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value === "string") {
      const parsed = Number(value);
      if (Number.isFinite(parsed)) return parsed;
      const lower = value.trim().toLowerCase();
      if (WORD_NUMBERS[lower] !== undefined) return WORD_NUMBERS[lower];
      const parts = lower.split(/[-\s]+/);
      if (parts.length === 2 && WORD_NUMBERS[parts[0]] !== undefined && WORD_NUMBERS[parts[1]] !== undefined) {
        return WORD_NUMBERS[parts[0]] + WORD_NUMBERS[parts[1]];
      }
    }
    return null;
  }

  function toStringArray(value: unknown): string[] {
    if (!Array.isArray(value)) return [];
    return value.filter((item): item is string => typeof item === "string");
  }

  function parseBreakdown(value: unknown): Record<string, number> | undefined {
    if (!isObject(value)) return undefined;
    const parsed: Record<string, number> = {};
    for (const [key, rawValue] of Object.entries(value)) {
      const numericValue = toNumber(rawValue);
      if (numericValue !== null) {
        parsed[key] = numericValue;
      }
    }
    return Object.keys(parsed).length > 0 ? parsed : undefined;
  }

  function unwrapLlmResult(value: unknown): Record<string, unknown> | null {
    if (!isObject(value)) return null;
    if (value.score !== undefined) return value;
    for (const key of ["result", "data", "analysis", "response", "output"]) {
      const nested = value[key];
      if (isObject(nested) && nested.score !== undefined) return nested;
    }
    for (const nested of Object.values(value)) {
      if (isObject(nested) && nested.score !== undefined) return nested;
    }
    return null;
  }

  function parseLlmResult(value: unknown): {
    score: number;
    summary: string;
    highlights: string[];
    recommendation: string;
    breakdown: Record<string, number> | undefined;
  } {
    const obj = unwrapLlmResult(value);
    if (!obj) throw new Error("Invalid analysis result: score is missing.");
    const score = toNumber(obj.score);
    if (score === null) throw new Error("Invalid analysis result: score is missing.");
    const summary = typeof obj.summary === "string" ? obj.summary : "";
    const recommendation = typeof obj.recommendation === "string" ? obj.recommendation : "potential";
    return {
      score,
      summary: summary || "No summary provided.",
      highlights: toStringArray(obj.highlights),
      recommendation,
      breakdown: parseBreakdown(obj.breakdown),
    };
  }

  it("parses a well-formed top-level result", () => {
    const result = parseLlmResult({
      score: 85,
      summary: "Strong match",
      highlights: ["CNC experience", "Sales background"],
      recommendation: "strong_match",
      breakdown: { related_exp: 80, industry_db: 40 },
    });
    expect(result.score).toBe(85);
    expect(result.summary).toBe("Strong match");
    expect(result.highlights).toEqual(["CNC experience", "Sales background"]);
    expect(result.recommendation).toBe("strong_match");
    expect(result.breakdown).toEqual({ related_exp: 80, industry_db: 40 });
  });

  it("parses score from word number", () => {
    const result = parseLlmResult({ score: "eighty", summary: "Good" });
    expect(result.score).toBe(80);
  });

  it("throws when score is missing", () => {
    expect(() => parseLlmResult({ summary: "No score" })).toThrow("Invalid analysis result");
  });

  it("throws when score is non-numeric string", () => {
    expect(() => parseLlmResult({ score: "good" })).toThrow("Invalid analysis result");
  });

  it("defaults summary when missing", () => {
    const result = parseLlmResult({ score: 70 });
    expect(result.summary).toBe("No summary provided.");
  });

  it("defaults summary when empty string", () => {
    const result = parseLlmResult({ score: 70, summary: "" });
    expect(result.summary).toBe("No summary provided.");
  });

  it("defaults recommendation to potential", () => {
    const result = parseLlmResult({ score: 50 });
    expect(result.recommendation).toBe("potential");
  });

  it("filters non-string highlights", () => {
    const result = parseLlmResult({
      score: 70,
      highlights: ["valid", 42, null, "also valid"],
    });
    expect(result.highlights).toEqual(["valid", "also valid"]);
  });

  it("defaults highlights to empty array", () => {
    const result = parseLlmResult({ score: 70 });
    expect(result.highlights).toEqual([]);
  });

  it("unwraps nested result and parses", () => {
    const result = parseLlmResult({
      result: { score: 65, summary: "Nested" },
    });
    expect(result.score).toBe(65);
    expect(result.summary).toBe("Nested");
  });

  it("parses breakdown with mixed numeric types", () => {
    const result = parseLlmResult({
      score: 70,
      breakdown: { related_exp: 60, industry_db: "35", invalid: "abc" },
    });
    expect(result.breakdown).toEqual({ related_exp: 60, industry_db: 35 });
    expect(result.breakdown).not.toHaveProperty("invalid");
  });
});

// Test stableHash FNV-1a logic (duplicated from analysis_tasks.ts:175-182)
describe("stableHash FNV-1a logic", () => {
  // Mirrors analysis_tasks.ts:175-182
  function stableHash(seed: string): string {
    let hash = 2166136261;
    for (const char of seed) {
      hash ^= char.codePointAt(0) ?? 0;
      hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(16);
  }

  it("returns offset basis for empty string", () => {
    // FNV-1a offset basis 2166136261 → unsigned → hex
    expect(stableHash("")).toBe((2166136261 >>> 0).toString(16));
  });

  it("is deterministic for same input", () => {
    expect(stableHash("CNC 销售")).toBe(stableHash("CNC 销售"));
  });

  it("produces different hashes for different inputs", () => {
    expect(stableHash("CNC")).not.toBe(stableHash("sales"));
  });

  it("handles CJK characters correctly", () => {
    const result = stableHash("销售工程师");
    expect(result).toMatch(/^[0-9a-f]+$/);
    expect(result.length).toBeGreaterThan(0);
  });

  it("handles emoji / surrogate pairs via codePointAt", () => {
    // codePointAt handles surrogate pairs correctly (unlike charCodeAt)
    const result = stableHash("👍");
    expect(result).toMatch(/^[0-9a-f]+$/);
  });

  it("produces unsigned 32-bit hex output", () => {
    const result = stableHash("test input with various chars 1234");
    // Unsigned 32-bit hex is 1-8 hex chars
    expect(result).toMatch(/^[0-9a-f]{1,8}$/);
  });
});

// Test buildAnalysisDispatchJobKey logic (duplicated from analysis_tasks.ts:204-224)
describe("buildAnalysisDispatchJobKey logic", () => {
  function stableHash(seed: string): string {
    let hash = 2166136261;
    for (const char of seed) {
      hash ^= char.codePointAt(0) ?? 0;
      hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(16);
  }

  function normalizeKeywords(keywords: string[]): string[] {
    return Array.from(
      new Set(
        keywords
          .map((keyword) => keyword.trim().toLowerCase())
          .filter((keyword) => keyword.length > 0)
      )
    );
  }

  const PROMPT_VERSION = 10;

  function buildAnalysisDispatchJobKey(input: {
    derivedJobDescriptionId?: string;
    jobDescriptionTitle?: string;
    jobDescriptionContent?: string;
    keywords?: string[];
    location?: string;
    promptVersion?: number;
  }): string {
    const pv = input.promptVersion ?? PROMPT_VERSION;
    if (input.derivedJobDescriptionId?.trim()) {
      return `job:${input.derivedJobDescriptionId.trim().toLowerCase()}:prompt:${pv}`;
    }
    const normalizedKeywords = normalizeKeywords(input.keywords ?? []);
    if (normalizedKeywords.length > 0) {
      // Simplified — real version calls buildKeywordAnalysisId
      return `keywords:${normalizedKeywords.join(",")}:prompt:${pv}`;
    }
    const title = input.jobDescriptionTitle?.trim().toLowerCase() ?? "";
    const content = input.jobDescriptionContent?.trim().toLowerCase() ?? "";
    if (!title && !content) {
      return `job:default:prompt:${pv}`;
    }
    return `job-content:prompt:${pv}:${stableHash(`${title}|${content}`)}`;
  }

  it("uses derivedJobDescriptionId when present", () => {
    expect(buildAnalysisDispatchJobKey({ derivedJobDescriptionId: "JD-123" })).toBe(
      `job:jd-123:prompt:${PROMPT_VERSION}`
    );
  });

  it("falls back to keywords when no derivedJobDescriptionId", () => {
    const result = buildAnalysisDispatchJobKey({ keywords: ["CNC", "Sales"] });
    expect(result).toContain("keywords:");
    expect(result).toContain("cnc,sales");
  });

  it("uses stableHash for JD title + content path", () => {
    const result = buildAnalysisDispatchJobKey({
      jobDescriptionTitle: "Sales Engineer",
      jobDescriptionContent: "CNC experience required",
    });
    expect(result).toContain("job-content:prompt:");
    expect(result).toContain(stableHash("sales engineer|cnc experience required"));
  });

  it("returns job:default when no keywords, no JD id, no title/content", () => {
    expect(buildAnalysisDispatchJobKey({})).toBe(`job:default:prompt:${PROMPT_VERSION}`);
  });
});

// Test inferTargetRoleType logic (duplicated from analysis_tasks.ts + isSalesRequiredContext)
describe("inferTargetRoleType logic", () => {
  // Mirrors isSalesRequiredContext from @trends/shared analysis-key.ts
  function normalizeText(text: string | undefined): string {
    return (text ?? "").trim().toLowerCase();
  }

  function isSalesRequiredContext(...texts: Array<string | undefined>): boolean {
    const haystack = texts
      .map((text) => normalizeText(text))
      .filter((text): text is string => Boolean(text))
      .join(" ");

    if (!haystack) return false;

    return /(?:^|\b)(?:sales?|business development|bd|account manager|key account manager|channel sales|channel manager|territory sales manager|regional sales manager)(?:\b|$)|销售工程师|销售经理|业务拓展|业务开发|客户开发|大客户|渠道销售|渠道经理|销售|渠道/.test(haystack);
  }

  // Mirrors inferTargetRoleType from analysis_tasks.ts
  function inferTargetRoleType(config: {
    keywords?: string[];
    jobDescriptionTitle?: string;
    jobDescriptionContent?: string;
  }): "sales" | undefined {
    if (isSalesRequiredContext(
      ...(config.keywords ?? []),
      config.jobDescriptionTitle,
      config.jobDescriptionContent
    )) {
      return "sales";
    }
    return undefined;
  }

  it("detects sales intent from Chinese keywords", () => {
    expect(inferTargetRoleType({ keywords: ["CNC", "销售"] })).toBe("sales");
  });

  it("detects sales intent from English keywords", () => {
    expect(inferTargetRoleType({ keywords: ["CNC", "sales"] })).toBe("sales");
  });

  it("detects sales intent from BD abbreviation", () => {
    expect(inferTargetRoleType({ keywords: ["BD", "CNC"] })).toBe("sales");
  });

  it("detects sales intent from job description title", () => {
    expect(inferTargetRoleType({ jobDescriptionTitle: "Sales Engineer" })).toBe("sales");
  });

  it("detects sales intent from job description content", () => {
    expect(inferTargetRoleType({ jobDescriptionContent: "负责渠道销售" })).toBe("sales");
  });

  it("returns undefined when no sales context", () => {
    expect(inferTargetRoleType({ keywords: ["CNC", "操作员"] })).toBeUndefined();
  });

  it("returns undefined for empty input", () => {
    expect(inferTargetRoleType({})).toBeUndefined();
  });

  it("detects sales from multiple combined signals", () => {
    expect(inferTargetRoleType({
      keywords: ["CNC"],
      jobDescriptionTitle: "Regional Sales Manager",
    })).toBe("sales");
  });
});
