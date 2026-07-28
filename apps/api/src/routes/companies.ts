import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";

import { getAuthenticatedActorId, requireWorkspaceUser } from "../middleware/auth.js";
import {
  addCompanyAlias,
  appendWorkspacePolicy,
  listCompanies,
  listWorkspacePolicies,
  seedCanonicalCompanies,
  upsertCompany,
} from "../services/company-policy-service.js";
import {
  deleteIndustryProfile,
  listIndustryProfiles,
  upsertIndustryProfile,
} from "../services/company-industry-profile-service.js";

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
app.use("/api/company-industry-profiles", async (c, next) => {
  if (["GET", "POST"].includes(c.req.method)) {
    return requireWorkspaceUser(c, next);
  }
  await next();
});
app.use("/api/company-industry-profiles/*", async (c, next) => {
  if (["GET", "POST", "DELETE"].includes(c.req.method)) {
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

const listCompaniesRoute = createRoute({
  method: "get",
  path: "/api/companies",
  tags: ["companies"],
  summary: "List company registry entries",
  responses: {
    200: {
      content: {
        "application/json": {
          schema: z.object({ success: z.literal(true), items: z.array(CompanySchema) }),
        },
      },
      description: "Company registry list",
    },
  },
});

app.openapi(listCompaniesRoute, async (c) => {
  const items = await listCompanies();
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
  const result = await upsertCompany({
    companyKey: body.companyKey,
    displayName: body.displayName,
    nameCn: body.nameCn,
    nameEn: body.nameEn,
    status: body.status,
    createdBy: actorId,
  });
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
          schema: z.object({ success: z.literal(true), created: z.boolean() }),
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

const listPoliciesRoute = createRoute({
  method: "get",
  path: "/api/company-policies",
  tags: ["companies"],
  summary: "List effective workspace company policies",
  responses: {
    200: {
      content: {
        "application/json": {
          schema: z.object({ success: z.literal(true), items: z.array(PolicySchema) }),
        },
      },
      description: "Workspace company policies",
    },
  },
});

app.openapi(listPoliciesRoute, async (c) => {
  const items = await listWorkspacePolicies(c.var.workspaceSlug);
  return c.json({ success: true as const, items }, 200);
});

const appendPolicyRoute = createRoute({
  method: "post",
  path: "/api/company-policies",
  tags: ["companies"],
  summary: "Append a workspace company policy revision",
  request: {
    body: {
      content: {
        "application/json": {
          schema: z.object({
            companyKey: z.string().min(1),
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
  },
});

app.openapi(appendPolicyRoute, async (c) => {
  const body = c.req.valid("json");
  const actorId = getAuthenticatedActorId(c);
  const result = await appendWorkspacePolicy({
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

// ---------------------------------------------------------------------------
// Company industry profiles (reviewed catalog)
// ---------------------------------------------------------------------------

const IndustryClassEnum = z.enum([
  "cnc", "automation", "metrology", "industrial", "non_industry", "unknown",
]);
const VerificationLevelEnum = z.enum(["verified", "candidate", "rejected"]);
const EvidenceSourceEnum = z.enum(["seed", "manual", "worker_web"]);

const IndustryProfileSchema = z.object({
  _id: z.string(),
  companyKey: z.string(),
  industryClass: IndustryClassEnum,
  verificationLevel: VerificationLevelEnum,
  officialDomain: z.string().optional(),
  evidenceSource: EvidenceSourceEnum,
  summary: z.string().optional(),
  sourceUrl: z.string().optional(),
  sourceDomain: z.string().optional(),
  sourceType: z.string().optional(),
  msicCode: z.string().optional(),
  msicDescription: z.string().optional(),
  fetchedAt: z.number().optional(),
  updatedAt: z.number(),
  updatedBy: z.string().optional(),
});

const listIndustryProfilesRoute = createRoute({
  method: "get",
  path: "/api/company-industry-profiles",
  tags: ["companies"],
  summary: "List reviewed company-industry profiles",
  request: {
    query: z.object({
      verificationLevel: VerificationLevelEnum.optional(),
    }),
  },
  responses: {
    200: {
      content: {
        "application/json": {
          schema: z.object({ success: z.literal(true), items: z.array(IndustryProfileSchema) }),
        },
      },
      description: "Reviewed company-industry profiles",
    },
  },
});

app.openapi(listIndustryProfilesRoute, async (c) => {
  const { verificationLevel } = c.req.valid("query");
  const items = await listIndustryProfiles(verificationLevel);
  return c.json({ success: true as const, items }, 200);
});

const upsertIndustryProfileRoute = createRoute({
  method: "post",
  path: "/api/company-industry-profiles",
  tags: ["companies"],
  summary: "Create or update a reviewed company-industry profile",
  request: {
    body: {
      content: {
        "application/json": {
          schema: z.object({
            companyKey: z.string().min(1),
            industryClass: IndustryClassEnum,
            verificationLevel: VerificationLevelEnum,
            officialDomain: z.string().optional(),
            evidenceSource: EvidenceSourceEnum.optional(),
            summary: z.string().optional(),
            sourceUrl: z.string().optional(),
            sourceDomain: z.string().optional(),
            sourceType: z.string().optional(),
            msicCode: z.string().optional(),
            msicDescription: z.string().optional(),
            fetchedAt: z.number().optional(),
          }),
        },
      },
    },
  },
  responses: {
    200: {
      content: {
        "application/json": {
          schema: z.object({ success: z.literal(true), companyKey: z.string(), created: z.boolean() }),
        },
      },
      description: "Profile upserted",
    },
  },
});

app.openapi(upsertIndustryProfileRoute, async (c) => {
  const body = c.req.valid("json");
  const actorId = getAuthenticatedActorId(c);
  const result = await upsertIndustryProfile({
    ...body,
    updatedBy: actorId,
  });
  return c.json({ success: true as const, ...result }, 200);
});

const deleteIndustryProfileRoute = createRoute({
  method: "delete",
  path: "/api/company-industry-profiles/:companyKey",
  tags: ["companies"],
  summary: "Delete a reviewed company-industry profile",
  request: {
    params: z.object({ companyKey: z.string() }),
  },
  responses: {
    200: {
      content: {
        "application/json": {
          schema: z.object({ success: z.literal(true), deleted: z.number() }),
        },
      },
      description: "Profile deleted",
    },
  },
});

app.openapi(deleteIndustryProfileRoute, async (c) => {
  const { companyKey } = c.req.valid("param");
  const result = await deleteIndustryProfile(companyKey);
  return c.json({ success: true as const, ...result }, 200);
});

export default app;
