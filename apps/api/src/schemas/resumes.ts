import { z } from "@hono/zod-openapi";

export const CsvStringArraySchema = z
  .union([z.string(), z.array(z.string())])
  .optional()
  .transform((value) => {
    if (value === undefined) return undefined;
    if (typeof value === "string") {
      const parts = value
        .split(/[,，、]/g)
        .map((part) => part.trim())
        .filter(Boolean);
      return parts.length > 0 ? parts : undefined;
    }
    return value;
  })
  .pipe(z.array(z.string()).optional());

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

export const ResumeLocationHierarchySchema = z
  .object({
    country: z.string().openapi({ example: "中国" }),
    province: z.string().optional().openapi({ example: "广东" }),
    city: z.string().optional().openapi({ example: "东莞" }),
    district: z.string().optional().openapi({ example: "长安" }),
    matchedFrom: z.enum(["location", "profile", "workHistory", "jobIntention", "source"]).optional(),
    confidence: z.enum(["high", "low"]).optional(),
  })
  .openapi("ResumeLocationHierarchy");

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

export const ResumeImportRestoreStateSchema = z
  .object({
    crawledAt: z.number().int().optional().openapi({ example: 1763917200000 }),
    isArchived: z.boolean().optional().openapi({ example: true }),
    archivedAt: z.number().int().optional().openapi({ example: 1763917200000 }),
    searchText: z.string().optional().openapi({ example: "alice cnc sales dongguan" }),
    primaryRuleScore: z.number().optional().openapi({ example: 85 }),
    ingestData: z.record(z.string(), z.unknown()).optional(),
    analysis: z.object({
      score: z.number(),
      summary: z.string().optional(),
      highlights: z.array(z.string()).optional(),
      recommendation: z.string().optional(),
      breakdown: z.record(z.string(), z.number()).optional(),
      jobDescriptionId: z.string().optional(),
      promptVersion: z.number().optional(),
      locale: z.string().optional(),
      queryLocation: z.string().optional(),
      analyzedAt: z.number().optional(),
    }).optional(),
    analyses: z.record(z.string(), z.object({
      score: z.number(),
      summary: z.string().optional(),
      highlights: z.array(z.string()).optional(),
      recommendation: z.string().optional(),
      breakdown: z.record(z.string(), z.number()).optional(),
      jobDescriptionId: z.string().optional(),
      promptVersion: z.number().optional(),
      locale: z.string().optional(),
      queryLocation: z.string().optional(),
      analyzedAt: z.number().optional(),
    })).optional(),
  })
  .openapi("ResumeImportRestoreState");

export const ResumeImportOptionsSchema = z
  .object({
    recomputeDerivedFields: z.boolean().optional().openapi({ example: true }),
  })
  .openapi("ResumeImportOptions");

const ResumeStructuredDetailsShape = {
  profileEducation: z.array(ResumeImportProfileEducationSchema).optional(),
  projectExperience: z.array(ResumeImportWorkHistorySchema).optional(),
  skills: z.array(z.union([z.string(), ResumeImportSkillDetailSchema])).optional(),
  languages: z.array(z.union([z.string(), ResumeImportLanguageDetailSchema])).optional(),
  licences: z.array(z.union([z.string(), ResumeImportLicenceDetailSchema])).optional(),
  resumeSnippet: z.union([z.string(), ResumeImportSnippetSchema]).optional(),
  currentIndustry: z.union([z.string(), ResumeImportIndustrySchema]).optional(),
  currentSubindustry: z.union([z.string(), ResumeImportIndustrySchema]).optional(),
  rightToWork: z.union([z.string(), z.boolean(), ResumeImportRightToWorkSchema]).optional(),
  digitalIdentity: z.union([z.string(), ResumeImportDigitalIdentitySchema]).optional(),
};

const ResumeIngestMatchedWorkEntrySchema = z
  .object({
    companyName: z.string().optional().openapi({ example: "FANUC" }),
    jobTitle: z.string().optional().openapi({ example: "Sales Engineer" }),
    years: z.number().openapi({ example: 3 }),
    industryVerified: z.boolean().openapi({ example: true }),
    matchedSignals: z.array(z.string()).openapi({ example: ["sales", "cnc"] }),
    directRoleMatch: z.boolean().optional().openapi({ example: true }),
  })
  .openapi("ResumeIngestMatchedWorkEntry");

