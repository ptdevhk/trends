import { describe, it, expect } from "vitest";
import {
  isRecord,
  readString,
  readNumber,
  readErrorCode,
  splitFrontmatter,
  parseMarkdownPreview,
  toMetadata,
} from "../config-source-inspector.js";

describe("isRecord", () => {
  it("returns true for plain objects", () => {
    expect(isRecord({})).toBe(true);
  });

  it("returns false for null", () => {
    expect(isRecord(null)).toBe(false);
  });

  it("returns false for arrays", () => {
    expect(isRecord([])).toBe(false);
  });

  it("returns false for primitives", () => {
    expect(isRecord("str")).toBe(false);
    expect(isRecord(42)).toBe(false);
  });
});

describe("readString", () => {
  it("returns trimmed string for valid input", () => {
    expect(readString("  hello  ")).toBe("hello");
  });

  it("returns undefined for empty/whitespace-only string", () => {
    expect(readString("")).toBeUndefined();
    expect(readString("   ")).toBeUndefined();
  });

  it("returns undefined for non-string input", () => {
    expect(readString(42)).toBeUndefined();
    expect(readString(null)).toBeUndefined();
  });
});

describe("readNumber", () => {
  it("returns number for finite values", () => {
    expect(readNumber(42)).toBe(42);
    expect(readNumber(0)).toBe(0);
  });

  it("returns undefined for non-number input", () => {
    expect(readNumber("42")).toBeUndefined();
    expect(readNumber(null)).toBeUndefined();
  });

  it("returns undefined for NaN and Infinity", () => {
    expect(readNumber(NaN)).toBeUndefined();
    expect(readNumber(Infinity)).toBeUndefined();
  });
});

describe("readErrorCode", () => {
  it("returns code string from error object", () => {
    expect(readErrorCode({ code: "ENOENT" })).toBe("ENOENT");
  });

  it("returns undefined for object without code", () => {
    expect(readErrorCode({ message: "fail" })).toBeUndefined();
  });

  it("returns undefined for non-object input", () => {
    expect(readErrorCode(null)).toBeUndefined();
    expect(readErrorCode("error")).toBeUndefined();
  });

  it("returns undefined when code is not a string", () => {
    expect(readErrorCode({ code: 42 })).toBeUndefined();
  });
});

describe("splitFrontmatter", () => {
  it("splits YAML frontmatter from body", () => {
    const result = splitFrontmatter("---\ntitle: Test\nversion: 1\n---\nBody content");
    expect(result.frontmatter).toEqual({ title: "Test", version: 1 });
    expect(result.body).toBe("Body content");
  });

  it("returns no frontmatter when missing", () => {
    const result = splitFrontmatter("Just body content");
    expect(result.frontmatter).toBeUndefined();
    expect(result.body).toBe("Just body content");
  });

  it("returns no frontmatter when closing --- is missing", () => {
    const result = splitFrontmatter("---\ntitle: Test\nNo closing");
    expect(result.frontmatter).toBeUndefined();
    expect(result.body).toBe("---\ntitle: Test\nNo closing");
  });

  it("handles empty body after frontmatter", () => {
    const result = splitFrontmatter("---\ntitle: Test\n---\n");
    expect(result.frontmatter).toEqual({ title: "Test" });
    expect(result.body).toBe("");
  });

  it("returns undefined frontmatter for non-object YAML", () => {
    const result = splitFrontmatter("---\n- item1\n- item2\n---\nBody");
    expect(result.frontmatter).toBeUndefined();
    expect(result.body).toBe("Body");
  });
});

describe("parseMarkdownPreview", () => {
  it("parses sections from markdown", () => {
    const md = "## Overview\nSome text\n## Details\nMore text";
    const result = parseMarkdownPreview(md);
    expect(result.sections).toHaveLength(2);
    expect(result.sections[0]?.heading).toBe("Overview");
    expect(result.sections[1]?.heading).toBe("Details");
  });

  it("parses subsections", () => {
    const md = "## Section\n### Sub A\n### Sub B\nContent";
    const result = parseMarkdownPreview(md);
    expect(result.sections[0]?.subsectionHeadings).toEqual(["Sub A", "Sub B"]);
  });

  it("ignores headings inside code fences", () => {
    const md = "## Section\n```\n## Not a heading\n```\nContent";
    const result = parseMarkdownPreview(md);
    expect(result.sections).toHaveLength(1);
    expect(result.sections[0]?.heading).toBe("Section");
  });

  it("counts lines per section", () => {
    const md = "## Section\nLine 1\nLine 2\nLine 3";
    const result = parseMarkdownPreview(md);
    expect(result.sections[0]?.lineCount).toBe(3);
  });

  it("parses frontmatter and sections together", () => {
    const md = "---\ntitle: Doc\n---\n## Intro\nHello";
    const result = parseMarkdownPreview(md);
    expect(result.frontmatter).toEqual({ title: "Doc" });
    expect(result.sections[0]?.heading).toBe("Intro");
  });

  it("returns empty sections for plain text", () => {
    const result = parseMarkdownPreview("Just plain text\nNo headings");
    expect(result.sections).toHaveLength(0);
  });

  it("handles markdown with no content after heading", () => {
    const md = "## Empty Section";
    const result = parseMarkdownPreview(md);
    expect(result.sections).toHaveLength(1);
    expect(result.sections[0]?.lineCount).toBe(0);
  });
});

describe("toMetadata", () => {
  it("extracts metadata from frontmatter", () => {
    const result = toMetadata({ version: 2, updated_at: "2026-05-22", description: "Test" });
    expect(result).toEqual({
      version: 2,
      updatedAt: "2026-05-22",
      description: "Test",
    });
  });

  it("supports updatedAt alias", () => {
    const result = toMetadata({ updatedAt: "2026-05-22" });
    expect(result?.updatedAt).toBe("2026-05-22");
  });

  it("returns undefined for empty frontmatter", () => {
    expect(toMetadata({})).toBeUndefined();
  });

  it("returns undefined for undefined input", () => {
    expect(toMetadata(undefined)).toBeUndefined();
  });

  it("ignores non-number version", () => {
    const result = toMetadata({ version: "2" });
    expect(result?.version).toBeUndefined();
  });

  it("ignores empty description", () => {
    const result = toMetadata({ description: "  " });
    expect(result?.description).toBeUndefined();
  });

  it("returns metadata with only valid fields", () => {
    const result = toMetadata({ version: 1, foo: "bar" });
    expect(result).toEqual({ version: 1 });
  });
});
