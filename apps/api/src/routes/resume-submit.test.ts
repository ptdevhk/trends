import { afterEach, describe, expect, it, vi } from "vitest";

import { createApp } from "../app";
import { convexSuccess, parseConvexCall, type ConvexCall } from "../test-helpers";

describe("resume submit route", () => {
  const originalSubmitToken = process.env.RESUME_SUBMIT_TOKEN;

  afterEach(() => {
    vi.restoreAllMocks();
    if (typeof originalSubmitToken === "string") {
      process.env.RESUME_SUBMIT_TOKEN = originalSubmitToken;
    } else {
      delete process.env.RESUME_SUBMIT_TOKEN;
    }
  });

  it("keeps legacy Job5156 payloads compatible", async () => {
    process.env.RESUME_SUBMIT_TOKEN = "test-token";
    const calls: ConvexCall[] = [];

    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const call = parseConvexCall(input, init, "mutation");
      calls.push(call);

      if (call.pathName === "resume_tasks:submitResumes") {
        return convexSuccess({
          submitted: 1,
          deduped: 0,
          inserted: 1,
          updated: 0,
          unchanged: 0,
        });
      }

      throw new Error(`Unexpected convex path: ${call.pathName}`);
    });

    const app = createApp();
    const response = await app.request("/api/resumes/submit", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer test-token",
      },
      body: JSON.stringify({
        metadata: {
          sourceUrl: "https://hr.job5156.com/search?keyword=%E9%94%80%E5%94%AE",
          keyword: "销售",
          generatedBy: "browser-extension@1.0.0",
        },
        resumes: [
          {
            resumeId: "R123456",
            name: "Alex Chen",
            profileUrl: "https://hr.job5156.com/resume/view/123456",
            activityStatus: "Active today",
            age: "28",
            experience: "5 years",
            education: "Bachelor",
            location: "Shenzhen",
            selfIntro: "认真敬业",
            jobIntention: "Sales Manager",
            expectedSalary: "10-15K",
            workHistory: [{ raw: "2021-03 ~ 2023-08 Example Co. - Sales Manager" }],
            extractedAt: "2026-03-12T01:02:03.000Z",
          },
        ],
      }),
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      success: true,
      submitted: 1,
      inserted: 1,
      updated: 0,
      unchanged: 0,
      deduped: 0,
    });

    expect(calls).toHaveLength(1);
    expect(calls[0]?.pathName).toBe("resume_tasks:submitResumes");
    expect(calls[0]?.args).toMatchObject({
      resumes: [
        {
          externalId: "hr.job5156.com:resume:R123456",
          source: "hr.job5156.com",
          tags: ["销售"],
          content: expect.objectContaining({
            resumeId: "R123456",
            name: "Alex Chen",
          }),
        },
      ],
    });
  });

  it("accepts source-aware Seek payloads", async () => {
    process.env.RESUME_SUBMIT_TOKEN = "test-token";
    const calls: ConvexCall[] = [];

    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const call = parseConvexCall(input, init, "mutation");
      calls.push(call);

      if (call.pathName === "resume_tasks:submitResumes") {
        return convexSuccess({
          submitted: 1,
          deduped: 0,
          inserted: 1,
          updated: 0,
          unchanged: 0,
        });
      }

      throw new Error(`Unexpected convex path: ${call.pathName}`);
    });

    const app = createApp();
    const response = await app.request("/api/resumes/submit", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer test-token",
      },
      body: JSON.stringify({
        metadata: {
          sourceKey: "seek",
          sourceHost: "hk.employer.seek.com",
          sourceUrl: "https://hk.employer.seek.com/candidates/recommended?jobId=90842915&pageNumber=2",
          keyword: "sales engineer",
          generatedBy: "browser-extension@1.1.0",
          collectionContext: {
            captureMode: "graphql-list",
            operation: "GetTalentSearchRecommendedCandidates",
            jobId: 90842915,
            searchId: "c51c7af1-4b0f-4d3b-8435-75b886a56872",
            pageNumber: 2,
            language: "en",
            profileType: "seek",
          },
        },
        resumes: [
          {
            profileId: 503033454,
            profileType: "seek",
            name: "yap kae wen",
            profileUrl: "https://hk.employer.seek.com/candidates/503033454",
            activityStatus: "Updated recently",
            age: "",
            experience: "",
            education: "",
            location: "Shah Alam, Selangor, MY",
            selfIntro: "",
            jobIntention: "Senior Sales Engineer",
            expectedSalary: "",
            workHistory: [
              {
                raw: "Senior Sales Engineer · Example Co.",
                companyName: "Example Co.",
                jobTitle: "Senior Sales Engineer",
                description: "Managed CNC machine accounts across Malaysia.",
              },
            ],
            profileEducation: [
              {
                institution: "Universiti Malaya",
                qualification: "Bachelor of Engineering",
              },
            ],
            skills: ["CNC", { name: "Key account management" }],
            languages: ["English", { name: "Mandarin", proficiency: "professional" }],
            licences: [{ name: "Class D" }],
            resumeSnippet: {
              text: "Experienced sales engineer covering machine tools.",
            },
            currentIndustry: { name: "Industrial machinery" },
            currentSubindustry: "Machine tools",
            rightToWork: { status: "citizen" },
            digitalIdentity: { linkedinUrl: "https://www.linkedin.com/in/example" },
            noticePeriodDays: 30,
            extractedAt: "2026-03-12T01:02:03.000Z",
          },
        ],
      }),
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      success: true,
      submitted: 1,
      inserted: 1,
      updated: 0,
      unchanged: 0,
      deduped: 0,
    });

    expect(calls).toHaveLength(1);
    expect(calls[0]?.pathName).toBe("resume_tasks:submitResumes");
    expect(calls[0]?.args).toMatchObject({
      resumes: [
        {
          externalId: "hk.employer.seek.com:profile:503033454",
          source: "hk.employer.seek.com",
          tags: ["sales engineer"],
          content: expect.objectContaining({
            profileId: "503033454",
            profileType: "seek",
            name: "yap kae wen",
            profileEducation: [
              {
                institution: "Universiti Malaya",
                qualification: "Bachelor of Engineering",
              },
            ],
            skills: ["CNC", { name: "Key account management" }],
            languages: ["English", { name: "Mandarin", proficiency: "professional" }],
            licences: [{ name: "Class D" }],
            resumeSnippet: {
              text: "Experienced sales engineer covering machine tools.",
            },
            currentIndustry: { name: "Industrial machinery" },
            currentSubindustry: "Machine tools",
            rightToWork: { status: "citizen" },
            digitalIdentity: { linkedinUrl: "https://www.linkedin.com/in/example" },
            noticePeriodDays: 30,
          }),
        },
      ],
    });
  });
});