const ResumeIngestRoleSignalSchema = z
  .object({
    type: z.string().openapi({ example: "sales" }),
    matchedSignals: z.array(z.string()).openapi({ example: ["销售工程师", "销售"] }),
    signalCount: z.number().optional().openapi({ example: 2 }),
    occurrences: z.number().optional().openapi({ example: 2 }),
    years: z.number().openapi({ example: 5 }),
    industryVerifiedYears: z.number().optional().openapi({ example: 5 }),
    roleRelevantYears: z.number().optional().openapi({ example: 5 }),
    industryVerifiedRelevantYears: z.number().optional().openapi({ example: 5 }),
    matchedWorkEntries: z.array(ResumeIngestMatchedWorkEntrySchema).optional(),
    verifyIn: z.string().openapi({ example: "workHistory" }),
  })
  .openapi("ResumeIngestRoleSignal");

const ResumeIngestBrandHitSchema = z
  .object({
    brand: z.string().openapi({ example: "fanuc" }),
    role: z.string().openapi({ example: "both" }),
    source: z.string().openapi({ example: "workHistory" }),
    context: z.string().openapi({ example: "employer" }),
  })
  .openapi("ResumeIngestBrandHit");

const ResumeIngestDataSchema = z
  .object({
    industryTags: z.array(z.string()).optional().openapi({ example: ["industrial-machinery"] }),
    synonymHits: z.array(z.string()).optional(),
    evidenceText: z.string().optional(),
    brandHits: z.array(ResumeIngestBrandHitSchema).optional(),
    companyHits: z.array(z.string()).optional().openapi({ example: ["fanuc"] }),
    industryDbV2Raw: z.number().optional().openapi({ example: 12 }),
    roleSignals: z.array(ResumeIngestRoleSignalSchema).optional(),
    verifiedRoleYears: z.record(z.string(), z.number()).optional(),
    ruleScores: z.record(z.string(), z.number()).optional(),
    experienceLevel: z.string().optional(),
    market: z.string().optional(),
    computedAt: z.number().optional(),
    skillsVersion: z.number().optional(),
  })
  .openapi("ResumeIngestData");

export const ResumeItemSchema = z
  .object({
    name: z.string().openapi({ example: "Alex Chen" }),
    profileUrl: z.string().openapi({ example: "https://hr.job5156.com/resume/view/123" }),
    source: z.string().optional().openapi({ example: "hr.job5156.com" }),
    activityStatus: z.string().openapi({ example: "Active today" }),
    age: z.string().openapi({ example: "28" }),
    experience: z.string().openapi({ example: "5 years" }),
    education: z.string().openapi({ example: "Bachelor" }),
    location: z.string().openapi({ example: "Shenzhen" }),
    locationHierarchy: ResumeLocationHierarchySchema.optional(),
    selfIntro: z.string().openapi({ example: "认真敬业，具备团队协作精神" }),
    jobIntention: z.string().openapi({ example: "Sales Manager" }),
    expectedSalary: z.string().openapi({ example: "10-15K" }),
    workHistory: z.array(ResumeWorkHistorySchema),
    ...ResumeStructuredDetailsShape,
    noticePeriodDays: z.number().int().optional(),
    ingestData: ResumeIngestDataSchema.optional(),
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
    filters: z.record(z.string(), z.string()).optional().openapi({ example: { status: "active" } }),
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
    version: z.string().optional().openapi({ example: "2" }),
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
    source: z.string().optional().openapi({ example: "hr.job5156.com" }),
    sourceHost: z.string().optional().openapi({ example: "hr.job5156.com" }),
    tags: z.array(z.string()).optional().openapi({ example: ["sales", "job5156"] }),
    name: z.string().openapi({ example: "Alex Chen" }),
    age: z.string().optional().openapi({ example: "28" }),
    experience: z.string().optional().openapi({ example: "5 years" }),
    education: z.string().optional().openapi({ example: "Bachelor" }),
    location: z.string().optional().openapi({ example: "Shenzhen" }),
    locationHierarchy: ResumeLocationHierarchySchema.optional(),
    jobIntention: z.string().optional().openapi({ example: "Sales Manager" }),
    expectedSalary: z.string().optional().openapi({ example: "10-15K" }),
    selfIntro: z.string().optional().openapi({ example: "认真敬业，具备团队协作精神" }),
    workHistory: z.array(ResumeImportWorkHistorySchema).optional(),
    ...ResumeStructuredDetailsShape,
    noticePeriodDays: z.coerce.number().int().optional(),
    profileUrl: z.string().optional().openapi({ example: "https://hr.job5156.com/resume/view/123" }),
    activityStatus: z.string().optional().openapi({ example: "Active today" }),
    extractedAt: z.string().optional().openapi({ example: "2026-02-03T10:00:00.000Z" }),
    restoreState: ResumeImportRestoreStateSchema.optional(),
  })
  .openapi("ResumeImportItem");

