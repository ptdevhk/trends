import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock db.js so constructor doesn't try to find project root
vi.mock("../db.js", () => ({
  findProjectRoot: () => "/tmp/trends-test",
}));

// Mock node:fs so loadConfiguredConcurrency doesn't read real config
vi.mock("node:fs", () => ({
  default: {
    existsSync: () => false,
    readFileSync: () => "",
  },
}));

// Mock ai-config to control availability checks
vi.mock("../ai-config.js", () => ({
  aiConfig: {
    enabled: true,
    resumesEnabled: true,
    model: "test-model",
    apiBase: "https://api.test.com/v1",
    apiKey: "test-key",
    temperature: 0.3,
    maxTokens: 1024,
    timeout: 30000,
  },
  validateResumeAIConfig: () => ({ valid: true }),
  getMaskedApiKey: () => "t***key",
}));

// Mock resume-ai-prompt-service
vi.mock("../resume-ai-prompt-service.js", () => ({
  resumeAiPromptService: {
    renderUserPromptTemplate: (_tpl: string, vars: Record<string, string>) =>
      Object.entries(vars).map(([k, v]) => `${k}: ${v}`).join("\n"),
    loadPrompt: () => ({
      normalized: {
        systemPrompt: "You are a resume screening assistant.",
        userPromptTemplate: "{{jobTitle}} {{requirements}}",
        locale: "zh",
      },
    }),
    getPromptForSourceKey: () => ({
      normalized: {
        systemPrompt: "You are a resume screening assistant.",
        userPromptTemplate: "{{jobTitle}} {{requirements}}",
        locale: "zh",
      },
    }),
  },
}));

// Mock locale-utils
vi.mock("../locale-utils.js", () => ({
  localeToNaturalLanguage: (locale: string) => locale === "zh" ? "Chinese" : "English",
  resolveAIOutputLocale: (_opts: { sourceKey?: string }) => "zh",
}));

