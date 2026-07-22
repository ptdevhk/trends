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
import {
  listResearchIndustryBrowse,
  resolveResearchCompanySurface,
} from "../services/research-industry-bridge-service.js";
import {
  getPulseKeywordsState,
  getResearchPulse,
  putPulseKeywords,
  PulseKeywordsValidationError,
} from "../services/research-pulse-service.js";
import {
  getHotlistPlatformsState,
  putHotlistPlatforms,
  HotlistPlatformsValidationError,
} from "../services/research-hotlist-platforms-service.js";

const app = new OpenAPIHono();

const RESEARCH_AUTH_METHODS = new Set(["GET", "POST", "PUT"]);

app.use("/api/research", async (c, next) => {
  if (RESEARCH_AUTH_METHODS.has(c.req.method)) {
    return requireWorkspaceUser(c, next);
  }
  await next();
});
app.use("/api/research/*", async (c, next) => {
  if (RESEARCH_AUTH_METHODS.has(c.req.method)) {
    return requireWorkspaceUser(c, next);
  }
  await next();
});

function resolveResearchWorkspaceSlug(c: { req: { header: (name: string) => string | undefined } }): string {
  return (
    c.req.header("X-Workspace-Slug")?.trim() ||
    c.req.header("x-workspace-slug")?.trim() ||
    "hr"
  );
}

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
            meta: z.object({
              liveCount: z.number(),
              showcaseCount: z.number(),
              liveFirst: z.literal(true),
            }),
          }),
        },
      },
      description: "Company signals (live-first, persona ranked)",
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
  return c.json(
    {
      success: true as const,
      persona: result.persona,
      items: result.items,
      meta: result.meta,
    },
    200,
  );
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
  summary: "Operator trigger: proxy to worker research ingest (workspace platform set)",
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
            platforms: z.array(z.string()).optional(),
          }),
        },
      },
      description: "Ingest trigger result",
    },
  },
});

app.openapi(ingestRunRoute, async (c) => {
  const workspaceSlug = resolveResearchWorkspaceSlug(c);
  const { effective } = await getHotlistPlatformsState(workspaceSlug);
  const result = await triggerResearchIngest({ platforms: effective });
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
                matchedKeywords: z.array(z.string()).optional(),
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
  const workspaceSlug = resolveResearchWorkspaceSlug(c);
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

const industryBrowseRoute = createRoute({
  method: "get",
  path: "/api/research/industry",
  tags: ["research"],
  summary: "CNC-first industry-data browse (resolveEntity inventory → research keys)",
  request: {
    query: z.object({
      limit: z.coerce.number().optional(),
      includeNonCnc: z.coerce.boolean().optional(),
      q: z.string().optional(),
    }),
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
                nameCn: z.string(),
                nameEn: z.string().optional(),
                displayName: z.string(),
                entityId: z.string(),
                kind: z.enum(["brand", "company", "override"]),
                origin: z.string().optional(),
                type: z.string().optional(),
                aliases: z.array(z.string()),
                cnc: z.boolean(),
              }),
            ),
          }),
        },
      },
      description: "CNC industry browse list (nameCn-first)",
    },
  },
});

app.openapi(industryBrowseRoute, async (c) => {
  const query = c.req.valid("query");
  const items = listResearchIndustryBrowse({
    limit: query.limit,
    includeNonCnc: query.includeNonCnc === true,
    q: query.q,
  });
  return c.json({ success: true as const, items }, 200);
});

const industryResolveRoute = createRoute({
  method: "get",
  path: "/api/research/industry/resolve",
  tags: ["research"],
  summary: "Map free-text surface to research companyKey (override + resolveEntity)",
  request: {
    query: z.object({
      q: z.string().min(1),
    }),
  },
  responses: {
    200: {
      content: {
        "application/json": {
          schema: z.object({
            success: z.literal(true),
            hit: z
              .object({
                companyKey: z.string(),
                nameCn: z.string(),
                nameEn: z.string().optional(),
                displayName: z.string(),
                matchTier: z.string(),
                entityId: z.string().optional(),
                source: z.enum(["override", "resolveEntity"]),
              })
              .nullable(),
          }),
        },
      },
      description: "Resolved research company or null",
    },
  },
});

