import { describe, expect, it } from "vitest";

import {
  compareCurrentCncMachineSalesRank,
  currentCncMachineSalesRank,
  isCncLikeSalesSearch,
} from "../cnc-sales-rank.js";

describe("isCncLikeSalesSearch", () => {
  it("is true for CNC 销售 with roleType sales", () => {
    expect(isCncLikeSalesSearch("CNC 销售", "sales")).toBe(true);
    expect(isCncLikeSalesSearch("数控 销售", "sales")).toBe(true);
  });

  it("treats a 销售 token in the query as sales even without roleType", () => {
    expect(isCncLikeSalesSearch("CNC 销售")).toBe(true);
  });

  it("is false without a sales role or CNC-like query", () => {
    expect(isCncLikeSalesSearch("CNC", "engineer")).toBe(false);
    expect(isCncLikeSalesSearch("3D扫描仪 销售", "sales")).toBe(false);
  });
});

describe("currentCncMachineSalesRank", () => {
  it("ranks current 机床销售 above historic-sales QA", () => {
    const currentSales = [{
      jobTitle: "机床销售工程师",
      companyName: "创世纪",
      description: "负责CNC机床销售",
      startDate: "2024-01",
    }];
    const historicSalesNowQa = [
      {
        jobTitle: "品质工程师",
        companyName: "某机械厂",
        description: "质量检验 QA",
        startDate: "2024-01",
      },
      {
        jobTitle: "销售工程师",
        companyName: "数控设备",
        description: "历史CNC销售",
        startDate: "2018-01",
        endDate: "2023-12",
      },
    ];
    expect(currentCncMachineSalesRank(currentSales)).toBe(2);
    expect(currentCncMachineSalesRank(historicSalesNowQa)).toBe(0);
    expect(compareCurrentCncMachineSalesRank(historicSalesNowQa, currentSales)).toBeGreaterThan(0);
  });
});
