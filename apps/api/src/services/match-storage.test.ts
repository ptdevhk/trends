import { describe, expect, it } from "vitest";

import {
  parseJsonArray,
  parseJsonObject,
  normalizeMatch,
  normalizeMatchRun,
} from "./match-storage.js";

// ---------------------------------------------------------------------------
// parseJsonArray
// ---------------------------------------------------------------------------

describe("parseJsonArray", () => {
  it("parses a JSON string array", () => {
    expect(parseJsonArray('["a", "b", "c"]')).toEqual(["a", "b", "c"]);
  });

  it("returns empty array for non-string input", () => {
    expect(parseJsonArray(null)).toEqual([]);
    expect(parseJsonArray(undefined)).toEqual([]);
    expect(parseJsonArray(42)).toEqual([]);
    expect(parseJsonArray(["already"])).toEqual([]);
  });

  it("returns empty array for empty/whitespace string", () => {
    expect(parseJsonArray("")).toEqual([]);
    expect(parseJsonArray("  ")).toEqual([]);
  });

  it("returns empty array for invalid JSON", () => {
    expect(parseJsonArray("not json")).toEqual([]);
  });

  it("returns empty array for valid JSON that is not an array", () => {
    expect(parseJsonArray('{"key": "value"}')).toEqual([]);
  });

  it("stringifies non-string array elements", () => {
    expect(parseJsonArray("[1, true, null]")).toEqual(["1", "true", "null"]);
  });
});

// ---------------------------------------------------------------------------
// parseJsonObject
// ---------------------------------------------------------------------------

