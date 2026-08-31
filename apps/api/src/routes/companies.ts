import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";

import {
  getAdminAccessError,
  getAuthenticatedActorId,
  requireWorkspaceUser,
} from "../middleware/auth.js";
import {
  addCompanyAlias,
  appendMarketPolicy,
  appendWorkspacePolicy,
  listCompanies,
  listMarketPolicies,
  listWorkspacePolicies,
  seedCanonicalCompanies,
  setCompanyArchived,
  upsertCompany,
} from "../services/company-policy-service.js";

const app = new OpenAPIHono();

app.use("/api/companies", async (c, next) => {
  if (["GET", "POST"].includes(c.req.method)) {
    return requireWorkspaceUser(c, next);
  }
  await next();
});
app.use("/api/companies/*", async (c, next) => {
  if (["GET", "POST"].includes(c.req.method)) {
    return requireWorkspaceUser(c, next);
  }
  await next();
});
app.use("/api/company-policies", async (c, next) => {
  if (["GET", "POST"].includes(c.req.method)) {
    return requireWorkspaceUser(c, next);
  }
  await next();
});

const CompanySchema = z.object({
  _id: z.string(),
  companyKey: z.string(),
  status: z.string(),
  displayName: z.string(),
  nameCn: z.string().optional(),
  nameEn: z.string().optional(),
  mergedIntoCompanyKey: z.string().optional(),
  createdAt: z.number(),
  updatedAt: z.number(),
  createdBy: z.string().optional(),
  archivedAt: z.number().optional(),
  aliases: z.array(
    z.object({
      aliasDisplay: z.string(),
      aliasNormalized: z.string(),
      source: z.string(),
    }),
  ),
});

const PolicySchema = z.object({
  companyKey: z.string(),
  displayName: z.string(),
  nameCn: z.string().optional(),
  nameEn: z.string().optional(),
  status: z.string(),
  scopeType: z.string(),
  scopeId: z.string(),
  revision: z.number(),
  effects: z
    .object({
      visibility: z.string().optional(),
      workflow: z.string().optional(),
      rankingEffect: z.string().optional(),
      reasonCodes: z.array(z.string()).optional(),
      summary: z.string().optional(),
    })
    .nullable(),
  createdAt: z.number(),
  createdBy: z.string().optional(),
});

const MarketScopeEnum = z.enum(["cn", "my", "th"]);
const PolicyErrorResponseSchema = z.object({
  success: z.literal(false),
  error: z.string(),
});

const listCompaniesRoute = createRoute({
  method: "get",
  path: "/api/companies",
  tags: ["companies"],
  summary: "List company registry entries (archived companies hidden unless includeArchived=true)",
  request: {
    query: z.object({
      includeArchived: z.enum(["true", "false"]).optional(),
    }),
  },
  responses: {
    200: {
      content: {
        "application/json": {
          schema: z.object({
            success: z.literal(true),
            items: z.array(CompanySchema),
          }),
        },
      },
      description: "Company registry list",
    },
  },
});

app.openapi(listCompaniesRoute, async (c) => {
  const { includeArchived } = c.req.valid("query");
  const items = await listCompanies({ includeArchived: includeArchived === "true" });
  return c.json({ success: true as const, items }, 200);
});

const upsertCompanyRoute = createRoute({
  method: "post",
  path: "/api/companies",
  tags: ["companies"],
  summary: "Create or update a company registry entry",
  request: {
    body: {
      content: {
        "application/json": {
          schema: z.object({
            companyKey: z.string().min(1),
            displayName: z.string().min(1),
            nameCn: z.string().optional(),
            nameEn: z.string().optional(),
            status: z.enum(["provisional", "confirmed", "merged"]).optional(),
          }),
        },
      },
    },
  },
  responses: {
    200: {
      content: {
        "application/json": {
          schema: z.object({
            success: z.literal(true),
            companyKey: z.string(),
            created: z.boolean(),
          }),
        },
      },
      description: "Company upserted",
    },
  },
});

app.openapi(upsertCompanyRoute, async (c) => {
  const body = c.req.valid("json");
  const actorId = getAuthenticatedActorId(c);
  const result = await upsertCompany({ ...body, createdBy: actorId });
  return c.json({ success: true as const, ...result }, 200);
});

const addAliasRoute = createRoute({
  method: "post",
  path: "/api/companies/aliases",
  tags: ["companies"],
  summary: "Add an alias to a company",
  request: {
    body: {
      content: {
        "application/json": {
          schema: z.object({
            companyKey: z.string().min(1),
            alias: z.string().min(1),
          }),
        },
      },
    },
  },
  responses: {
    200: {
      content: {
        "application/json": {
          schema: z.object({
            success: z.literal(true),
            created: z.boolean(),
          }),
        },
      },
      description: "Alias added",
    },
  },
});

app.openapi(addAliasRoute, async (c) => {
  const body = c.req.valid("json");
  const result = await addCompanyAlias({
    companyKey: body.companyKey,
    alias: body.alias,
    source: "operator",
  });
  return c.json({ success: true as const, created: result.created }, 200);
});

const seedRoute = createRoute({
  method: "post",
  path: "/api/companies/seed",
  tags: ["companies"],
  summary:
    "Seed canonical companies (Pro-Technic, Polywell) and optional workspace no-hire policies for both",
  request: {
    body: {
      content: {
        "application/json": {
          schema: z.object({
            seedNoHireForWorkspace: z.boolean().optional(),
            /** @deprecated Alias for seedNoHireForWorkspace */
            seedKnownGoodForWorkspace: z.boolean().optional(),
          }),
        },
      },
    },
  },
  responses: {
    200: {
      content: {
        "application/json": {
          schema: z.object({
            success: z.literal(true),
            companiesCreated: z.number(),
            companiesUpdated: z.number(),
            aliasesCreated: z.number(),
            policiesSeeded: z.number(),
            policyRevision: z.number().nullable(),
          }),
        },
      },
      description: "Seed result",
    },
  },
});

