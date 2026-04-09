import { mutation, query } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { v } from "convex/values";
import {
  buildSearchProfileCriteria,
  buildLatestWorkHistoryEvidence,
  generateStructuredJobDescriptionContent,
  getWorkspaceSearchProfileTemplates,
} from "@trends/shared";
import { buildSearchText, mergeSearchTextWithIngestData } from "./search_text";
import { deriveResumeIdentity } from "./lib/resume_identity";

import { DEFAULT_WORKSPACE_SLUG } from "./sessions";

const jobDescriptionType = v.union(v.literal("system"), v.literal("custom"));
const WORKSPACE_DEMO_DEV_MACHINERY_SALES_SLUG =
  "workspace-demo-dev-machinery-sales";

function normalizeWorkspaceSlug(input: string | undefined): string {
  const normalized = input?.trim();
  return normalized && normalized.length > 0
    ? normalized
    : DEFAULT_WORKSPACE_SLUG;
}

function belongsToWorkspace(
  recordWorkspaceSlug: string | undefined,
  workspaceSlug: string,
): boolean {
  if (workspaceSlug === DEFAULT_WORKSPACE_SLUG) {
    return (
      !recordWorkspaceSlug || recordWorkspaceSlug === DEFAULT_WORKSPACE_SLUG
    );
  }
  return recordWorkspaceSlug === workspaceSlug;
}

function seedJobDescriptionKey(item: {
  title: string;
  type: string;
  workspaceSlug?: string;
}): string {
  const scope =
    item.type === "custom"
      ? normalizeWorkspaceSlug(item.workspaceSlug)
      : "system";
  return `${item.title}::${item.type}::${scope}`;
}