app.openapi(industryResolveRoute, async (c) => {
  const { q } = c.req.valid("query");
  const hit = resolveResearchCompanySurface(q);
  return c.json({ success: true as const, hit }, 200);
});

const PulseKeywordGroupSchema = z.object({
  id: z.string(),
  label: z.string(),
  keywords: z.array(z.string()),
});

const PulseKeywordsWorkspaceSchema = z.object({
  version: z.literal(1),
  enabled: z.array(z.string()),
  excluded: z.array(z.string()),
  custom: z.array(z.string()),
});

const PulseKeywordsStateSchema = z.object({
  success: z.literal(true),
  seed: z.object({
    version: z.string(),
    groups: z.array(PulseKeywordGroupSchema),
    defaultKeywords: z.array(z.string()),
  }),
  workspace: PulseKeywordsWorkspaceSchema,
  effective: z.array(z.string()),
});

const getPulseKeywordsRoute = createRoute({
  method: "get",
  path: "/api/research/pulse/keywords",
  tags: ["research"],
  summary: "Get research pulse keyword seed, workspace overlay, and effective list",
  responses: {
    200: {
      content: {
        "application/json": {
          schema: PulseKeywordsStateSchema,
        },
      },
      description: "Pulse keywords state",
    },
  },
});

app.openapi(getPulseKeywordsRoute, async (c) => {
  const workspaceSlug = resolveResearchWorkspaceSlug(c);
  const state = await getPulseKeywordsState(workspaceSlug);
  return c.json({ success: true as const, ...state }, 200);
});

const putPulseKeywordsRoute = createRoute({
  method: "put",
  path: "/api/research/pulse/keywords",
  tags: ["research"],
  summary: "Upsert workspace research pulse keyword overlay",
  request: {
    body: {
      content: {
        "application/json": {
          schema: z.object({
            enabled: z.array(z.string()).optional(),
            excluded: z.array(z.string()).optional(),
            custom: z.array(z.string()).optional(),
          }),
        },
      },
    },
  },
  responses: {
    200: {
      content: {
        "application/json": {
          schema: PulseKeywordsStateSchema,
        },
      },
      description: "Updated pulse keywords state",
    },
    400: {
      content: {
        "application/json": {
          schema: z.object({
            success: z.literal(false),
            error: z.string(),
          }),
        },
      },
      description: "Validation error",
    },
  },
});

app.openapi(putPulseKeywordsRoute, async (c) => {
  const workspaceSlug = resolveResearchWorkspaceSlug(c);
  const body = c.req.valid("json");
  try {
    const state = await putPulseKeywords(workspaceSlug, body);
    return c.json({ success: true as const, ...state }, 200);
  } catch (error) {
    if (error instanceof PulseKeywordsValidationError) {
      return c.json({ success: false as const, error: error.message }, 400);
    }
    throw error;
  }
});

const getPulseRoute = createRoute({
  method: "get",
  path: "/api/research/pulse",
  tags: ["research"],
  summary: "Keyword-filtered research pulse (市场动态) feed",
  request: {
    query: z.object({
      limit: z.coerce.number().optional(),
      all: z.string().optional(),
    }),
  },
  responses: {
    200: {
      content: {
        "application/json": {
          schema: z.object({
            success: z.literal(true),
            items: z.array(
              z.object({
                title: z.string(),
                platform: z.string(),
                url: z.string().optional(),
                capturedAt: z.number(),
                matchedKeywords: z.array(z.string()),
                resolvedCompanies: z
                  .array(
                    z.object({
                      companyKey: z.string(),
                      nameCn: z.string(),
                      nameEn: z.string().optional(),
                    }),
                  )
                  .optional(),
              }),
            ),
            meta: z.object({
              filtered: z.boolean(),
              effectiveKeywords: z.array(z.string()),
              rawCount: z.number(),
              matchedCount: z.number(),
              keywordHits: z.array(
                z.object({
                  keyword: z.string(),
                  hitCount: z.number(),
                  sampleTitles: z.array(z.string()),
                }),
              ),
            }),
          }),
        },
      },
      description: "Filtered or unfiltered pulse items",
    },
  },
});

