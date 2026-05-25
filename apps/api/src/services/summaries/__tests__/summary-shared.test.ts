import { describe, expect, it } from "vitest";

import { getDefaultTemplateId, getSummaryTitle } from "../summary-shared.js";

describe("getSummaryTitle", () => {
  it("returns daily title for daily period", () => {
    expect(getSummaryTitle("daily")).toBe("Daily Ops Summary");
  });

  it("returns weekly title for weekly period", () => {
    expect(getSummaryTitle("weekly")).toBe("Weekly Ops Summary");
  });

  it("returns monthly title for monthly period", () => {
    expect(getSummaryTitle("monthly")).toBe("Monthly New Candidates Digest");
  });
});

describe("getDefaultTemplateId", () => {
  it("returns summary-daily for daily period", () => {
    expect(getDefaultTemplateId("daily")).toBe("summary-daily");
  });

  it("returns summary-daily for weekly period", () => {
    expect(getDefaultTemplateId("weekly")).toBe("summary-daily");
  });

  it("returns summary-monthly for monthly period", () => {
    expect(getDefaultTemplateId("monthly")).toBe("summary-monthly");
  });
});
