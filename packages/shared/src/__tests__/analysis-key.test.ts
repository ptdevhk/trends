import { describe, expect, it } from "vitest";

import { isSalesRequiredContext } from "../analysis-key";

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
