import { describe, it, expect } from "vitest";
import { inferExperienceLevelFromYears } from "../ingest-compute-service.js";

describe("inferExperienceLevelFromYears", () => {
  it("returns senior for 7+ years", () => {
    expect(inferExperienceLevelFromYears(7)).toBe("senior");
    expect(inferExperienceLevelFromYears(10)).toBe("senior");
    expect(inferExperienceLevelFromYears(30)).toBe("senior");
  });

  it("returns mid for 3-6 years", () => {
    expect(inferExperienceLevelFromYears(3)).toBe("mid");
    expect(inferExperienceLevelFromYears(5)).toBe("mid");
    expect(inferExperienceLevelFromYears(6)).toBe("mid");
  });

  it("returns junior for 0-2 years", () => {
    expect(inferExperienceLevelFromYears(0)).toBe("junior");
    expect(inferExperienceLevelFromYears(1)).toBe("junior");
    expect(inferExperienceLevelFromYears(2)).toBe("junior");
  });
});
