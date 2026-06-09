import { describe, expect, it } from "vitest";

import { normalizeResumeLocationHierarchy } from "../resume-normalization";

describe("normalizeResumeLocationHierarchy with source fallback", () => {
  it("returns explicit location hierarchy when present", () => {
    const result = normalizeResumeLocationHierarchy({
      location: "Kuala Lumpur",
      source: "seek",
    });
    expect(result?.country).toBe("Malaysia");
    expect(result?.confidence).toBe("high");
  });

  it("falls back to Malaysia from seek source when location is empty", () => {
    const result = normalizeResumeLocationHierarchy({
      location: "",
      source: "seek",
    });
    expect(result).toEqual(
      expect.objectContaining({
        country: "Malaysia",
        matchedFrom: "source",
        confidence: "low",
      }),
    );
  });

  it("falls back to Malaysia from seek hostname when location is empty", () => {
    const result = normalizeResumeLocationHierarchy(
      { location: "", source: "my.employer.seek.com" },
    );
    expect(result).toEqual(
      expect.objectContaining({
        country: "Malaysia",
        matchedFrom: "source",
        confidence: "low",
      }),
    );
  });

  it("falls back to Malaysia via explicit source param", () => {
    const result = normalizeResumeLocationHierarchy(
      { name: "Test Resume", location: "" },
      "my.employer.seek.com",
    );
    expect(result).toEqual(
      expect.objectContaining({
        country: "Malaysia",
        matchedFrom: "source",
      }),
    );
  });

  it("falls back to 中国 from job5156 hostname when location is empty", () => {
    const result = normalizeResumeLocationHierarchy({
      location: "",
      source: "hr.job5156.com",
    });
    expect(result).toEqual(
      expect.objectContaining({
        country: "中国",
        matchedFrom: "source",
      }),
    );
  });

  it("falls back to 中国 from 51job source when location is empty", () => {
    const result = normalizeResumeLocationHierarchy({
      location: "",
      source: "51job",
    });
    expect(result).toEqual(
      expect.objectContaining({
        country: "中国",
        matchedFrom: "source",
      }),
    );
  });

  it("overrides stale explicit hierarchy when 51job source implies China", () => {
    const result = normalizeResumeLocationHierarchy({
      location: "武汉",
      source: "ehire.51job.com",
      locationHierarchy: {
        country: "Malaysia",
        province: "Selangor",
        matchedFrom: "location",
        confidence: "high",
      },
    });

    expect(result).toEqual(
      expect.objectContaining({
        country: "中国",
        matchedFrom: "source",
        confidence: "low",
      }),
    );
  });

  it("returns undefined when no candidates and no known source", () => {
    const result = normalizeResumeLocationHierarchy({
      location: "",
      source: "unknown-source",
    });
    expect(result).toBeUndefined();
  });

  it("falls back to 中国 from 51job source when work history locations conflict", () => {
    const result = normalizeResumeLocationHierarchy({
      location: "徐州",
      source: "ehire.51job.com",
      workHistory: [
        { companyName: "常州天陨机械有限公司", jobTitle: "CNC/数控操机" },
        { companyName: "无锡能达汽车销售服务有限公司", jobTitle: "汽车喷漆" },
      ],
    });

    expect(result).toEqual(
      expect.objectContaining({
        country: "中国",
        matchedFrom: "source",
        confidence: "low",
      }),
    );
  });

  it("falls back to 中国 from job5156 source when detailed work history locations conflict", () => {
    const result = normalizeResumeLocationHierarchy({
      location: "",
      source: "hr.job5156.com",
      workHistory: [
        { companyName: "东莞市品杨五金科技有限公司", description: "销售、CNC、生产管理" },
        { companyName: "毅嘉电子（苏州）有限公司", description: "销售和制造协作" },
      ],
    });

    expect(result).toEqual(
      expect.objectContaining({
        country: "中国",
        matchedFrom: "source",
        confidence: "low",
      }),
    );
  });
});
