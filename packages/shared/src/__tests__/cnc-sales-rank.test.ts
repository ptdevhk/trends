import { describe, expect, it } from "vitest";

import {
  compareCurrentCncMachineSalesRank,
  compareCurrentCncServiceEngineerRank,
  currentCncMachineSalesRank,
  currentCncServiceEngineerRank,
  isCncLikeSalesSearch,
  isCncLikeServiceEngineerSearch,
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

describe("isCncLikeServiceEngineerSearch", () => {
  it("is true for a CNC service-engineer phrase with roleType engineer", () => {
    expect(isCncLikeServiceEngineerSearch('"CNC" "Service Engineer"', "engineer")).toBe(true);
    expect(isCncLikeServiceEngineerSearch("CNC 服务工程师", "engineer")).toBe(true);
    expect(isCncLikeServiceEngineerSearch("数控 售后工程师", "engineer")).toBe(true);
    expect(isCncLikeServiceEngineerSearch("CNC วิศวกรบริการ", "engineer")).toBe(true);
  });

  it("is true when both service and engineer tokens appear, quoted or not", () => {
    expect(isCncLikeServiceEngineerSearch("CNC service engineer", "engineer")).toBe(true);
    expect(isCncLikeServiceEngineerSearch("数控 technical service", "engineer")).toBe(true);
  });

  it("is false without an engineer roleType", () => {
    expect(isCncLikeServiceEngineerSearch('"CNC" "Service Engineer"', "sales")).toBe(false);
    expect(isCncLikeServiceEngineerSearch('"CNC" "Service Engineer"')).toBe(false);
    expect(isCncLikeServiceEngineerSearch('"CNC" "Service Engineer"', "hr")).toBe(false);
  });

  it("is false for CN CNC sales goldens so the sales ranker is unchanged", () => {
    expect(isCncLikeServiceEngineerSearch("CNC 销售", "sales")).toBe(false);
    expect(isCncLikeServiceEngineerSearch("数控 销售", "sales")).toBe(false);
  });

  it("is false for engineer queries without a CNC-like token", () => {
    expect(isCncLikeServiceEngineerSearch("3D scanner service engineer", "engineer")).toBe(false);
    expect(isCncLikeServiceEngineerSearch("service engineer", "engineer")).toBe(false);
  });
});

describe("currentCncServiceEngineerRank", () => {
  const currentJob = (jobTitle: string, description = "", companyName = "某公司") => [
    { jobTitle, companyName, description, startDate: "2024-01" },
  ];

  it("ranks service engineer + CNC above a service technician without CNC", () => {
    const serviceEngineerCnc = currentJob("CNC Service Engineer", "负责CNC机床售后维修");
    const serviceTechnicianNoCnc = currentJob("Service Technician", "设备维护");
    expect(currentCncServiceEngineerRank(serviceEngineerCnc)).toBe(3);
    expect(currentCncServiceEngineerRank(serviceTechnicianNoCnc)).toBe(2);
    expect(compareCurrentCncServiceEngineerRank(serviceTechnicianNoCnc, serviceEngineerCnc)).toBeGreaterThan(0);
  });

  it("ranks a CNC machinist above an accountant", () => {
    const machinist = currentJob("CNC Machinist", "操作加工中心");
    const accountant = currentJob("Accountant", "负责公司账务");
    expect(currentCncServiceEngineerRank(machinist)).toBe(1);
    expect(currentCncServiceEngineerRank(accountant)).toBe(0);
    expect(compareCurrentCncServiceEngineerRank(accountant, machinist)).toBeGreaterThan(0);
  });

  it("ranks a service technician above a quantity surveyor", () => {
    const serviceTechnician = currentJob("Service Technician", "CNC 设备维修");
    const quantitySurveyor = currentJob("Quantity Surveyor", "工程造价");
    expect(currentCncServiceEngineerRank(serviceTechnician)).toBe(3);
    expect(currentCncServiceEngineerRank(quantitySurveyor)).toBe(0);
    expect(compareCurrentCncServiceEngineerRank(quantitySurveyor, serviceTechnician)).toBeGreaterThan(0);
  });

  it("ranks a service engineer + CNC above an accountant, QS and sales manager", () => {
    const serviceEngineer = currentJob("售后服务工程师", "CNC机床维修");
    const accountant = currentJob("Accountant", "");
    const quantitySurveyor = currentJob("Quantity Surveyor", "");
    const salesManager = currentJob("Sales Manager", "");
    expect(currentCncServiceEngineerRank(serviceEngineer)).toBe(3);
    expect(currentCncServiceEngineerRank(accountant)).toBe(0);
    expect(currentCncServiceEngineerRank(quantitySurveyor)).toBe(0);
    expect(currentCncServiceEngineerRank(salesManager)).toBe(0);
  });

  it("treats Thai service-engineer titles as service + engineer", () => {
    const thai = currentJob("วิศวกรบริการ", "CNC machine maintenance");
    expect(currentCncServiceEngineerRank(thai)).toBe(3);
  });

  it("returns 0 for empty work history", () => {
    expect(currentCncServiceEngineerRank([])).toBe(0);
    expect(currentCncServiceEngineerRank(undefined)).toBe(0);
  });
});