describe("parseJsonObject", () => {
  it("parses a valid breakdown JSON string", () => {
    const result = parseJsonObject(JSON.stringify({
      skillMatch: 0.8,
      experienceMatch: 0.6,
      educationMatch: 0.5,
      locationMatch: 0.9,
      industryMatch: 0.7,
    }));
    expect(result).toEqual({
      skillMatch: 0.8,
      roleMatch: 0,
      experienceMatch: 0.6,
      educationMatch: 0.5,
      locationMatch: 0.9,
      industryMatch: 0.7,
      brandRelevance: 0,
    });
  });

  it("includes roleMatch and brandRelevance when present", () => {
    const result = parseJsonObject(JSON.stringify({
      skillMatch: 0.8,
      experienceMatch: 0.6,
      educationMatch: 0.5,
      locationMatch: 0.9,
      industryMatch: 0.7,
      roleMatch: 0.4,
      brandRelevance: 0.3,
    }));
    expect(result?.roleMatch).toBe(0.4);
    expect(result?.brandRelevance).toBe(0.3);
  });

  it("returns undefined for non-string input", () => {
    expect(parseJsonObject(null)).toBeUndefined();
    expect(parseJsonObject(undefined)).toBeUndefined();
    expect(parseJsonObject(42)).toBeUndefined();
  });

  it("returns undefined for empty/whitespace string", () => {
    expect(parseJsonObject("")).toBeUndefined();
    expect(parseJsonObject("  ")).toBeUndefined();
  });

  it("returns undefined for invalid JSON", () => {
    expect(parseJsonObject("not json")).toBeUndefined();
  });

  it("returns undefined when required keys are missing", () => {
    expect(parseJsonObject(JSON.stringify({ skillMatch: 0.8 }))).toBeUndefined();
  });

  it("returns undefined when required keys are not numbers", () => {
    expect(parseJsonObject(JSON.stringify({
      skillMatch: "bad",
      experienceMatch: 0.6,
      educationMatch: 0.5,
      locationMatch: 0.9,
      industryMatch: 0.7,
    }))).toBeUndefined();
  });

  it("defaults brandRelevance to 0 when not present", () => {
    const result = parseJsonObject(JSON.stringify({
      skillMatch: 0.8,
      experienceMatch: 0.6,
      educationMatch: 0.5,
      locationMatch: 0.9,
      industryMatch: 0.7,
    }));
    expect(result?.brandRelevance).toBe(0);
  });

  it("defaults roleMatch to 0 when not present", () => {
    const result = parseJsonObject(JSON.stringify({
      skillMatch: 0.8,
      experienceMatch: 0.6,
      educationMatch: 0.5,
      locationMatch: 0.9,
      industryMatch: 0.7,
    }));
    expect(result?.roleMatch).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// normalizeMatch
// ---------------------------------------------------------------------------

describe("normalizeMatch", () => {
  function makeRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
    return {
      id: 1,
      resume_id: "resume-1",
      job_description_id: "jd-1",
      score: 0.85,
      recommendation: "strong_match",
      highlights: '["skill A"]',
      concerns: '["gap B"]',
      summary: "Good candidate",
      matched_at: "2024-01-01",
      ...overrides,
    };
  }

  it("normalizes a basic match row", () => {
    const result = normalizeMatch(makeRow());
    expect(result.id).toBe(1);
    expect(result.resumeId).toBe("resume-1");
    expect(result.jobDescriptionId).toBe("jd-1");
    expect(result.score).toBe(0.85);
    expect(result.recommendation).toBe("strong_match");
    expect(result.highlights).toEqual(["skill A"]);
    expect(result.concerns).toEqual(["gap B"]);
    expect(result.summary).toBe("Good candidate");
  });

  it("defaults scoreSource to ai when no score_source or ai_model", () => {
    const result = normalizeMatch(makeRow());
    expect(result.scoreSource).toBe("ai");
  });

  it("detects rule scoreSource from score_source field", () => {
    const result = normalizeMatch(makeRow({ score_source: "rule" }));
    expect(result.scoreSource).toBe("rule");
  });

  it("detects rule scoreSource from ai_model prefix", () => {
    const result = normalizeMatch(makeRow({ ai_model: "rule-v1" }));
    expect(result.scoreSource).toBe("rule");
  });

  it("sets ai scoreSource for non-rule ai_model", () => {
    const result = normalizeMatch(makeRow({ ai_model: "gpt-4" }));
    expect(result.scoreSource).toBe("ai");
  });

  it("extracts optional fields", () => {
    const result = normalizeMatch(makeRow({
      session_id: "sess-1",
      user_id: "user-1",
      sample_name: "Sample",
      breakdown: JSON.stringify({
        skillMatch: 0.8,
        experienceMatch: 0.6,
        educationMatch: 0.5,
        locationMatch: 0.9,
        industryMatch: 0.7,
      }),
      processing_time_ms: 1500,
    }));
    expect(result.sessionId).toBe("sess-1");
    expect(result.userId).toBe("user-1");
    expect(result.sampleName).toBe("Sample");
    expect(result.breakdown).toBeDefined();
    expect(result.processingTimeMs).toBe(1500);
  });

  it("handles missing optional fields", () => {
    const result = normalizeMatch(makeRow());
    expect(result.sessionId).toBeUndefined();
    expect(result.userId).toBeUndefined();
    expect(result.sampleName).toBeUndefined();
    expect(result.breakdown).toBeUndefined();
    expect(result.processingTimeMs).toBeUndefined();
    expect(result.aiModel).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// normalizeMatchRun
// ---------------------------------------------------------------------------

describe("normalizeMatchRun", () => {
  function makeRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
    return {
      id: "run-1",
      job_description_id: "jd-1",
      mode: "hybrid",
      status: "completed",
      total_count: 10,
      processed_count: 10,
      failed_count: 0,
      started_at: "2024-01-01T00:00:00Z",
      ...overrides,
    };
  }

  it("normalizes a basic match run row", () => {
    const result = normalizeMatchRun(makeRow());
    expect(result.id).toBe("run-1");
    expect(result.jobDescriptionId).toBe("jd-1");
    expect(result.mode).toBe("hybrid");
    expect(result.status).toBe("completed");
    expect(result.totalCount).toBe(10);
    expect(result.processedCount).toBe(10);
    expect(result.failedCount).toBe(0);
  });

  it("defaults mode to hybrid for invalid value", () => {
    const result = normalizeMatchRun(makeRow({ mode: "invalid" }));
    expect(result.mode).toBe("hybrid");
  });

  it("defaults mode to hybrid for missing value", () => {
    const result = normalizeMatchRun(makeRow({ mode: undefined }));
    expect(result.mode).toBe("hybrid");
  });

  it("defaults status to processing for invalid value", () => {
    const result = normalizeMatchRun(makeRow({ status: "unknown" }));
    expect(result.status).toBe("processing");
  });

  it("accepts all valid modes", () => {
    for (const mode of ["rules_only", "ai_only", "hybrid"] as const) {
      const result = normalizeMatchRun(makeRow({ mode }));
      expect(result.mode).toBe(mode);
    }
  });

  it("accepts all valid statuses", () => {
    for (const status of ["processing", "completed", "failed"] as const) {
      const result = normalizeMatchRun(makeRow({ status }));
      expect(result.status).toBe(status);
    }
  });

  it("extracts optional fields", () => {
    const result = normalizeMatchRun(makeRow({
      session_id: "sess-1",
      sample_name: "Sample",
      matched_count: 8,
      avg_score: 0.75,
      completed_at: "2024-01-01T01:00:00Z",
      error: null,
    }));
    expect(result.sessionId).toBe("sess-1");
    expect(result.sampleName).toBe("Sample");
    expect(result.matchedCount).toBe(8);
    expect(result.avgScore).toBe(0.75);
    expect(result.completedAt).toBe("2024-01-01T01:00:00Z");
  });

  it("handles null optional fields", () => {
    const result = normalizeMatchRun(makeRow({
      matched_count: null,
      avg_score: null,
      completed_at: null,
      error: null,
    }));
    expect(result.matchedCount).toBeUndefined();
    expect(result.avgScore).toBeUndefined();
    expect(result.completedAt).toBeUndefined();
    expect(result.error).toBeUndefined();
  });

  it("preserves error string", () => {
    const result = normalizeMatchRun(makeRow({ error: "timeout" }));
    expect(result.error).toBe("timeout");
  });
});
