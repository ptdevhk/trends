import { z } from "@hono/zod-openapi";

const CsvStringArraySchema = z.preprocess((value) => {
  if (typeof value !== "string") return value;
  const parts = value
    .split(/[,，、]/g)
    .map((part) => part.trim())
    .filter(Boolean);
  return parts.length > 0 ? parts : undefined;
}, z.array(z.string()).optional());

const ResumeWorkHistoryDetailShape = {
  companyName: z.string().optional().openapi({ example: "Example Co." }),
  jobTitle: z.string().optional().openapi({ example: "Sales Manager" }),
  description: z.string().optional().openapi({ example: "Managed CNC machine tool accounts across the region." }),
  startDate: z.string().optional().openapi({ example: "2021-03" }),
  endDate: z.string().optional().openapi({ example: "2023-08" }),
};

export const ResumeWorkHistorySchema = z
  .object({
    raw: z.string().openapi({ example: "2021-03 ~ 2023-08 Example Co. - Sales Manager" }),
    ...ResumeWorkHistoryDetailShape,
  })
  .openapi("ResumeWorkHistory");

const ResumeImportWorkHistorySchema = z
  .object({
    raw: z.string().optional().openapi({ example: "2021-03 ~ 2023-08 Example Co. - Sales Manager" }),
    ...ResumeWorkHistoryDetailShape,
  })
  .openapi("ResumeImportWorkHistory");

const ResumeImportProfileEducationSchema = z
  .object({
    institution: z.string().optional().openapi({ example: "Universiti Malaya" }),
    qualification: z.string().optional().openapi({ example: "Bachelor of Engineering" }),
    fieldOfStudy: z.string().optional().openapi({ example: "Mechanical Engineering" }),
    description: z.string().optional().openapi({ example: "Focused on mechanical design and manufacturing systems." }),
    startDate: z.string().optional().openapi({ example: "2014" }),
    endDate: z.string().optional().openapi({ example: "2018" }),
  })
  .openapi("ResumeImportProfileEducation");

const ResumeImportSkillDetailSchema = z
  .object({
    name: z.string().openapi({ example: "CNC" }),
    level: z.string().optional().openapi({ example: "advanced" }),
    yearsOfExperience: z.union([z.number().int(), z.string()]).optional().openapi({ example: 5 }),
  })
  .openapi("ResumeImportSkillDetail");

const ResumeImportLanguageDetailSchema = z
  .object({
    name: z.string().openapi({ example: "English" }),
    proficiency: z.string().optional().openapi({ example: "professional" }),
  })
  .openapi("ResumeImportLanguageDetail");

const ResumeImportLicenceDetailSchema = z
  .object({
    name: z.string().openapi({ example: "Class D" }),
    authority: z.string().optional().openapi({ example: "JPJ" }),
    issuedAt: z.string().optional().openapi({ example: "2020-01" }),
    expiresAt: z.string().optional().openapi({ example: "2030-01" }),
  })
  .openapi("ResumeImportLicenceDetail");

const ResumeImportSnippetSchema = z
  .object({
    text: z.string().openapi({ example: "Experienced sales engineer covering machine tools." }),
  })
  .openapi("ResumeImportSnippet");

const ResumeImportIndustrySchema = z
  .object({
    name: z.string().openapi({ example: "Industrial machinery" }),
    code: z.string().optional().openapi({ example: "industrial-machinery" }),
  })
  .openapi("ResumeImportIndustry");

const ResumeImportRightToWorkSchema = z
  .object({
    status: z.string().openapi({ example: "citizen" }),
    details: z.string().optional().openapi({ example: "Eligible to work in Malaysia without sponsorship." }),
  })
  .openapi("ResumeImportRightToWork");

const ResumeImportDigitalIdentitySchema = z
  .object({
    linkedinUrl: z.string().optional().openapi({ example: "https://www.linkedin.com/in/example" }),
    seekProfileUrl: z.string().optional().openapi({ example: "https://hk.employer.seek.com/candidates/503033454" }),
    portfolioUrl: z.string().optional().openapi({ example: "https://example.com/portfolio" }),
    websiteUrl: z.string().optional().openapi({ example: "https://example.com" }),
  })
  .openapi("ResumeImportDigitalIdentity");