app.openapi(getPulseRoute, async (c) => {
  const workspaceSlug = resolveResearchWorkspaceSlug(c);
  const query = c.req.valid("query");
  const allRaw = (query.all ?? "").toLowerCase();
  const all = allRaw === "1" || allRaw === "true" || allRaw === "yes" || allRaw === "on";
  const result = await getResearchPulse(workspaceSlug, {
    limit: query.limit,
    all,
  });
  return c.json({ success: true as const, ...result }, 200);
});

const HotlistPlatformSchema = z.object({
  id: z.string(),
  name: z.string(),
  expectedDomain: z.string().optional(),
});

const HotlistPlatformGroupSchema = z.object({
  id: z.string(),
  label: z.string(),
  platforms: z.array(HotlistPlatformSchema),
});

const HotlistPlatformsWorkspaceSchema = z.object({
  version: z.literal(1),
  enabled: z.array(z.string()),
  excluded: z.array(z.string()),
});

const HotlistPlatformsStateSchema = z.object({
  success: z.literal(true),
  seed: z.object({
    version: z.string(),
    groups: z.array(HotlistPlatformGroupSchema),
    defaults: z.array(z.string()),
    catalogIds: z.array(z.string()),
  }),
  workspace: HotlistPlatformsWorkspaceSchema,
  effective: z.array(z.string()),
});

const getHotlistPlatformsRoute = createRoute({
  method: "get",
  path: "/api/research/platforms",
  tags: ["research"],
  summary: "Get research hotlist platform catalog, workspace overlay, and effective ingest set",
  responses: {
    200: {
      content: {
        "application/json": {
          schema: HotlistPlatformsStateSchema,
        },
      },
      description: "Hotlist platforms state",
    },
  },
});

app.openapi(getHotlistPlatformsRoute, async (c) => {
  const workspaceSlug = resolveResearchWorkspaceSlug(c);
  const state = await getHotlistPlatformsState(workspaceSlug);
  return c.json({ success: true as const, ...state }, 200);
});

const putHotlistPlatformsRoute = createRoute({
  method: "put",
  path: "/api/research/platforms",
  tags: ["research"],
  summary: "Upsert workspace research hotlist platform overlay (ingest set)",
  request: {
    body: {
      content: {
        "application/json": {
          schema: z.object({
            enabled: z.array(z.string()).optional(),
            excluded: z.array(z.string()).optional(),
          }),
        },
      },
    },
  },
  responses: {
    200: {
      content: {
        "application/json": {
          schema: HotlistPlatformsStateSchema,
        },
      },
      description: "Updated hotlist platforms state",
    },
    400: {
      content: {
        "application/json": {
          schema: z.object({
            success: z.literal(false),
            error: z.string(),
          }),
        },
      },
      description: "Validation error",
    },
  },
});

app.openapi(putHotlistPlatformsRoute, async (c) => {
  const workspaceSlug = resolveResearchWorkspaceSlug(c);
  const body = c.req.valid("json");
  try {
    const state = await putHotlistPlatforms(workspaceSlug, body);
    return c.json({ success: true as const, ...state }, 200);
  } catch (error) {
    if (error instanceof HotlistPlatformsValidationError) {
      return c.json({ success: false as const, error: error.message }, 400);
    }
    throw error;
  }
});

export default app;
