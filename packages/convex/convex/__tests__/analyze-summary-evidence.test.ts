import { describe, expect, it } from "vitest";

import { USER_PROMPT_TEMPLATE, normalizeResume } from "../analyze";

describe("analyze summary evidence lane", () => {
  it("reads persisted root-level ingestData evidence from a resume doc", () => {
    const normalized = normalizeResume({
      content: {
        name: "杨先生",
        education: "大专",
        experience: "21年",
        workHistory: [
          { raw: "2023-02~至今 江门市东森木业有限公司 业务员" },
          { raw: "2015-04~2022-12 新兴县百利丰不锈钢制品有限公司东莞分厂 CNC编程组长" },
        ],
      },
      ingestData: {
        evidenceText:
          "2023-02~至今 江门市东森木业有限公司 业务员\n2015-04~2022-12 新兴县百利丰不锈钢制品有限公司东莞分厂 cnc编程组长",
      },
    } as unknown);

    expect(normalized.name).toBe("杨先生");
    expect(normalized.evidenceText).toContain("业务员");
    expect(normalized.evidenceText).toContain("cnc编程组长");
    expect(normalized.evidenceText).not.toBe("未填写");
  });

  it("still falls back to content-level ingestData for direct content payloads", () => {
    const normalized = normalizeResume({
      name: "武先生",
      education: "大专",
      workHistory: [{ raw: "2022-11~至今 金维谊 销售代表" }],
      ingestData: {
        evidenceText: "2022-11~至今 金维谊 销售代表",
      },
    } as unknown);

    expect(normalized.evidenceText).toBe("2022-11~至今 金维谊 销售代表");
  });

  it("keeps the active prompt focused on work-history evidence", () => {
    expect(USER_PROMPT_TEMPLATE).toContain("工作经历证据");
    expect(USER_PROMPT_TEMPLATE).toContain("岗位角色、行业背景");
    expect(USER_PROMPT_TEMPLATE).toContain("不要写“未提供具体工作经历”");
  });
});
