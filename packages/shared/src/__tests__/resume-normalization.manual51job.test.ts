import { describe, expect, it } from "vitest";

import { parse51jobManualResume } from "../resume-normalization";

describe("resume-normalization manual 51job", () => {
  it("does not promote narrative fragments into companyName", () => {
    const text = [
      "王先生",
      "工作经历",
      "2018.05 - 2020.11（2年6个月）",
      "职位：销售代表",
      "工作描述：",
      "在该公司主要负责以电话开发客户，然后通过线上交流沟通，线下上门拜访客户的方式来完成与客户的合作。",
      "长沙冠聚信息技术有限公司",
      "2017.06 - 2018.01（7个月）",
      "职位：电话销售",
      "工作描述：通过公司提供的客户资源进行电话联系，开发意向客户。",
    ].join("\n");

    const parsed = parse51jobManualResume({ text });

    expect(parsed.workHistory).toEqual(expect.arrayContaining([
      expect.objectContaining({
        companyName: "长沙冠聚信息技术有限公司",
        jobTitle: "销售代表",
        startDate: "2018-05",
        endDate: "2020-11",
      }),
      expect.objectContaining({
        jobTitle: "电话销售",
        startDate: "2017-06",
        endDate: "2018-01",
      }),
    ]));

    expect(parsed.workHistory.some((entry) => entry.companyName === "在该公司")).toBe(false);
    expect(parsed.workHistory.some((entry) => entry.companyName === "通过公司")).toBe(false);
  });

  it("does not treat duration lines as job titles or generic nouns as companies", () => {
    const text = [
      "工作经历",
      "加工中心 2025.05-2025.07（2个月）",
      "2022.01-2025.04（3年3个月）",
    ].join("\n");

    const parsed = parse51jobManualResume({ text });

    expect(parsed.workHistory.some((entry) => entry.companyName === "加工中心")).toBe(false);
    expect(parsed.workHistory.some((entry) => entry.jobTitle === "2025.05-2025.07 2个月")).toBe(false);
    expect(parsed.workHistory.some((entry) => typeof entry.jobTitle === "string" && /\d{4}/u.test(entry.jobTitle))).toBe(false);
  });
});
