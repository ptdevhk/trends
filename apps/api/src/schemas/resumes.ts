import { z } from "@hono/zod-openapi";

const CsvStringArraySchema = z.preprocess((value) => {
  if (typeof value !== "string") return value;
  const parts = value
    .split(/[,，、]/g)
    .map((part) => part.trim())
    .filter(Boolean);
  return parts.length > 0 ? parts : undefined;
}, z.array(z.string()).optional());

export const ResumeWorkHistorySchema = z
  .object({
    raw: z.string().openapi({ example: "2021-03 ~ 2023-08 Example Co. - Sales Manager" }),
  })
  .openapi("ResumeWorkHistory");

export const ResumeItemSchema = z
  .object({
    name: z.string().openapi({ example: "Alex Chen" }),
    profileUrl: z.string().openapi({ example: "https://hr.job5156.com/resume/123" }),
    activityStatus: z.string().openapi({ example: "Active today" }),
    age: z.string().openapi({ example: "28" }),
    experience: z.string().openapi({ example: "5 years" }),
    education: z.string().openapi({ example: "Bachelor" }),
    location: z.string().openapi({ example: "Shenzhen" }),
    selfIntro: z.string().openapi({ example: "认真敬业，具备团队协作精神" }),
    jobIntention: z.string().openapi({ example: "Sales Manager" }),
    expectedSalary: z.string().openapi({ example: "10-15K" }),
    workHistory: z.array(ResumeWorkHistorySchema),
    extractedAt: z.string().openapi({ example: "2026-02-03T10:00:00.000Z" }),
    resumeId: z.string().optional().openapi({ example: "R123456" }),
    perUserId: z.string().optional().openapi({ example: "U987654" }),
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
      })
      .optional(),
    data: z.array(ResumeItemSchema),
  })
  .openapi("ResumesResponse");

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

export const ResumeMatchSchema = z
  .object({
    resumeId: z.string().openapi({ example: "R123456" }),
    jobDescriptionId: z.string().openapi({ example: "lathe-sales" }),
    score: z.number().int().openapi({ example: 85 }),
    recommendation: RecommendationSchema.openapi({ example: "match" }),
    highlights: z.array(z.string()).openapi({ example: ["客户开发经验丰富"] }),
    concerns: z.array(z.string()).openapi({ example: ["缺少机床销售经验"] }),
    summary: z.string().openapi({ example: "候选人与岗位匹配良好，可安排面试。" }),
    matchedAt: z.string().openapi({ example: "2026-02-05T08:00:00.000Z" }),
    sessionId: z.string().optional().openapi({ example: "session-123" }),
    userId: z.string().optional().openapi({ example: "user-abc" }),
  })
  .openapi("ResumeMatch");

export const MatchRequestSchema = z
  .object({
    sessionId: z.string().optional().openapi({ example: "session-123" }),
    sample: z.string().optional().openapi({ example: "sample-initial" }),
    jobDescriptionId: z.string().openapi({ example: "lathe-sales" }),
    resumeIds: z.array(z.string()).optional().openapi({ example: ["R123456"] }),
    limit: z.number().int().min(1).max(1000).optional().openapi({ example: 50 }),
  })
  .openapi("MatchRequest");

export const MatchStatsSchema = z
  .object({
    processed: z.number().int(),
    matched: z.number().int(),
    avgScore: z.number(),
    processingTimeMs: z.number().int().optional(),
  })
  .openapi("MatchStats");

export const MatchResponseSchema = z
  .object({
    success: z.literal(true),
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
