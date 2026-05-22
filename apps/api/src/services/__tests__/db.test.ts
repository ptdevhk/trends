import { describe, it, expect } from "vitest";
import { formatDate, formatChineseDate, parseIsoDate } from "../db.js";

describe("formatDate", () => {
  it("formats a date in ISO format", () => {
    const date = new Date(2026, 4, 22); // May 22, 2026
    expect(formatDate(date)).toBe("2026-05-22");
  });

  it("pads single-digit month and day", () => {
    const date = new Date(2026, 0, 5); // Jan 5, 2026
    expect(formatDate(date)).toBe("2026-01-05");
  });

  it("formats end of year", () => {
    const date = new Date(2026, 11, 31); // Dec 31, 2026
    expect(formatDate(date)).toBe("2026-12-31");
  });

  it("formats start of year", () => {
    const date = new Date(2026, 0, 1); // Jan 1, 2026
    expect(formatDate(date)).toBe("2026-01-01");
  });
});

describe("formatChineseDate", () => {
  it("formats a date in Chinese format", () => {
    const date = new Date(2026, 4, 22); // May 22, 2026
    expect(formatChineseDate(date)).toBe("2026年05月22日");
  });

  it("pads single-digit month and day", () => {
    const date = new Date(2026, 0, 5); // Jan 5, 2026
    expect(formatChineseDate(date)).toBe("2026年01月05日");
  });
});

describe("parseIsoDate", () => {
  it("parses a valid ISO date string", () => {
    const result = parseIsoDate("2026-05-22");
    expect(result.getFullYear()).toBe(2026);
    expect(result.getMonth()).toBe(4); // 0-indexed
    expect(result.getDate()).toBe(22);
  });

  it("parses January 1", () => {
    const result = parseIsoDate("2026-01-01");
    expect(result.getFullYear()).toBe(2026);
    expect(result.getMonth()).toBe(0);
    expect(result.getDate()).toBe(1);
  });

  it("parses December 31", () => {
    const result = parseIsoDate("2026-12-31");
    expect(result.getFullYear()).toBe(2026);
    expect(result.getMonth()).toBe(11);
    expect(result.getDate()).toBe(31);
  });

  it("throws for invalid date format", () => {
    expect(() => parseIsoDate("not-a-date")).toThrow("Invalid date: not-a-date");
  });

  it("throws for partial date", () => {
    expect(() => parseIsoDate("2026-05")).toThrow("Invalid date: 2026-05");
  });

  it("throws for empty string", () => {
    expect(() => parseIsoDate("")).toThrow("Invalid date: ");
  });

  it("throws for date with time component", () => {
    expect(() => parseIsoDate("2026-05-22T10:00:00")).toThrow("Invalid date: 2026-05-22T10:00:00");
  });

  it("round-trips with formatDate", () => {
    const original = new Date(2026, 4, 22);
    const formatted = formatDate(original);
    const parsed = parseIsoDate(formatted);
    expect(formatDate(parsed)).toBe(formatted);
  });
});
