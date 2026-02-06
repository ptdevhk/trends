import { describe, expect, it } from "vitest";

import { ResumesQuerySchema } from "../../schemas/resumes";

describe("ResumesQuerySchema Unicode delimiter parsing", () => {
  const cases = [
    {
      label: "ASCII comma",
      input: "东莞,深圳",
      expected: ["东莞", "深圳"],
    },
    {
      label: "Full-width comma",
      input: "东莞，深圳",
      expected: ["东莞", "深圳"],
    },
    {
      label: "Enumeration comma",
      input: "东莞、深圳",
      expected: ["东莞", "深圳"],
    },
    {
      label: "Mixed delimiters",
      input: "东莞,深圳，广州、佛山",
      expected: ["东莞", "深圳", "广州", "佛山"],
    },
  ];

  it.each(cases)("parses $label", ({ input, expected }) => {
    const parsed = ResumesQuerySchema.parse({ locations: input });
    expect(parsed.locations).toEqual(expected);
  });
});

describe("ResumesQuerySchema Unicode whitespace normalization", () => {
  it("normalizes full-width space in q", () => {
    const parsed = ResumesQuerySchema.parse({ q: "车床　销售" });
    expect(parsed.q).toBe("车床 销售");
  });

  it("collapses multiple spaces in q", () => {
    const parsed = ResumesQuerySchema.parse({ q: "车床   销售" });
    expect(parsed.q).toBe("车床 销售");
  });

  it("treats whitespace-only q as undefined", () => {
    const parsed = ResumesQuerySchema.parse({ q: "　　" });
    expect(parsed.q).toBeUndefined();
  });
});