export const CandidateActionBackupSchema = z
  .object({
    resumeId: z.string().openapi({ example: "R123456" }),
    actionType: z.enum([
      "star",
      "shortlist",
      "reject",
      "archive",
      "note",
      "contact",
      "rating",
      "ai_score_like",
      "ai_score_unlike",
      "ai_summary_like",
      "ai_summary_unlike",
    ]).openapi({ example: "archive" }),
    actionData: z.record(z.string(), z.unknown()).optional().openapi({ example: { scopeId: "session-123" } }),
    scopeId: z.string().optional().openapi({ example: "session-123" }),
    createdAt: z.string().openapi({ example: "2026-03-15T10:30:00+08:00" }),
  })
  .openapi("CandidateActionBackup");

export const CandidateStatusBackupSchema = z
  .object({
    identityKey: z.string().openapi({ example: "profileUrl:https://hr.job5156.com/resume/view/123" }),
    status: z.enum([
      "new",
      "shortlisted",
      "rejected",
      "contacted",
      "interviewing",
      "interviewed_pass",
      "interviewed_reject",
      "appeal_submitted",
      "human_review",
      "upheld",
      "reversed",
      "offer",
      "hired",
      "withdrawn",
    ]).openapi({ example: "interviewing" }),
    notes: z.string().optional().openapi({ example: "Strong candidate" }),
    updatedBy: z.string().optional().openapi({ example: "hr.lead" }),
    updatedAt: z.number().openapi({ example: 1710489600000 }),
    history: z.array(z.object({
      status: z.string(),
      updatedAt: z.number(),
      notes: z.string().optional(),
    })).optional(),
  })
  .openapi("CandidateStatusBackup");

export const ResumeImportRequestSchema = z
  .object({
    metadata: ResumeImportMetadataSchema,
    resumes: z.array(ResumeImportItemSchema).optional(),
    data: z.array(ResumeImportItemSchema).optional(),
    options: ResumeImportOptionsSchema.optional(),
    candidateActions: z.array(CandidateActionBackupSchema).optional(),
    candidateStatus: z.array(CandidateStatusBackupSchema).optional(),
  })
  .superRefine((value, ctx) => {
    if (!value.resumes && !value.data && !value.candidateActions && !value.candidateStatus) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Expected resumes, data, candidateActions, or candidateStatus array",
        path: ["resumes"],
      });
    }
  })
  .openapi("ResumeImportRequest");

export const ResumeBackupRequestSchema = z
  .object({
    resumeIds: z.array(z.string().trim().min(1)).optional(),
    sourceHosts: z.array(z.string().trim().min(1)).optional(),
    limit: z.number().int().min(1).optional(),
  })
  .openapi("ResumeBackupRequest");

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

const ResumeManualImportContextFields = {
  searchProfileId: z.string().optional().openapi({ example: "sales-engineer" }),
  keyword: z.string().optional().openapi({ example: "销售工程师" }),
  location: z.string().optional().openapi({ example: "东莞" }),
};

