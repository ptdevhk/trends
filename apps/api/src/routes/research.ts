import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";

import { requireWorkspaceUser } from "../middleware/auth.js";
import {
  getLatestIngestRun,
  getLatestParity,
  listCompanySignals,
  listResearchNews,
  searchResearchCompanies,
  triggerResearchIngest,
} from "../services/research-service.js";
import {
  getResearchShowcase,
  seedResearchShowcase,
} from "../services/research-showcase-service.js";

const app = new OpenAPIHono();

app.use("/api/research", async (c, next) => {
  if (["GET", "POST"].includes(c.req.method)) {
    return requireWorkspaceUser(c, next);
  }
  await next();
});
app.use("/api/research/*", async (c, next) => {
  if (["GET", "POST"].includes(c.req.method)) {
    return requireWorkspaceUser(c, next);
  }
  await next();
});

const NewsItemSchema = z.object({
  _id: z.string(),
  sourceId: z.string(),
  platform: z.string(),
  title: z.string(),
  contentHash: z.string(),
  capturedAt: z.number(),
  externalId: z.string().optional(),
  url: z.string().optional(),
  rank: z.number().optional(),
  publishedAt: z.number().optional(),
  rawSnippet: z.string().optional(),
});

const SignalSchema = z.object({
  _id: z.string(),
  companyKey: z.string(),
  kind: z.string(),
  title: z.string(),
  summary: z.string().optional(),
  evidence: z.object({
    newsItemId: z.string().optional(),
    title: z.string(),
    url: z.string().optional(),
    platform: z.string(),
    seenAt: z.number(),
    snippet: z.string().optional(),
  }),
  score: z.number().optional(),
  capturedAt: z.number(),
  ingestRunId: z.string().optional(),
});

const listNewsRoute = createRoute({
  method: "get",
  path: "/api/research/news",
  tags: ["research"],
  summary: "List recent native research news items",
  request: {
    query: z.object({
      limit: z.coerce.number().optional(),
      platform: z.string().optional(),
      since: z.coerce.number().optional(),
    }),
  },
  responses: {
    200: {
      content: {
        "application/json": {
          schema: z.object({ success: z.literal(true), items: z.array(NewsItemSchema) }),
        },
      },
      description: "Recent news items",
    },
  },
});

app.openapi(listNewsRoute, async (c) => {
  const query = c.req.valid("query");
  const items = await listResearchNews({
    limit: query.limit,
    platform: query.platform,
    since: query.since,
  });
  return c.json({ success: true as const, items }, 200);
});

const listSignalsRoute = createRoute({
  method: "get",
  path: "/api/research/companies/{companyKey}/signals",
  tags: ["research"],
  summary: "List company research signals ranked by persona",
  request: {
    params: z.object({ companyKey: z.string() }),
    query: z.object({
      persona: z.enum(["hr", "sales"]).optional(),
      limit: z.coerce.number().optional(),
    }),
  },
  responses: {
    200: {
      content: {
        "application/json": {
          schema: z.object({
            success: z.literal(true),
            persona: z.enum(["hr", "sales"]),
            items: z.array(SignalSchema),
          }),
        },
      },
      description: "Company signals",
    },
  },
});

app.openapi(listSignalsRoute, async (c) => {
  const { companyKey } = c.req.valid("param");
  const query = c.req.valid("query");
  const result = await listCompanySignals({
    companyKey,
    persona: query.persona,
    limit: query.limit,
  });
  return c.json({ success: true as const, persona: result.persona, items: result.items }, 200);
});

const searchCompaniesRoute = createRoute({
  method: "get",
  path: "/api/research/companies/search",
  tags: ["research"],
  summary: "Search/resolve companies for research UI and CLI",
  request: {
    query: z.object({ q: z.string().optional() }),
  },
  responses: {
    200: {
      content: {
        "application/json": {
          schema: z.object({
            success: z.literal(true),
            items: z.array(
              z.object({
                companyKey: z.string(),
                displayName: z.string(),
                nameCn: z.string().optional(),
                nameEn: z.string().optional(),
              }),
            ),
          }),
        },
      },
      description: "Company search hits",
    },
  },
});

app.openapi(searchCompaniesRoute, async (c) => {
  const query = c.req.valid("query");
  const items = await searchResearchCompanies(query.q ?? "");
  return c.json({ success: true as const, items }, 200);
});

