import { z } from "@hono/zod-openapi";

// RSS item schema
export const RssItemSchema = z
  .object({
    title: z.string(),
    feed_id: z.string(),
    feed_name: z.string(),
    url: z.string().optional(),
    published_at: z.string().optional(),
    author: z.string().optional(),
    date: z.string().optional(),
    fetch_time: z.string().optional(),
    summary: z.string().optional(),
  })
  .openapi("RssItem");

// RSS query parameters
export const RssQuerySchema = z.object({
  feed: z
    .string()
    .optional()
    .openapi({
      param: { name: "feed", in: "query" },
    }),
  days: z
    .string()
    .optional()
    .transform((v) => (v ? parseInt(v, 10) : 1))
    .pipe(z.number().min(1).max(30))
    .openapi({
      param: { name: "days", in: "query" },
      example: "1",
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
  include_summary: z
    .string()
    .optional()
    .transform((v) => v === "true")
    .openapi({
      param: { name: "include_summary", in: "query" },
      example: "false",
    }),
});

// RSS response
export const RssResponseSchema = z
  .object({
    success: z.literal(true),
    summary: z
      .object({
        description: z.string(),
        total: z.number().int(),
        returned: z.number().int(),
        days: z.number().int(),
        feeds: z.union([z.string(), z.array(z.string())]),
      })
      .optional(),
    data: z.array(RssItemSchema),
  })
  .openapi("RssResponse");