export const ResumeManualImportRequestSchema = z
  .object({
    files: z.any().openapi({
      type: "array",
      items: { type: "string", format: "binary" },
    }),
    ...ResumeManualImportContextFields,
  })
  .openapi("ResumeManualImportRequest");

export const ResumeManualImportFormSchema = z.object({
  files: z.array(z.instanceof(File)).min(1),
  ...ResumeManualImportContextFields,
});

export const ResumeManualImportSourceSchema = z
  .object({
    key: z.string().openapi({ example: "51job-manual" }),
    label: z.string().openapi({ example: "51job-manual" }),
  })
  .openapi("ResumeManualImportSource");

export const ResumeManualImportFileResultSchema = z
  .object({
    uploadName: z.string().openapi({ example: "51job.rar" }),
    entryPath: z.string().openapi({ example: "前程无忧简历/51job_张三(123456).docx" }),
    extension: z.string().openapi({ example: ".docx" }),
    status: z.enum(["imported", "skipped", "failed"]).openapi({ example: "imported" }),
    resumeName: z.string().optional().openapi({ example: "张三" }),
    profileId: z.string().optional().openapi({ example: "123456" }),
    warnings: z.array(z.string()).default([]),
    error: z.string().optional().openapi({ example: "Legacy .doc parsing is not supported yet" }),
  })
  .openapi("ResumeManualImportFileResult");

export const ResumeManualImportSummarySchema = z
  .object({
    uploadedFiles: z.number().int(),
    discoveredFiles: z.number().int(),
    parsedResumes: z.number().int(),
    imported: z.number().int(),
    inserted: z.number().int(),
    updated: z.number().int(),
    unchanged: z.number().int(),
    deduped: z.number().int(),
    skipped: z.number().int(),
    failed: z.number().int(),
  })
  .openapi("ResumeManualImportSummary");

export const ResumeManualImportResponseSchema = z
  .object({
    success: z.literal(true),
    source: ResumeManualImportSourceSchema,
    summary: ResumeManualImportSummarySchema,
    files: z.array(ResumeManualImportFileResultSchema),
    warnings: z.array(z.string()).default([]),
  })
  .openapi("ResumeManualImportResponse");

export const ResumeManualImportErrorSchema = z
  .object({
    success: z.literal(false),
    error: z.string(),
    files: z.array(ResumeManualImportFileResultSchema).optional(),
    warnings: z.array(z.string()).optional(),
  })
  .openapi("ResumeManualImportError");

export const OptionalIntParam = (opts: { min?: number; max?: number; example?: string; name: string }) =>
  z.string()
    .optional()
    .transform((v) => (v ? parseInt(v, 10) : undefined))
    .pipe(
      opts.max
        ? z.number().min(opts.min ?? 0).max(opts.max).optional()
        : z.number().min(opts.min ?? 0).optional(),
    )
    .openapi({
      param: { name: opts.name, in: "query" },
      example: opts.example ?? "0",
    });

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
  offset: OptionalIntParam({ name: "offset", example: "0" }),
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
  minMatchScore: OptionalIntParam({ name: "minMatchScore", max: 100, example: "70" }),
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
  maxExperience: OptionalIntParam({ name: "maxExperience", example: "10" }),
  education: CsvStringArraySchema.openapi({
    param: { name: "education", in: "query" },
    example: "bachelor,master",
  }),
  skills: CsvStringArraySchema.openapi({
    param: { name: "skills", in: "query" },
    example: "CNC,FANUC",
  }),
  requiredKeywords: CsvStringArraySchema.openapi({
    param: { name: "requiredKeywords", in: "query" },
    example: "machine tools,CNC",
  }),
  locations: CsvStringArraySchema.openapi({
    param: { name: "locations", in: "query" },
    example: "东莞,深圳",
  }),
  minSalary: OptionalIntParam({ name: "minSalary", example: "5000" }),
  maxSalary: OptionalIntParam({ name: "maxSalary", example: "15000" }),
  minRoleYears: OptionalIntParam({ name: "minRoleYears", example: "1" }),
  roleFilterType: z
    .string()
    .optional()
    .openapi({
      param: { name: "roleFilterType", in: "query" },
      example: "sales",
    }),
  minAge: OptionalIntParam({ name: "minAge", example: "25" }),
  maxAge: OptionalIntParam({ name: "maxAge", example: "40" }),
  sources: CsvStringArraySchema.openapi({
    param: { name: "sources", in: "query" },
    example: "job5156,51job",
  }),
  recommendation: CsvStringArraySchema.openapi({
    param: { name: "recommendation", in: "query" },
    example: "strong_match,match",
  }),
  // Semantic search parameters
  enableSemantic: z
    .enum(["true", "false"])
    .optional()
    .transform((value) => value === "true")
    .openapi({
      param: { name: "enableSemantic", in: "query" },
      example: "true",
    }),
  semanticWeight: z
    .coerce
    .number()
    .min(0)
    .max(1)
    .optional()
    .openapi({
      param: { name: "semanticWeight", in: "query" },
      example: "0.5",
    }),
  semanticLimit: OptionalIntParam({ name: "semanticLimit", max: 256, example: "50" }),
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
        sourceMapping: z.record(z.string(), z.string()).optional(),
        searchMode: z.enum(["bm25", "bm25_fallback", "bm25_only_no_vectors", "hybrid"]).optional(),
      })
      .optional(),
    data: z.array(ResumeItemSchema),
  })
  .openapi("ResumesResponse");

