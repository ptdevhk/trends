import { describe, expect, it, vi, afterEach } from "vitest";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import {
  parseTargetSpec,
  runWebResearchCli,
  type WebResearchFixture,
} from "./web-steward-run.js";

afterEach(() => {
  vi.restoreAllMocks();
});

const HAPPY_FIXTURE: WebResearchFixture = {
  searches: {
    "富泰精机 主营 行业": {
      query: "富泰精机 主营 行业",
      results: [
        {
          title: "富泰精机官网",
          url: "https://www.futai.com/",
          content: "富泰精机 数控 加工",
        },
      ],
    },
    "富泰精机 公司 简介 官网": {
      query: "富泰精机 公司 简介 官网",
      results: [
        {
          title: "富泰精机 - B2B",
          url: "https://b2b.example.com/futai",
          content: "自动化设备",
        },
      ],
    },
  },
  scrapes: {
    "https://b2b.example.com/futai": {
      url: "https://b2b.example.com/futai",
      markdown: "富泰精机主营数控加工中心，数控机床年产能500台",
    },
  },
};

const TARGETS = [{ companyKey: "futai", names: ["富泰精机"] }];

describe("web-steward-run CLI", () => {
  describe("parseTargetSpec", () => {
    it("parses key:Name1|Name2 specs", () => {
      expect(parseTargetSpec("futai:富泰精机|富泰精机有限公司")).toEqual({
        companyKey: "futai",
        names: ["富泰精机", "富泰精机有限公司"],
      });
    });

    it("rejects specs without a colon or with empty names", () => {
      expect(() => parseTargetSpec("futai")).toThrow(/Invalid --target/);
      expect(() => parseTargetSpec(":富泰精机")).toThrow(/Invalid --target/);
      expect(() => parseTargetSpec("futai:|  ")).toThrow(/Invalid --target/);
    });
  });

  it("fixture happy path dry-run drafts a proposal with exact planned writes", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const result = await runWebResearchCli({
      targets: TARGETS,
      apply: false,
      convexUrl: "http://127.0.0.1:3210",
      fixture: HAPPY_FIXTURE,
      env: {
        WEB_RESEARCH_ENABLED: "false",
        WEB_RESEARCH_OFFICIAL_DOMAINS: "futai.com",
      },
      now: () => 1_700_000_000_000,
    });

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(result.results).toHaveLength(1);
    expect(result.results[0]).toMatchObject({
      companyKey: "futai",
      proposalId: "web-steward-futai",
      outcome: "drafted",
      queriesRun: 2,
      scrapesRun: 1,
    });
    expect(result.results[0].sources).toEqual([
      {
        sourceId: "web-steward-futai-src-1",
        url: "https://www.futai.com/",
        sourceType: "official_site",
        trustTier: "primary",
        fetchStatus: "pending",
      },
      {
        sourceId: "web-steward-futai-src-2",
        url: "https://b2b.example.com/futai",
        sourceType: "directory",
        trustTier: "corroborating",
        fetchStatus: "fetched",
      },
    ]);

    expect(result.plannedWrites.map((w) => w.op)).toEqual([
      "upsertProposal",
      "upsertEvidenceSource",
      "upsertEvidenceSource",
      "setResearchState",
    ]);
    expect(result.plannedWrites[0].input).toEqual({
      proposalId: "web-steward-futai",
      companyKey: "futai",
      triggerReasons: ["curated"],
      priority: 5,
      suggestedVerificationLevel: "candidate",
      suggestedIndustryClass: "cnc",
      materialChangeSummary:
        "Web steward: 2 candidate source(s) from 2 query(s); signal cnc @ 0.5",
      requestedBy: "web-steward",
    });
    expect(result.plannedWrites[1].input).toEqual({
      sourceId: "web-steward-futai-src-1",
      companyKey: "futai",
      proposalId: "web-steward-futai",
      url: "https://www.futai.com/",
      sourceType: "official_site",
      trustTier: "primary",
      title: "富泰精机官网",
      fetchStatus: "pending",
      suggestedIndustryClass: "cnc",
      workerConfidence: 0.5,
    });
    expect(result.plannedWrites[2].input).toEqual({
      sourceId: "web-steward-futai-src-2",
      companyKey: "futai",
      proposalId: "web-steward-futai",
      url: "https://b2b.example.com/futai",
      sourceType: "directory",
      trustTier: "corroborating",
      title: "富泰精机 - B2B",
      fetchStatus: "fetched",
      fetchedAt: 1_700_000_000_000,
      suggestedIndustryClass: "cnc",
      workerConfidence: 1.0,
      evidenceExcerpt: expect.stringContaining("数控"),
    });
    expect(result.plannedWrites[3].input).toEqual({
      proposalId: "web-steward-futai",
      status: "ready_for_review",
      suggestedVerificationLevel: "candidate",
      suggestedIndustryClass: "cnc",
      materialChangeSummary:
        "Web steward: 2 candidate source(s) from 2 query(s); signal cnc @ 0.5",
    });
  });

  it("writes a dry-run log file when logDir is set", async () => {
    const logDir = mkdtempSync(join(tmpdir(), "web-steward-log-"));
    try {
      const result = await runWebResearchCli({
        targets: TARGETS,
        apply: false,
        convexUrl: "http://127.0.0.1:3210",
        fixture: HAPPY_FIXTURE,
        env: { WEB_RESEARCH_ENABLED: "false" },
        logDir,
      });

      expect(result.logPath).toBeDefined();
      expect(result.logPath?.startsWith(logDir)).toBe(true);
      expect(existsSync(result.logPath as string)).toBe(true);
      const logged = JSON.parse(readFileSync(result.logPath as string, "utf-8")) as {
        apply: boolean;
        results: Array<{ outcome: string }>;
        plannedWrites: unknown[];
      };
      expect(logged.apply).toBe(false);
      expect(logged.results[0]?.outcome).toBe("drafted");
      expect(logged.plannedWrites).toHaveLength(4);
    } finally {
      rmSync(logDir, { recursive: true, force: true });
    }
  });

  it("feature-off env yields per-target disabled with no writes", async () => {
    const result = await runWebResearchCli({
      targets: TARGETS,
      apply: false,
      convexUrl: "http://127.0.0.1:3210",
      env: {},
    });

    expect(result.results).toHaveLength(1);
    expect(result.results[0]).toMatchObject({
      companyKey: "futai",
      proposalId: "web-steward-futai",
      outcome: "disabled",
      queriesRun: 0,
      scrapesRun: 0,
      sources: [],
    });
    expect(result.plannedWrites).toEqual([]);
  });

  it("fixture budget 0 skips the target as out of budget", async () => {
    const result = await runWebResearchCli({
      targets: TARGETS,
      apply: false,
      convexUrl: "http://127.0.0.1:3210",
      fixture: { ...HAPPY_FIXTURE, budget: 0 },
      env: { WEB_RESEARCH_ENABLED: "false" },
    });

    expect(result.results[0]?.outcome).toBe("skipped_budget");
    expect(result.plannedWrites).toEqual([]);
  });
});