const ResumeStructuredDetailsShape = {
  profileEducation: z.array(ResumeImportProfileEducationSchema).optional(),
  skills: z.array(z.union([z.string(), ResumeImportSkillDetailSchema])).optional(),
  languages: z.array(z.union([z.string(), ResumeImportLanguageDetailSchema])).optional(),
  licences: z.array(z.union([z.string(), ResumeImportLicenceDetailSchema])).optional(),
  resumeSnippet: z.union([z.string(), ResumeImportSnippetSchema]).optional(),
  currentIndustry: z.union([z.string(), ResumeImportIndustrySchema]).optional(),
  currentSubindustry: z.union([z.string(), ResumeImportIndustrySchema]).optional(),
  rightToWork: z.union([z.string(), z.boolean(), ResumeImportRightToWorkSchema]).optional(),
  digitalIdentity: z.union([z.string(), ResumeImportDigitalIdentitySchema]).optional(),
};

export const ResumeItemSchema = z
  .object({
    name: z.string().openapi({ example: "Alex Chen" }),
    profileUrl: z.string().openapi({ example: "https://hr.job5156.com/resume/view/123" }),
    activityStatus: z.string().openapi({ example: "Active today" }),
    age: z.string().openapi({ example: "28" }),
    experience: z.string().openapi({ example: "5 years" }),
    education: z.string().openapi({ example: "Bachelor" }),
    location: z.string().openapi({ example: "Shenzhen" }),
    selfIntro: z.string().openapi({ example: "认真敬业，具备团队协作精神" }),
    jobIntention: z.string().openapi({ example: "Sales Manager" }),
    expectedSalary: z.string().openapi({ example: "10-15K" }),
    workHistory: z.array(ResumeWorkHistorySchema),
    ...ResumeStructuredDetailsShape,
    noticePeriodDays: z.number().int().optional(),
    extractedAt: z.string().openapi({ example: "2026-02-03T10:00:00.000Z" }),
    resumeId: z.string().optional().openapi({ example: "R123456" }),
    perUserId: z.string().optional().openapi({ example: "U987654" }),
    profileId: z.string().optional().openapi({ example: "503033454" }),
    profileType: z.string().optional().openapi({ example: "seek" }),
    externalId: z.string().optional().openapi({ example: "seek:profile:503033454" }),
  })
  .openapi("ResumeItem");

export const ResumeSampleSchema = z
  .object({
    name: z.string().openapi({ example: "sample-initial" }),
    filename: z.string().openapi({ example: "sample-initial.json" }),
    updatedAt: z.string().openapi({ example: "2026-02-03T10:00:00.000Z" }),
    size: z.number().int().openapi({ example: 10240 }),
  })
  .openapi("ResumeSample");

export const ResumeSearchCriteriaSchema = z
  .object({
    keyword: z.string().optional().openapi({ example: "销售" }),
    location: z.string().optional().openapi({ example: "东莞" }),
    filters: z.record(z.string()).optional().openapi({ example: { status: "active" } }),
  })
  .openapi("ResumeSearchCriteria");

export const ResumeMetadataSchema = z
  .object({
    sourceUrl: z.string().optional().openapi({ example: "https://hr.job5156.com/search?keyword=销售" }),
    searchCriteria: ResumeSearchCriteriaSchema.optional(),
    generatedAt: z.string().optional().openapi({ example: "2026-02-03T09:27:52.152Z" }),
    generatedBy: z.string().optional().openapi({ example: "browser-extension@1.0.0" }),
    totalPages: z.number().int().optional().openapi({ example: 1 }),
    totalResumes: z.number().int().optional().openapi({ example: 20 }),
    reproduction: z.string().optional().openapi({ example: "Navigate to sourceUrl, then add ?tr_auto_export=json" }),
  })
  .openapi("ResumeMetadata");