export const ResumeDetailPathParamSchema = z.object({
  resumeId: z.string().openapi({
    param: { name: "resumeId", in: "path" },
    example: "resume-live-1",
  }),
});

export const ResumeDetailResponseSchema = z
  .object({
    success: z.literal(true),
    source: z.enum(["sample", "convex"]),
    sample: ResumeSampleSchema.optional(),
    data: ResumeItemSchema,
  })
  .openapi("ResumeDetailResponse");

export const ResumeDiagnosticsQuerySchema = z.object({
  archived: z
    .enum(["true", "false"])
    .optional()
    .transform((value) => value === "true")
    .openapi({
      param: { name: "archived", in: "query" },
      example: "true",
    }),
  sourceKey: z
    .union([z.string(), z.array(z.string())])
    .optional()
    .transform((value) => {
      if (!value) {
        return undefined;
      }
      if (Array.isArray(value)) {
        return value.map((item) => item.trim()).filter((item) => item.length > 0);
      }
      const trimmed = value.trim();
      return trimmed.length > 0 ? [trimmed] : undefined;
    })
    .openapi({
      param: { name: "sourceKey", in: "query" },
      example: "51job-manual",
    }),
  limit: z
    .string()
    .optional()
    .transform((value) => (value ? parseInt(value, 10) : undefined))
    .pipe(z.number().min(1).max(500).optional())
    .openapi({
      param: { name: "limit", in: "query" },
      example: "100",
    }),
});

export const ResumeDiagnosticsItemSchema = z
  .object({
    resumeId: z.string(),
    externalId: z.string(),
    source: z.string(),
    sourceKey: z.string(),
    name: z.string(),
    jobIntention: z.string(),
    location: z.string(),
    isArchived: z.boolean().optional(),
    archivedAt: z.number().optional(),
  })
  .openapi("ResumeDiagnosticsItem");

export const ResumeDiagnosticsResponseSchema = z
  .object({
    success: z.literal(true),
    summary: z.object({
      archived: z.boolean(),
      sourceKeys: z.array(z.string()).optional(),
      returned: z.number().int(),
      limit: z.number().int(),
    }),
    data: z.array(ResumeDiagnosticsItemSchema),
  })
  .openapi("ResumeDiagnosticsResponse");

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
      sourceMapping: z.record(z.string(), z.string()),
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
    maxExperience: z.number().min(0).optional(),
    education: z.array(z.string()).optional(),
    skills: z.array(z.string()).optional(),
    locations: z.array(z.string()).optional(),
    minSalary: z.number().min(0).optional(),
    maxSalary: z.number().min(0).optional(),
    minRoleYears: z.number().min(0).optional(),
    roleFilterType: z.string().optional(),
    minAge: z.number().min(0).optional(),
    maxAge: z.number().min(0).optional(),
    sources: z.array(z.string()).optional(),
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
    breakdown: z.record(z.string(), z.number()).optional().openapi({ example: { related_exp: 20, industry_db: 40 } }),
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