function stableSerialize(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableSerialize(item)).join(",")}]`;
  }

  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(
        ([key, nested]) => `${JSON.stringify(key)}:${stableSerialize(nested)}`,
      );
    return `{${entries.join(",")}}`;
  }

  return JSON.stringify(value);
}

function stableHash(seed: string): string {
  let hash = 2166136261;
  for (const char of seed) {
    hash ^= char.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16);
}

function buildSeekMalaysiaSalesDemoResume(seededAt: number) {
  const externalId = "my.employer.seek.com:profile:503033454";
  const source = "my.employer.seek.com";
  const content = {
    externalId,
    profileId: "503033454",
    profileType: "seek",
    name: "Yap Kae Wen",
    profileUrl: "https://my.employer.seek.com/candidates/503033454",
    activityStatus: "Updated recently",
    age: "32",
    experience: "9 years",
    education: "Bachelor of Engineering",
    location: "Kuala Lumpur, Malaysia",
    selfIntro:
      "Malaysia-based sales engineer covering CNC machine tools, channel partners, and key accounts.",
    jobIntention: "Sales Engineer / Sales Manager",
    desiredPosition: "Sales Engineer / Sales Manager",
    expectedSalary: "MYR 8,000 - MYR 12,000",
    summary:
      "Sales Engineer / Sales Manager for CNC machine tools with Kuala Lumpur coverage and nationwide Malaysia accounts.",
    companies: ["Precision Machines Malaysia Sdn Bhd", "STAR Micronics Asia"],
    workHistory: [
      {
        raw: "2021-04~Present Precision Machines Malaysia Sdn Bhd Senior Sales Engineer\nHandled CNC machine tool sales, distributor development, and Kuala Lumpur key accounts.",
        companyName: "Precision Machines Malaysia Sdn Bhd",
        jobTitle: "Senior Sales Engineer",
        startDate: "2021-04",
        endDate: "Present",
        description:
          "Handled CNC machine tool sales, distributor development, and Kuala Lumpur key accounts across Malaysia.",
      },
      {
        raw: "2017-01~2021-03 STAR Micronics Asia Regional Sales Executive\nSold STAR sliding headstock lathes and automation solutions across Malaysia.",
        companyName: "STAR Micronics Asia",
        jobTitle: "Regional Sales Executive",
        startDate: "2017-01",
        endDate: "2021-03",
        description:
          "Sold STAR sliding headstock lathes and automation solutions across Malaysia.",
      },
    ],
    profileEducation: [
      {
        institution: "Universiti Malaya",
        qualification: "Bachelor of Engineering",
      },
    ],
    skills: [
      "Sales Engineer",
      "Sales Manager",
      "CNC",
      "machine tools",
      "account management",
      { name: "Key account management", yearsOfExperience: 6 },
      { name: "Dealer channel development", yearsOfExperience: 4 },
    ],
    languages: [
      "English",
      { name: "Mandarin", proficiency: "professional" },
      { name: "Bahasa Melayu", proficiency: "professional" },
    ],
    licences: [{ name: "Class D" }],
    resumeSnippet: {
      text: "Kuala Lumpur based CNC sales engineer covering Malaysia machine tool accounts.",
    },
    currentIndustry: { name: "Industrial machinery" },
    currentSubindustry: "Machine tools",
    rightToWork: {
      status: "citizen",
      details: "Eligible to work in Malaysia without sponsorship.",
    },
    digitalIdentity: {
      linkedinUrl: "https://www.linkedin.com/in/yap-kae-wen",
    },
    noticePeriodDays: 30,
    extractedAt: "2026-03-17T08:00:00.000Z",
  };
  const evidenceText = buildLatestWorkHistoryEvidence(content.workHistory).text;
  const ingestData = {
    evidenceText,
    industryTags: ["machinery", "sales"],
    synonymHits: [
      "Sales Engineer",
      "Sales Manager",
      "machine tools",
      "account management",
      "Kuala Lumpur",
      "Malaysia",
    ],
    brandHits: [
      {
        brand: "STAR",
        role: "sales engineer",
        source: "workHistory",
        context:
          "Sold STAR sliding headstock lathes and automation solutions across Malaysia.",
      },
    ],
    companyHits: ["Precision Machines Malaysia Sdn Bhd", "STAR Micronics Asia"],
    roleSignals: [
      {
        type: "sales",
        matchedSignals: [
          "sales engineer",
          "sales manager",
          "account management",
          "machine tools",
          "cnc",
        ],
        signalCount: 5,
        occurrences: 5,
        years: 6,
        industryVerifiedYears: 6,
        roleRelevantYears: 6,
        industryVerifiedRelevantYears: 6,
        matchedWorkEntries: [
          {
            companyName: "Precision Machines Malaysia Sdn Bhd",
            jobTitle: "Senior Sales Engineer",
            years: 4,
            industryVerified: true,
            matchedSignals: ["sales engineer", "machine tools", "cnc"],
          },
          {
            companyName: "STAR Micronics Asia",
            jobTitle: "Regional Sales Executive",
            years: 4,
            industryVerified: true,
            matchedSignals: [
              "sales manager",
              "account management",
              "machine tools",
            ],
          },
        ],
        verifyIn: "workHistory",
      },
    ],
    ruleScores: {
      "seek-malaysia-sales": 86,
      "jd-seek-malaysia-sales": 86,
    },
    experienceLevel: "senior",
    computedAt: seededAt,
    skillsVersion: 2,
  };
  const searchText = mergeSearchTextWithIngestData(buildSearchText(content), {
    industryTags: ingestData.industryTags,
    synonymHits: ingestData.synonymHits,
    brandHits: ingestData.brandHits,
    companyHits: ingestData.companyHits,
  });

  return {
    externalId,
    source,
    tags: ["seed", "workspace-demo", "seek-malaysia-sales"],
    content,
    hash: stableHash(
      stableSerialize({
        externalId,
        source,
        content,
        ingestData,
        primaryRuleScore: 86,
      }),
    ),
    searchText,
    ingestData,
    primaryRuleScore: 86,
    crawledAt: seededAt - 15_000,
  };
}

export const status = query({
  args: {},
  handler: async (ctx) => {
    const [
      jobDescriptions,
      resumes,
      collectionTasks,
      searchProfiles,
      screeningSessions,
      searchHistory,
      workspaceConfig,
    ] = await Promise.all([
      ctx.db.query("job_descriptions").first(),
      ctx.db.query("resumes").first(),
      ctx.db.query("collection_tasks").first(),
      ctx.db.query("search_profiles").first(),
      ctx.db.query("screening_sessions").first(),
      ctx.db.query("search_history").first(),
      ctx.db.query("workspace_config").first(),
    ]);

    const counts = {
      jobDescriptions: jobDescriptions === null ? 0 : 1,
      resumes: resumes === null ? 0 : 1,
      collectionTasks: collectionTasks === null ? 0 : 1,
      searchProfiles: searchProfiles === null ? 0 : 1,
      screeningSessions: screeningSessions === null ? 0 : 1,
      searchHistory: searchHistory === null ? 0 : 1,
      workspaceConfig: workspaceConfig === null ? 0 : 1,
    };

    return {
      ...counts,
      isEmpty:
        counts.jobDescriptions === 0 &&
        counts.resumes === 0 &&
        counts.collectionTasks === 0 &&
        counts.searchProfiles === 0 &&
        counts.screeningSessions === 0 &&
        counts.searchHistory === 0 &&
        counts.workspaceConfig === 0,
    };
  },
});

export const seedJobDescriptions = mutation({
  args: {
    items: v.array(
      v.object({
        title: v.string(),
        slug: v.optional(v.string()),
        content: v.string(),
        type: jobDescriptionType,
        workspaceSlug: v.optional(v.string()),
        location: v.optional(v.string()),
        customKeywords: v.optional(v.array(v.string())),
        minExperience: v.optional(v.number()),
        maxExperience: v.optional(v.number()),
        minAge: v.optional(v.number()),
        maxAge: v.optional(v.number()),
      }),
    ),
  },
  handler: async (ctx, args) => {
    const existingJobDescriptions = await ctx.db
      .query("job_descriptions")
      .collect();
    const existingByKey = new Map(
      existingJobDescriptions.map((item) => [
        seedJobDescriptionKey(item),
        item,
      ]),
    );

    let inserted = 0;
    let skipped = 0;
    let updated = 0;

    for (const item of args.items) {
      const workspaceSlug =
        item.type === "custom"
          ? normalizeWorkspaceSlug(item.workspaceSlug)
          : undefined;
      const key = seedJobDescriptionKey({
        title: item.title,
        type: item.type,
        workspaceSlug,
      });
      const existing = existingByKey.get(key);
      if (existing) {
        const patch: {
          slug?: string;
          content?: string;
          workspaceSlug?: string;
          location?: string;
          customKeywords?: string[];
          minExperience?: number;
          maxExperience?: number;
          minAge?: number;
          maxAge?: number;
          lastModified?: number;
        } = {};

        if (item.slug && existing.slug !== item.slug) {
          patch.slug = item.slug;
        }
        if (existing.content !== item.content) {
          patch.content = item.content;
        }
        if (
          item.type === "custom" &&
          existing.workspaceSlug !== workspaceSlug
        ) {
          patch.workspaceSlug = workspaceSlug;
        }
        if (item.location && existing.location !== item.location) {
          patch.location = item.location;
        }
        if (
          item.customKeywords &&
          stableSerialize(existing.customKeywords ?? []) !==
            stableSerialize(item.customKeywords)
        ) {
          patch.customKeywords = item.customKeywords;
        }
        if (
          item.minExperience !== undefined &&
          existing.minExperience !== item.minExperience
        ) {
          patch.minExperience = item.minExperience;
        }
        if (
          item.maxExperience !== undefined &&
          existing.maxExperience !== item.maxExperience
        ) {
          patch.maxExperience = item.maxExperience;
        }
        if (item.minAge !== undefined && existing.minAge !== item.minAge) {
          patch.minAge = item.minAge;
        }
        if (item.maxAge !== undefined && existing.maxAge !== item.maxAge) {
          patch.maxAge = item.maxAge;
        }

        if (Object.keys(patch).length > 0) {
          patch.lastModified = Date.now();
          await ctx.db.patch(existing._id, patch);
          updated += 1;
        }
        skipped += 1;
        continue;
      }

      await ctx.db.insert("job_descriptions", {
        title: item.title,
        slug: item.slug,
        content: item.content,
        type: item.type,
        workspaceSlug,
        enabled: true,
        lastModified: Date.now(),
        location: item.location,
        customKeywords: item.customKeywords,
        minExperience: item.minExperience,
        maxExperience: item.maxExperience,
        minAge: item.minAge,
        maxAge: item.maxAge,
      });
      inserted += 1;
    }

    return { inserted, skipped, updated };
  },
});

export const seedResumes = mutation({
  args: {
    resumes: v.array(
      v.object({
        externalId: v.string(),
        content: v.any(),
        hash: v.string(),
        source: v.string(),
        tags: v.array(v.string()),
      }),
    ),
  },
  handler: async (ctx, args) => {
    let inserted = 0;
    let skipped = 0;
    const insertedIds: Id<"resumes">[] = [];

    for (const resume of args.resumes) {
      const identity = deriveResumeIdentity({
        content: resume.content,
        externalId: resume.externalId,
        source: resume.source,
      });
      let existing = await ctx.db
        .query("resumes")
        .withIndex("by_identityKey", (q) =>
          q.eq("identityKey", identity.identityKey),
        )
        .unique();
      if (!existing) {
        existing = await ctx.db
          .query("resumes")
          .withIndex("by_externalId", (q) =>
            q.eq("externalId", resume.externalId),
          )
          .unique();
      }

      const searchText = buildSearchText(resume.content);

      if (existing) {
        const nextTags = Array.from(
          new Set([...existing.tags, ...resume.tags]),
        );
        const patch: {
          identityKey?: string;
          searchText?: string;
          tags?: string[];
        } = {};
        if (!existing.searchText) {
          patch.searchText = searchText;
        }
        if (existing.identityKey !== identity.identityKey) {
          patch.identityKey = identity.identityKey;
        }
        const tagsChanged =
          nextTags.length !== existing.tags.length ||
          nextTags.some((tag, index) => existing.tags[index] !== tag);
        if (tagsChanged) {
          patch.tags = nextTags;
        }
        if (Object.keys(patch).length > 0) {
          await ctx.db.patch(existing._id, patch);
        }
        skipped += 1;
        continue;
      }

      const id = await ctx.db.insert("resumes", {
        externalId: resume.externalId,
        identityKey: identity.identityKey,
        content: resume.content,
        hash: resume.hash,
        searchText,
        source: resume.source,
        tags: resume.tags,
        crawledAt: Date.now(),
      });
      insertedIds.push(id);
      inserted += 1;
    }

    // Schedule ingest agent for newly inserted resumes (compute industryTags, ruleScores, etc.)
    if (insertedIds.length > 0) {
      const BATCH = 50;
      for (let i = 0; i < insertedIds.length; i += BATCH) {
        await ctx.scheduler.runAfter(
          0,
          internal.ingest_agent.processNewResumes,
          {
            resumeIds: insertedIds.slice(i, i + BATCH),
          },
        );
      }
    }

    return { inserted, skipped };
  },
});

export const seedWorkspaceDemoData = mutation({
  args: {
    includeDemoResumes: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const seededAt = 1_762_000_000_000;
    const includeDemoResumes = args.includeDemoResumes === true;
    const customJobDescriptions = [
      {
        title: "车床销售",
        slug: WORKSPACE_DEMO_DEV_MACHINERY_SALES_SLUG,
        workspaceSlug: "dev",
        location: "广东",
        industryTags: ["machinery", "sales"],
        customKeywords: ["机床", "销售"],
        minExperience: 1,
        maxAge: 45,
        content: generateStructuredJobDescriptionContent({
          title: "车床销售",
          location: "广东",
          industryTags: ["machinery", "sales"],
          customKeywords: ["机床", "销售"],
          minExperience: 1,
          maxAge: 45,
        }),
      },
      {
        title: "Workspace Demo · HR Resume Operations Specialist",
        slug: "workspace-demo-hr-resume-ops",
        workspaceSlug: "hr",
        content: [
          "# Workspace Demo · HR Resume Operations Specialist",
          "",
          "## Must Have",
          "- Resume screening and shortlist operations experience",
          "- Familiarity with ATS workflows and hiring coordination",
          "- High-quality candidate communication and interview handling",
          "",
          "## Preferred",
          "- Recruiting analytics and hiring funnel optimization",
          "- Hiring support for manufacturing and equipment roles",
        ].join("\n"),
      },
    ];

    const searchProfiles = getWorkspaceSearchProfileTemplates("dev").map((template) => ({
      name: template.profile.name,
      criteria: buildSearchProfileCriteria(template.profile),
      profile: template.profile,
      workspaceSlug: template.workspaceSlug,
      lastRunAt: typeof template.seedLastRunOffsetMs === "number"
        ? seededAt - template.seedLastRunOffsetMs
        : undefined,
    }));

    const screeningSessions = [
      {
        sessionKey: "workspace-demo-session-dev",
        status: "active" as const,
        config: {
          location: "东莞",
          keywords: ["机床", "销售"],
          jobDescriptionId: WORKSPACE_DEMO_DEV_MACHINERY_SALES_SLUG,
          filters: {
            minExperience: 3,
            education: ["大专", "本科"],
          },
        },
        reviewedResumeIds: [] as string[],
        workspaceSlug: "dev",
        lastActive: seededAt - 60_000,
      },
      {
        sessionKey: "workspace-demo-session-hr",
        status: "active" as const,
        config: {
          location: "东莞",
          keywords: ["招聘", "简历"],
          jobDescriptionId: "workspace-demo-hr-resume-ops",
          filters: {
            minExperience: 1,
            education: ["大专", "本科"],
          },
        },
        reviewedResumeIds: [] as string[],
        workspaceSlug: "hr",
        lastActive: seededAt - 30_000,
      },
    ];

    const searchHistory: Array<{
      sessionKey: string;
      title: string;
      location: string;
      keywords: string[];
      jobDescriptionId?: string;
      collectionSource?: {
        type: "job5156" | "51job" | "seek";
        exactUrl?: string;
      };
      collectUrl?: string;
      filters?: Record<string, unknown>;
      selectedTags?: string[];
      selectedCompanies?: string[];
      selectedExperienceLevel?: string;
      workspaceSlug?: string;
      createdAt: number;
      lastOpenedAt: number;
    }> = [
      {
        sessionKey: "workspace-demo-session-dev",
        title: "东莞 · 机械 销售",
        location: "东莞",
        keywords: ["机床", "销售"],
        jobDescriptionId: WORKSPACE_DEMO_DEV_MACHINERY_SALES_SLUG,
        filters: {
          minExperience: 3,
          education: ["大专", "本科"],
        },
        selectedTags: ["STAR机床"],
        selectedCompanies: ["深圳市星晨精密设备有限公司"],
        selectedExperienceLevel: "mid",
        workspaceSlug: "dev",
        createdAt: seededAt - 300_000,
        lastOpenedAt: seededAt - 120_000,
      },
      {
        sessionKey: "workspace-demo-session-hr",
        title: "东莞 · 招聘 简历",
        location: "东莞",
        keywords: ["招聘", "简历"],
        jobDescriptionId: "workspace-demo-hr-resume-ops",
        filters: {
          minExperience: 1,
          education: ["大专", "本科"],
        },
        selectedTags: ["招聘运营"],
        selectedCompanies: ["东莞市智聘人力资源有限公司"],
        selectedExperienceLevel: "junior",
        workspaceSlug: "hr",
        createdAt: seededAt - 240_000,
        lastOpenedAt: seededAt - 90_000,
      },
    ];

    const workspaceConfigs = [
      {
        workspaceSlug: "dev",
        configKey: "custom-keywords",
        configValue: {
          categories: [
            {
              id: "workspace-dev-brand",
              name: "Dev 品牌优先",
              icon: "factory",
            },
          ],
          tags: [
            {
              id: "workspace-dev-brand-star",
              keyword: "STAR机床",
              english: "STAR 机床",
              category: "workspace-dev-brand",
            },
            {
              id: "workspace-dev-brand-haas",
              keyword: "HAAS",
              english: "HAAS",
              category: "workspace-dev-brand",
            },
          ],
        },
      },
      {
        workspaceSlug: "hr",
        configKey: "custom-keywords",
        configValue: {
          categories: [
            { id: "workspace-hr-priority", name: "HR 优先标签", icon: "users" },
          ],
          tags: [
            {
              id: "workspace-hr-priority-communication",
              keyword: "候选人沟通",
              english: "Candidate Communication",
              category: "workspace-hr-priority",
            },
            {
              id: "workspace-hr-priority-coordination",
              keyword: "面试协调",
              english: "Interview Coordination",
              category: "workspace-hr-priority",
            },
          ],
        },
      },
      {
        workspaceSlug: "dev",
        configKey: "filter-presets",
        configValue: {
          categories: [{ id: "workspace-dev", name: "Dev 专用", icon: "zap" }],
          presets: [
            {
              id: "workspace-dev-fast-track-sales",
              name: "Dev 高潜销售",
              category: "workspace-dev",
              filters: {
                minExperience: 4,
                education: ["大专", "本科"],
                salaryRange: { min: 12000, max: 28000 },
              },
            },
          ],
        },
      },
      {
        workspaceSlug: "hr",
        configKey: "filter-presets",
        configValue: {
          categories: [
            { id: "workspace-hr", name: "HR 专用", icon: "briefcase" },
          ],
          presets: [
            {
              id: "workspace-hr-fast-shortlist",
              name: "HR 快速初筛",
              category: "workspace-hr",
              filters: {
                minExperience: 1,
                education: ["大专", "本科", "硕士"],
              },
            },
          ],
        },
      },
      {
        workspaceSlug: "dev",
        configKey: "agent-overrides",
        configValue: {
          agents: {
            defaults: {
              screener: { passThreshold: 58 },
              evaluator: { passThreshold: 74 },
            },
          },
        },
      },
      {
        workspaceSlug: "hr",
        configKey: "agent-overrides",
        configValue: {
          agents: {
            defaults: {
              screener: { passThreshold: 52 },
              evaluator: { passThreshold: 68 },
            },
          },
        },
      },
    ];

    const result = {
      customJobDescriptions: { inserted: 0, updated: 0 },
      searchProfiles: { inserted: 0, updated: 0 },
      screeningSessions: { inserted: 0, updated: 0 },
      searchHistory: { inserted: 0, updated: 0 },
      workspaceConfig: { inserted: 0, updated: 0 },
      resumes: { inserted: 0, updated: 0 },
    };

    const existingCustomJds = await ctx.db
      .query("job_descriptions")
      .filter((q) => q.eq(q.field("type"), "custom"))
      .collect();
    const existingCustomByKey = new Map(
      existingCustomJds.map((item) => [seedJobDescriptionKey(item), item]),
    );
    const customSlugKey = (
      workspaceSlug: string | undefined,
      slug: string | undefined,
    ) => `${normalizeWorkspaceSlug(workspaceSlug)}::${slug ?? ""}`;
    const existingCustomBySlug = new Map(
      existingCustomJds.map((item) => [
        customSlugKey(item.workspaceSlug, item.slug),
        item,
      ]),
    );
    for (const item of customJobDescriptions) {
      const key = seedJobDescriptionKey({
        title: item.title,
        type: "custom",
        workspaceSlug: item.workspaceSlug,
      });
      const existing =
        existingCustomByKey.get(key) ??
        existingCustomBySlug.get(customSlugKey(item.workspaceSlug, item.slug));
      if (existing) {
        const needsUpdate =
          existing.title !== item.title ||
          existing.slug !== item.slug ||
          existing.content !== item.content ||
          existing.workspaceSlug !== item.workspaceSlug ||
          existing.location !== item.location ||
          stableSerialize(existing.industryTags ?? []) !==
            stableSerialize(item.industryTags ?? []) ||
          stableSerialize(existing.customKeywords ?? []) !==
            stableSerialize(item.customKeywords ?? []) ||
          existing.minExperience !== item.minExperience ||
          existing.maxAge !== item.maxAge ||
          existing.enabled !== true;
        if (needsUpdate) {
          await ctx.db.patch(existing._id, {
            title: item.title,
            slug: item.slug,
            content: item.content,
            workspaceSlug: item.workspaceSlug,
            location: item.location,
            industryTags: item.industryTags,
            customKeywords: item.customKeywords,
            minExperience: item.minExperience,
            maxAge: item.maxAge,
            enabled: true,
            lastModified: seededAt,
          });
          result.customJobDescriptions.updated += 1;
        }
        continue;
      }
      await ctx.db.insert("job_descriptions", {
        title: item.title,
        slug: item.slug,
        content: item.content,
        type: "custom",
        workspaceSlug: item.workspaceSlug,
        location: item.location,
        industryTags: item.industryTags,
        customKeywords: item.customKeywords,
        minExperience: item.minExperience,
        maxAge: item.maxAge,
        enabled: true,
        lastModified: seededAt,
      });
      result.customJobDescriptions.inserted += 1;
    }

    const existingProfiles = await ctx.db.query("search_profiles").collect();
    const profileKey = (name: string, workspaceSlug: string | undefined) =>
      `${name}::${normalizeWorkspaceSlug(workspaceSlug)}`;
    const existingProfilesByKey = new Map(
      existingProfiles.map((profile) => [
        profileKey(profile.name, profile.workspaceSlug),
        profile,
      ]),
    );
    for (const item of searchProfiles) {
      const targetWorkspaceSlug = normalizeWorkspaceSlug(item.workspaceSlug);
      const key = profileKey(item.name, targetWorkspaceSlug);
      const existing = existingProfilesByKey.get(key);
      if (existing) {
        const needsUpdate =
          stableSerialize(existing.criteria) !==
            stableSerialize(item.criteria) ||
          stableSerialize(existing.profile ?? {}) !==
            stableSerialize(item.profile ?? {}) ||
          existing.workspaceSlug !== targetWorkspaceSlug ||
          existing.lastRunAt !== item.lastRunAt;
        if (needsUpdate) {
          await ctx.db.patch(existing._id, {
            criteria: item.criteria,
            profile: item.profile,
            workspaceSlug: targetWorkspaceSlug,
            lastRunAt: item.lastRunAt,
          });
          result.searchProfiles.updated += 1;
        }
        continue;
      }
      await ctx.db.insert("search_profiles", {
        name: item.name,
        criteria: item.criteria,
        profile: item.profile,
        workspaceSlug: targetWorkspaceSlug,
        lastRunAt: item.lastRunAt,
      });
      result.searchProfiles.inserted += 1;
    }

    const existingSessions = await ctx.db.query("screening_sessions").collect();
    const sessionKey = (value: string, workspaceSlug: string | undefined) =>
      `${value}::${normalizeWorkspaceSlug(workspaceSlug)}`;
    const existingSessionsByKey = new Map(
      existingSessions.map((session) => [
        sessionKey(session.sessionKey, session.workspaceSlug),
        session,
      ]),
    );
    for (const item of screeningSessions) {
      const targetWorkspaceSlug = normalizeWorkspaceSlug(item.workspaceSlug);
      const key = sessionKey(item.sessionKey, targetWorkspaceSlug);
      const existing = existingSessionsByKey.get(key);
      if (existing) {
        const needsUpdate =
          existing.status !== item.status ||
          stableSerialize(existing.config) !== stableSerialize(item.config) ||
          stableSerialize(existing.reviewedResumeIds) !==
            stableSerialize(item.reviewedResumeIds) ||
          existing.workspaceSlug !== targetWorkspaceSlug ||
          existing.lastActive !== item.lastActive;
        if (needsUpdate) {
          await ctx.db.patch(existing._id, {
            status: item.status,
            config: item.config,
            reviewedResumeIds: item.reviewedResumeIds,
            workspaceSlug: targetWorkspaceSlug,
            lastActive: item.lastActive,
          });
          result.screeningSessions.updated += 1;
        }
        continue;
      }

      await ctx.db.insert("screening_sessions", {
        sessionKey: item.sessionKey,
        status: item.status,
        config: item.config,
        reviewedResumeIds: item.reviewedResumeIds,
        workspaceSlug: targetWorkspaceSlug,
        lastActive: item.lastActive,
      });
      result.screeningSessions.inserted += 1;
    }

    const existingSearchHistory = await ctx.db
      .query("search_history")
      .collect();
    const searchHistoryKey = (
      sessionKeyValue: string,
      title: string,
      workspaceSlug: string | undefined,
    ) =>
      `${sessionKeyValue}::${title}::${normalizeWorkspaceSlug(workspaceSlug)}`;
    const existingSearchHistoryByKey = new Map(
      existingSearchHistory.map((entry) => [
        searchHistoryKey(entry.sessionKey, entry.title, entry.workspaceSlug),
        entry,
      ]),
    );
    for (const item of searchHistory) {
      const targetWorkspaceSlug = normalizeWorkspaceSlug(item.workspaceSlug);
      const key = searchHistoryKey(
        item.sessionKey,
        item.title,
        targetWorkspaceSlug,
      );
      const existing = existingSearchHistoryByKey.get(key);
      if (existing) {
        const needsUpdate =
          existing.location !== item.location ||
          stableSerialize(existing.keywords) !==
            stableSerialize(item.keywords) ||
          existing.jobDescriptionId !== item.jobDescriptionId ||
          stableSerialize(existing.collectionSource ?? null) !==
            stableSerialize(item.collectionSource ?? null) ||
          existing.collectUrl !== item.collectUrl ||
          stableSerialize(existing.filters ?? {}) !==
            stableSerialize(item.filters ?? {}) ||
          stableSerialize(existing.selectedTags ?? []) !==
            stableSerialize(item.selectedTags ?? []) ||
          stableSerialize(existing.selectedCompanies ?? []) !==
            stableSerialize(item.selectedCompanies ?? []) ||
          existing.selectedExperienceLevel !== item.selectedExperienceLevel ||
          existing.workspaceSlug !== targetWorkspaceSlug ||
          existing.createdAt !== item.createdAt ||
          existing.lastOpenedAt !== item.lastOpenedAt;
        if (needsUpdate) {
          await ctx.db.patch(existing._id, {
            location: item.location,
            keywords: item.keywords,
            jobDescriptionId: item.jobDescriptionId,
            collectionSource: item.collectionSource,
            collectUrl: item.collectUrl,
            filters: item.filters,
            selectedTags: item.selectedTags,
            selectedCompanies: item.selectedCompanies,
            selectedExperienceLevel: item.selectedExperienceLevel,
            workspaceSlug: targetWorkspaceSlug,
            createdAt: item.createdAt,
            lastOpenedAt: item.lastOpenedAt,
          });
          result.searchHistory.updated += 1;
        }
        continue;
      }

      await ctx.db.insert("search_history", {
        sessionKey: item.sessionKey,
        title: item.title,
        location: item.location,
        keywords: item.keywords,
        jobDescriptionId: item.jobDescriptionId,
        collectionSource: item.collectionSource,
        collectUrl: item.collectUrl,
        filters: item.filters,
        selectedTags: item.selectedTags,
        selectedCompanies: item.selectedCompanies,
        selectedExperienceLevel: item.selectedExperienceLevel,
        workspaceSlug: targetWorkspaceSlug,
        createdAt: item.createdAt,
        lastOpenedAt: item.lastOpenedAt,
      });
      result.searchHistory.inserted += 1;
    }

    for (const item of workspaceConfigs) {
      const existing = await ctx.db
        .query("workspace_config")
        .withIndex("by_workspace_key", (q) =>
          q
            .eq("workspaceSlug", item.workspaceSlug)
            .eq("configKey", item.configKey),
        )
        .unique();
      if (existing) {
        const configChanged =
          stableSerialize(existing.configValue) !==
          stableSerialize(item.configValue);
        if (configChanged) {
          await ctx.db.patch(existing._id, {
            configValue: item.configValue,
            updatedAt: seededAt,
          });
          result.workspaceConfig.updated += 1;
        }
        continue;
      }

      await ctx.db.insert("workspace_config", {
        workspaceSlug: item.workspaceSlug,
        configKey: item.configKey,
        configValue: item.configValue,
        updatedAt: seededAt,
      });
      result.workspaceConfig.inserted += 1;
    }

    const demoResumes = includeDemoResumes
      ? [buildSeekMalaysiaSalesDemoResume(seededAt)]
      : [];
    for (const item of demoResumes) {
      const identity = deriveResumeIdentity({
        content: item.content,
        externalId: item.externalId,
        source: item.source,
      });
      let existing = await ctx.db
        .query("resumes")
        .withIndex("by_identityKey", (q) =>
          q.eq("identityKey", identity.identityKey),
        )
        .unique();
      if (!existing) {
        existing = await ctx.db
          .query("resumes")
          .withIndex("by_externalId", (q) =>
            q.eq("externalId", item.externalId),
          )
          .unique();
      }

      if (existing) {
        const nextTags = Array.from(new Set([...existing.tags, ...item.tags]));
        const needsUpdate =
          existing.identityKey !== identity.identityKey ||
          existing.externalId !== item.externalId ||
          existing.source !== item.source ||
          existing.hash !== item.hash ||
          stableSerialize(existing.content) !== stableSerialize(item.content) ||
          stableSerialize(existing.tags) !== stableSerialize(nextTags) ||
          stableSerialize(existing.ingestData ?? {}) !==
            stableSerialize(item.ingestData) ||
          existing.primaryRuleScore !== item.primaryRuleScore ||
          existing.searchText !== item.searchText ||
          existing.crawledAt !== item.crawledAt;
        if (needsUpdate) {
          await ctx.db.patch(existing._id, {
            identityKey: identity.identityKey,
            externalId: item.externalId,
            content: item.content,
            hash: item.hash,
            source: item.source,
            tags: nextTags,
            crawledAt: item.crawledAt,
            ingestData: item.ingestData,
            primaryRuleScore: item.primaryRuleScore,
            searchText: item.searchText,
          });
          result.resumes.updated += 1;
        }
        continue;
      }

      await ctx.db.insert("resumes", {
        externalId: item.externalId,
        identityKey: identity.identityKey,
        content: item.content,
        hash: item.hash,
        source: item.source,
        tags: item.tags,
        crawledAt: item.crawledAt,
        ingestData: item.ingestData,
        primaryRuleScore: item.primaryRuleScore,
        searchText: item.searchText,
      });
      result.resumes.inserted += 1;
    }

    return result;
  },
});

export const clearWorkspaceData = mutation({
  args: {
    workspaceSlug: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const workspaceSlug = normalizeWorkspaceSlug(args.workspaceSlug);
    let customJobDescriptions = 0;
    let searchProfiles = 0;
    let screeningSessions = 0;
    let searchHistory = 0;
    let workspaceConfig = 0;

    const customJds = await ctx.db
      .query("job_descriptions")
      .filter((q) => q.eq(q.field("type"), "custom"))
      .collect();
    for (const jd of customJds) {
      if (!belongsToWorkspace(jd.workspaceSlug, workspaceSlug)) {
        continue;
      }
      await ctx.db.delete(jd._id);
      customJobDescriptions += 1;
    }

    const profiles = await ctx.db.query("search_profiles").collect();
    for (const profile of profiles) {
      if (!belongsToWorkspace(profile.workspaceSlug, workspaceSlug)) {
        continue;
      }
      await ctx.db.delete(profile._id);
      searchProfiles += 1;
    }

    const sessions = await ctx.db.query("screening_sessions").collect();
    for (const session of sessions) {
      if (!belongsToWorkspace(session.workspaceSlug, workspaceSlug)) {
        continue;
      }
      await ctx.db.delete(session._id);
      screeningSessions += 1;
    }

    const historyEntries = await ctx.db.query("search_history").collect();
    for (const entry of historyEntries) {
      if (!belongsToWorkspace(entry.workspaceSlug, workspaceSlug)) {
        continue;
      }
      await ctx.db.delete(entry._id);
      searchHistory += 1;
    }

    const configEntries = await ctx.db
      .query("workspace_config")
      .withIndex("by_workspace", (q) => q.eq("workspaceSlug", workspaceSlug))
      .collect();
    for (const entry of configEntries) {
      await ctx.db.delete(entry._id);
      workspaceConfig += 1;
    }

    return {
      workspaceSlug,
      customJobDescriptions,
      searchProfiles,
      screeningSessions,
      searchHistory,
      workspaceConfig,
    };
  },
});

export const clearWorkspaceDemoResumes = mutation({
  args: {},
  handler: async (ctx) => {
    const resumes = await ctx.db.query("resumes").collect();
    let deleted = 0;

    for (const resume of resumes) {
      if (!resume.tags.includes("workspace-demo")) {
        continue;
      }
      await ctx.db.delete(resume._id);
      deleted += 1;
    }

    return {
      deleted,
      tag: "workspace-demo",
    };
  },
});

export const clearAll = mutation({
  args: {},
  handler: async (ctx) => {
    const jds = await ctx.db.query("job_descriptions").collect();
    for (const jd of jds) await ctx.db.delete(jd._id);

    const resumes = await ctx.db.query("resumes").collect();
    for (const resume of resumes) await ctx.db.delete(resume._id);

    const tasks = await ctx.db.query("collection_tasks").collect();
    for (const task of tasks) await ctx.db.delete(task._id);

    const analysisTasks = await ctx.db.query("analysis_tasks").collect();
    for (const task of analysisTasks) await ctx.db.delete(task._id);

    const searchProfiles = await ctx.db.query("search_profiles").collect();
    for (const profile of searchProfiles) await ctx.db.delete(profile._id);

    const screeningSessions = await ctx.db
      .query("screening_sessions")
      .collect();
    for (const session of screeningSessions) await ctx.db.delete(session._id);

    const searchHistory = await ctx.db.query("search_history").collect();
    for (const entry of searchHistory) await ctx.db.delete(entry._id);

    const workspaceConfig = await ctx.db.query("workspace_config").collect();
    for (const item of workspaceConfig) await ctx.db.delete(item._id);

    return { success: true };
  },
});