export const ResumeImportCollectionContextSchema = z
  .object({
    captureMode: z.string().optional(),
    operation: z.string().optional(),
    jobId: z.union([z.string(), z.number()]).pipe(z.coerce.string()).optional(),
    searchId: z.string().optional(),
    pageNumber: z.coerce.number().int().optional(),
    language: z.string().optional(),
    profileType: z.string().optional(),
  })
  .openapi("ResumeImportCollectionContext");

export const ResumeImportMetadataSchema = z
  .object({
    sourceUrl: z.string().url().openapi({ example: "https://hr.job5156.com/search?keyword=销售" }),
    generatedBy: z.string().openapi({ example: "browser-extension@1.0.0" }),
    sourceKey: z.string().optional().openapi({ example: "seek" }),
    sourceHost: z.string().optional().openapi({ example: "hk.employer.seek.com" }),
    keyword: z.string().optional().openapi({ example: "销售" }),
    location: z.string().optional().openapi({ example: "东莞" }),
    searchProfileId: z.string().optional().openapi({ example: "sales-engineer" }),
    collectionContext: ResumeImportCollectionContextSchema.optional(),
    searchCriteria: ResumeSearchCriteriaSchema.optional(),
    generatedAt: z.string().optional().openapi({ example: "2026-02-03T09:27:52.152Z" }),
    totalPages: z.number().int().optional().openapi({ example: 1 }),
    totalResumes: z.number().int().optional().openapi({ example: 20 }),
    reproduction: z.string().optional().openapi({ example: "Navigate to sourceUrl, then add ?tr_auto_export=json" }),
  })
  .openapi("ResumeImportMetadata");

export const ResumeImportItemSchema = z
  .object({
    resumeId: z.union([z.string(), z.number()]).pipe(z.coerce.string()).optional(),
    perUserId: z.union([z.string(), z.number()]).pipe(z.coerce.string()).optional(),
    profileId: z.union([z.string(), z.number()]).pipe(z.coerce.string()).optional(),
    profileType: z.string().optional(),
    externalId: z.string().optional(),
    name: z.string().openapi({ example: "Alex Chen" }),
    age: z.string().optional().openapi({ example: "28" }),
    experience: z.string().optional().openapi({ example: "5 years" }),
    education: z.string().optional().openapi({ example: "Bachelor" }),
    location: z.string().optional().openapi({ example: "Shenzhen" }),
    jobIntention: z.string().optional().openapi({ example: "Sales Manager" }),
    expectedSalary: z.string().optional().openapi({ example: "10-15K" }),
    selfIntro: z.string().optional().openapi({ example: "认真敬业，具备团队协作精神" }),
    workHistory: z.array(ResumeImportWorkHistorySchema).optional(),
    ...ResumeStructuredDetailsShape,
    noticePeriodDays: z.coerce.number().int().optional(),
    profileUrl: z.string().optional().openapi({ example: "https://hr.job5156.com/resume/view/123" }),
    activityStatus: z.string().optional().openapi({ example: "Active today" }),
    extractedAt: z.string().optional().openapi({ example: "2026-02-03T10:00:00.000Z" }),
  })
  .openapi("ResumeImportItem");

export const ResumeImportRequestSchema = z
  .object({
    metadata: ResumeImportMetadataSchema,
    resumes: z.array(ResumeImportItemSchema).optional(),
    data: z.array(ResumeImportItemSchema).optional(),
  })
  .superRefine((value, ctx) => {
    if (!value.resumes && !value.data) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Expected resumes or data array",
        path: ["resumes"],
      });
    }
  })
  .openapi("ResumeImportRequest");

export const ResumeSubmitSummarySchema = z
  .object({
    success: z.literal(true),
    submitted: z.number().int(),
    inserted: z.number().int(),
    updated: z.number().int(),
    unchanged: z.number().int(),
    deduped: z.number().int(),
  })
  .openapi("ResumeSubmitSummary");

