import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";

import {
  ResumeImportItemSchema,
  ResumeImportMetadataSchema,
  ResumeSubmitSummarySchema,
} from "../schemas/resumes.js";
import { resolveConvexUrl, submitResumeImport } from "../services/resume-import-service.js";
import { logger } from "../services/logger.js";

const app = new OpenAPIHono();

const ResumeSubmitRequestSchema = z.object({
  metadata: ResumeImportMetadataSchema,
  resumes: z.array(ResumeImportItemSchema),
});

const ResumeSubmitResponseSchema = ResumeSubmitSummarySchema;

const ResumeSubmitErrorSchema = z.object({
  success: z.literal(false),
  error: z.string(),
});

async function recordSyncError(errorMessage: string): Promise<void> {
  try {
    const convexUrl = resolveConvexUrl().replace(/\/$/, "");
    await fetch(`${convexUrl}/api/mutation`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({
        path: "sync_events:recordError",
        args: { source: "browser-extension", error: errorMessage },
      }),
    });
  } catch (err) {
    logger.error("Failed to record sync error event", err, { route: "resume_submit" });
  }
}

function normalizeBearerToken(headerValue: string | undefined): string | null {
  if (!headerValue) return null;
  const match = headerValue.match(/^Bearer\s+(.+)$/i);
  if (!match) return null;
  const token = match[1]?.trim();
  return token ? token : null;
}

const resumeSubmitRoute = createRoute({
  method: "post",
  path: "/api/resumes/submit",
  tags: ["resumes"],
  summary: "Submit resumes (browser extension sync)",
  request: {
    body: {
      content: {
        "application/json": {
          schema: ResumeSubmitRequestSchema,
        },
      },
      required: true,
    },
  },
  responses: {
    200: {
      description: "Submission result",
      content: {
        "application/json": {
          schema: ResumeSubmitResponseSchema,
        },
      },
    },
    400: {
      description: "Invalid request payload",
      content: {
        "application/json": {
          schema: ResumeSubmitErrorSchema,
        },
      },
    },
    401: {
      description: "Unauthorized",
      content: {
        "application/json": {
          schema: ResumeSubmitErrorSchema,
        },
      },
    },
    500: {
      description: "Server error",
      content: {
        "application/json": {
          schema: ResumeSubmitErrorSchema,
        },
      },
    },
  },
});

const verifyTokenRoute = createRoute({
  method: "post",
  path: "/api/resumes/verify-token",
  tags: ["resumes"],
  summary: "Verify submit token",
  responses: {
    200: {
      description: "Token valid",
      content: {
        "application/json": {
          schema: z.object({ success: z.literal(true) }),
        },
      },
    },
    401: {
      description: "Unauthorized",
      content: {
        "application/json": {
          schema: ResumeSubmitErrorSchema,
        },
      },
    },
    500: {
      description: "Token not configured",
      content: {
        "application/json": {
          schema: ResumeSubmitErrorSchema,
        },
      },
    },
  },
});

app.openapi(verifyTokenRoute, async (c) => {
  const expectedToken = process.env.RESUME_SUBMIT_TOKEN?.trim();
  if (!expectedToken) {
    return c.json({ success: false as const, error: "RESUME_SUBMIT_TOKEN is not configured" }, 500);
  }

  const providedToken = normalizeBearerToken(c.req.header("Authorization"));
  if (!providedToken || providedToken !== expectedToken) {
    return c.json({ success: false as const, error: "Unauthorized" }, 401);
  }

  return c.json({ success: true as const }, 200);
});

app.openapi(resumeSubmitRoute, async (c) => {
  try {
    const expectedToken = process.env.RESUME_SUBMIT_TOKEN?.trim();
    if (!expectedToken) {
      await recordSyncError("RESUME_SUBMIT_TOKEN is not configured on server");
      return c.json({ success: false as const, error: "RESUME_SUBMIT_TOKEN is not configured" }, 500);
    }

    const authHeader = c.req.header("Authorization");
    const providedToken = normalizeBearerToken(authHeader);
    if (!providedToken || providedToken !== expectedToken) {
      await recordSyncError("Authentication failed: invalid or missing token");
      return c.json({ success: false as const, error: "Unauthorized" }, 401);
    }

    const body: unknown = await c.req.json();
    const parsedBody = ResumeSubmitRequestSchema.safeParse(body);
    if (!parsedBody.success) {
      await recordSyncError("Invalid resume submit payload");
      return c.json({ success: false as const, error: "Invalid resume submit payload" }, 400);
    }

    const result = await submitResumeImport(parsedBody.data, c.var.workspaceSlug);

    return c.json(result, 200);
  } catch (error) {
    logger.error("Failed to submit resumes", error, { route: "resume_submit" });
    const msg = error instanceof Error ? error.message : "Failed to submit resumes";
    await recordSyncError(msg);
    return c.json({ success: false as const, error: "Failed to submit resumes" }, 500);
  }
});

export default app;
