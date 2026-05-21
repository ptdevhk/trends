import { describe, expect, it } from "vitest"
import {
  hasStructuredSeedFields,
  parseOptionalNumber,
  sanitizeIndustryTags,
} from "./jd-editor-utils"

describe("parseOptionalNumber", () => {
  it("returns undefined for empty string", () => {
    expect(parseOptionalNumber("")).toBeUndefined()
  })

  it("returns undefined for whitespace-only string", () => {
    expect(parseOptionalNumber("   ")).toBeUndefined()
  })

  it("parses integer string", () => {
    expect(parseOptionalNumber("5")).toBe(5)
  })

  it("parses negative integer string", () => {
    expect(parseOptionalNumber("-3")).toBe(-3)
  })

  it("truncates decimal to integer", () => {
    expect(parseOptionalNumber("3.7")).toBe(3)
  })

  it("truncates negative decimal toward zero", () => {
    expect(parseOptionalNumber("-2.9")).toBe(-2)
  })

  it("returns undefined for non-numeric string", () => {
    expect(parseOptionalNumber("abc")).toBeUndefined()
  })

  it("returns undefined for Infinity", () => {
    expect(parseOptionalNumber("Infinity")).toBeUndefined()
  })

  it("trims whitespace before parsing", () => {
    expect(parseOptionalNumber("  10  ")).toBe(10)
  })

  it("parses zero", () => {
    expect(parseOptionalNumber("0")).toBe(0)
  })
})

describe("sanitizeIndustryTags", () => {
  it("returns empty array for undefined input", () => {
    expect(sanitizeIndustryTags(undefined)).toEqual([])
  })

  it("returns empty array for empty array input", () => {
    expect(sanitizeIndustryTags([])).toEqual([])
  })

  it("normalizes valid canonical tags (lowercase)", () => {
    const result = sanitizeIndustryTags(["machinery", "software"])
    expect(result).toContain("machinery")
    expect(result).toContain("software")
  })

  it("lowercases and maps legacy tags to canonical", () => {
    const result = sanitizeIndustryTags(["CNC"])
    expect(result).toEqual(["machinery"])
  })

  it("filters out unrecognized tags", () => {
    const result = sanitizeIndustryTags(["machinery", "InvalidTag123"])
    expect(result).toEqual(["machinery"])
  })
})

describe("hasStructuredSeedFields", () => {
  it("returns false for undefined input", () => {
    expect(hasStructuredSeedFields(undefined)).toBe(false)
  })

  it("returns false when all fields are empty/undefined", () => {
    expect(hasStructuredSeedFields({
      location: undefined,
      industryTags: undefined,
      customKeywords: undefined,
      minExperience: undefined,
      maxExperience: undefined,
      minAge: undefined,
      maxAge: undefined,
    })).toBe(false)
  })

  it("returns true when location is set", () => {
    expect(hasStructuredSeedFields({
      location: "Dongguan",
    })).toBe(true)
  })

  it("returns false for whitespace-only location", () => {
    expect(hasStructuredSeedFields({
      location: "   ",
    })).toBe(false)
  })

  it("returns true when industryTags has items", () => {
    expect(hasStructuredSeedFields({
      industryTags: ["Manufacturing"],
    })).toBe(true)
  })

  it("returns false when industryTags is empty array", () => {
    expect(hasStructuredSeedFields({
      industryTags: [],
    })).toBe(false)
  })

  it("returns true when customKeywords has items", () => {
    expect(hasStructuredSeedFields({
      customKeywords: ["机床"],
    })).toBe(true)
  })

  it("returns true when minExperience is set", () => {
    expect(hasStructuredSeedFields({
      minExperience: 3,
    })).toBe(true)
  })

  it("returns true when maxExperience is set", () => {
    expect(hasStructuredSeedFields({
      maxExperience: 10,
    })).toBe(true)
  })

  it("returns true when minAge is set", () => {
    expect(hasStructuredSeedFields({
      minAge: 25,
    })).toBe(true)
  })

  it("returns true when maxAge is set", () => {
    expect(hasStructuredSeedFields({
      maxAge: 40,
    })).toBe(true)
  })

  it("returns true when multiple fields are set", () => {
    expect(hasStructuredSeedFields({
      location: "Shenzhen",
      industryTags: ["Manufacturing"],
      minExperience: 5,
    })).toBe(true)
  })
})
