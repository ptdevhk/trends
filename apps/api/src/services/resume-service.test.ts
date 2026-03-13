import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { ResumeService } from "./resume-service";

function createFixtureRoot(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "resume-service-"));
  fs.mkdirSync(path.join(root, "output", "resumes", "samples"), { recursive: true });
  fs.mkdirSync(path.join(root, "config", "resume"), { recursive: true });
  fs.mkdirSync(path.join(root, "config", "job-descriptions"), { recursive: true });
  fs.writeFileSync(path.join(root, "config", "resume", "skills_words.txt"), "sales cnc\n", "utf8");
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
});
