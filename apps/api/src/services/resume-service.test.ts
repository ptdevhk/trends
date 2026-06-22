import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { ResumeService } from "./resume-service";

const MINIMAL_SKILLS_MD = `---
version: 1
updated_at: '2026-01-01'
---

## 领域分类

### machinery
- displayName: 机械
- keywords: cnc, 机械

## 同义词表

## 企业名单

## 评分规则

## 经验级别

## 职能信号

## 行业背景

## 排除词
`;

function createFixtureRoot(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "resume-service-"));
  fs.mkdirSync(path.join(root, "output", "resumes", "samples"), { recursive: true });
  fs.mkdirSync(path.join(root, "config", "resume"), { recursive: true });
  fs.mkdirSync(path.join(root, "config", "job-descriptions"), { recursive: true });
  fs.writeFileSync(path.join(root, "config", "resume", "skills_words.txt"), "sales cnc\n", "utf8");
  fs.writeFileSync(path.join(root, "config", "resume", "skills.md"), MINIMAL_SKILLS_MD, "utf8");
  return root;
}

function cleanupFixtureRoot(root: string): void {
  fs.rmSync(root, { recursive: true, force: true });
}

describe("ResumeService", () => {
  const roots: string[] = [];

  afterEach(() => {
    for (const root of roots.splice(0)) {
      cleanupFixtureRoot(root);
    }
  });

  it("keeps non-Job5156 sample profile URLs unchanged when sample metadata identifies Seek", () => {
    const root = createFixtureRoot();
    roots.push(root);

    const samplePath = path.join(root, "output", "resumes", "samples", "seek-sample.json");
    fs.writeFileSync(
      samplePath,
      JSON.stringify({
        metadata: {
          sourceHost: "hk.employer.seek.com",
          sourceKey: "seek",
          sourceUrl: "https://hk.employer.seek.com/candidates/recommended?jobId=1&pageNumber=2",
          generatedBy: "browser-extension@1.1.1",
        },
        data: [
          {
            name: "Seek Candidate",
            profileUrl: "https://hk.employer.seek.com/candidates/503033454",
            activityStatus: "Updated recently",
            age: "",
            experience: "5 years",
            education: "Bachelor",
            location: "Shah Alam",
            selfIntro: "",
            jobIntention: "Sales Engineer",
            expectedSalary: "",
            workHistory: [{ raw: "Example Co." }],
            extractedAt: "2026-03-12T00:00:00.000Z",
            profileId: "503033454",
            profileType: "seek",
          },
        ],
      }, null, 2),
      "utf8"
    );

    const service = new ResumeService(root);
    const { items } = service.loadSample("seek-sample");

    expect(items[0]?.profileUrl).toBe("https://hk.employer.seek.com/candidates/503033454");
  });

  it("loads a checked-in sample with searchable fields", () => {
    const root = createFixtureRoot();
    roots.push(root);

    const sourcePath = path.resolve(
      process.cwd(),
      "output",
      "resumes",
      "samples",
      "sample-cnc-dongguan.json"
    );
    const samplePath = path.join(
      root,
      "output",
      "resumes",
      "samples",
      "sample-cnc-dongguan.json"
    );
    fs.copyFileSync(sourcePath, samplePath);

    const service = new ResumeService(root);
    const { items, metadata } = service.loadSample("sample-cnc-dongguan");

    expect(metadata).toBeDefined();
    expect(items.length).toBeGreaterThan(0);
  });

  it("applies required keyword filters with all-keyword semantics", () => {
    const root = createFixtureRoot();
    roots.push(root);

    const service = new ResumeService(root);
    const items = [
      {
        name: "Both Terms",
        profileUrl: "https://example.com/both",
        activityStatus: "Active",
        age: "30",
        experience: "5 years",
        education: "Bachelor",
        location: "Dongguan",
        selfIntro: "",
        jobIntention: "Sales Engineer",
        expectedSalary: "10k-20k",
        workHistory: [{ raw: "2020-2025 machine tools cnc sales engineer" }],
        extractedAt: "2026-03-27T00:00:00.000Z",
      },
      {
        name: "One Term",
        profileUrl: "https://example.com/one",
        activityStatus: "Active",
        age: "29",
        experience: "4 years",
        education: "Bachelor",
        location: "Dongguan",
        selfIntro: "",
        jobIntention: "Sales Engineer",
        expectedSalary: "10k-20k",
        workHistory: [{ raw: "2020-2025 machine tools sales engineer" }],
        extractedAt: "2026-03-27T00:00:00.000Z",
      },
    ];

    const filtered = service.filterResumes(items, {
      requiredKeywords: ["machine tools", "cnc"],
    });

    expect(filtered.map((item) => item.name)).toEqual(["Both Terms"]);
  });

  it("still normalizes Job5156 sample profile URLs into canonical display URLs", () => {
    const root = createFixtureRoot();
    roots.push(root);

    const samplePath = path.join(root, "output", "resumes", "samples", "job5156-sample.json");
    fs.writeFileSync(
      samplePath,
      JSON.stringify({
        metadata: {
          sourceHost: "hr.job5156.com",
          sourceKey: "job5156",
          sourceUrl: "https://hr.job5156.com/search?keyword=%E9%94%80%E5%94%AE",
          generatedBy: "browser-extension@1.1.1",
        },
        data: [
          {
            name: "Job Candidate",
            profileUrl: "https://hr.job5156.com/api/com/resume/123456",
            activityStatus: "在线中",
            age: "30岁",
            experience: "5年",
            education: "本科",
            location: "东莞",
            selfIntro: "",
            jobIntention: "销售工程师",
            expectedSalary: "",
            workHistory: [{ raw: "Example Co." }],
            extractedAt: "2026-03-12T00:00:00.000Z",
            resumeId: "123456",
          },
        ],
      }, null, 2),
      "utf8"
    );

    const service = new ResumeService(root);
    const { items } = service.loadSample("job5156-sample");

    expect(items[0]?.profileUrl).toBe("https://hr.job5156.com/resume/view/123456");
  });

  it("preserves structured Job5156 detail-page work history when loading samples", () => {
    const root = createFixtureRoot();
    roots.push(root);

    const samplePath = path.join(root, "output", "resumes", "samples", "job5156-detail-sample.json");
    fs.writeFileSync(
      samplePath,
      JSON.stringify({
        metadata: {
          sourceHost: "hr.job5156.com",
          sourceKey: "job5156",
          sourceUrl: "https://hr.job5156.com/resume/view/987654",
          generatedBy: "browser-extension@1.1.1",
        },
        data: [
          {
            name: "Detail Candidate",
            profileUrl: "https://hr.job5156.com/resume/view/987654",
            activityStatus: "在线中",
            age: "34岁",
            experience: "11年",
            education: "本科",
            location: "东莞",
            selfIntro: "熟悉机床销售与项目跟进。",
            jobIntention: "销售工程师",
            expectedSalary: "15000-20000元/月",
            workHistory: [
              {
                raw: "2021-03~至今(4年)东莞某设备公司销售工程师\n负责华南区机床销售与客户维护",
                companyName: "东莞某设备公司",
                jobTitle: "销售工程师",
                startDate: "2021-03",
                endDate: "至今",
                description: "负责华南区机床销售与客户维护。\n离职原因：寻求更大平台。",
              },
            ],
            extractedAt: "2026-03-12T00:00:00.000Z",
            resumeId: "987654",
          },
        ],
      }, null, 2),
      "utf8"
    );

    const service = new ResumeService(root);
    const { items } = service.loadSample("job5156-detail-sample");

    expect(items[0]?.profileUrl).toBe("https://hr.job5156.com/resume/view/987654");
    expect(items[0]?.workHistory).toEqual([
      {
        raw: "2021-03~至今(4年)东莞某设备公司销售工程师\n负责华南区机床销售与客户维护",
        companyName: "东莞某设备公司",
        jobTitle: "销售工程师",
        startDate: "2021-03",
        endDate: "至今",
        description: "负责华南区机床销售与客户维护。\n离职原因：寻求更大平台。",
      },
    ]);
  });

  it("does not match keywords from jobIntention or selfIntro alone in API-side search", () => {
    const root = createFixtureRoot();
    roots.push(root);

    const service = new ResumeService(root);
    const items = [
      {
        name: "Only Header Fields",
        profileUrl: "https://example.com/resume-1",
        activityStatus: "Active",
        age: "30",
        experience: "5 years",
        education: "Bachelor",
        location: "Dongguan",
        selfIntro: "FANUC CNC sales",
        jobIntention: "Sales Engineer",
        expectedSalary: "10k-20k",
        workHistory: [],
        extractedAt: "2026-03-20T00:00:00.000Z",
        resumeId: "resume-header-only",
      },
    ];

    expect(service.searchResumes(items, "sales engineer fanuc")).toEqual([]);
    expect(service.filterResumes(items, { skills: ["fanuc"] })).toEqual([]);
  });

  it("treats 51job samples with unresolved city-only locations as China for country filters", () => {
    const root = createFixtureRoot();
    roots.push(root);

    const samplePath = path.join(root, "output", "resumes", "samples", "51job-city-sample.json");
    fs.writeFileSync(
      samplePath,
      JSON.stringify({
        metadata: {
          sourceHost: "ehire.51job.com",
          sourceKey: "51job",
          sourceUrl: "https://ehire.51job.com/resume",
          generatedBy: "browser-extension@1.1.1",
        },
        data: [
          {
            name: "51job China Candidate",
            profileUrl: "https://ehire.51job.com/resume/abc",
            activityStatus: "Active",
            age: "32岁",
            experience: "8年",
            education: "本科",
            location: "徐州",
            selfIntro: "",
            jobIntention: "销售工程师",
            expectedSalary: "",
            workHistory: [{ raw: "常州天陨机械有限公司 销售工程师" }],
            extractedAt: "2026-03-20T00:00:00.000Z",
          },
        ],
      }, null, 2),
      "utf8"
    );

    const service = new ResumeService(root);
    const { items } = service.loadSample("51job-city-sample");

    expect(service.filterResumes(items, { locations: ["China"] })).toHaveLength(1);
    expect(service.filterResumes(items, { locations: ["广东"] })).toHaveLength(0);
  });

  it("rejects direct unverified sales work-history years in local sample filters", () => {
    const root = createFixtureRoot();
    roots.push(root);

    const service = new ResumeService(root);
    const items = [
      {
        name: "Unverified Direct Sales",
        profileUrl: "https://example.com/unverified-direct-sales",
        activityStatus: "Active",
        age: "30",
        experience: "6 years",
        education: "Bachelor",
        location: "Shenzhen",
        selfIntro: "",
        jobIntention: "Sales",
        expectedSalary: "",
        workHistory: [],
        ingestData: {
          roleSignals: [
            {
              type: "sales",
              matchedSignals: ["电话销售"],
              signalCount: 1,
              occurrences: 1,
              years: 6.75,
              roleRelevantYears: 6.75,
              industryVerifiedRelevantYears: 0,
              verifyIn: "workHistory",
              matchedWorkEntries: [
                {
                  companyName: "Example Trading",
                  jobTitle: "电话销售",
                  years: 6.75,
                  industryVerified: false,
                  directRoleMatch: true,
                  matchedSignals: ["电话销售"],
                },
              ],
            },
          ],
        },
        extractedAt: "2026-03-20T00:00:00.000Z",
      },
      {
        name: "Verified Sales",
        profileUrl: "https://example.com/verified-sales",
        activityStatus: "Active",
        age: "30",
        experience: "6 years",
        education: "Bachelor",
        location: "Shenzhen",
        selfIntro: "",
        jobIntention: "Sales",
        expectedSalary: "",
        workHistory: [],
        ingestData: {
          roleSignals: [
            {
              type: "sales",
              matchedSignals: ["销售工程师"],
              signalCount: 1,
              occurrences: 1,
              years: 3,
              roleRelevantYears: 6,
              industryVerifiedRelevantYears: 3,
              verifyIn: "workHistory",
              matchedWorkEntries: [
                {
                  companyName: "Example Machine Tools",
                  jobTitle: "销售工程师",
                  years: 3,
                  industryVerified: true,
                  directRoleMatch: true,
                  matchedSignals: ["销售工程师"],
                },
              ],
            },
          ],
        },
        extractedAt: "2026-03-20T00:00:00.000Z",
      },
      {
        name: "Sales Mention Only",
        profileUrl: "https://example.com/mention-only",
        activityStatus: "Active",
        age: "30",
        experience: "6 years",
        education: "Bachelor",
        location: "Shenzhen",
        selfIntro: "",
        jobIntention: "Engineer",
        expectedSalary: "",
        workHistory: [],
        ingestData: {
          roleSignals: [
            {
              type: "sales",
              matchedSignals: ["销售"],
              signalCount: 1,
              occurrences: 1,
              years: 6,
              verifyIn: "workHistory",
              matchedWorkEntries: [
                {
                  companyName: "Example Manufacturing",
                  jobTitle: "CNC Engineer",
                  years: 6,
                  industryVerified: false,
                  directRoleMatch: false,
                  matchedSignals: ["销售"],
                },
              ],
            },
          ],
        },
        extractedAt: "2026-03-20T00:00:00.000Z",
      },
    ];

    const filtered = service.filterResumes(items, { roleFilterType: "sales", minRoleYears: 1 });
    expect(filtered.map((item) => item.name)).toEqual(["Verified Sales"]);
  });

  describe("salary filter graceful degradation", () => {
    it("resumes with empty salary pass minSalary filter", () => {
      const root = createFixtureRoot();
      roots.push(root);
      const service = new ResumeService(root);
      const items = [
        {
          name: "Seek MY",
          profileUrl: "https://example.com/seek-my",
          activityStatus: "Active",
          age: "",
          experience: "5 years",
          education: "",
          location: "Malaysia",
          selfIntro: "",
          jobIntention: "Sales",
          expectedSalary: "",
          workHistory: [],
          extractedAt: "2026-03-20T00:00:00.000Z",
        },
      ];

      const filtered = service.filterResumes(items, { minSalary: 5000 });
      expect(filtered).toHaveLength(1);
    });

    it("resumes with unknown salary are excluded by maxSalary", () => {
      const root = createFixtureRoot();
      roots.push(root);
      const service = new ResumeService(root);
      const items = [
        {
          name: "Seek MY",
          profileUrl: "https://example.com/seek-my",
          activityStatus: "Active",
          age: "",
          experience: "5 years",
          education: "",
          location: "Malaysia",
          selfIntro: "",
          jobIntention: "Sales",
          expectedSalary: "",
          workHistory: [],
          extractedAt: "2026-03-20T00:00:00.000Z",
        },
      ];

      const filtered = service.filterResumes(items, { maxSalary: 10000 });
      expect(filtered).toHaveLength(0);
    });

    it("excludes wan salaries above a raw-CNY maximum", () => {
      const root = createFixtureRoot();
      roots.push(root);
      const service = new ResumeService(root);
      const items = [
        {
          name: "High Salary",
          profileUrl: "https://example.com/high-salary",
          activityStatus: "Active",
          age: "",
          experience: "5 years",
          education: "",
          location: "China",
          selfIntro: "",
          jobIntention: "Sales",
          expectedSalary: "2.8-4.2万/月",
          workHistory: [],
          extractedAt: "2026-03-20T00:00:00.000Z",
        },
      ];

      const filtered = service.filterResumes(items, { maxSalary: 25000 });
      expect(filtered).toHaveLength(0);
    });
  });

  describe("education filter normalization", () => {
    it("normalizes Chinese education terms to standard levels", () => {
      const root = createFixtureRoot();
      roots.push(root);
      const service = new ResumeService(root);
      const items = [
        {
          name: "Master Degree",
          profileUrl: "https://example.com/master",
          activityStatus: "Active",
          age: "28岁",
          experience: "5年",
          education: "硕士",
          location: "东莞",
          selfIntro: "",
          jobIntention: "销售",
          expectedSalary: "",
          workHistory: [],
          extractedAt: "2026-03-20T00:00:00.000Z",
        },
      ];

      // "master" matches "硕士" via normalizeEducationLevel
      const filtered = service.filterResumes(items, { education: ["master"] });
      expect(filtered).toHaveLength(1);
    });

    it("excludes resumes whose education doesn't match filter", () => {
      const root = createFixtureRoot();
      roots.push(root);
      const service = new ResumeService(root);
      const items = [
        {
          name: "Associate Degree",
          profileUrl: "https://example.com/associate",
          activityStatus: "Active",
          age: "24岁",
          experience: "2年",
          education: "大专",
          location: "东莞",
          selfIntro: "",
          jobIntention: "销售",
          expectedSalary: "",
          workHistory: [],
          extractedAt: "2026-03-20T00:00:00.000Z",
        },
      ];

      const filtered = service.filterResumes(items, { education: ["master"] });
      expect(filtered).toHaveLength(0);
    });

    it("matches English education terms for MY market resumes", () => {
      const root = createFixtureRoot();
      roots.push(root);
      const service = new ResumeService(root);
      const items = [
        {
          name: "Seek MY",
          profileUrl: "https://example.com/seek-my",
          activityStatus: "Active",
          age: "",
          experience: "5 years",
          education: "Bachelor of Engineering",
          location: "Malaysia",
          selfIntro: "",
          jobIntention: "Sales",
          expectedSalary: "",
          workHistory: [],
          extractedAt: "2026-03-20T00:00:00.000Z",
        },
      ];

      // normalizeEducationLevel now recognizes English education terms
      const filtered = service.filterResumes(items, { education: ["bachelor"] });
      expect(filtered).toHaveLength(1);
    });
  });

  describe("skills/requiredKeywords — full searchText haystack", () => {
    it("uses searchText field when available for skills matching", () => {
      const root = createFixtureRoot();
      roots.push(root);
      const service = new ResumeService(root);
      const items = [
        {
          name: "CNC Resume",
          profileUrl: "https://example.com/cnc",
          activityStatus: "Active",
          age: "30",
          experience: "5",
          education: "Bachelor",
          location: "Dongguan",
          selfIntro: "",
          jobIntention: "",
          expectedSalary: "",
          workHistory: [{ companyName: "ACME", jobTitle: "CNC Operator", raw: "ACME CNC Operator 3 years" }],
          extractedAt: "2026-03-20T00:00:00.000Z",
          // searchText includes "fanuc" from earlier workHistory not in latest entry
          searchText: "CNC Resume Dongguan ACME CNC Operator 3 years fanuc experience",
        },
      ];

      // "fanuc" is NOT in buildBffSearchText (narrow haystack) but IS in searchText
      const filtered = service.filterResumes(items, { skills: ["fanuc"] });
      expect(filtered).toHaveLength(1);
    });

    it("uses searchText field when available for requiredKeywords matching", () => {
      const root = createFixtureRoot();
      roots.push(root);
      const service = new ResumeService(root);
      const items = [
        {
          name: "CNC Resume",
          profileUrl: "https://example.com/cnc",
          activityStatus: "Active",
          age: "30",
          experience: "5",
          education: "Bachelor",
          location: "Dongguan",
          selfIntro: "",
          jobIntention: "",
          expectedSalary: "",
          workHistory: [],
          extractedAt: "2026-03-20T00:00:00.000Z",
          searchText: "CNC Resume Dongguan machine tools fanuc operator",
        },
      ];

      const filtered = service.filterResumes(items, { requiredKeywords: ["machine tools"] });
      expect(filtered).toHaveLength(1);
    });

    it("falls back to buildBffSearchText when searchText is absent", () => {
      const root = createFixtureRoot();
      roots.push(root);
      const service = new ResumeService(root);
      const items = [
        {
          name: "Sales Resume",
          profileUrl: "https://example.com/sales",
          activityStatus: "Active",
          age: "30",
          experience: "3",
          education: "Bachelor",
          location: "Shanghai",
          selfIntro: "Sales manager",
          jobIntention: "Sales Director",
          expectedSalary: "",
          workHistory: [],
          extractedAt: "2026-03-20T00:00:00.000Z",
          // No searchText — falls back to buildBffSearchText which includes name
        },
      ];

      // "sales" is in buildBffSearchText via name/selfIntro/jobIntention
      const filtered = service.filterResumes(items, { skills: ["sales"] });
      expect(filtered).toHaveLength(1);
    });
  });
});
