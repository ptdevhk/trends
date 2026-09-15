import { describe, expect, it } from "vitest";
import { isExportFieldKey } from "./export-fields-config.js";

describe("isExportFieldKey", () => {
  it("accepts known export field keys", () => {
    expect(isExportFieldKey("resumeId")).toBe(true);
    expect(isExportFieldKey("name")).toBe(true);
  });

  it("rejects non-strings and unknown keys", () => {
    expect(isExportFieldKey(null)).toBe(false);
    expect(isExportFieldKey(undefined)).toBe(false);
    expect(isExportFieldKey(1)).toBe(false);
    expect(isExportFieldKey({ key: "resumeId" })).toBe(false);
    expect(isExportFieldKey("notAField")).toBe(false);
    expect(isExportFieldKey("ResumeId")).toBe(false);
    expect(isExportFieldKey("")).toBe(false);
  });
});
