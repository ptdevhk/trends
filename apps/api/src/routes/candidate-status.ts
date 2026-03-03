import fs from "node:fs";
import path from "node:path";

import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";

import { config } from "../services/config.js";
import { workspaceConfigService } from "../services/workspace-config-service.js";

const app = new OpenAPIHono();

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function readEnvVarFromFile(filePath: string, key: string): string | null {
  if (!fs.existsSync(filePath)) {
    return null;
  }

  const lines = fs.readFileSync(filePath, "utf8").split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }

    const match = trimmed.match(/^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!match || match[1] !== key) {
      continue;
    }

    let value = match[2].trim();
    const hasDoubleQuotes = value.startsWith("\"") && value.endsWith("\"");
    const hasSingleQuotes = value.startsWith("'") && value.endsWith("'");
    if (hasDoubleQuotes || hasSingleQuotes) {
      value = value.slice(1, -1);
    }

    return value;
  }

  return null;
}

function resolveConvexUrl(): string {
  if (process.env.CONVEX_URL) {
    return process.env.CONVEX_URL;
  }
  if (process.env.VITE_CONVEX_URL) {
    return process.env.VITE_CONVEX_URL;
  }

  const candidateFiles = [
    path.join(config.projectRoot, "packages", "convex", ".env.local"),
    path.join(config.projectRoot, "apps", "web", ".env.local"),
    path.join(config.projectRoot, ".env.local"),
    path.join(config.projectRoot, ".env"),
  ];

  for (const filePath of candidateFiles) {
    const direct = readEnvVarFromFile(filePath, "CONVEX_URL");
    if (direct) {
      return direct;
    }
    const vite = readEnvVarFromFile(filePath, "VITE_CONVEX_URL");
    if (vite) {
      return vite;
    }
  }

  return "http://127.0.0.1:3210";
}

async function callConvex(
  type: "query" | "mutation",
  pathName: string,
  args: Record<string, unknown>
): Promise<unknown> {
  const convexUrl = resolveConvexUrl().replace(/\/$/, "");
  const response = await fetch(`${convexUrl}/api/${type}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({ path: pathName, args }),
  });

  if (!response.ok) {
    const message = await response.text();
    throw new Error(`Convex ${type} failed (${response.status}): ${message}`);
  }

  const payload = await response.json() as unknown;
  if (!isRecord(payload) || payload.status !== "success") {
    const errorMessage = isRecord(payload) ? readString(payload.errorMessage) : undefined;
    throw new Error(errorMessage ?? `Convex ${type} failed for ${pathName}`);
  }

  return payload.value;
}

const CandidateStatusEnum = z.enum([
  "new",
  "contacted",
  "interviewing",
  "interviewed_pass",
  "interviewed_reject",
  "offer",
  "hired",
  "withdrawn",
]);

const CandidateStatusSchema = z.object({
  _id: z.string(),
  identityKey: z.string(),
  workspaceSlug: z.string(),
  status: CandidateStatusEnum,
  notes: z.string().optional(),
  updatedBy: z.string().optional(),
  updatedAt: z.number(),
  history: z.array(z.object({
    status: z.string(),
    updatedAt: z.number(),
    notes: z.string().optional(),
  })).optional(),
});

const ListResponseSchema = z.object({
  success: z.literal(true),
  items: z.array(CandidateStatusSchema),
});

const UpdateRequestSchema = z.object({
  identityKey: z.string(),
  status: CandidateStatusEnum,
  notes: z.string().optional(),
  updatedBy: z.string().optional(),
});

const UpdateResponseSchema = z.object({
  success: z.literal(true),
  item: CandidateStatusSchema.optional(),
  learningEntry: z.object({
    date: z.string(),
    observation: z.string(),
  }).optional(),
});

type CandidateStatusItem = z.infer<typeof CandidateStatusSchema>;

function toCandidateStatusItem(value: unknown): CandidateStatusItem | undefined {
  const parsed = CandidateStatusSchema.safeParse(value);
  if (!parsed.success) {
    return undefined;
  }
  return parsed.data;
}

const listRoute = createRoute({
  method: "get",
  path: "/api/candidate-status",
  tags: ["actions"],
  summary: "List candidate interview statuses",
  responses: {
    200: {
      content: { "application/json": { schema: ListResponseSchema } },
      description: "Status list",
    },
  },
});

app.openapi(listRoute, async (c) => {
  const value = await callConvex("query", "candidate_status:list", {
    workspaceSlug: c.var.workspaceSlug,
  });
  const items = Array.isArray(value)
    ? value
        .map((item) => toCandidateStatusItem(item))
        .filter((item): item is CandidateStatusItem => item !== undefined)
    : [];
  return c.json({ success: true as const, items }, 200);
});

const updateRoute = createRoute({
  method: "post",
  path: "/api/candidate-status",
  tags: ["actions"],
  summary: "Set candidate interview status",
  request: {
    body: {
      content: {
        "application/json": { schema: UpdateRequestSchema },
      },
    },
  },
  responses: {
    200: {
      content: { "application/json": { schema: UpdateResponseSchema } },
      description: "Status updated",
    },
  },
});

app.openapi(updateRoute, async (c) => {
  const body = c.req.valid("json");
  await callConvex("mutation", "candidate_status:upsert", {
    workspaceSlug: c.var.workspaceSlug,
    identityKey: body.identityKey,
    status: body.status,
    notes: body.notes,
    updatedBy: body.updatedBy,
  });

  const item = await callConvex("query", "candidate_status:getByIdentity", {
    workspaceSlug: c.var.workspaceSlug,
    identityKey: body.identityKey,
  });

  let learningEntry:
    | {
      date: string;
      observation: string;
    }
    | undefined;

  if (body.status === "interviewed_reject") {
    const noteText = body.notes?.trim() || "面试后不合适";
    learningEntry = await workspaceConfigService.appendLearningLogEntry(
      c.var.workspaceSlug,
      `reject_pattern: ${noteText} -> interviewed_reject`
    );
  }

  return c.json({
    success: true as const,
    item: toCandidateStatusItem(item),
    learningEntry,
  }, 200);
});

export default app;
