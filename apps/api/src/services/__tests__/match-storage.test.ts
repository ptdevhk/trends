import { describe, it, expect } from "vitest";
import {
  parseJsonArray,
  parseJsonObject,
  normalizeMatch,
  normalizeMatchRun,
} from "../match-storage.js";

describe("parseJsonArray", () => {
  it("parses valid JSON array string", () => {
    expect(parseJsonArray('["a","b","c"]')).toEqual(["a", "b", "c"]);
    expect(parseJsonArray("[1,2,3]")).toEqual(["1", "2", "3"]);
  });
  it("returns empty array for empty string", () => {
    expect(parseJsonArray("")).toEqual([]);
    expect(parseJsonArray("  ")).toEqual([]);
  });
  it("returns empty array for non-string input", () => {
    expect(parseJsonArray(null)).toEqual([]);
    expect(parseJsonArray(undefined)).toEqual([]);
    expect(parseJsonArray(42)).toEqual([]);
  });
  it("returns empty array for invalid JSON", () => {
    expect(parseJsonArray("not json")).toEqual([]);
    expect(parseJsonArray("{invalid")).toEqual([]);
  });
  it("returns empty array for non-array JSON", () => {
    expect(parseJsonArray('{"key":"value"}')).toEqual([]);
    expect(parseJsonArray('"string"')).toEqual([]);
  });
});

describe("parseJsonObject", () => {
  it("parses valid breakdown JSON", () => {
    const result = parseJsonObject(
      JSON.stringify({
        skillMatch: 15,
        experienceMatch: 25,
        educationMatch: 15,
        locationMatch: 15,
        industryMatch: 10,
        brandRelevance: 10,
      }),
    );
    expect(result).toEqual({
      skillMatch: 15,
      roleMatch: 0,
      experienceMatch: 25,
      educationMatch: 15,
      locationMatch: 15,
      industryMatch: 10,
      brandRelevance: 10,
    });
  });
  it("parses breakdown with roleMatch", () => {
    const result = parseJsonObject(
      JSON.stringify({
        skillMatch: 15,
        roleMatch: 10,
        experienceMatch: 25,
        educationMatch: 15,
        locationMatch: 15,
        industryMatch: 10,
      }),
    );
    expect(result?.roleMatch).toBe(10);
  });
  it("defaults brandRelevance to 0 when missing", () => {
    const result = parseJsonObject(
      JSON.stringify({
        skillMatch: 15,
        experienceMatch: 25,
        educationMatch: 15,
        locationMatch: 15,
        industryMatch: 10,
      }),
    );
    expect(result?.brandRelevance).toBe(0);
  });
  it("defaults roleMatch to 0 when missing", () => {
    const result = parseJsonObject(
      JSON.stringify({
        skillMatch: 15,
        experienceMatch: 25,
        educationMatch: 15,
        locationMatch: 15,
        industryMatch: 10,
      }),
    );
    expect(result?.roleMatch).toBe(0);
  });
  it("returns undefined when required keys are missing", () => {
    expect(parseJsonObject(JSON.stringify({ skillMatch: 15 }))).toBeUndefined();
    expect(parseJsonObject(JSON.stringify({}))).toBeUndefined();
  });
  it("returns undefined for non-string input", () => {
    expect(parseJsonObject(null)).toBeUndefined();
    expect(parseJsonObject(undefined)).toBeUndefined();
    expect(parseJsonObject(42)).toBeUndefined();
  });
  it("returns undefined for empty string", () => {
    expect(parseJsonObject("")).toBeUndefined();
    expect(parseJsonObject("  ")).toBeUndefined();
  });
  it("returns undefined for invalid JSON", () => {
    expect(parseJsonObject("not json")).toBeUndefined();
  });
});