export const ResumesQuerySchema = z.object({
  sample: z
    .string()
    .optional()
    .openapi({
      param: { name: "sample", in: "query" },
      example: "sample-initial",
    }),
  q: z
    .string()
    .optional()
    .transform((value) => {
      if (typeof value !== "string") return value;
      const normalized = value
        .replace(/[\u3000]/g, " ")
        .replace(/\s+/g, " ")
        .trim();
      return normalized || undefined;
    })
    .openapi({
      param: { name: "q", in: "query" },
      example: "sales",
    }),
  source: z
    .enum(["sample", "convex"])
    .default("sample")
    .openapi({
      param: { name: "source", in: "query" },
      example: "sample",
    }),
  limit: z
    .coerce
    .number()
    .min(1)
    .max(1000)
    .optional()
    .openapi({
      param: { name: "limit", in: "query" },
      example: 1000,
    }),
  offset: z
    .string()
    .optional()
    .transform((v) => (v ? parseInt(v, 10) : undefined))
    .pipe(z.number().min(0).optional())
    .openapi({
      param: { name: "offset", in: "query" },
      example: "0",
    }),
  sessionId: z
    .string()
    .optional()
    .openapi({
      param: { name: "sessionId", in: "query" },
      example: "session-123",
    }),
  jobDescriptionId: z
    .string()
    .optional()
    .openapi({
      param: { name: "jobDescriptionId", in: "query" },
      example: "lathe-sales",
    }),
  minMatchScore: z
    .string()
    .optional()
    .transform((v) => (v ? parseInt(v, 10) : undefined))
    .pipe(z.number().min(0).max(100).optional())
    .openapi({
      param: { name: "minMatchScore", in: "query" },
      example: "70",
    }),
  sortBy: z
    .enum(["score", "name", "experience", "extractedAt"])
    .optional()
    .openapi({
      param: { name: "sortBy", in: "query" },
      example: "score",
    }),
  sortOrder: z
    .enum(["asc", "desc"])
    .optional()
    .openapi({
      param: { name: "sortOrder", in: "query" },
      example: "desc",
    }),
  minExperience: z
    .string()
    .optional()
    .transform((v) => (v ? parseInt(v, 10) : undefined))
    .pipe(z.number().min(0).optional())
    .openapi({
      param: { name: "minExperience", in: "query" },
      example: "3",
    }),
  maxExperience: z
    .string()
    .optional()
    .transform((v) => (v ? parseInt(v, 10) : undefined))
    .pipe(z.number().min(0).optional())
    .openapi({
      param: { name: "maxExperience", in: "query" },
      example: "10",
    }),
  education: CsvStringArraySchema.openapi({
    param: { name: "education", in: "query" },
    example: "bachelor,master",
  }),
  skills: CsvStringArraySchema.openapi({
    param: { name: "skills", in: "query" },
    example: "CNC,FANUC",
  }),
  locations: CsvStringArraySchema.openapi({
    param: { name: "locations", in: "query" },
    example: "东莞,深圳",
  }),
  minSalary: z
    .string()
    .optional()
    .transform((v) => (v ? parseInt(v, 10) : undefined))
    .pipe(z.number().min(0).optional())
    .openapi({
      param: { name: "minSalary", in: "query" },
      example: "5000",
    }),
  maxSalary: z
    .string()
    .optional()
    .transform((v) => (v ? parseInt(v, 10) : undefined))
    .pipe(z.number().min(0).optional())
    .openapi({
      param: { name: "maxSalary", in: "query" },
      example: "15000",
    }),
  recommendation: CsvStringArraySchema.openapi({
    param: { name: "recommendation", in: "query" },
    example: "strong_match,match",
  }),
});

const KeywordGroupSchema = z.object({
  original: z.string(),
  variants: z.array(z.string()),
});

export const ResumesResponseSchema = z
  .object({
    success: z.literal(true),
    sample: ResumeSampleSchema.optional(),
    metadata: ResumeMetadataSchema.optional(),
    summary: z
      .object({
        total: z.number().int(),
        returned: z.number().int(),
        query: z.string().optional(),
        source: z.enum(["sample", "convex"]).optional(),
        expandedTo: z.array(z.string()).optional(),
        mode: z.enum(["AND", "OR"]).optional(),
        keywordGroups: z.array(KeywordGroupSchema).optional(),
        sourceMapping: z.record(z.string()).optional(),
      })
      .optional(),
    data: z.array(ResumeItemSchema),
  })
  .openapi("ResumesResponse");

