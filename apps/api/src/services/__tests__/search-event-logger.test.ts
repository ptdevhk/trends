import { describe, it, expect } from "vitest";
import {
  normalizeQuery,
  readString,
  readNumber,
  parseSearchEvent,
} from "../search-event-logger.js";

describe("normalizeQuery", () => {
  it("returns trimmed string", () => {
    expect(readString("  hello  ")).toBe("hello");
  });

  it("returns null for non-string", () => {
    expect(readString(42)).toBeNull();
    expect(readString(null)).toBeNull();
  });

  it("returns null for empty/whitespace-only string", () => {
    expect(readString("")).toBeNull();
    expect(readString("   ")).toBeNull();
  });
});

describe("readNumber", () => {
  it("returns number for finite values", () => {
    expect(readNumber(42)).toBe(42);
    expect(readNumber(0)).toBe(0);
  });

  it("returns null for non-number", () => {
    expect(readNumber("42")).toBeNull();
    expect(readNumber(null)).toBeNull();
  });

  it("returns null for NaN and Infinity", () => {
    expect(readNumber(NaN)).toBeNull();
    expect(readNumber(Infinity)).toBeNull();
  });
});

describe("parseSearchEvent", () => {
  it("parses a search_query event", () => {
    const result = parseSearchEvent({
      type: "search_query",
      query: "CNC operator",
      resultCount: 25,
      topScore: 85,
      ts: "2026-05-22T10:00:00Z",
    });
    expect(result).toEqual({
      type: "search_query",
      query: "CNC operator",
      resultCount: 25,
      topScore: 85,
      ts: "2026-05-22T10:00:00Z",
    });
  });

  it("parses a search_query event without topScore", () => {
    const result = parseSearchEvent({
      type: "search_query",
      query: "CNC",
      resultCount: 5,
      ts: "2026-05-22T10:00:00Z",
    });
    expect(result).toEqual({
      type: "search_query",
      query: "CNC",
      resultCount: 5,
      topScore: undefined,
      ts: "2026-05-22T10:00:00Z",
    });
  });

  it("parses a search_zero_results event", () => {
    const result = parseSearchEvent({
      type: "search_zero_results",
      query: "rare skill",
      ts: "2026-05-22T10:00:00Z",
    });
    expect(result).toEqual({
      type: "search_zero_results",
      query: "rare skill",
      ts: "2026-05-22T10:00:00Z",
    });
  });

  it("parses a candidate_action shortlist event", () => {
    const result = parseSearchEvent({
      type: "candidate_action",
      resumeId: "resume_1",
      action: "shortlist",
      query: "CNC",
      ts: "2026-05-22T10:00:00Z",
    });
    expect(result).toEqual({
      type: "candidate_action",
      resumeId: "resume_1",
      action: "shortlist",
      query: "CNC",
      ts: "2026-05-22T10:00:00Z",
    });
  });

  it("parses a candidate_action reject event", () => {
    const result = parseSearchEvent({
      type: "candidate_action",
      resumeId: "resume_2",
      action: "reject",
      ts: "2026-05-22T10:00:00Z",
    });
    expect(result).toEqual({
      type: "candidate_action",
      resumeId: "resume_2",
      action: "reject",
      query: undefined,
      ts: "2026-05-22T10:00:00Z",
    });
  });

  it("returns null for non-object input", () => {
    expect(parseSearchEvent(null)).toBeNull();
    expect(parseSearchEvent("string")).toBeNull();
  });

  it("returns null when type is missing", () => {
    expect(parseSearchEvent({ ts: "2026-05-22T10:00:00Z" })).toBeNull();
  });

  it("returns null when ts is missing", () => {
    expect(parseSearchEvent({ type: "search_query" })).toBeNull();
  });

  it("returns null for search_query without query", () => {
    expect(parseSearchEvent({
      type: "search_query",
      resultCount: 5,
      ts: "2026-05-22T10:00:00Z",
    })).toBeNull();
  });

  it("returns null for search_query without resultCount", () => {
    expect(parseSearchEvent({
      type: "search_query",
      query: "CNC",
      ts: "2026-05-22T10:00:00Z",
    })).toBeNull();
  });

  it("returns null for candidate_action with invalid action", () => {
    expect(parseSearchEvent({
      type: "candidate_action",
      resumeId: "resume_1",
      action: "star",
      ts: "2026-05-22T10:00:00Z",
    })).toBeNull();
  });

  it("returns null for unknown event type", () => {
    expect(parseSearchEvent({
      type: "unknown_type",
      ts: "2026-05-22T10:00:00Z",
    })).toBeNull();
  });

  it("returns null for search_zero_results without query", () => {
    expect(parseSearchEvent({
      type: "search_zero_results",
      ts: "2026-05-22T10:00:00Z",
    })).toBeNull();
  });
});
