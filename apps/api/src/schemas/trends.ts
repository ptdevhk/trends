import { z } from "@hono/zod-openapi";

// Trend item schema
export const TrendItemSchema = z
  .object({
    title: z.string().openapi({ example: "OpenAI announces GPT-5" }),
    platform: z.string().openapi({ example: "zhihu" }),
    platform_name: z.string().openapi({ example: "Zhihu Hot List" }),
    rank: z.number().int().openapi({ example: 1 }),
    avg_rank: z.number().optional().openapi({ example: 2.5 }),
    count: z.number().int().optional().openapi({ example: 5 }),
    timestamp: z.string().optional(),
    date: z.string().optional(),
    url: z.string().optional(),
    mobileUrl: z.string().optional(),
  })
  .openapi("TrendItem");

// Trends query parameters
export const TrendsQuerySchema = z.object({
  platform: z
    .string()
    .optional()
    .openapi({
      param: { name: "platform", in: "query" },
      example: "zhihu",
    }),
  date: z
    .string()
    .optional()
    .openapi({
      param: { name: "date", in: "query" },
      example: "2025-01-27",
    }),
  limit: z
    .string()
    .optional()
    .transform((v) => (v ? parseInt(v, 10) : 50))
    .pipe(z.number().min(1).max(100))
    .openapi({
      param: { name: "limit", in: "query" },
      example: "50",
    }),
  include_url: z
    .string()
    .optional()
    .transform((v) => v === "true")
    .openapi({
      param: { name: "include_url", in: "query" },
      example: "false",
    }),
});

// Trends response
export const TrendsResponseSchema = z
  .object({
    success: z.literal(true),
    summary: z
      .object({
        description: z.string(),
        total: z.number().int(),
        returned: z.number().int(),
        platforms: z.union([z.string(), z.array(z.string())]),
      })
      .optional(),
    data: z.array(TrendItemSchema),
  })
  .openapi("TrendsResponse");

// Trend detail path parameter
export const TrendIdParamSchema = z.object({
  id: z.string().openapi({
    param: { name: "id", in: "path" },
    example: "abc123",
  }),
});

// Trend detail response
export const TrendDetailResponseSchema = z
  .object({
    success: z.literal(true),
    data: TrendItemSchema,
  })
  .openapi("TrendDetailResponse");

// Topic schema
export const TopicSchema = z
  .object({
    keyword: z.string().openapi({ example: "AI" }),
    frequency: z.number().int().openapi({ example: 15 }),
    matched_news: z.number().int().optional(),
    trend: z.enum(["rising", "stable", "falling"]).optional(),
    weight_score: z.number().optional(),
  })
  .openapi("Topic");

// Topics query parameters
export const TopicsQuerySchema = z.object({
  top_n: z
    .string()
    .optional()
    .transform((v) => (v ? parseInt(v, 10) : 10))
    .pipe(z.number().min(1).max(50))
    .openapi({
      param: { name: "top_n", in: "query" },
      example: "10",
    }),
  mode: z
    .enum(["daily", "current"])
    .optional()
    .default("current")
    .openapi({
      param: { name: "mode", in: "query" },
      example: "current",
    }),
  extract_mode: z
    .enum(["keywords", "auto_extract"])
    .optional()
    .default("keywords")
    .openapi({
      param: { name: "extract_mode", in: "query" },
      example: "keywords",
    }),
});

// Topics response
export const TopicsResponseSchema = z
  .object({
    success: z.literal(true),
    topics: z.array(TopicSchema),
    generated_at: z.string().optional(),
    mode: z.string().optional(),
    extract_mode: z.string().optional(),
    total_keywords: z.number().int().optional(),
    description: z.string().optional(),
  })
  .openapi("TopicsResponse");