describe("normalizeMatch", () => {
  const baseRow: Record<string, unknown> = {
    id: 1,
    resume_id: "resume_abc",
    job_description_id: "jd_123",
    score: 75,
    recommendation: "match",
    highlights: '["Strong CNC experience"]',
    concerns: '["Limited sales exposure"]',
    summary: "Good candidate",
    matched_at: "2026-05-22T10:00:00Z",
  };

  it("normalizes a basic match row", () => {
    const result = normalizeMatch(baseRow);
    expect(result.id).toBe(1);
    expect(result.resumeId).toBe("resume_abc");
    expect(result.jobDescriptionId).toBe("jd_123");
    expect(result.score).toBe(75);
    expect(result.recommendation).toBe("match");
    expect(result.highlights).toEqual(["Strong CNC experience"]);
    expect(result.concerns).toEqual(["Limited sales exposure"]);
    expect(result.summary).toBe("Good candidate");
  });

  it("defaults scoreSource to ai when no score_source or ai_model", () => {
    expect(normalizeMatch(baseRow).scoreSource).toBe("ai");
  });

  it("detects rule scoreSource from score_source field", () => {
    const result = normalizeMatch({ ...baseRow, score_source: "rule" });
    expect(result.scoreSource).toBe("rule");
  });

  it("detects rule scoreSource from ai_model prefix", () => {
    const result = normalizeMatch({ ...baseRow, ai_model: "rule-v1" });
    expect(result.scoreSource).toBe("rule");
  });

  it("maps ai_model when present", () => {
    const result = normalizeMatch({ ...baseRow, ai_model: "claude-sonnet-4-6" });
    expect(result.aiModel).toBe("claude-sonnet-4-6");
    expect(result.scoreSource).toBe("ai");
  });

  it("maps optional fields", () => {
    const result = normalizeMatch({
      ...baseRow,
      session_id: "sess_1",
      user_id: "user_1",
      sample_name: "Sample A",
      processing_time_ms: 1500,
    });
    expect(result.sessionId).toBe("sess_1");
    expect(result.userId).toBe("user_1");
    expect(result.sampleName).toBe("Sample A");
    expect(result.processingTimeMs).toBe(1500);
  });

  it("handles missing optional fields", () => {
    const result = normalizeMatch(baseRow);
    expect(result.sessionId).toBeUndefined();
    expect(result.userId).toBeUndefined();
    expect(result.sampleName).toBeUndefined();
    expect(result.aiModel).toBeUndefined();
    expect(result.processingTimeMs).toBeUndefined();
    expect(result.breakdown).toBeUndefined();
  });

  it("parses breakdown JSON", () => {
    const result = normalizeMatch({
      ...baseRow,
      breakdown: JSON.stringify({
        skillMatch: 15, experienceMatch: 25, educationMatch: 15,
        locationMatch: 15, industryMatch: 10,
      }),
    });
    expect(result.breakdown).toBeDefined();
    expect(result.breakdown?.skillMatch).toBe(15);
  });
});

describe("normalizeMatchRun", () => {
  const baseRow: Record<string, unknown> = {
    id: "run_abc",
    job_description_id: "jd_123",
    total_count: 100,
    processed_count: 95,
    failed_count: 5,
    started_at: "2026-05-22T09:00:00Z",
  };

  it("normalizes a basic match run row", () => {
    const result = normalizeMatchRun(baseRow);
    expect(result.id).toBe("run_abc");
    expect(result.jobDescriptionId).toBe("jd_123");
    expect(result.mode).toBe("hybrid");
    expect(result.status).toBe("processing");
    expect(result.totalCount).toBe(100);
    expect(result.processedCount).toBe(95);
    expect(result.failedCount).toBe(5);
  });

  it("parses valid mode", () => {
    expect(normalizeMatchRun({ ...baseRow, mode: "rules_only" }).mode).toBe("rules_only");
    expect(normalizeMatchRun({ ...baseRow, mode: "ai_only" }).mode).toBe("ai_only");
    expect(normalizeMatchRun({ ...baseRow, mode: "hybrid" }).mode).toBe("hybrid");
  });

  it("defaults invalid mode to hybrid", () => {
    expect(normalizeMatchRun({ ...baseRow, mode: "invalid" }).mode).toBe("hybrid");
  });

  it("parses valid status", () => {
    expect(normalizeMatchRun({ ...baseRow, status: "completed" }).status).toBe("completed");
    expect(normalizeMatchRun({ ...baseRow, status: "failed" }).status).toBe("failed");
    expect(normalizeMatchRun({ ...baseRow, status: "processing" }).status).toBe("processing");
  });

  it("defaults invalid status to processing", () => {
    expect(normalizeMatchRun({ ...baseRow, status: "unknown" }).status).toBe("processing");
  });

  it("maps optional fields", () => {
    const result = normalizeMatchRun({
      ...baseRow,
      session_id: "sess_1",
      sample_name: "Sample A",
      matched_count: 80,
      avg_score: 72.5,
      completed_at: "2026-05-22T09:30:00Z",
      error: "Some error",
    });
    expect(result.sessionId).toBe("sess_1");
    expect(result.sampleName).toBe("Sample A");
    expect(result.matchedCount).toBe(80);
    expect(result.avgScore).toBe(72.5);
    expect(result.completedAt).toBe("2026-05-22T09:30:00Z");
    expect(result.error).toBe("Some error");
  });

  it("handles null matchedCount and avgScore", () => {
    const result = normalizeMatchRun({ ...baseRow, matched_count: null, avg_score: null });
    expect(result.matchedCount).toBeUndefined();
    expect(result.avgScore).toBeUndefined();
  });

  it("handles missing optional fields", () => {
    const result = normalizeMatchRun(baseRow);
    expect(result.sessionId).toBeUndefined();
    expect(result.sampleName).toBeUndefined();
    expect(result.matchedCount).toBeUndefined();
    expect(result.avgScore).toBeUndefined();
    expect(result.completedAt).toBeUndefined();
    expect(result.error).toBeUndefined();
  });
});