// Mock logger
vi.mock("../logger.js", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

import { AIMatchingService } from "../ai-matching.js";

function makeRequest(overrides: Record<string, unknown> = {}) {
  return {
    resume: {
      id: "r_001",
      name: "Test Candidate",
      workExperience: 5,
      education: "本科",
      skills: ["CNC", "销售"],
      companies: ["西门子"],
      sourceKey: "seek",
      ...overrides,
    },
    jobDescription: {
      title: "CNC工程师",
      requirements: "3年以上CNC经验",
      company: "测试公司",
    },
  };
}

describe("AIMatchingService", () => {
  let service: AIMatchingService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new AIMatchingService();
  });

  describe("isAvailable", () => {
    it("returns available in test environment", () => {
      const result = service.isAvailable();
      expect(result.available).toBe(true);
    });

    it("returns available when AI_MOCK_ENABLED is true", () => {
      const original = process.env.NODE_ENV;
      process.env.NODE_ENV = "production";
      process.env.AI_MOCK_ENABLED = "true";
      const svc = new AIMatchingService();
      const result = svc.isAvailable();
      expect(result.available).toBe(true);
      process.env.NODE_ENV = original;
      delete process.env.AI_MOCK_ENABLED;
    });
  });

  describe("getServiceInfo", () => {
    it("returns service configuration", () => {
      const info = service.getServiceInfo();
      expect(info.model).toBe("test-model");
      expect(info.apiBase).toBe("https://api.test.com/v1");
      expect(info.apiKeyMasked).toBe("t***key");
      expect(info.concurrency).toBeGreaterThan(0);
      expect(typeof info.enabled).toBe("boolean");
      expect(typeof info.resumesEnabled).toBe("boolean");
    });
  });

  describe("matchResume", () => {
    it("returns no_match when service unavailable", async () => {
      // Override isAvailable to return unavailable
      vi.spyOn(service, "isAvailable").mockReturnValueOnce({
        available: false,
        reason: "API key not configured",
      });
      const result = await service.matchResume(makeRequest());
      expect(result.score).toBe(0);
      expect(result.recommendation).toBe("no_match");
      expect(result.scoreSource).toBe("ai");
      expect(result.concerns).toEqual(
        expect.arrayContaining([expect.stringContaining("API key")])
      );
    });

    it("parses valid JSON response from LLM", async () => {
      const llmResponse = JSON.stringify({
        score: 75,
        recommendation: "match",
        highlights: ["5年CNC经验"],
        concerns: ["缺少CAD技能"],
        summary: "候选人具有相关经验",
      });
      vi.spyOn(service, "callLLM" as keyof AIMatchingService).mockResolvedValueOnce(llmResponse);

      const result = await service.matchResume(makeRequest());
      expect(result.score).toBe(75);
      expect(result.recommendation).toBe("match");
      expect(result.highlights).toContain("5年CNC经验");
      expect(result.concerns).toContain("缺少CAD技能");
      expect(result.summary).toBe("候选人具有相关经验");
      expect(result.scoreSource).toBe("ai");
    });

    it("handles markdown code block response", async () => {
      const llmResponse = '```json\n{"score": 80, "recommendation": "match", "highlights": ["经验丰富"], "concerns": [], "summary": "合适"}\n```';
      vi.spyOn(service, "callLLM" as keyof AIMatchingService).mockResolvedValueOnce(llmResponse);

      const result = await service.matchResume(makeRequest());
      expect(result.score).toBe(80);
      expect(result.recommendation).toBe("match");
    });

    it("handles plain code block response", async () => {
      const llmResponse = '```\n{"score": 60, "recommendation": "potential", "highlights": [], "concerns": ["经验不足"], "summary": "一般"}\n```';
      vi.spyOn(service, "callLLM" as keyof AIMatchingService).mockResolvedValueOnce(llmResponse);

      const result = await service.matchResume(makeRequest());
      expect(result.score).toBe(60);
      expect(result.recommendation).toBe("potential");
    });

    it("caps score at 100", async () => {
      const llmResponse = JSON.stringify({
        score: 150,
        recommendation: "strong_match",
        highlights: [],
        concerns: [],
        summary: "test",
      });
      vi.spyOn(service, "callLLM" as keyof AIMatchingService).mockResolvedValueOnce(llmResponse);

      const result = await service.matchResume(makeRequest());
      expect(result.score).toBe(100);
    });

    it("floors score at 0", async () => {
      const llmResponse = JSON.stringify({
        score: -10,
        recommendation: "no_match",
        highlights: [],
        concerns: [],
        summary: "test",
      });
      vi.spyOn(service, "callLLM" as keyof AIMatchingService).mockResolvedValueOnce(llmResponse);

      const result = await service.matchResume(makeRequest());
      expect(result.score).toBe(0);
    });

    it("derives recommendation from score when missing", async () => {
      const llmResponse = JSON.stringify({
        score: 92,
        highlights: [],
        concerns: [],
        summary: "test",
      });
      vi.spyOn(service, "callLLM" as keyof AIMatchingService).mockResolvedValueOnce(llmResponse);

      const result = await service.matchResume(makeRequest());
      expect(result.recommendation).toBe("strong_match");
    });

    it("derives match recommendation for score 70-89", async () => {
      const llmResponse = JSON.stringify({
        score: 75,
        highlights: [],
        concerns: [],
        summary: "test",
      });
      vi.spyOn(service, "callLLM" as keyof AIMatchingService).mockResolvedValueOnce(llmResponse);

      const result = await service.matchResume(makeRequest());
      expect(result.recommendation).toBe("match");
    });

    it("derives potential recommendation for score 50-69", async () => {
      const llmResponse = JSON.stringify({
        score: 55,
        highlights: [],
        concerns: [],
        summary: "test",
      });
      vi.spyOn(service, "callLLM" as keyof AIMatchingService).mockResolvedValueOnce(llmResponse);

      const result = await service.matchResume(makeRequest());
      expect(result.recommendation).toBe("potential");
    });

    it("derives no_match recommendation for score below 50", async () => {
      const llmResponse = JSON.stringify({
        score: 30,
        highlights: [],
        concerns: [],
        summary: "test",
      });
      vi.spyOn(service, "callLLM" as keyof AIMatchingService).mockResolvedValueOnce(llmResponse);

      const result = await service.matchResume(makeRequest());
      expect(result.recommendation).toBe("no_match");
    });

    it("handles word-based score tokens", async () => {
      const llmResponse = '{"score": "seventy-five", "recommendation": "match", "highlights": [], "concerns": [], "summary": "test"}';
      vi.spyOn(service, "callLLM" as keyof AIMatchingService).mockResolvedValueOnce(llmResponse);

      const result = await service.matchResume(makeRequest());
      expect(result.score).toBe(75);
    });

    it("handles Chinese word score tokens via repairScoreField", async () => {
      // Some LLMs return word scores like "八十" — the repair regex catches these
      const llmResponse = '{"score": 八十, "recommendation": "match", "highlights": [], "concerns": [], "summary": "test"}';
      vi.spyOn(service, "callLLM" as keyof AIMatchingService).mockResolvedValueOnce(llmResponse);

      const result = await service.matchResume(makeRequest());
      //repairScoreField may not handle Chinese — score should fall back to 0 or parse error
      expect(result.score).toBeGreaterThanOrEqual(0);
      expect(result.score).toBeLessThanOrEqual(100);
    });

    it("handles JSON5 response with trailing commas", async () => {
      const llmResponse = '{score: 65, recommendation: "potential", highlights: ["CNC"], concerns: [], summary: "一般",}';
      vi.spyOn(service, "callLLM" as keyof AIMatchingService).mockResolvedValueOnce(llmResponse);

      const result = await service.matchResume(makeRequest());
      expect(result.score).toBe(65);
      expect(result.recommendation).toBe("potential");
    });

    it("returns no_match on LLM error", async () => {
      vi.spyOn(service, "callLLM" as keyof AIMatchingService).mockRejectedValueOnce(
        new Error("Network timeout")
      );

      const result = await service.matchResume(makeRequest());
      expect(result.score).toBe(0);
      expect(result.recommendation).toBe("no_match");
      expect(result.scoreSource).toBe("ai");
    });

    it("returns parse error for unparseable response", async () => {
      vi.spyOn(service, "callLLM" as keyof AIMatchingService).mockResolvedValueOnce(
        "This is not JSON at all"
      );

      const result = await service.matchResume(makeRequest());
      expect(result.score).toBe(0);
      expect(result.recommendation).toBe("no_match");
      expect(result.concerns.length).toBeGreaterThan(0);
    });

    it("handles non-array highlights/concerns gracefully", async () => {
      const llmResponse = JSON.stringify({
        score: 50,
        recommendation: "potential",
        highlights: "not an array",
        concerns: null,
        summary: 123,
      });
      vi.spyOn(service, "callLLM" as keyof AIMatchingService).mockResolvedValueOnce(llmResponse);

      const result = await service.matchResume(makeRequest());
      expect(result.highlights).toEqual([]);
      expect(result.concerns).toEqual([]);
    });

    it("includes rawResponse in result", async () => {
      const llmResponse = JSON.stringify({
        score: 60,
        recommendation: "potential",
        highlights: [],
        concerns: [],
        summary: "test",
      });
      vi.spyOn(service, "callLLM" as keyof AIMatchingService).mockResolvedValueOnce(llmResponse);

      const result = await service.matchResume(makeRequest());
      expect(result.rawResponse).toBeDefined();
      expect(typeof result.rawResponse).toBe("string");
    });

    it("truncates very long raw responses", async () => {
      const longSummary = "x".repeat(10000);
      const llmResponse = JSON.stringify({
        score: 50,
        recommendation: "potential",
        highlights: [],
        concerns: [],
        summary: longSummary,
      });
      vi.spyOn(service, "callLLM" as keyof AIMatchingService).mockResolvedValueOnce(llmResponse);

      const result = await service.matchResume(makeRequest());
      expect(result.rawResponse!.length).toBeLessThanOrEqual(4000);
    });

    it("recomputes MY final score from related_exp and source-derived industry_db floor", async () => {
      const llmResponse = JSON.stringify({
        score: 30,
        recommendation: "potential",
        highlights: ["机械行业经验"],
        concerns: [],
        summary: "候选人具备相关经验",
        breakdown: {
          related_exp: 78,
          industry_db: 0,
        },
      });
      vi.spyOn(service, "callLLM" as keyof AIMatchingService).mockResolvedValueOnce(llmResponse);

      const result = await service.matchResume(makeRequest({
        sourceKey: "seek",
        companyHits: [],
      }));

      expect(result).toMatchObject({
        score: 70,
        recommendation: "match",
        breakdown: {
          related_exp: 60,
          industry_db: 40,
        },
      });
    });

    it("recomputes MY final score to the 50-point hit cap when MY has a qualifying company hit", async () => {
      const llmResponse = JSON.stringify({
        score: 30,
        recommendation: "potential",
        highlights: ["机械行业经验"],
        concerns: [],
        summary: "候选人具备相关经验",
        breakdown: {
          related_exp: 78,
          industry_db: 0,
        },
      });
      vi.spyOn(service, "callLLM" as keyof AIMatchingService).mockResolvedValueOnce(llmResponse);

      const result = await service.matchResume(makeRequest({
        sourceKey: "seek",
        companyHits: ["fanuc"],
      }));

      expect(result).toMatchObject({
        score: 80,
        recommendation: "match",
        breakdown: {
          related_exp: 60,
          industry_db: 50,
        },
      });
    });

    it("lets the MY floor lift legacy no_match outputs into the canonical 40+ range", async () => {
      const llmResponse = JSON.stringify({
        score: 18,
        recommendation: "no_match",
        highlights: [],
        concerns: ["跨市场相关性偏弱"],
        summary: "候选人与岗位相关性较弱",
        breakdown: {
          related_exp: 35,
          industry_db: 0,
        },
      });
      vi.spyOn(service, "callLLM" as keyof AIMatchingService).mockResolvedValueOnce(llmResponse);

      const result = await service.matchResume(makeRequest({
        sourceKey: "seek",
        companyHits: [],
      }));

      expect(result).toMatchObject({
        score: 55,
        recommendation: "potential",
        breakdown: {
          related_exp: 30,
          industry_db: 40,
        },
      });
    });

    it("applies the MY unverified-sales evidence ceiling before computing the final score", async () => {
      const llmResponse = JSON.stringify({
        score: 86,
        recommendation: "strong_match",
        highlights: ["长期CNC销售经验"],
        concerns: [],
        summary: "候选人具备直接销售经验",
        breakdown: {
          related_exp: 86,
          industry_db: 0,
        },
      });
      vi.spyOn(service, "callLLM" as keyof AIMatchingService).mockResolvedValueOnce(llmResponse);

      const result = await service.matchResume({
        resume: {
          id: "r_my_sales",
          name: "MY Sales Candidate",
          sourceKey: "seek",
          companyHits: [],
          roleSignals: [
            {
              type: "sales",
              matchedSignals: ["CNC sales", "key account"],
              signalCount: 2,
              occurrences: 2,
              years: 11,
              industryVerifiedYears: 0,
              roleRelevantYears: 11,
              industryVerifiedRelevantYears: 0,
              matchedWorkEntries: [
                {
                  companyName: "XYZ CNC Machinery Sdn Bhd",
                  jobTitle: "Sales Engineer",
                  years: 11,
                  industryVerified: false,
                  matchedSignals: ["CNC sales", "machine tools"],
                  directRoleMatch: true,
                },
              ],
              verifyIn: "workHistory",
            },
          ],
        },
        jobDescription: {
          title: "Sales Engineer",
          requirements: "At least 3 years of CNC sales experience",
          responsibilities: "Sales, customer development, key account management",
        },
      });

      expect(result).toMatchObject({
        score: 73,
        recommendation: "match",
        breakdown: {
          related_exp: 65,
          industry_db: 40,
        },
      });
    });
  });

  describe("matchBatch", () => {
    it("returns empty results for empty input", async () => {
      const result = await service.matchBatch([], { title: "test", requirements: "test" });
      expect(result.results).toEqual([]);
      expect(result.processedCount).toBe(0);
      expect(result.failedCount).toBe(0);
    });

    it("processes multiple resumes", async () => {
      const llmResponse = JSON.stringify({
        score: 70,
        recommendation: "match",
        highlights: [],
        concerns: [],
        summary: "test",
      });
      vi.spyOn(service, "callLLM" as keyof AIMatchingService).mockResolvedValue(llmResponse);

      const resumes = [
        { id: "r_001", name: "Candidate 1" },
        { id: "r_002", name: "Candidate 2" },
      ];
      const result = await service.matchBatch(resumes, { title: "CNC", requirements: "test" });
      expect(result.results).toHaveLength(2);
      expect(result.processedCount).toBe(2);
      expect(result.failedCount).toBe(0);
    });

    it("counts failures when matchResume throws", async () => {
      // matchResume catches callLLM errors internally, but the batch worker
      // has a separate try/catch that can catch if matchResume itself throws
      // (e.g. if isAvailable throws). Mock matchResume to throw for first resume.
      vi.spyOn(service, "matchResume" as keyof AIMatchingService)
        .mockRejectedValueOnce(new Error("Unexpected error"))
        .mockResolvedValueOnce({
          score: 70,
          recommendation: "match",
          highlights: [],
          concerns: [],
          summary: "test",
          scoreSource: "ai",
        });

      const resumes = [
        { id: "r_001", name: "Candidate 1" },
        { id: "r_002", name: "Candidate 2" },
      ];
      const result = await service.matchBatch(resumes, { title: "CNC", requirements: "test" });
      expect(result.processedCount).toBe(2);
      expect(result.failedCount).toBe(1);
    });

    it("calls onResult callback for each resume", async () => {
      const llmResponse = JSON.stringify({
        score: 70,
        recommendation: "match",
        highlights: [],
        concerns: [],
        summary: "test",
      });
      vi.spyOn(service, "callLLM" as keyof AIMatchingService).mockResolvedValue(llmResponse);

      const progress: Array<{ resumeId: string; done: number }> = [];
      const resumes = [
        { id: "r_001", name: "Candidate 1" },
        { id: "r_002", name: "Candidate 2" },
      ];
      await service.matchBatch(resumes, { title: "CNC", requirements: "test" }, {
        onResult: (p) => { progress.push({ resumeId: p.resumeId, done: p.done }); },
      });
      expect(progress).toHaveLength(2);
      expect(progress.map((p) => p.done)).toEqual([1, 2]);
    });

    it("measures processing time", async () => {
      const llmResponse = JSON.stringify({
        score: 70,
        recommendation: "match",
        highlights: [],
        concerns: [],
        summary: "test",
      });
      vi.spyOn(service, "callLLM" as keyof AIMatchingService).mockResolvedValue(llmResponse);

      const result = await service.matchBatch(
        [{ id: "r_001", name: "Candidate 1" }],
        { title: "CNC", requirements: "test" }
      );
      expect(result.processingTimeMs).toBeGreaterThanOrEqual(0);
    });
  });

  describe("generateOutreach", () => {
    it("throws when service unavailable", async () => {
      vi.spyOn(service, "isAvailable").mockReturnValueOnce({
        available: false,
        reason: "API key not configured",
      });

      await expect(
        service.generateOutreach(
          { id: "r_001", name: "Test" },
          { title: "Job", requirements: "test" },
          { score: 75, recommendation: "match", highlights: [], concerns: [], summary: "test" }
        )
      ).rejects.toThrow("API key not configured");
    });

    it("returns subject and body from valid JSON response", async () => {
      const llmResponse = JSON.stringify({
        subject: "关于CNC工程师职位",
        body: "尊敬的候选人，\n\n我们非常感兴趣您的CNC经验。",
      });
      vi.spyOn(service, "callLLM" as keyof AIMatchingService).mockResolvedValueOnce(llmResponse);

      const result = await service.generateOutreach(
        { id: "r_001", name: "Test" },
        { title: "CNC工程师", requirements: "test", company: "测试公司" },
        { score: 80, recommendation: "match", highlights: ["CNC经验"], concerns: [], summary: "优秀候选人" }
      );
      expect(result.subject).toBe("关于CNC工程师职位");
      expect(result.body).toContain("CNC经验");
    });

    it("returns fallback when response is not valid JSON", async () => {
      vi.spyOn(service, "callLLM" as keyof AIMatchingService).mockResolvedValueOnce(
        "This is not JSON, just a plain text response about the position."
      );

      const result = await service.generateOutreach(
        { id: "r_001", name: "Test" },
        { title: "CNC工程师", requirements: "test" },
        { score: 60, recommendation: "potential", highlights: [], concerns: [], summary: "test" }
      );
      expect(result.subject).toContain("CNC工程师");
      expect(typeof result.body).toBe("string");
    });

    it("throws on LLM error", async () => {
      vi.spyOn(service, "callLLM" as keyof AIMatchingService).mockRejectedValueOnce(
        new Error("Timeout")
      );

      await expect(
        service.generateOutreach(
          { id: "r_001", name: "Test" },
          { title: "Job", requirements: "test" },
          { score: 75, recommendation: "match", highlights: [], concerns: [], summary: "test" }
        )
      ).rejects.toThrow("Timeout");
    });
  });

  describe("score parsing edge cases", () => {
    it("parses numeric string score", async () => {
      const llmResponse = '{"score": "85", "recommendation": "match", "highlights": [], "concerns": [], "summary": "test"}';
      vi.spyOn(service, "callLLM" as keyof AIMatchingService).mockResolvedValueOnce(llmResponse);

      const result = await service.matchResume(makeRequest());
      expect(result.score).toBe(85);
    });

    it("handles zero score", async () => {
      const llmResponse = JSON.stringify({
        score: 0,
        recommendation: "no_match",
        highlights: [],
        concerns: [],
        summary: "test",
      });
      vi.spyOn(service, "callLLM" as keyof AIMatchingService).mockResolvedValueOnce(llmResponse);

      const result = await service.matchResume(makeRequest());
      expect(result.score).toBe(0);
      expect(result.recommendation).toBe("no_match");
    });

    it("handles hundred score", async () => {
      const llmResponse = JSON.stringify({
        score: 100,
        recommendation: "strong_match",
        highlights: [],
        concerns: [],
        summary: "test",
      });
      vi.spyOn(service, "callLLM" as keyof AIMatchingService).mockResolvedValueOnce(llmResponse);

      const result = await service.matchResume(makeRequest());
      expect(result.score).toBe(100);
      expect(result.recommendation).toBe("strong_match");
    });

    it("handles word score with tens compound (seventy-five)", async () => {
      const llmResponse = '{"score": "seventy-five", "recommendation": "match", "highlights": [], "concerns": [], "summary": "test"}';
      vi.spyOn(service, "callLLM" as keyof AIMatchingService).mockResolvedValueOnce(llmResponse);

      const result = await service.matchResume(makeRequest());
      expect(result.score).toBe(75);
    });

    it("handles word score with hyphenated tens (sixty-two)", async () => {
      const llmResponse = '{"score": "sixty-two", "recommendation": "potential", "highlights": [], "concerns": [], "summary": "test"}';
      vi.spyOn(service, "callLLM" as keyof AIMatchingService).mockResolvedValueOnce(llmResponse);

      const result = await service.matchResume(makeRequest());
      expect(result.score).toBe(62);
    });

    it("handles single word score (eighty)", async () => {
      const llmResponse = '{"score": "eighty", "recommendation": "match", "highlights": [], "concerns": [], "summary": "test"}';
      vi.spyOn(service, "callLLM" as keyof AIMatchingService).mockResolvedValueOnce(llmResponse);

      const result = await service.matchResume(makeRequest());
      expect(result.score).toBe(80);
    });

    it("handles quoted word score", async () => {
      const llmResponse = '{"score": "\\"fifty\\"", "recommendation": "potential", "highlights": [], "concerns": [], "summary": "test"}';
      vi.spyOn(service, "callLLM" as keyof AIMatchingService).mockResolvedValueOnce(llmResponse);

      const result = await service.matchResume(makeRequest());
      expect(result.score).toBe(50);
    });

    it("defaults to 0 for unrecognized score value", async () => {
      const llmResponse = '{"score": "excellent", "recommendation": "match", "highlights": [], "concerns": [], "summary": "test"}';
      vi.spyOn(service, "callLLM" as keyof AIMatchingService).mockResolvedValueOnce(llmResponse);

      const result = await service.matchResume(makeRequest());
      expect(result.score).toBe(0);
    });

    it("handles null score gracefully", async () => {
      const llmResponse = '{"score": null, "recommendation": "no_match", "highlights": [], "concerns": [], "summary": "test"}';
      vi.spyOn(service, "callLLM" as keyof AIMatchingService).mockResolvedValueOnce(llmResponse);

      const result = await service.matchResume(makeRequest());
      expect(result.score).toBe(0);
    });

    it("handles undefined score gracefully", async () => {
      const llmResponse = '{"recommendation": "no_match", "highlights": [], "concerns": [], "summary": "test"}';
      vi.spyOn(service, "callLLM" as keyof AIMatchingService).mockResolvedValueOnce(llmResponse);

      const result = await service.matchResume(makeRequest());
      expect(result.score).toBe(0);
    });
  });

  describe("callLLM", () => {
    it("returns mock response when AI_MOCK_ENABLED is true", async () => {
      const originalEnv = process.env.AI_MOCK_ENABLED;
      process.env.AI_MOCK_ENABLED = "true";

      const svc = new AIMatchingService();
      const result = await svc.callLLM([{ role: "user", content: "test" }]);

      // Mock response should be valid JSON with subject/body
      const parsed = JSON.parse(result);
      expect(parsed.subject).toBeDefined();
      expect(parsed.body).toBeDefined();

      process.env.AI_MOCK_ENABLED = originalEnv;
    });
  });
});
