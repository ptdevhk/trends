import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { describe, it, expect, vi } from "vitest";
import {
  WebVitalsLogger,
  readString,
  readNumber,
  parseMetric,
  percentile,
} from "../web-vitals-logger.js";

describe("readString", () => {
  it("returns trimmed string for valid input", () => {
    expect(readString("  hello  ")).toBe("hello");
  });

  it("returns null for non-string input", () => {
    expect(readString(42)).toBeNull();
    expect(readString(null)).toBeNull();
    expect(readString(undefined)).toBeNull();
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
    expect(readNumber(-1.5)).toBe(-1.5);
  });

  it("returns null for non-number input", () => {
    expect(readNumber("42")).toBeNull();
    expect(readNumber(null)).toBeNull();
    expect(readNumber(undefined)).toBeNull();
  });

  it("returns null for NaN and Infinity", () => {
    expect(readNumber(NaN)).toBeNull();
    expect(readNumber(Infinity)).toBeNull();
    expect(readNumber(-Infinity)).toBeNull();
  });
});

describe("parseMetric", () => {
  const validInput = {
    name: "LCP",
    value: 1.5,
    rating: "good",
    id: "v3-abc123",
    navigationType: "navigate",
    workspace: "default",
    timestamp: 1700000000000,
  };

  it("parses a valid metric", () => {
    const result = parseMetric(validInput);
    expect(result).toEqual(validInput);
  });

  it("returns null for non-object input", () => {
    expect(parseMetric(null)).toBeNull();
    expect(parseMetric("string")).toBeNull();
    expect(parseMetric(42)).toBeNull();
  });

  it("returns null when name is missing", () => {
    expect(parseMetric({ ...validInput, name: "" })).toBeNull();
  });

  it("returns null when value is missing", () => {
    expect(parseMetric({ ...validInput, value: null })).toBeNull();
  });

  it("returns null when rating is invalid", () => {
    expect(parseMetric({ ...validInput, rating: "excellent" })).toBeNull();
  });

  it("accepts needs-improvement rating", () => {
    const result = parseMetric({ ...validInput, rating: "needs-improvement" });
    expect(result?.rating).toBe("needs-improvement");
  });

  it("accepts poor rating", () => {
    const result = parseMetric({ ...validInput, rating: "poor" });
    expect(result?.rating).toBe("poor");
  });

  it("returns null when id is missing", () => {
    expect(parseMetric({ ...validInput, id: null })).toBeNull();
  });

  it("returns null when navigationType is missing", () => {
    expect(parseMetric({ ...validInput, navigationType: "" })).toBeNull();
  });

  it("returns null when workspace is missing", () => {
    expect(parseMetric({ ...validInput, workspace: undefined })).toBeNull();
  });

  it("returns null when timestamp is missing", () => {
    expect(parseMetric({ ...validInput, timestamp: NaN })).toBeNull();
  });
});

describe("percentile", () => {
  it("returns 0 for empty array", () => {
    expect(percentile([], 50)).toBe(0);
  });

  it("computes p50 (median)", () => {
    expect(percentile([1, 2, 3, 4, 5], 50)).toBe(3);
  });

  it("computes p95", () => {
    const result = percentile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 95);
    expect(result).toBeGreaterThanOrEqual(9);
    expect(result).toBeLessThanOrEqual(10);
  });

  it("computes p75", () => {
    const result = percentile([1, 2, 3, 4], 75);
    expect(result).toBe(3);
  });

  it("handles single-element array", () => {
    expect(percentile([42], 50)).toBe(42);
    expect(percentile([42], 95)).toBe(42);
  });

  it("handles p0 and p100", () => {
    expect(percentile([1, 2, 3], 0)).toBe(1);
    expect(percentile([1, 2, 3], 100)).toBe(3);
  });
});

describe("WebVitalsLogger", () => {
  it("logs malformed JSONL lines while summarizing valid metrics", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "web-vitals-logger-"));
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);

    try {
      fs.mkdirSync(path.join(root, "output"), { recursive: true });
      fs.writeFileSync(
        path.join(root, "output", "web-vitals.jsonl"),
        [
          "{bad json",
          JSON.stringify({
            name: "LCP",
            value: 1.5,
            rating: "good",
            id: "v3-abc123",
            navigationType: "navigate",
            workspace: "default",
            timestamp: Date.now(),
          }),
        ].join("\n"),
        "utf8",
      );

      const summary = new WebVitalsLogger(root).getSummary(24);

      expect(summary.totalReports).toBe(1);
      expect(summary.metrics.LCP).toMatchObject({ p50: 1.5, good: 1 });
      expect(errorSpy).toHaveBeenCalledWith(
        expect.stringContaining("Failed to parse web vitals log line"),
        expect.any(SyntaxError),
      );
    } finally {
      errorSpy.mockRestore();
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});
