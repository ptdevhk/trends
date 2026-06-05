import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import { callConvexQuery, isConvexPaginatedQueryPage } from "../services/convex-utils.js";
import { SkillsKnowledgeService } from "../services/skills-knowledge.js";
import { config } from "../services/config.js";
import { logger } from "../services/logger.js";
import { resolveResumeDiagnosticsSourceKey } from "@trends/shared";
import {
  AnalysisTasksResponseSchema,
  ResumeDiagnosticsQuerySchema,
  ResumeDiagnosticsResponseSchema,
} from "../schemas/index.js";
import { requireAdmin } from "../middleware/auth.js";

const app = new OpenAPIHono();
app.use("/api/resumes/analysis-tasks", requireAdmin);
app.use("/api/resumes/skills-version", requireAdmin);
app.use("/api/resumes/field-coverage", requireAdmin);
app.use("/api/resumes/diagnostics", requireAdmin);
const skillsKnowledgeService = new SkillsKnowledgeService(config.projectRoot);

const SimpleErrorSchema = z.object({ success: z.literal(false), error: z.string() });
const AnalysisTasksSuccessSchema = AnalysisTasksResponseSchema;
const SkillsVersionResponseSchema = z.object({ success: z.literal(true), version: z.number() });
const FieldCoverageResponseSchema = z.object({
  success: z.literal(true),
  scanned: z.number().int(),
  missingSearchText: z.number().int(),
  missingVerifiedRoleYears: z.number().int(),
  hasRoleSignals: z.number().int(),
});

function normalizeResumeDiagnosticsSourceKeys(values: string[] | undefined): string[] | undefined {
  if (!values?.length) {
    return undefined;
  }

  const resolved = Array.from(new Set(
    values
      .map((value) => resolveResumeDiagnosticsSourceKey({ sourceKey: value.trim(), source: value.trim() }))
  ));

  return resolved.length > 0 ? resolved : undefined;
}

const listAnalysisTasksRoute = createRoute({
  method: "get",
  path: "/api/resumes/analysis-tasks",
  tags: ["resumes"],
  summary: "List analysis tasks",
  responses: {
    200: { content: { "application/json": { schema: AnalysisTasksSuccessSchema } }, description: "Analysis tasks" },
    500: { content: { "application/json": { schema: SimpleErrorSchema } }, description: "Internal error" },
  },
});
app.openapi(listAnalysisTasksRoute, async (c) => {
  try {
    const tasks = (await callConvexQuery("analysis_tasks:list", {})) as Array<{
      _id: string;
      status: string;
      _creationTime: number;
      config?: {
        jobDescriptionId?: string;
        jobDescriptionTitle?: string;
        keywords?: string[];
        location?: string;
        promptVersion?: number;
        resumeCount?: number;
      };
      progress?: { current?: number; total?: number; skipped?: number };
      results?: {
        analyzed?: number;
        failed?: number;
        avgScore?: number;
        highScoreCount?: number;
      };
      lastStatus?: string;
      error?: string;
    }>;

    return c.json(
      AnalysisTasksResponseSchema.parse({
        success: true,
        tasks,
      }),
      200,
    );
  } catch (error) {
    logger.error("Failed to list analysis tasks", error, { route: "resumes_diagnostics" });
    const message = error instanceof Error ? error.message : String(error);
    return c.json({ success: false, error: message }, 500);
  }
});

const getSkillsVersionRoute = createRoute({
  method: "get",
  path: "/api/resumes/skills-version",
  tags: ["resumes"],
  summary: "Get current skills knowledge version",
  responses: {
    200: { content: { "application/json": { schema: SkillsVersionResponseSchema } }, description: "Skills version" },
  },
});
app.openapi(getSkillsVersionRoute, (c) => {
  const version = skillsKnowledgeService.getVersion();
  return c.json({ success: true, version }, 200);
});

const getFieldCoverageRoute = createRoute({
  method: "get",
  path: "/api/resumes/field-coverage",
  tags: ["resumes"],
  summary: "Get field coverage stats across all resumes",
  responses: {
    200: { content: { "application/json": { schema: FieldCoverageResponseSchema } }, description: "Field coverage" },
  },
});
app.openapi(getFieldCoverageRoute, async (c) => {
  const total = { scanned: 0, missingSearchText: 0, missingVerifiedRoleYears: 0, hasRoleSignals: 0 };
  let cursor: string | null = null;

  for (let i = 0; i < 100; i++) {
    const batch = await callConvexQuery("resumes:fieldCoverage", {
      ...(cursor ? { cursor } : {}),
      batchSize: 200,
    }) as {
      scanned: number;
      missingSearchText: number;
      missingVerifiedRoleYears: number;
      hasRoleSignals: number;
      hasMore: boolean;
      cursor: string | null;
    };
    total.scanned += batch.scanned;
    total.missingSearchText += batch.missingSearchText;
    total.missingVerifiedRoleYears += batch.missingVerifiedRoleYears;
    total.hasRoleSignals += batch.hasRoleSignals;

    if (!batch.hasMore) break;
    cursor = batch.cursor;
  }

  return c.json({ success: true, ...total }, 200);
});

const listResumeDiagnosticsRoute = createRoute({
  method: "get",
  path: "/api/resumes/diagnostics",
  tags: ["resumes"],
  summary: "List resume diagnostics rows with optional archived/source filters",
  request: {
    query: ResumeDiagnosticsQuerySchema,
  },
  responses: {
    200: {
      content: {
        "application/json": {
          schema: ResumeDiagnosticsResponseSchema,
        },
      },
      description: "Diagnostics rows",
    },
  },
});

app.openapi(listResumeDiagnosticsRoute, async (c) => {
  const {
    archived,
    sourceKey,
    limit,
  } = c.req.valid("query");

  const includeArchived = archived === true;
  const requestedLimit = Math.min(Math.max(limit ?? 100, 1), 500);
  const normalizedSourceKeys = normalizeResumeDiagnosticsSourceKeys(sourceKey);
  const pathName = includeArchived ? "resumes_diagnostics:listArchivedDiagnostics" : "resumes_diagnostics:listIngestDiagnostics";
  const rows: unknown[] = [];
  let cursor: string | null = null;

  for (let rounds = 0; rounds < 100 && rows.length < requestedLimit; rounds += 1) {
    const value = await callConvexQuery(pathName, {
      paginationOpts: {
        cursor,
        numItems: Math.min(requestedLimit - rows.length, 100),
      },
      ...(normalizedSourceKeys ? { sourceKeys: normalizedSourceKeys } : {}),
    });

    if (!isConvexPaginatedQueryPage(value)) {
      throw new Error(`Unexpected diagnostics page payload for ${pathName}`);
    }

    rows.push(...value.page);
    if (value.isDone) {
      break;
    }

    cursor = value.continueCursor ?? null;
    if (!cursor) {
      break;
    }
  }

  return c.json(ResumeDiagnosticsResponseSchema.parse({
    success: true as const,
    summary: {
      archived: includeArchived,
      ...(normalizedSourceKeys ? { sourceKeys: normalizedSourceKeys } : {}),
      returned: rows.length,
      limit: requestedLimit,
    },
    data: rows,
  }), 200);
});

export default app;