export const ResumeExportResolvedResumeSchema = z.object({
  externalId: z.string().optional(),
  name: z.string().optional(),
  jobIntention: z.string().optional(),
  location: z.string().optional(),
  locationHierarchy: ResumeLocationHierarchySchema.optional(),
  age: z.string().optional(),
  experience: z.string().optional(),
  education: z.string().optional(),
  expectedSalary: z.string().optional(),
  profileUrl: z.string().optional(),
  source: z.string().optional(),
  selfIntro: z.string().optional(),
  workHistory: z.array(z.object({
    raw: z.string().optional(),
    companyName: z.string().optional(),
    jobTitle: z.string().optional(),
    description: z.string().optional(),
    startDate: z.string().optional(),
    endDate: z.string().optional(),
  })).optional(),
  ingestData: z
    .object({
      industryTags: z.array(z.string()).optional(),
      brandHits: z.array(z.object({
        brand: z.string(),
        role: z.string(),
        source: z.string(),
        context: z.string(),
        companyId: z.number().optional(),
      })).optional(),
      companyHits: z.array(z.string()).optional(),
      industryDbV2Raw: z.number().optional(),
      roleSignals: z.array(z.object({
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
      })).optional(),
    })
    .optional(),
});

export const ResumeExportBinaryResponseSchema = z
  .string()
  .openapi({ format: "binary" });

export const ReviewPacketRunStatusSchema = z
  .enum(["exported", "feedback_imported", "summary_sent", "failed"])
  .openapi("ReviewPacketRunStatus");

export const ReviewPacketSummaryCountSchema = z
  .object({
    key: z.string(),
    label: z.string(),
    count: z.number().int(),
  })
  .openapi("ReviewPacketSummaryCount");

export const ReviewPacketRunSchema = z
  .object({
    id: z.string().openapi({ example: "review-packet-123" }),
    workspaceSlug: z.string().openapi({ example: "hr" }),
    source: ResumeExportSourceSchema,
    sampleName: z.string().optional().openapi({ example: "sample-initial" }),
    sessionId: z.string().optional().openapi({ example: "session-123" }),
    jobDescriptionId: z.string().optional().openapi({ example: "lathe-sales" }),
    format: z.enum(["csv", "xlsx"]).openapi({ example: "xlsx" }),
    status: ReviewPacketRunStatusSchema,
    totalCount: z.number().int().openapi({ example: 25 }),
    packetFilename: z.string().optional().openapi({ example: "review-packet-review-packet-123.xlsx" }),
    exportedAt: z.string().openapi({ example: "2026-03-20T09:00:00+08:00" }),
    feedbackImportedAt: z.string().optional().openapi({ example: "2026-03-20T11:30:00+08:00" }),
    summarySentAt: z.string().optional().openapi({ example: "2026-03-20T11:45:00+08:00" }),
    summaryChannel: z.string().optional().openapi({ example: "wechat_work" }),
    stats: z
      .object({
        import: z
          .object({
            importedAt: z.string(),
            fileName: z.string(),
            totalRows: z.number().int(),
            matchedRows: z.number().int(),
            importedRows: z.number().int(),
            reviewedCount: z.number().int(),
            statusUpdates: z.number().int(),
            actionUpdates: z.number().int(),
            noteUpdates: z.number().int(),
            invalidRows: z.number().int(),
            duplicateRows: z.number().int(),
            warningCount: z.number().int(),
            matchedByProfileUrlCount: z.number().int(),
            nameMismatchCount: z.number().int(),
            warnings: z.array(z.string()),
          })
          .optional(),
        summary: z
          .object({
            previewedAt: z.string().optional(),
            sentAt: z.string().optional(),
            channel: z.string().optional(),
            reviewedCount: z.number().int(),
            pendingCount: z.number().int(),
            warningCount: z.number().int(),
            statusBreakdown: z.record(z.string(), z.number().int()),
            actionBreakdown: z.record(z.string(), z.number().int()),
          })
          .optional(),
      })
      .optional(),
    error: z.string().optional(),
  })
  .openapi("ReviewPacketRun");