app.openapi(seedRoute, async (c) => {
  const body = c.req.valid("json");
  const actorId = getAuthenticatedActorId(c);
  const result = await seedCanonicalCompanies({
    workspaceSlug: c.var.workspaceSlug,
    seedNoHireForWorkspace:
      body.seedNoHireForWorkspace === true || body.seedKnownGoodForWorkspace === true,
    createdBy: actorId,
  });
  return c.json({ success: true as const, ...result }, 200);
});

const archiveCompanyRoute = createRoute({
  method: "post",
  path: "/api/companies/:companyKey/archive",
  tags: ["companies"],
  summary:
    "Archive (soft delete) or restore a company registry entry; archived companies are hidden from the default list and stop matching resume policies",
  request: {
    params: z.object({ companyKey: z.string().min(1) }),
    body: {
      content: {
        "application/json": {
          schema: z.object({ archived: z.boolean() }),
        },
      },
    },
  },
  responses: {
    200: {
      content: {
        "application/json": {
          schema: z.object({
            success: z.literal(true),
            companyKey: z.string(),
            archived: z.boolean(),
            archivedAt: z.number().nullable(),
          }),
        },
      },
      description: "Archive state updated",
    },
  },
});

app.openapi(archiveCompanyRoute, async (c) => {
  const { companyKey } = c.req.valid("param");
  const { archived } = c.req.valid("json");
  const actorId = getAuthenticatedActorId(c);
  const result = await setCompanyArchived({ companyKey, archived, createdBy: actorId });
  return c.json({ success: true as const, ...result }, 200);
});

const listPoliciesRoute = createRoute({
  method: "get",
  path: "/api/company-policies",
  tags: ["companies"],
  summary: "List effective workspace or market company policies",
  request: {
    query: z.object({
      market: MarketScopeEnum.optional(),
    }),
  },
  responses: {
    200: {
      content: {
        "application/json": {
          schema: z.object({ success: z.literal(true), items: z.array(PolicySchema) }),
        },
      },
      description: "Company policies for the requested scope",
    },
    401: {
      content: {
        "application/json": { schema: PolicyErrorResponseSchema },
      },
      description: "Authentication required",
    },
    403: {
      content: {
        "application/json": { schema: PolicyErrorResponseSchema },
      },
      description: "Admin access required for market scope",
    },
  },
});

app.openapi(listPoliciesRoute, async (c) => {
  const { market } = c.req.valid("query");
  if (market) {
    const adminError = getAdminAccessError(c);
    if (adminError) {
      return c.json(adminError.body, adminError.status);
    }
  }
  const items = market
    ? await listMarketPolicies(market)
    : await listWorkspacePolicies(c.var.workspaceSlug);
  return c.json({ success: true as const, items }, 200);
});

const appendPolicyRoute = createRoute({
  method: "post",
  path: "/api/company-policies",
  tags: ["companies"],
  summary: "Append a workspace or market company policy revision",
  request: {
    body: {
      content: {
        "application/json": {
          schema: z.object({
            companyKey: z.string().min(1),
            market: MarketScopeEnum.optional(),
            preset: z.enum(["known_good", "no_hire", "none"]).optional(),
            visibility: z.enum(["default", "hide"]).optional(),
            workflow: z.enum(["default", "blocked"]).optional(),
            rankingEffect: z
              .enum(["none", "band_known_good", "band_known_bad", "boost", "demote"])
              .optional(),
            reasonCodes: z.array(z.string()).optional(),
            summary: z.string().optional(),
          }),
        },
      },
    },
  },
  responses: {
    200: {
      content: {
        "application/json": {
          schema: z.object({ success: z.literal(true), revision: z.number() }),
        },
      },
      description: "Policy revision appended",
    },
    401: {
      content: {
        "application/json": { schema: PolicyErrorResponseSchema },
      },
      description: "Authentication required",
    },
    403: {
      content: {
        "application/json": { schema: PolicyErrorResponseSchema },
      },
      description: "Admin access required for market scope",
    },
  },
});

app.openapi(appendPolicyRoute, async (c) => {
  const body = c.req.valid("json");
  if (body.market) {
    const adminError = getAdminAccessError(c);
    if (adminError) {
      return c.json(adminError.body, adminError.status);
    }
  }
  const actorId = getAuthenticatedActorId(c);
  const result = body.market
    ? await appendMarketPolicy({
        companyKey: body.companyKey,
        market: body.market,
        createdBy: actorId,
        preset: body.preset,
        visibility: body.visibility,
        workflow: body.workflow,
        rankingEffect: body.rankingEffect,
        reasonCodes: body.reasonCodes,
        summary: body.summary,
      })
    : await appendWorkspacePolicy({
        companyKey: body.companyKey,
        workspaceSlug: c.var.workspaceSlug,
        createdBy: actorId,
        preset: body.preset,
        visibility: body.visibility,
        workflow: body.workflow,
        rankingEffect: body.rankingEffect,
        reasonCodes: body.reasonCodes,
        summary: body.summary,
      });
  return c.json({ success: true as const, revision: result.revision }, 200);
});

export default app;
