import { existsSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { normalizeResumeImportPayload } from "../../apps/api/src/services/resume-import-service";

const PROD_BACKUP_PATH = "output/resume-backups/resumes-dev.tar.gz";
const hasProdBackup = existsSync(PROD_BACKUP_PATH);

type BackupResume = Record<string, unknown>;

interface BackupPayload {
  metadata: Record<string, unknown>;
  resumes: BackupResume[];
  data?: BackupResume[];
}

async function loadProdBackup(): Promise<BackupPayload> {
  const { readPortableBackupFile } = await import("./operator-utils.ts");
  const raw = await readPortableBackupFile(PROD_BACKUP_PATH);
  const parsed = JSON.parse(raw) as BackupPayload;
  return parsed;
}

function groupBySource(resumes: BackupResume[]): Map<string, BackupResume[]> {
  const groups = new Map<string, BackupResume[]>();
  for (const r of resumes) {
    const src = (r.sourceHost as string) ?? (r.source as string) ?? "unknown";
    if (!groups.has(src)) {
      groups.set(src, []);
    }
    groups.get(src)!.push(r);
  }
  return groups;
}

describe.skipIf(!hasProdBackup)("v0.1.0 prod backup compatibility", () => {
  it("reads the tar.gz backup without error", async () => {
    const backup = await loadProdBackup();
    expect(backup.metadata).toBeDefined();
    expect(backup.resumes.length).toBeGreaterThan(0);
    expect(backup.metadata.generatedBy).toBe("trends-api backup");
  });

  it("normalizes every resume in the v0.1.0 prod backup through the current import pipeline", async () => {
    const backup = await loadProdBackup();
    const result = normalizeResumeImportPayload({
      metadata: {
        sourceUrl: backup.metadata.sourceUrl as string,
        generatedBy: backup.metadata.generatedBy as string,
      },
      resumes: backup.resumes,
    });

    expect(result.convexResumes).toHaveLength(backup.resumes.length);
    for (const item of result.convexResumes) {
      expect(item.externalId).toBeTruthy();
      expect(item.source).toBeTruthy();
      expect(item.hash).toMatch(/^[0-9a-f]{64}$/u);
      expect(item.content).toBeDefined();
    }
  });

  it("preserves all source-specific fields for each v0.1.0 source after normalization", async () => {
    const backup = await loadProdBackup();
    const groups = groupBySource(backup.resumes);

    const result = normalizeResumeImportPayload({
      metadata: {
        sourceUrl: backup.metadata.sourceUrl as string,
        generatedBy: backup.metadata.generatedBy as string,
      },
      resumes: backup.resumes,
    });

    const bySource = new Map<string, BackupResume[]>();
    for (const r of backup.resumes) {
      const src = (r.sourceHost as string) ?? "unknown";
      if (!bySource.has(src)) bySource.set(src, []);
      bySource.get(src)!.push(r);
    }

    // Job5156: must keep resumeId, perUserId, profileUrl, workHistory
    const job5156 = bySource.get("hr.job5156.com");
    if (job5156 && job5156.length > 0) {
      const first = result.convexResumes.find(
        (c) => c.source === "hr.job5156.com",
      );
      expect(first).toBeDefined();
      const content = first!.content as Record<string, unknown>;
      expect(content).toHaveProperty("resumeId");
      expect(content).toHaveProperty("perUserId");
      expect(content).toHaveProperty("workHistory");
      expect(content).toHaveProperty("profileUrl");
      expect(content).toHaveProperty("locationHierarchy");
    }

    // Seek: must keep profileId, profileType, skills, languages, rightToWork
    const seek = bySource.get("hk.employer.seek.com");
    if (seek && seek.length > 0) {
      const first = result.convexResumes.find(
        (c) => c.source === "hk.employer.seek.com",
      );
      expect(first).toBeDefined();
      const content = first!.content as Record<string, unknown>;
      expect(content).toHaveProperty("profileId");
      expect(content).toHaveProperty("profileType");
      expect(content).toHaveProperty("skills");
      expect(content).toHaveProperty("languages");
      expect(content).toHaveProperty("locationHierarchy");
    }

    // 51job-manual: must keep profileId, profileType, profileEducation, resumeSnippet
    const manual = bySource.get("51job-manual");
    if (manual && manual.length > 0) {
      const first = result.convexResumes.find(
        (c) => c.source === "51job-manual",
      );
      expect(first).toBeDefined();
      const content = first!.content as Record<string, unknown>;
      expect(content).toHaveProperty("profileId");
      expect(content).toHaveProperty("profileType");
      expect(content).toHaveProperty("profileEducation");
      expect(content).toHaveProperty("resumeSnippet");
      expect(content).toHaveProperty("locationHierarchy");
    }
  });

  it("derives correct externalId for each v0.1.0 source", async () => {
    const backup = await loadProdBackup();

    const result = normalizeResumeImportPayload({
      metadata: {
        sourceUrl: backup.metadata.sourceUrl as string,
        generatedBy: backup.metadata.generatedBy as string,
      },
      resumes: backup.resumes,
    });

    const bySource = new Map<string, typeof result.convexResumes[0]>();
    for (const item of result.convexResumes) {
      if (!bySource.has(item.source)) {
        bySource.set(item.source, item);
      }
    }

    // Job5156 uses hr.job5156.com:resume:<resumeId>
    const job5156Item = bySource.get("hr.job5156.com");
    if (job5156Item) {
      expect(job5156Item.externalId).toMatch(
        /^hr\.job5156\.com:resume:\d+$/u,
      );
    }

    // Seek uses hk.employer.seek.com:profile:<profileId>
    const seekItem = bySource.get("hk.employer.seek.com");
    if (seekItem) {
      expect(seekItem.externalId).toMatch(
        /^hk\.employer\.seek\.com:profile:\d+$/u,
      );
    }

    // 51job-manual uses 51job-manual:profile:<profileId>
    const manualItem = bySource.get("51job-manual");
    if (manualItem) {
      expect(manualItem.externalId).toMatch(
        /^51job-manual:profile:\d+$/u,
      );
    }
  });

  it("preserves per-item sourceHost and tags from v0.1.0 backup", async () => {
    const backup = await loadProdBackup();

    const result = normalizeResumeImportPayload({
      metadata: {
        sourceUrl: backup.metadata.sourceUrl as string,
        generatedBy: backup.metadata.generatedBy as string,
      },
      resumes: backup.resumes,
    });

    for (const item of result.convexResumes) {
      expect(item.source).toBeTruthy();
      expect(Array.isArray(item.tags)).toBe(true);
    }

    // sourceHost and tags must NOT leak into content
    for (const item of result.convexResumes) {
      const content = item.content as Record<string, unknown>;
      expect(content).not.toHaveProperty("sourceHost");
      expect(content).not.toHaveProperty("tags");
    }
  });
});

describe("51job extension collection shape compatibility", () => {
  const job51ExtensionResume = {
    resumeId: "975386637",
    perUserId: "121430648",
    externalId: "975386637",
    profileUrl:
      "https://ehire.51job.com/Revision/talent/resume/detail?resumeId=975386637",
    source: "ehire.51job.com",
    sourceHost: "ehire.51job.com",
    name: "袁先生",
    age: "37岁",
    experience: "10年",
    education: "大专",
    location: "河南郑州",
    jobIntention: "CNC销售",
    expectedSalary: "8000-12000元/月",
    selfIntro: "负责河南区域CNC销售工作",
    activityStatus: "",
    workHistory: [
      {
        raw: "2020-12 ~ 至今 某机械公司 销售工程师",
        companyName: "某机械公司",
        jobTitle: "销售工程师",
        description: "负责CNC设备销售",
        startDate: "2020-12",
        endDate: "至今",
      },
    ],
    rawData: {
      base_info: { user_name: "袁先生", age: "37岁" },
      recent_work_info: { position: "销售工程师" },
      work_list: [],
      education_list: [],
      label_sorted_skill_tag_list: [],
    },
    pageIndex: 0,
    extractedAt: "2026-04-15T10:54:04.409Z",
  };

  it("normalizes 51job extension resume with rawData through the import pipeline", () => {
    const result = normalizeResumeImportPayload({
      metadata: {
        sourceKey: "51job",
        sourceHost: "ehire.51job.com",
        sourceUrl:
          "https://ehire.51job.com/Revision/talent/search?keyword=CNC",
        keyword: "CNC 销售",
        generatedBy: "browser-extension@1.1.1",
      },
      resumes: [job51ExtensionResume],
    });

    expect(result.source).toBe("ehire.51job.com");
    expect(result.convexResumes).toHaveLength(1);

    const item = result.convexResumes[0]!;
    expect(item.externalId).toBe("975386637");
    expect(item.source).toBe("ehire.51job.com");
    expect(item.tags).toEqual(["CNC 销售"]);

    const content = item.content as Record<string, unknown>;
    expect(content.name).toBe("袁先生");
    expect(content).toHaveProperty("workHistory");
    // rawData is not in ResumeImportItemSchema — stripped by Zod parsing
    expect(content).not.toHaveProperty("rawData");
    expect(content).toHaveProperty("locationHierarchy");
    expect(content).not.toHaveProperty("sourceHost");
    expect(content).not.toHaveProperty("tags");
  });

  it("handles 51job extension resume with detail-enriched fields", () => {
    const detailEnrichedResume = {
      ...job51ExtensionResume,
      workHistory: [
        {
          raw: "2020-12 ~ 至今 某机械公司 销售工程师",
          companyName: "某机械公司",
          jobTitle: "销售工程师",
          description: "负责CNC设备销售和客户维护",
          startDate: "2020-12",
          endDate: "至今",
        },
      ],
      projectExperience: [
        {
          raw: "2022-01 ~ 2023-06 某CNC升级项目",
          companyName: "客户项目",
          jobTitle: "项目负责人",
          startDate: "2022-01",
          endDate: "2023-06",
        },
      ],
      profileEducation: [
        {
          institution: "河南工业大学",
          qualification: "本科",
          fieldOfStudy: "机械设计制造",
          startDate: "2008-09",
          endDate: "2012-06",
        },
      ],
      skills: ["CNC编程", { name: "Fanuc系统", level: "advanced" }],
      licences: [{ name: "数控车工高级证" }],
    };

    const result = normalizeResumeImportPayload({
      metadata: {
        sourceKey: "51job",
        sourceHost: "ehire.51job.com",
        sourceUrl:
          "https://ehire.51job.com/Revision/talent/resume/detail?resumeId=975386637",
        generatedBy: "browser-extension@1.1.1",
        collectionContext: {
          captureMode: "detail-page",
          operation: "auto-sync",
        },
      },
      resumes: [detailEnrichedResume],
    });

    const content = result.convexResumes[0]!.content as Record<string, unknown>;
    expect(content).toHaveProperty("projectExperience");
    expect(content).toHaveProperty("profileEducation");
    expect(content).toHaveProperty("skills");
    expect(content).toHaveProperty("licences");

    const skills = content.skills as unknown[];
    expect(skills).toHaveLength(2);
    expect(skills[0]).toBe("CNC编程");
    expect(skills[1]).toEqual({ name: "Fanuc系统", level: "advanced" });
  });

  it("handles 51job extension resume without detail enrichment (search-only)", () => {
    const searchOnlyResume = {
      resumeId: "12345",
      perUserId: "67890",
      name: "测试候选人",
      source: "ehire.51job.com",
      sourceHost: "ehire.51job.com",
      age: "28岁",
      education: "本科",
      location: "东莞",
      jobIntention: "销售工程师",
      workHistory: [
        {
          raw: "2022-03 ~ 至今 ABC公司 销售工程师",
          companyName: "ABC公司",
          jobTitle: "销售工程师",
          startDate: "2022-03",
          endDate: "至今",
        },
      ],
      rawData: { base_info: {} },
      pageIndex: 3,
      extractedAt: "2026-04-15T10:00:00.000Z",
    };

    const result = normalizeResumeImportPayload({
      metadata: {
        sourceKey: "51job",
        sourceHost: "ehire.51job.com",
        sourceUrl:
          "https://ehire.51job.com/Revision/talent/search?keyword=销售",
        keyword: "销售",
        generatedBy: "browser-extension@1.1.1",
      },
      resumes: [searchOnlyResume],
    });

    expect(result.convexResumes).toHaveLength(1);
    const content = result.convexResumes[0]!.content as Record<string, unknown>;
    expect(content).not.toHaveProperty("projectExperience");
    expect(content).not.toHaveProperty("profileEducation");
    expect(content).not.toHaveProperty("skills");
  });
});

describe("post-v0.1.0 schema field backward compatibility", () => {
  it("accepts v0.1.0 resumes without new optional fields (sourceKey, isArchived, archivedAt)", () => {
    const v010Resume = {
      resumeId: "10094914",
      perUserId: "10050219",
      name: "吴先生",
      sourceHost: "hr.job5156.com",
      tags: ["销售 CNC"],
      workHistory: [
        { raw: "2023-03~2025-04 东莞某公司 销售工程师" },
      ],
      extractedAt: "2026-03-18T02:56:01.757Z",
    };

    const result = normalizeResumeImportPayload({
      metadata: {
        sourceUrl: "https://hr.job5156.com/search?keyword=CNC",
        generatedBy: "browser-extension@1.0.0",
        searchCriteria: { keyword: "销售 CNC" },
      },
      resumes: [v010Resume],
    });

    expect(result.convexResumes).toHaveLength(1);
    // sourceKey, isArchived, archivedAt are Convex-level fields, not import fields
    // Import must succeed without them
    expect(result.convexResumes[0]!.source).toBe("hr.job5156.com");
  });

  it("accepts v0.1.0 resumes with legacy tagEnvelope restoreState", () => {
    const v010Backup = {
      resumeId: "555",
      name: "旧候选人",
      sourceHost: "hr.job5156.com",
      tags: ["销售"],
      workHistory: [{ raw: "test" }],
      extractedAt: "2026-03-01T00:00:00.000Z",
      restoreState: {
        crawledAt: 1709251200000,
        searchText: "旧候选人 销售",
        primaryRuleScore: 75,
        ingestData: {
          industryTags: ["machine-tools"],
          tagEnvelope: ["销售", "CNC"],
        },
      },
    };

    const result = normalizeResumeImportPayload({
      metadata: {
        sourceUrl: "https://backup.example.com/api/resumes/backup",
        generatedBy: "trends-api backup",
      },
      resumes: [v010Backup],
    });

    expect(result.convexResumes).toHaveLength(1);
    const restoreState = result.convexResumes[0]!.restoreState;
    expect(restoreState).toBeDefined();
    expect(restoreState!.crawledAt).toBe(1709251200000);
    expect(restoreState!.ingestData).toEqual({
      industryTags: ["machine-tools"],
      tagEnvelope: ["销售", "CNC"],
    });
  });

  it("handles v0.1.0 resumes with empty string fields gracefully", () => {
    const v010Resume = {
      resumeId: "777",
      name: "空字段候选人",
      sourceHost: "hr.job5156.com",
      tags: ["销售"],
      experience: "",
      jobIntention: "",
      selfIntro: "",
      location: "",
      workHistory: [{ raw: "test" }],
      extractedAt: "2026-03-01T00:00:00.000Z",
    };

    const result = normalizeResumeImportPayload({
      metadata: {
        sourceUrl: "https://hr.job5156.com/search?keyword=销售",
        generatedBy: "browser-extension@1.0.0",
        searchCriteria: { keyword: "销售" },
      },
      resumes: [v010Resume],
    });

    expect(result.convexResumes).toHaveLength(1);
  });

  it("handles Seek rightToWork as string (v0.1.0) vs object (current)", () => {
    // v0.1.0 backup stores rightToWork as a plain string
    const stringRightToWork = {
      profileId: "503059495",
      profileType: "seek",
      name: "seek candidate",
      sourceHost: "hk.employer.seek.com",
      tags: ["sales"],
      rightToWork: "Malaysia permanent work rights",
      workHistory: [{ raw: "test" }],
      extractedAt: "2026-03-20T07:39:49.087Z",
    };

    // Current extension sends rightToWork as an object
    const objectRightToWork = {
      profileId: "503033454",
      profileType: "seek",
      name: "seek candidate 2",
      sourceHost: "hk.employer.seek.com",
      tags: ["sales"],
      rightToWork: { status: "citizen" },
      workHistory: [{ raw: "test" }],
      extractedAt: "2026-03-20T07:39:49.087Z",
    };

    const result = normalizeResumeImportPayload({
      metadata: {
        sourceUrl: "https://backup.example.com/api/resumes/backup",
        generatedBy: "trends-api backup",
      },
      resumes: [stringRightToWork, objectRightToWork],
    });

    expect(result.convexResumes).toHaveLength(2);
    const c1 = result.convexResumes[0]!.content as Record<string, unknown>;
    const c2 = result.convexResumes[1]!.content as Record<string, unknown>;
    expect(c1.rightToWork).toBe("Malaysia permanent work rights");
    expect(c2.rightToWork).toEqual({ status: "citizen" });
  });

  it("handles Job5156 profileEducation with legacy endDate format", () => {
    // v0.1.0 backup stores education endDate as "2007-09~2010-07"
    const legacyEducation = {
      resumeId: "10094914",
      name: "旧学历候选人",
      sourceHost: "hr.job5156.com",
      tags: ["销售"],
      workHistory: [{ raw: "test" }],
      profileEducation: [
        {
          institution: "重庆正大软件职业技术学院",
          qualification: "大专 · 软件技术",
          description: "大专 · 软件技术 · 2007-09~2010-07",
          endDate: "2007-09~2010-07",
        },
      ],
      extractedAt: "2026-03-18T02:56:01.757Z",
    };

    const result = normalizeResumeImportPayload({
      metadata: {
        sourceUrl: "https://backup.example.com/api/resumes/backup",
        generatedBy: "trends-api backup",
      },
      resumes: [legacyEducation],
    });

    expect(result.convexResumes).toHaveLength(1);
    const content = result.convexResumes[0]!.content as Record<string, unknown>;
    const education = content.profileEducation as Record<string, unknown>[];
    expect(education).toHaveLength(1);
    // Legacy endDate passes through as-is (migration handles normalization)
    expect(education[0]!.endDate).toBe("2007-09~2010-07");
    expect(education[0]!.institution).toBe("重庆正大软件职业技术学院");
  });
});

describe.skipIf(!hasProdBackup)("mixed-source backup round-trip (prod upgrade scenario)", () => {
  it("restores a mixed-source backup with per-item source metadata", async () => {
    const backup = await loadProdBackup();
    const groups = groupBySource(backup.resumes);
    expect(groups.size).toBeGreaterThanOrEqual(2);

    // Pick first resume from each source for a mixed batch
    const mixedSample: BackupResume[] = [];
    for (const [, items] of groups) {
      mixedSample.push(items[0]!);
    }

    const result = normalizeResumeImportPayload({
      metadata: {
        sourceUrl: backup.metadata.sourceUrl as string,
        generatedBy: backup.metadata.generatedBy as string,
      },
      resumes: mixedSample,
    });

    // Each item gets its own source from sourceHost
    const sources = new Set(result.convexResumes.map((r) => r.source));
    expect(sources.size).toBeGreaterThanOrEqual(2);

    for (const item of result.convexResumes) {
      expect(item.source).toBeTruthy();
      expect(item.externalId).toBeTruthy();
      expect(item.hash).toBeTruthy();
      const content = item.content as Record<string, unknown>;
      expect(content).not.toHaveProperty("sourceHost");
      expect(content).not.toHaveProperty("tags");
    }
  });

  it("handles v0.1.0 backup with RECOMPUTE_DERIVED_FIELDS=true (strips restoreState computed fields)", async () => {
    const backup = await loadProdBackup();

    const result = normalizeResumeImportPayload({
      metadata: {
        sourceUrl: backup.metadata.sourceUrl as string,
        generatedBy: backup.metadata.generatedBy as string,
      },
      resumes: [
        {
          resumeId: "test-1",
          name: "重算候选人",
          sourceHost: "hr.job5156.com",
          tags: ["销售"],
          workHistory: [{ raw: "test" }],
          extractedAt: "2026-03-01T00:00:00.000Z",
          restoreState: {
            crawledAt: 1709251200000,
            searchText: "cached search text",
            primaryRuleScore: 80,
            ingestData: { industryTags: ["old-tag"] },
            analysis: { score: 75 },
            analyses: { "source:job5156|analysis:test": { score: 75 } },
          },
        },
      ],
      options: { recomputeDerivedFields: true },
    });

    const restoreState = result.convexResumes[0]!.restoreState;
    expect(restoreState).toBeDefined();
    expect(restoreState!.crawledAt).toBe(1709251200000);
    // Computed fields should be stripped
    expect(restoreState!.searchText).toBeUndefined();
    expect(restoreState!.primaryRuleScore).toBeUndefined();
    expect(restoreState!.ingestData).toBeUndefined();
    expect(restoreState!.analysis).toBeUndefined();
    expect(restoreState!.analyses).toBeUndefined();
  });
});
