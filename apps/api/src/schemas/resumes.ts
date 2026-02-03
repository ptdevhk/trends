import { z } from "@hono/zod-openapi";

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
    .openapi({
      param: { name: "q", in: "query" },
      example: "sales",
    }),
  limit: z
    .coerce
    .number()
    .min(1)
    .max(500)
    .optional()
    .openapi({
      param: { name: "limit", in: "query" },
      example: "50",
    }),
});

export const ResumesResponseSchema = z
  .object({
    success: z.literal(true),
    sample: ResumeSampleSchema.optional(),
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
