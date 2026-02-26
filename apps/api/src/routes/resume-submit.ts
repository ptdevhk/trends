import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";

import { config } from "../services/config.js";

const app = new OpenAPIHono();

const ResumeSubmitMetadataSchema = z.object({
  sourceUrl: z.string().url(),
  keyword: z.string().optional(),
  location: z.string().optional(),
  searchProfileId: z.string().optional(),
  generatedBy: z.string(),
});

const ResumeSubmitWorkHistorySchema = z.object({
  raw: z.string(),
});

const ResumeSubmitItemSchema = z.object({
  resumeId: z.union([z.string(), z.number()]).pipe(z.coerce.string()).optional(),
  perUserId: z.union([z.string(), z.number()]).pipe(z.coerce.string()).optional(),
  name: z.string(),
  age: z.string().optional(),
  experience: z.string().optional(),
  education: z.string().optional(),
  location: z.string().optional(),
  jobIntention: z.string().optional(),
  expectedSalary: z.string().optional(),
  selfIntro: z.string().optional(),
  workHistory: z.array(ResumeSubmitWorkHistorySchema).optional(),
  profileUrl: z.string().optional(),
  activityStatus: z.string().optional(),
  extractedAt: z.string().optional(),
});

const ResumeSubmitRequestSchema = z.object({
  metadata: ResumeSubmitMetadataSchema,
  resumes: z.array(ResumeSubmitItemSchema),
});

const ResumeSubmitResponseSchema = z.object({
  success: z.literal(true),
  submitted: z.number().int(),
  inserted: z.number().int(),
  updated: z.number().int(),
  unchanged: z.number().int(),
  deduped: z.number().int(),
});

const ResumeSubmitErrorSchema = z.object({
  success: z.literal(false),
  error: z.string(),
});

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function stableStringify(value: unknown): string {
  if (value === null) return "null";
  if (value === undefined) return "undefined";

  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(",")}]`;
  }

  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    const keys = Object.keys(record).sort((a, b) => a.localeCompare(b));
    return `{${keys.map((key) => `${key}:${stableStringify(record[key])}`).join(",")}}`;
  }

  return JSON.stringify(value);
}

function readEnvVarFromFile(filePath: string, key: string): string | null {
  try {
    if (!fs.existsSync(filePath)) return null;
    const content = fs.readFileSync(filePath, "utf8");
    const lines = content.split(/\r?\n/);
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const idx = trimmed.indexOf("=");
      if (idx < 0) continue;
      const k = trimmed.slice(0, idx).trim();
      if (k !== key) continue;
      const v = trimmed.slice(idx + 1).trim();
      return v.replace(/^['"]|['"]$/g, "");
    }
    return null;
  } catch {
    return null;
  }
}

function resolveConvexUrl(): string {
  if (process.env.CONVEX_URL) return process.env.CONVEX_URL;
  if (process.env.VITE_CONVEX_URL) return process.env.VITE_CONVEX_URL;

  const candidateFiles = [
    path.join(config.projectRoot, "packages", "convex", ".env.local"),
    path.join(config.projectRoot, "apps", "web", ".env.local"),
    path.join(config.projectRoot, ".env.local"),
    path.join(config.projectRoot, ".env"),
  ];

  for (const filePath of candidateFiles) {
    const direct = readEnvVarFromFile(filePath, "CONVEX_URL");
    if (direct) return direct;
    const vite = readEnvVarFromFile(filePath, "VITE_CONVEX_URL");
    if (vite) return vite;
  }

  return "http://127.0.0.1:3210";
}

async function submitResumesToConvex(args: {
  resumes: Array<{
    externalId: string;
    content: unknown;
    hash: string;
    source: string;
    tags: string[];
  }>;
}): Promise<{
  submitted: number;
  deduped: number;
  inserted: number;
  updated: number;
  unchanged: number;
}> {
  const convexUrl = resolveConvexUrl().replace(/\/$/, "");
  const response = await fetch(`${convexUrl}/api/mutation`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({
      path: "resume_tasks:submitResumes",
      args,
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Convex mutation failed (${response.status}): ${text}`);
  }

  const payload = (await response.json()) as {
    status?: string;
    value?: unknown;
    errorMessage?: string;
  };

  if (payload.status !== "success") {
    throw new Error(payload.errorMessage || "Convex mutation failed");
  }

  if (!isRecord(payload.value)) {
    throw new Error("Invalid submitResumes response from Convex");
  }

  const value = payload.value;
  return {
    submitted: typeof value.submitted === "number" ? value.submitted : 0,
    deduped: typeof value.deduped === "number" ? value.deduped : 0,
    inserted: typeof value.inserted === "number" ? value.inserted : 0,
    updated: typeof value.updated === "number" ? value.updated : 0,
    unchanged: typeof value.unchanged === "number" ? value.unchanged : 0,
  };
}

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
    console.error("Failed to record sync error event", err);
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

    const { metadata, resumes } = parsedBody.data;

    const tag =
      (metadata.searchProfileId && metadata.searchProfileId.trim()) ||
      (metadata.keyword && metadata.keyword.trim()) ||
      null;
    const tags = tag ? [tag] : [];

    const convexResumes = resumes.map((resume) => {
      const content: unknown = resume;
      const hash = crypto.createHash("sha256").update(stableStringify(content), "utf8").digest("hex");
      const externalId = resume.resumeId?.trim() ? resume.resumeId.trim() : hash;

      return {
        externalId,
        content,
        hash,
        source: "hr.job5156.com",
        tags,
      };
    });

    const result = await submitResumesToConvex({ resumes: convexResumes });

    return c.json(
      ResumeSubmitResponseSchema.parse({
        success: true as const,
        submitted: result.submitted,
        inserted: result.inserted,
        updated: result.updated,
        unchanged: result.unchanged,
        deduped: result.deduped,
      }),
      200,
    );
  } catch (error) {
    console.error("Failed to submit resumes", error);
    const msg = error instanceof Error ? error.message : "Failed to submit resumes";
    await recordSyncError(msg);
    return c.json({ success: false as const, error: "Failed to submit resumes" }, 500);
  }
});

export default app;