const ingestRunRoute = createRoute({
  method: "post",
  path: "/api/research/ingest/run",
  tags: ["research"],
  summary: "Operator trigger: proxy to worker research ingest",
  responses: {
    200: {
      content: {
        "application/json": {
          schema: z.object({
            success: z.boolean(),
            mode: z.string(),
            started_at: z.string().optional(),
            finished_at: z.string().optional(),
            message: z.string(),
          }),
        },
      },
      description: "Ingest trigger result",
    },
  },
});

app.openapi(ingestRunRoute, async (c) => {
  const result = await triggerResearchIngest();
  return c.json(result, 200);
});

const parityRoute = createRoute({
  method: "get",
  path: "/api/research/parity",
  tags: ["research"],
  summary: "Latest research parity run (durable kill-switch ledger)",
  responses: {
    200: {
      content: {
        "application/json": {
          schema: z.object({
            success: z.literal(true),
            parity: z.unknown().nullable(),
          }),
        },
      },
      description: "Latest parity row or null",
    },
  },
});

app.openapi(parityRoute, async (c) => {
  const parity = await getLatestParity();
  return c.json({ success: true as const, parity }, 200);
});

const latestIngestRoute = createRoute({
  method: "get",
  path: "/api/research/ingest/latest",
  tags: ["research"],
  summary: "Latest research ingest run for desk empty-state / operator feedback",
  responses: {
    200: {
      content: {
        "application/json": {
          schema: z.object({
            success: z.literal(true),
            run: z.unknown().nullable(),
          }),
        },
      },
      description: "Latest ingest run or null",
    },
  },
});

app.openapi(latestIngestRoute, async (c) => {
  const run = await getLatestIngestRun();
  return c.json({ success: true as const, run }, 200);
});

const ShowcaseCompanyCardSchema = z.object({
  companyKey: z.string(),
  displayName: z.string(),
  nameCn: z.string().optional(),
  nameEn: z.string().optional(),
  kindCounts: z.record(z.string(), z.number()),
  signalCount: z.number(),
  showcase: z.boolean(),
  href: z.string(),
});

const showcaseRoute = createRoute({
  method: "get",
  path: "/api/research/showcase",
  tags: ["research"],
  summary: "Research showcase hub payload (golden + resume-desk cards + pulse)",
  responses: {
    200: {
      content: {
        "application/json": {
          schema: z.object({
            success: z.literal(true),
            golden: z.array(ShowcaseCompanyCardSchema),
            fromResumeDesk: z.array(ShowcaseCompanyCardSchema),
            pulse: z.array(
              z.object({
                title: z.string(),
                platform: z.string(),
                url: z.string().optional(),
                capturedAt: z.number(),
              }),
            ),
            meta: z.object({
              lastIngest: z.unknown().nullable(),
              showcaseSeedVersion: z.string(),
              seedIngestRunId: z.string(),
            }),
          }),
        },
      },
      description: "Showcase hub DTO",
    },
  },
});

app.openapi(showcaseRoute, async (c) => {
  const workspaceSlug =
    c.req.header("X-Workspace-Slug")?.trim() ||
    c.req.header("x-workspace-slug")?.trim() ||
    "hr";
  const payload = await getResearchShowcase(workspaceSlug);
  return c.json({ success: true as const, ...payload }, 200);
});

const showcaseSeedRoute = createRoute({
  method: "post",
  path: "/api/research/showcase/seed",
  tags: ["research"],
  summary: "Idempotent operator seed for showcase hub density",
  responses: {
    200: {
      content: {
        "application/json": {
          schema: z.object({
            success: z.literal(true),
            companiesUpserted: z.number(),
            aliasesCreated: z.number(),
            newsUpserted: z.number(),
            newsCreated: z.number(),
            signalsUpserted: z.number(),
            signalsCreated: z.number(),
            seedIngestRunId: z.string(),
          }),
        },
      },
      description: "Seed counters (signalsCreated=0 on pure re-seed)",
    },
  },
});

app.openapi(showcaseSeedRoute, async (c) => {
  const result = await seedResearchShowcase();
  return c.json({ success: true as const, ...result }, 200);
});

export default app;