export const ResumeKeywordExpansionQuerySchema = z.object({
  q: z
    .string()
    .optional()
    .transform((value) => {
      if (typeof value !== "string") return value;
      const normalized = value
        .replace(/[\u3000]/g, " ")
        .replace(/\s+/g, " ")
        .trim();
      return normalized || undefined;
    })
    .openapi({
      param: { name: "q", in: "query" },
      example: "销售",
    }),
});

export const ResumeKeywordExpansionResponseSchema = z
  .object({
    success: z.literal(true),
    summary: z.object({
      keyword: z.string().optional(),
      groups: z.array(KeywordGroupSchema),
      mode: z.enum(["AND", "OR"]),
      expandedTo: z.array(z.string()),
      sourceMapping: z.record(z.string()),
    }),
  })
  .openapi("ResumeKeywordExpansionResponse");

export const ResumeSamplesResponseSchema = z
  .object({
    success: z.literal(true),
    samples: z.array(ResumeSampleSchema),
  })
  .openapi("ResumeSamplesResponse");

export const ResumeFiltersSchema = z
  .object({
    minExperience: z.number().min(0).optional(),
    maxExperience: z.number().min(0).optional(),
    education: z.array(z.string()).optional(),
    skills: z.array(z.string()).optional(),
    locations: z.array(z.string()).optional(),
    minSalary: z.number().min(0).optional(),
    maxSalary: z.number().min(0).optional(),
    minMatchScore: z.number().min(0).max(100).optional(),
    recommendation: z.array(z.string()).optional(),
    sortBy: z.enum(["score", "name", "experience", "extractedAt"]).optional(),
    sortOrder: z.enum(["asc", "desc"]).optional(),
  })
  .openapi("ResumeFilters");

export const RecommendationSchema = z.enum([
  "strong_match",
  "match",
  "potential",
  "no_match",
]);

export const ScoreSourceSchema = z.enum(["rule", "ai"]);

export const ResumeResultSourceSchema = z
  .enum(["sample", "convex"])
  .openapi("ResumeResultSource");

export const MatchBreakdownSchema = z
  .object({
    skillMatch: z.number().int().openapi({ example: 20 }),
    roleMatch: z.number().int().optional().openapi({ example: 8 }),
    experienceMatch: z.number().int().openapi({ example: 18 }),
    educationMatch: z.number().int().openapi({ example: 12 }),
    locationMatch: z.number().int().openapi({ example: 15 }),
    industryMatch: z.number().int().openapi({ example: 10 }),
    brandRelevance: z.number().int().openapi({ example: 7 }),
  })
  .openapi("MatchBreakdown");

export const ResumeMatchSchema = z
  .object({
    resumeId: z.string().openapi({ example: "R123456" }),
    jobDescriptionId: z.string().openapi({ example: "lathe-sales" }),
    score: z.number().int().openapi({ example: 85 }),
    recommendation: RecommendationSchema.openapi({ example: "match" }),
    highlights: z.array(z.string()).openapi({ example: ["客户开发经验丰富"] }),
    concerns: z.array(z.string()).openapi({ example: ["缺少机床销售经验"] }),
    summary: z.string().openapi({ example: "候选人与岗位匹配良好，可安排面试。" }),
    breakdown: MatchBreakdownSchema.optional(),
    scoreSource: ScoreSourceSchema.optional().openapi({ example: "rule" }),
    matchedAt: z.string().openapi({ example: "2026-02-05T08:00:00.000Z" }),
    sessionId: z.string().optional().openapi({ example: "session-123" }),
    userId: z.string().optional().openapi({ example: "user-abc" }),
    debug: z
      .object({
        primaryRuleScore: z.number().optional().openapi({ example: 85 }),
        provenance: z
          .array(
            z.object({
              term: z.string().openapi({ example: "销售" }),
              source: z.enum(["searchText", "industryTags", "companyHits", "synonymHits"]).openapi({ example: "searchText" }),
              expandedFrom: z.string().optional().openapi({ example: "sales" }),
            })
          )
          .optional(),
        roleSignals: z
          .array(
            z.object({
              type: z.string().openapi({ example: "sales" }),
              matchedSignals: z.array(z.string()).openapi({ example: ["销售经理", "渠道"] }),
              signalCount: z.number().openapi({ example: 2 }),
              occurrences: z.number().openapi({ example: 2 }),
              years: z.number().openapi({ example: 5 }),
              industryVerifiedYears: z.number().openapi({ example: 5 }),
              roleRelevantYears: z.number().optional().openapi({ example: 5 }),
              industryVerifiedRelevantYears: z.number().optional().openapi({ example: 5 }),
              verifyIn: z.enum(["workHistory", "searchText"]).openapi({ example: "workHistory" }),
            })
          )
          .optional(),
        companyHits: z.array(z.string()).optional().openapi({ example: ["fanuc"] }),
        brandHits: z
          .array(
            z.object({
              brand: z.string().openapi({ example: "fanuc" }),
              role: z.enum(["employer", "equipment", "both"]).openapi({ example: "both" }),
              source: z.enum(["workHistory", "selfIntro", "jobIntention"]).openapi({ example: "workHistory" }),
              context: z.enum(["employer", "equipment", "sales", "technical", "general"]).openapi({ example: "employer" }),
            })
          )
          .optional(),
      })
      .optional(),
  })
  .openapi("ResumeMatch");

