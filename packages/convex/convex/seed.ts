import { mutation, query } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { v } from "convex/values";
import { buildSearchText } from "./search_text";
import { deriveResumeIdentity } from "./lib/resume_identity";

const jobDescriptionType = v.union(v.literal("system"), v.literal("custom"));
const DEFAULT_WORKSPACE_SLUG = "dev";

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
      ctx.db.query("job_descriptions").collect(),
      ctx.db.query("resumes").collect(),
      ctx.db.query("collection_tasks").collect(),
      ctx.db.query("search_profiles").collect(),
      ctx.db.query("screening_sessions").collect(),
      ctx.db.query("search_history").collect(),
      ctx.db.query("workspace_config").collect(),
    ]);

    const counts = {
      jobDescriptions: jobDescriptions.length,
      resumes: resumes.length,
      collectionTasks: collectionTasks.length,
      searchProfiles: searchProfiles.length,
      screeningSessions: screeningSessions.length,
      searchHistory: searchHistory.length,
      workspaceConfig: workspaceConfig.length,
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
  args: {},
  handler: async (ctx) => {
    const seededAt = 1_762_000_000_000;
    const customJobDescriptions = [
      {
        title: "车床销售",
        slug: "workspace-demo-dev-cnc-sales",
        workspaceSlug: "dev",
        location: "广东",
        industryTags: ["machinery", "cnc", "sales"],
        customKeywords: ["机床", "销售"],
        minExperience: 1,
        maxAge: 45,
        content: [
          "---",
          'title: "车床销售"',
          "status: active",
          'location: "广东"',
          "industry_tags:",
          '  - "machinery"',
          '  - "cnc"',
          '  - "sales"',
          "auto_match:",
          "  keywords:",
          '    - "机床"',
          '    - "销售"',
          "  locations:",
          '    - "广东"',
          "  priority: 60",
          "  suggested_filters:",
          "    minExperience: 1",
          "    maxAge: 45",
          "---",
          "",
          "# 职位描述",
          "",
          "请补充「车床销售」的岗位职责。",
          "",
          "# 任职要求",
          "",
          "- 相关经验：1+ 年",
          "- 年龄范围：--45",
          "- 行业方向：machinery / cnc / sales",
          "",
          "# 关键词",
          "",
          "机床, 销售",
        ].join("\n"),
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

    const searchProfiles = [
      {
        name: "CNC销售-Demo",
        criteria: {
          keywords: ["CNC", "销售"],
          locations: ["广东,江苏"],
        },
        profile: {
          name: "CNC销售-Demo",
          status: "active" as const,
          location: "广东,江苏",
          keywords: ["CNC", "销售"],
          filters: {
            minExperience: 1,
            minAge: 25,
            maxAge: 35,
          },
        },
        workspaceSlug: "dev",
        lastRunAt: seededAt - 3_600_000,
      },
      {
        name: "Workspace Demo · HR Resume Ops",
        criteria: {
          keywords: ["招聘", "简历", "人事", "筛选"],
          locations: ["东莞", "广州"],
        },
        profile: {
          name: "Workspace Demo · HR Resume Ops",
          status: "active" as const,
          location: "东莞,广州",
          keywords: ["招聘", "简历", "人事", "筛选"],
          filters: {
            minExperience: 1,
            minAge: 25,
            maxAge: 35,
          },
        },
        workspaceSlug: "hr",
        lastRunAt: seededAt - 1_800_000,
      },
    ];

    const screeningSessions = [
      {
        sessionKey: "workspace-demo-session-dev",
        status: "active" as const,
        config: {
          location: "东莞",
          keywords: ["CNC", "销售"],
          jobDescriptionId: "workspace-demo-dev-cnc-sales",
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

    const searchHistory = [
      {
        sessionKey: "workspace-demo-session-dev",
        title: "东莞 · CNC 销售",
        location: "东莞",
        keywords: ["CNC", "销售"],
        jobDescriptionId: "workspace-demo-dev-cnc-sales",
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
              english: "STAR CNC",
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

    const existingSearchHistory = await ctx.db.query("search_history").collect();
    const searchHistoryKey = (sessionKeyValue: string, title: string, workspaceSlug: string | undefined) =>
      `${sessionKeyValue}::${title}::${normalizeWorkspaceSlug(workspaceSlug)}`;
    const existingSearchHistoryByKey = new Map(
      existingSearchHistory.map((entry) => [
        searchHistoryKey(entry.sessionKey, entry.title, entry.workspaceSlug),
        entry,
      ]),
    );
    for (const item of searchHistory) {
      const targetWorkspaceSlug = normalizeWorkspaceSlug(item.workspaceSlug);
      const key = searchHistoryKey(item.sessionKey, item.title, targetWorkspaceSlug);
      const existing = existingSearchHistoryByKey.get(key);
      if (existing) {
        const needsUpdate =
          existing.location !== item.location ||
          stableSerialize(existing.keywords) !== stableSerialize(item.keywords) ||
          existing.jobDescriptionId !== item.jobDescriptionId ||
          stableSerialize(existing.filters ?? {}) !== stableSerialize(item.filters ?? {}) ||
          stableSerialize(existing.selectedTags ?? []) !== stableSerialize(item.selectedTags ?? []) ||
          stableSerialize(existing.selectedCompanies ?? []) !== stableSerialize(item.selectedCompanies ?? []) ||
          existing.selectedExperienceLevel !== item.selectedExperienceLevel ||
          existing.workspaceSlug !== targetWorkspaceSlug ||
          existing.createdAt !== item.createdAt ||
          existing.lastOpenedAt !== item.lastOpenedAt;
        if (needsUpdate) {
          await ctx.db.patch(existing._id, {
            location: item.location,
            keywords: item.keywords,
            jobDescriptionId: item.jobDescriptionId,
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
