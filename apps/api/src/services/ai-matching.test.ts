import { describe, expect, it } from "vitest";

import { AIMatchingService } from "./ai-matching.js";

class CapturingAIMatchingService extends AIMatchingService {
    public lastMessages: Array<{ role: string; content: string }> = [];

    override async callLLM(messages: Array<{ role: string; content: string }>): Promise<string> {
        this.lastMessages = messages;
        return JSON.stringify({
            score: 86,
            recommendation: "strong_match",
            highlights: ["CNC experience"],
            concerns: [],
            summary: "Strong CNC sales fit",
            breakdown: {
                related_exp: 86,
                industry_db: 60,
            },
        });
    }
}

describe("AIMatchingService", () => {
    it("hydrates verified companies from companyHits and caps non-sales profiles", async () => {
        const service = new CapturingAIMatchingService();
        const result = await service.matchResume({
            resume: {
                id: "resume-1",
                name: "赵先生",
                workExperience: 8,
                education: "中专",
                skills: ["CNC", "调试"],
                companies: ["深圳市玄羽科技有限公司"],
                companyHits: ["FANUC", "三菱"],
                roleSignals: [
                    {
                        type: "engineer",
                        matchedSignals: ["工程师", "调试"],
                        signalCount: 2,
                        occurrences: 2,
                        years: 3.9,
                        industryVerifiedYears: 0,
                        roleRelevantYears: 3.9,
                        verifyIn: "workHistory",
                    },
                ],
                workHistory: "2023-03 ~ 2024-09 深圳市玄羽科技有限公司 应用工程师",
                sourceKey: "convex",
            },
            jobDescription: {
                title: "销售 CNC",
                requirements: "销售 CNC 设备",
                responsibilities: "销售、客户开发、订单推进",
            },
        });

        expect(service.lastMessages).toHaveLength(2);
        const promptContent = service.lastMessages[1]?.content ?? "";
        expect(promptContent).toContain("行业数据库验证公司**: FANUC, 三菱");
        expect(promptContent).toContain("岗位信号");
        expect(promptContent.match(/行业数据库验证公司\*\*: ([^\n]+)/)?.[1]).toBe("FANUC, 三菱");
        expect(result.score).toBe(49);
        expect(result.recommendation).toBe("potential");
        expect(result.summary).toBe("Strong CNC sales fit");
    });
});