export const ReviewPacketTrackedExportResponseSchema = z
  .object({
    success: z.literal(true),
    run: ReviewPacketRunSchema,
    downloadPath: z.string().openapi({ example: "/api/resumes/review-packets/review-packet-123/download" }),
  })
  .openapi("ReviewPacketTrackedExportResponse");

export const ReviewPacketExportRequestSchema = z
  .object({
    format: z.enum(["csv", "xlsx"]).default("csv").openapi({ example: "csv" }),
    source: ResumeExportSourceSchema,
    sample: z.string().optional().openapi({ example: "sample-initial" }),
    userComment: z.string().optional().openapi({ example: "Batch note" }),
    referenceNote: z.string().optional().openapi({ example: "Internal export" }),
    industryDbV2Stats: IndustryDbV2StatsSchema.optional(),
    debug: z.boolean().optional().openapi({ example: false }),
    sessionId: z.string().optional().openapi({ example: "session-123" }),
    jobDescriptionId: z.string().optional().openapi({ example: "lathe-sales" }),
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
  .openapi("ReviewPacketExportRequest");

export const ReviewPacketRunsResponseSchema = z
  .object({
    success: z.literal(true),
    items: z.array(ReviewPacketRunSchema),
  })
  .openapi("ReviewPacketRunsResponse");

export const ReviewPacketFeedbackImportRequestSchema = z
  .object({
    file: z.any().openapi({
      type: "string",
      format: "binary",
    }),
    updatedBy: z.string().optional().openapi({ example: "hr.lead" }),
  })
  .openapi("ReviewPacketFeedbackImportRequest");

export const ReviewPacketFeedbackImportFormSchema = z.object({
  file: z.instanceof(File),
  updatedBy: z.string().optional(),
});

export const ReviewPacketFeedbackImportResponseSchema = z
  .object({
    success: z.literal(true),
    run: ReviewPacketRunSchema,
    summary: z.object({
      fileName: z.string(),
      totalRows: z.number().int(),
      matchedRows: z.number().int(),
      importedRows: z.number().int(),
      reviewedCount: z.number().int(),
      statusUpdates: z.number().int(),
      actionUpdates: z.number().int(),
      noteUpdates: z.number().int(),
      invalidRows: z.number().int(),
      duplicateRows: z.number().int(),
      warningCount: z.number().int(),
      matchedByProfileUrlCount: z.number().int(),
      nameMismatchCount: z.number().int(),
    }),
    warnings: z.array(z.string()),
  })
  .openapi("ReviewPacketFeedbackImportResponse");

export const ReviewPacketSummaryDataSchema = z
  .object({
    packetId: z.string(),
    workspaceSlug: z.string(),
    source: ResumeExportSourceSchema,
    sampleName: z.string().optional(),
    sessionId: z.string().optional(),
    jobDescriptionId: z.string().optional(),
    exportedAt: z.string(),
    feedbackImportedAt: z.string().optional(),
    summarySentAt: z.string().optional(),
    totalExported: z.number().int(),
    reviewedCount: z.number().int(),
    pendingCount: z.number().int(),
    warningCount: z.number().int(),
    statusBreakdown: z.array(ReviewPacketSummaryCountSchema),
    actionBreakdown: z.array(ReviewPacketSummaryCountSchema),
    warnings: z.array(z.string()),
  })
  .openapi("ReviewPacketSummaryData");

export const ReviewPacketSummaryPreviewRequestSchema = z
  .object({
    templateId: z.string().optional().openapi({ example: "review-packet-wechat" }),
  })
  .openapi("ReviewPacketSummaryPreviewRequest");

export const ReviewPacketSummaryPreviewResponseSchema = z
  .object({
    success: z.literal(true),
    run: ReviewPacketRunSchema,
    channel: z.literal("wechat_work"),
    templateId: z.string(),
    content: z.string(),
    data: ReviewPacketSummaryDataSchema,
  })
  .openapi("ReviewPacketSummaryPreviewResponse");

export const ReviewPacketSummarySendRequestSchema = z
  .object({
    templateId: z.string().optional().openapi({ example: "review-packet-wechat" }),
    webhookUrl: z.string().url().optional().openapi({ example: "https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=***" }),
  })
  .openapi("ReviewPacketSummarySendRequest");

export const ReviewPacketSummarySendResponseSchema = z
  .object({
    success: z.literal(true),
    run: ReviewPacketRunSchema,
    channel: z.literal("wechat_work"),
    templateId: z.string(),
    delivery: z.object({
      errcode: z.number().optional(),
      errmsg: z.string().optional(),
    }).passthrough(),
  })
  .openapi("ReviewPacketSummarySendResponse");

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
        sourceMapping: z.record(z.string(), z.string()).optional(),
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

export const AnalyzeRequestSchema = z.object({
  query: z.string().optional().openapi({ example: "CNC 销售" }),
  jobDescriptionId: z.string().optional().openapi({ example: "lathe-sales" }),
  location: z.string().optional().openapi({ example: "东莞" }),
  maxExperience: z.number().min(0).optional().openapi({ example: 10 }),
  education: z.array(z.string()).optional().openapi({ example: ["bachelor", "master"] }),
  skills: z.array(z.string()).optional().openapi({ example: ["CNC", "FANUC"] }),
  requiredKeywords: z.array(z.string()).optional().openapi({ example: ["machine tools"] }),
  locations: z.array(z.string()).optional().openapi({ example: ["东莞", "深圳"] }),
  minSalary: z.number().min(0).optional().openapi({ example: 5000 }),
  maxSalary: z.number().min(0).optional().openapi({ example: 15000 }),
  limit: z.number().min(1).max(500).default(50).openapi({ example: 50 }),
  dryRun: z.boolean().default(false).openapi({ example: false }),
});

export const AnalyzeResponseSchema = z
  .object({
    success: z.literal(true),
    dryRun: z.boolean().optional(),
    taskId: z.string().optional(),
    resumeCount: z.number(),
    skippedCount: z.number().optional(),
    config: z
      .object({
        jobDescriptionId: z.string().optional(),
        keywords: z.array(z.string()).optional(),
        location: z.string().optional(),
      })
      .optional(),
  })
  .openapi("AnalyzeResponse");

export const AnalysisTaskConfigSchema = z.object({
  jobDescriptionId: z.string().optional(),
  jobDescriptionTitle: z.string().optional(),
  keywords: z.array(z.string()).optional(),
  location: z.string().optional(),
  promptVersion: z.number().optional(),
  resumeCount: z.number().optional(),
});

export const AnalysisTaskProgressSchema = z.object({
  current: z.number().optional(),
  total: z.number().optional(),
  skipped: z.number().optional(),
});

export const AnalysisTaskResultsSchema = z.object({
  analyzed: z.number().optional(),
  failed: z.number().optional(),
  avgScore: z.number().optional(),
  highScoreCount: z.number().optional(),
});

export const AnalysisTaskSchema = z.object({
  _id: z.string(),
  status: z.enum(["pending", "processing", "completed", "failed", "cancelled"]),
  _creationTime: z.number(),
  config: AnalysisTaskConfigSchema.optional(),
  progress: AnalysisTaskProgressSchema.optional(),
  results: AnalysisTaskResultsSchema.optional(),
  lastStatus: z.string().optional(),
  error: z.string().optional(),
});

export const AnalysisTasksResponseSchema = z
  .object({
    success: z.literal(true),
    tasks: z.array(AnalysisTaskSchema),
  })
  .openapi("AnalysisTasksResponse");

// Shared route-level schemas (previously duplicated across route files)

export const ClearMatchesResponseSchema = z
  .object({
    success: z.literal(true),
    deleted: z.number().int(),
    jobDescriptionId: z.string().optional(),
  })
  .openapi("ClearMatchesResponse");

export const ResumeResetResponseSchema = z
  .object({
    success: z.literal(true),
    count: z.number().int(),
    partial: z.boolean(),
    deleted: z.record(z.string(), z.number().int()),
  })
  .openapi("ResumeResetResponse");
