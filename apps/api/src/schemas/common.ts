import { z } from "@hono/zod-openapi";

// Reusable pagination and filter schemas
export const PaginationSchema = z.object({
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

export const PlatformFilterSchema = z.object({
  platform: z
    .string()
    .optional()
    .openapi({
      param: { name: "platform", in: "query" },
      example: "zhihu",
    }),
});

export const DateFilterSchema = z.object({
  date: z
    .string()
    .optional()
    .openapi({
      param: { name: "date", in: "query" },
      example: "2025-01-27",
    }),
});

// Error response schema
export const ErrorResponseSchema = z
  .object({
    success: z.literal(false),
    error: z.object({
      code: z.string().openapi({ example: "INVALID_PARAMETER" }),
      message: z.string().openapi({ example: "Invalid platform ID" }),
      suggestion: z.string().optional(),
    }),
  })
  .openapi("ErrorResponse");
