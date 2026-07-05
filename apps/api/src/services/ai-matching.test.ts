import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AIMatchingService } from "./ai-matching.js";

class FailingAIMatchingService extends AIMatchingService {
    override async callLLM(): Promise<string> {
        throw new Error("test error");
    }
}

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
    beforeEach(() => {
        vi.stubEnv("AI_OUTPUT_LOCALE", "");
    });

    afterEach(() => {
        vi.unstubAllEnvs();
    });

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
        expect(promptContent).toContain("**市场**: CN");
        expect(promptContent).toContain("行业数据库验证公司**: FANUC, 三菱");
        expect(promptContent).toContain("**行业数据库品牌命中**: 无");
        expect(promptContent).toContain("岗位信号");
        expect(promptContent.match(/行业数据库验证公司\*\*: ([^\n]+)/)?.[1]).toBe("FANUC, 三菱");
        expect(result.score).toBe(86);
        expect(result.recommendation).toBe("strong_match");
        expect(result.summary).toBe("Strong CNC sales fit");
    });

    it("uses English fallback labels for seek prompt hydration", async () => {
        const service = new CapturingAIMatchingService();
        await service.matchResume({
            resume: {
                id: "resume-seek-1",
                name: "Alice",
                sourceKey: "seek",
                roleSignals: [
                    {
                        type: "sales",
                        matchedSignals: ["CNC sales", "key accounts"],
                        signalCount: 2,
                        occurrences: 2,
                        years: 4,
                        industryVerifiedYears: 4,
                        roleRelevantYears: 4,
                        verifyIn: "workHistory",
                        matchedWorkEntries: [
                            {
                                companyName: "Acme Machine Tools",
                                jobTitle: "Sales Engineer",
                                years: 2,
                                industryVerified: true,
                                matchedSignals: ["CNC sales"],
                            },
                        ],
                    },
                ],
            },
            jobDescription: {
                title: "Sales Engineer",
                requirements: "Sell CNC equipment",
            },
        });

        const promptContent = service.lastMessages[1]?.content ?? "";
        expect(promptContent).toContain("**Market**: MY");
        expect(promptContent).toContain("**Industry Database Verified Companies**: none");
        expect(promptContent).toContain("**Industry Database Brand Hits**: none");
        expect(promptContent).toContain("**Work-History Evidence**:\nNo work history provided");
        expect(promptContent).toContain("**Role Signals**:");
        expect(promptContent).toContain("2 years verified");
        expect(promptContent).toContain("signals:CNC sales");
        expect(promptContent).not.toContain("已验证");
        expect(promptContent).not.toContain("信号:");
        expect(promptContent).not.toContain("2年");
    });

    it("returns locale-aware error summaries for seek resumes when matching fails", async () => {
        const service = new FailingAIMatchingService();
        const result = await service.matchResume({
            resume: {
                id: "resume-seek-err",
                name: "Alice",
                sourceKey: "seek",
            },
            jobDescription: {
                title: "Sales Engineer",
                requirements: "Sell CNC equipment",
            },
        });

        expect(result.score).toBe(0);
        expect(result.recommendation).toBe("no_match");
        expect(result.summary).toBe("An error occurred during AI analysis");
        expect(result.concerns[0]).toContain("AI analysis failed");
        expect(result.concerns[0]).not.toContain("AI分析失败");
    });

    it("returns Chinese error summaries for default locale resumes when matching fails", async () => {
        const service = new FailingAIMatchingService();
        const result = await service.matchResume({
            resume: {
                id: "resume-job5156-err",
                name: "张先生",
                sourceKey: "job5156",
            },
            jobDescription: {
                title: "销售 CNC",
                requirements: "销售 CNC 设备",
            },
        });

        expect(result.score).toBe(0);
        expect(result.recommendation).toBe("no_match");
        expect(result.summary).toBe("AI分析过程中发生错误");
        expect(result.concerns[0]).toContain("AI分析失败");
    });

    it("applies analysis field usage policy overrides when hydrating prompts", async () => {
        const service = new CapturingAIMatchingService();
        await service.matchResume(
            {
                resume: {
                    id: "resume-policy-1",
                    name: "Alice",
                    sourceKey: "seek",
                    companyHits: ["FANUC"],
                    workHistory: "2020-2024 Acme Machine Tools Sales Engineer",
                },
                jobDescription: {
                    title: "Sales Engineer",
                    requirements: "Sell CNC equipment",
                },
            },
            {
                fieldUsagePolicy: {
                    fields: {
                        companyHits: {
                            surfaces: {
                                analysis: false,
                            },
                        },
                        workHistory: {
                            surfaces: {
                                analysis: false,
                            },
                        },
                    },
                },
            },
        );

        const promptContent = service.lastMessages[1]?.content ?? "";
        expect(promptContent).toContain("**Industry Database Verified Companies**: none");
        expect(promptContent).toContain("**Work-History Evidence**:\nNo work history provided");
        // "FANUC" now appears in the keyFactors output contract example — only check
        // that candidate-specific data is scrubbed
        expect(promptContent).not.toContain("Acme Machine Tools");
    });
});