export const ResumeExportSourceSchema = z.enum(["sample", "convex"]).openapi("ResumeExportSource");

export const ResumeExportMatchSchema = z
  .object({
    score: z.number().openapi({ example: 88 }),
    recommendation: RecommendationSchema.openapi({ example: "strong_match" }),
    scoreSource: ScoreSourceSchema.optional().openapi({ example: "ai" }),
    summary: z.string().optional().openapi({ example: "Strong CNC sales fit." }),
    breakdown: z.record(z.number()).optional().openapi({ example: { related_exp: 20, industry_db: 40 } }),
  })
  .openapi("ResumeExportMatch");

export const ResumeExportEntryContextSchema = z
  .object({
    resumeId: z.string().min(1).openapi({ example: "resume-1" }),
    ruleScore: z.number().optional().openapi({ example: 72 }),
    action: z.string().optional().openapi({ example: "shortlist" }),
    match: ResumeExportMatchSchema.optional(),
    userComment: z.string().optional().openapi({ example: "Call back tomorrow" }),
    referenceNote: z.string().optional().openapi({ example: "Referred by HR" }),
    status: z.string().optional().openapi({ example: "contacted" }),
  })
  .openapi("ResumeExportEntryContext");

export const IndustryDbV2StatsSchema = z
  .object({
    size: z.number().int().min(0).openapi({ example: 50 }),
    min: z.number().optional().openapi({ example: 0 }),
    max: z.number().optional().openapi({ example: 25 }),
    p50: z.number().optional().openapi({ example: 10 }),
    p80: z.number().openapi({ example: 20 }),
    mean: z.number().optional().openapi({ example: 12.4 }),
    stddev: z.number().optional().openapi({ example: 6.8 }),
    histogram50: z.array(z.number().int().min(0)).length(51),
  })
  .openapi("IndustryDbV2Stats");

export const ResumeExportCanonicalRequestSchema = z
  .object({
    format: z.enum(["csv", "xlsx"]).default("csv").openapi({ example: "csv" }),
    source: ResumeExportSourceSchema,
    sample: z.string().optional().openapi({ example: "sample-initial" }),
    userComment: z.string().optional().openapi({ example: "Batch note" }),
    referenceNote: z.string().optional().openapi({ example: "Internal export" }),
    industryDbV2Stats: IndustryDbV2StatsSchema.optional(),
    debug: z.boolean().optional().openapi({ example: false }),
    entries: z.array(ResumeExportEntryContextSchema).min(1).max(2000),
  })
  .superRefine((value, ctx) => {
    if (value.source === "sample" && !value.sample?.trim()) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "sample is required when source is sample",
        path: ["sample"],
      });
    }
    if (value.source === "convex" && value.sample !== undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "sample is only allowed when source is sample",
        path: ["sample"],
      });
    }
  })
  .openapi("ResumeExportCanonicalRequest");

