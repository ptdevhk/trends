import { describe, expect, it } from "vitest";

import {
  isSalesRequiredContext,
  resolveResumeDiagnosticsSourceKey,
} from "../analysis-key";

describe("isSalesRequiredContext", () => {
  it("detects common English sales-title phrases", () => {
    expect(isSalesRequiredContext("account manager")).toBe(true);
    expect(isSalesRequiredContext("key account manager")).toBe(true);
    expect(isSalesRequiredContext("business development manager")).toBe(true);
    expect(isSalesRequiredContext("channel manager")).toBe(true);
  });

  it("detects Chinese sales terms", () => {
    expect(isSalesRequiredContext("销售经理")).toBe(true);
    expect(isSalesRequiredContext("客户开发")).toBe(true);
    expect(isSalesRequiredContext("业务拓展")).toBe(true);
  });

  it("does not classify non-sales technical titles as sales", () => {
    expect(isSalesRequiredContext("应用工程师")).toBe(false);
    expect(isSalesRequiredContext("机械工程师")).toBe(false);
  });
});

describe("resolveResumeDiagnosticsSourceKey", () => {
  it("keeps manual 51job imports as their own diagnostics key", () => {
    expect(resolveResumeDiagnosticsSourceKey({ source: "51job-manual" })).toBe("51job-manual");
    expect(resolveResumeDiagnosticsSourceKey({ sourceKey: "51job-manual" })).toBe("51job-manual");
  });

  it("maps live source hosts to grouped diagnostics keys", () => {
    expect(resolveResumeDiagnosticsSourceKey({ source: "hr.job5156.com" })).toBe("job5156");
    expect(resolveResumeDiagnosticsSourceKey({ source: "ehire.51job.com" })).toBe("51job");
    expect(resolveResumeDiagnosticsSourceKey({ source: "my.employer.seek.com" })).toBe("seek");
  });

  it("returns unknown for unmatched source values", () => {
    expect(resolveResumeDiagnosticsSourceKey({ source: "manual.51job.com" })).toBe("unknown");
    expect(resolveResumeDiagnosticsSourceKey({ source: "unknown-host.example.com" })).toBe("unknown");
    expect(resolveResumeDiagnosticsSourceKey({ source: "" })).toBe("unknown");
  });
});
