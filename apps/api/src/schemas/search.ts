import { z } from "@hono/zod-openapi";

// Search result schema
export const SearchResultSchema = z
  .object({
    title: z.string(),
    platform: z.string(),
    platform_name: z.string(),
    ranks: z.array(z.number().int()).optional(),
    count: z.number().int().optional(),
    avg_rank: z.number().optional(),
    url: z.string().optional(),
    mobileUrl: z.string().optional(),
    date: z.string().optional(),
  })
  .openapi("SearchResult");

// Search query parameters
export const SearchQuerySchema = z.object({
  q: z
    .string()
    .min(1)
    .openapi({
      param: { name: "q", in: "query" },
      example: "AI",
    }),
  platform: z
    .string()
    .optional()
    .openapi({
      param: { name: "platform", in: "query" },
    }),
  start_date: z
    .string()
    .optional()
    .openapi({
      param: { name: "start_date", in: "query" },
      example: "2025-01-20",
    }),
  end_date: z
    .string()
    .optional()
    .openapi({
      param: { name: "end_date", in: "query" },
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
});

// Search response
export const SearchResponseSchema = z
  .object({
    success: z.literal(true),
    results: z.array(SearchResultSchema),
    total: z.number().int(),
    total_found: z.number().int().optional(),
    statistics: z
      .object({
        platform_distribution: z.record(z.string(), z.number().int()).optional(),
        avg_rank: z.number().optional(),
        keyword: z.string(),
      })
      .optional(),
  })
  .openapi("SearchResponse");