const ResumeExportLegacyWorkHistorySchema = z.object({
  raw: z.string().optional(),
  companyName: z.string().optional(),
  jobTitle: z.string().optional(),
  description: z.string().optional(),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
});

const ResumeExportLegacyRoleSignalSchema = z.object({
  type: z.string(),
  matchedSignals: z.array(z.string()),
  signalCount: z.number().optional(),
  occurrences: z.number().optional(),
  years: z.number(),
  industryVerifiedYears: z.number().optional(),
  roleRelevantYears: z.number().optional(),
  industryVerifiedRelevantYears: z.number().optional(),
  matchedWorkEntries: z
    .array(
      z.object({
        companyName: z.string().optional(),
        jobTitle: z.string().optional(),
        years: z.number(),
        industryVerified: z.boolean(),
        matchedSignals: z.array(z.string()),
      })
    )
    .optional(),
  verifyIn: z.string().optional(),
});

const ResumeExportLegacyBrandHitSchema = z.object({
  brand: z.string(),
  role: z.string(),
  source: z.string(),
  context: z.string(),
  companyId: z.number().optional(),
});

export const ResumeExportResolvedResumeSchema = z.object({
  name: z.string().optional(),
  jobIntention: z.string().optional(),
  location: z.string().optional(),
  age: z.string().optional(),
  experience: z.string().optional(),
  education: z.string().optional(),
  expectedSalary: z.string().optional(),
  profileUrl: z.string().optional(),
  source: z.string().optional(),
  selfIntro: z.string().optional(),
  workHistory: z.array(ResumeExportLegacyWorkHistorySchema).optional(),
  ingestData: z
    .object({
      industryTags: z.array(z.string()).optional(),
      brandHits: z.array(ResumeExportLegacyBrandHitSchema).optional(),
      companyHits: z.array(z.string()).optional(),
      industryDbV2Raw: z.number().optional(),
      roleSignals: z.array(ResumeExportLegacyRoleSignalSchema).optional(),
    })
    .optional(),
});

export const ResumeExportLegacyResumeSchema = ResumeExportResolvedResumeSchema;

export const ResumeExportLegacyRequestSchema = z
  .object({
    format: z.enum(["csv", "xlsx"]).default("csv"),
    userComment: z.string().optional(),
    referenceNote: z.string().optional(),
    industryDbV2Stats: IndustryDbV2StatsSchema.optional(),
    entries: z
      .array(
        z.object({
          key: z.string().min(1),
          ruleScore: z.number().optional(),
          action: z.string().optional(),
          match: ResumeExportMatchSchema.optional(),
          resume: ResumeExportLegacyResumeSchema,
          userComment: z.string().optional(),
          referenceNote: z.string().optional(),
          status: z.string().optional(),
        })
      )
      .min(1)
      .max(2000),
  })
  .openapi("ResumeExportLegacyRequest");

export const ResumeExportRequestSchema = z
  .union([ResumeExportCanonicalRequestSchema, ResumeExportLegacyRequestSchema])
  .openapi("ResumeExportRequest");

export const ResumeExportBinaryResponseSchema = z
  .string()
  .openapi({ format: "binary" });

export const MatchRequestSchema = z
  .object({
    sessionId: z.string().optional().openapi({ example: "session-123" }),
    sample: z.string().optional().openapi({ example: "sample-initial" }),
    source: ResumeResultSourceSchema.default("sample").openapi({ example: "sample" }),
    persist: z.boolean().default(true).openapi({ example: true }),
    jobDescriptionId: z.string().optional().openapi({ example: "lathe-sales" }),
    keywords: z.array(z.string()).optional().openapi({ example: ["cnc", "车床"] }),
    location: z.string().optional().openapi({ example: "广东" }),
    resumeIds: z.array(z.string()).optional().openapi({ example: ["R123456"] }),
    limit: z.number().int().min(1).max(1000).optional().openapi({ example: 50 }),
    topN: z.number().int().min(1).max(500).optional().openapi({ example: 20 }),
    mode: z.enum(["rules_only", "hybrid", "ai_only"]).optional().openapi({ example: "hybrid" }),
  })
  .openapi("MatchRequest");

export const MatchStatsSchema = z
  .object({
    processed: z.number().int(),
    matched: z.number().int(),
    avgScore: z.number(),
    processingTimeMs: z.number().int().optional(),
    pendingAi: z.number().int().optional(),
  })
  .openapi("MatchStats");

export const MatchResponseSchema = z
  .object({
    success: z.literal(true),
    mode: z.enum(["rules_only", "hybrid", "ai_only"]).optional(),
    streamPath: z.string().optional(),
    pendingAiCount: z.number().int().optional(),
    query: z
      .object({
        source: ResumeResultSourceSchema.optional(),
        persisted: z.boolean().optional(),
        keywordGroups: z.array(KeywordGroupSchema).optional(),
        expandedTo: z.array(z.string()).optional(),
        sourceMapping: z.record(z.string()).optional(),
        inferredRequiredRoles: z
          .array(
            z.object({
              type: z.string().openapi({ example: "sales" }),
              signals: z.array(z.string()).openapi({ example: ["销售", "业务"] }),
              verifyIn: z.enum(["workHistory", "searchText"]).openapi({ example: "workHistory" }),
              minYears: z.number().optional().openapi({ example: 2 }),
            })
          )
          .optional(),
      })
      .optional(),
    results: z.array(ResumeMatchSchema),
    stats: MatchStatsSchema,
  })
  .openapi("MatchResponse");

export const ResumeMatchesResponseSchema = z
  .object({
    success: z.literal(true),
    results: z.array(ResumeMatchSchema),
  })
  .openapi("ResumeMatchesResponse");

export const ResumeMatchesQuerySchema = z.object({
  sessionId: z
    .string()
    .optional()
    .openapi({
      param: { name: "sessionId", in: "query" },
      example: "session-123",
    }),
  jobDescriptionId: z
    .string()
    .optional()
    .openapi({
      param: { name: "jobDescriptionId", in: "query" },
      example: "lathe-sales",
    }),
});

export const MatchRunStatusSchema = z.enum(["processing", "completed", "failed"]);
export const MatchRunModeSchema = z.enum(["rules_only", "hybrid", "ai_only"]);

export const MatchRunSchema = z
  .object({
    id: z.string().openapi({ example: "run-123" }),
    sessionId: z.string().optional().openapi({ example: "session-123" }),
    jobDescriptionId: z.string().openapi({ example: "lathe-sales" }),
    sampleName: z.string().optional().openapi({ example: "sample-initial" }),
    mode: MatchRunModeSchema.openapi({ example: "hybrid" }),
    status: MatchRunStatusSchema.openapi({ example: "completed" }),
    totalCount: z.number().int().openapi({ example: 100 }),
    processedCount: z.number().int().openapi({ example: 20 }),
    failedCount: z.number().int().openapi({ example: 0 }),
    matchedCount: z.number().int().optional().openapi({ example: 14 }),
    avgScore: z.number().optional().openapi({ example: 72.3 }),
    startedAt: z.string().openapi({ example: "2026-02-11T08:00:00.000Z" }),
    completedAt: z.string().optional().openapi({ example: "2026-02-11T08:00:09.000Z" }),
    error: z.string().optional().openapi({ example: "AI provider timeout" }),
  })
  .openapi("MatchRun");

export const MatchRunsQuerySchema = z.object({
  sessionId: z
    .string()
    .optional()
    .openapi({
      param: { name: "sessionId", in: "query" },
      example: "session-123",
    }),
  jobDescriptionId: z
    .string()
    .optional()
    .openapi({
      param: { name: "jobDescriptionId", in: "query" },
      example: "lathe-sales",
    }),
  limit: z
    .coerce
    .number()
    .int()
    .min(1)
    .max(100)
    .optional()
    .openapi({
      param: { name: "limit", in: "query" },
      example: 20,
    }),
});

export const MatchRunsResponseSchema = z
  .object({
    success: z.literal(true),
    runs: z.array(MatchRunSchema),
  })
  .openapi("MatchRunsResponse");
