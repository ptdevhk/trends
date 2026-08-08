import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import {
  INDUSTRY_CLASSES,
  INDUSTRY_EVIDENCE_RESEARCH_ORIGINS,
  INDUSTRY_EVIDENCE_FRESHNESS_STATES,
  INDUSTRY_EVIDENCE_SOURCE_TYPES,
  INDUSTRY_EVIDENCE_TRUST_TIERS,
  INDUSTRY_MAINTENANCE_TRIGGER_REASONS,
  INDUSTRY_PROPOSAL_STATUSES,
  INDUSTRY_REVIEW_ACTIONS,
  INDUSTRY_REVIEW_CONFIDENCE_BANDS,
  INDUSTRY_REVIEW_RISK_FLAGS,
  INDUSTRY_REVIEW_SCHEMA_VERSION,
  INDUSTRY_REVIEW_SOURCE_REASON_CODES,
  INDUSTRY_VERIFICATION_LEVELS,
  validateIndustryReviewAttestation,
  type IndustryReviewAttestation,
} from "@trends/shared";

import {
  getAuthenticatedActorId,
  requireAdmin,
  requireWorkspaceUser,
} from "../middleware/auth.js";
import {
  addCompanyAlias,
  appendWorkspacePolicy,
  listCompanies,
  listWorkspacePolicies,
  seedCanonicalCompanies,
  setCompanyArchived,
  upsertCompany,
} from "../services/company-policy-service.js";
import {
  deleteIndustryProfile,
  listIndustryProfiles,
  upsertIndustryProfile,
} from "../services/company-industry-profile-service.js";
import {
  listIndustryEvidenceSources,
  upsertIndustryEvidenceSource,
} from "../services/company-industry-evidence-service.js";
import {
  approveIndustryProposalAndStartRecompute,
  getIndustryProposal,
  listIndustryProposals,
  listIndustryProposalsPage,
  resolveIndustryProposal,
  undoIndustryProposalApproval,
  upsertIndustryProposal,
} from "../services/company-industry-proposal-service.js";
import { companyIndustryRecomputeService } from "../services/company-industry-recompute-service.js";
import {
  getCompanyIndustryEvidenceBundle,
  listIndustryVerdictRevisions,
} from "../services/company-industry-revision-service.js";
import { requestCompanyIndustryEvidenceRefresh } from "../services/company-industry-refresh-request-service.js";
import { getIndustryCoverageSummary } from "../services/company-industry-coverage-service.js";
import { enqueueIndustryMaintenance } from "../services/industry-maintenance-pipeline-service.js";
import {
  cancelIndustryEvidenceResearch,
  enqueueIndustryEvidenceResearch,
  getIndustryEvidenceResearchSummary,
  IndustryEvidenceResearchError,
  listIndustryIdentityCandidates,
  resolveIndustryProposalIdentity,
  retryIndustryEvidenceResearch,
} from "../services/industry-evidence-research-service.js";
import { callConvexQuery } from "../services/convex-utils.js";
import { config } from "../services/config.js";
import type { IndustryReviewPacket } from "../services/company-industry-review-service.js";
import {
  INDUSTRY_REVIEW_STALE_CODE,
  industryReviewStaleReason,
  isIndustryReviewStaleError,
  IndustryReviewStaleError,
} from "../services/company-industry-review-errors.js";

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
app.use("/api/company-industry-proposals", requireAdmin);
app.use("/api/company-industry-proposals/*", requireAdmin);
app.use("/api/company-industry-evidence-sources", requireAdmin);
app.use("/api/company-industry-evidence-sources/*", requireAdmin);
app.use("/api/company-industry-revisions/*", requireAdmin);
app.use("/api/company-industry-recompute-runs", requireAdmin);
app.use("/api/company-industry-recompute-runs/*", requireAdmin);
app.use("/api/company-industry-maintenance-runs", requireAdmin);
app.use("/api/company-industry-maintenance-runs/*", requireAdmin);
app.use("/api/company-industry-coverage", requireAdmin);
app.use("/api/company-industry-bundles/*", requireWorkspaceUser);
app.use("/api/company-industry-refresh-requests", requireWorkspaceUser);

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
          schema: z.object({ success: z.literal(true), items: z.array(CompanySchema) }),
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

const IndustryClassEnum = z.enum(INDUSTRY_CLASSES);
const VerificationLevelEnum = z.enum(INDUSTRY_VERIFICATION_LEVELS);
const EvidenceSourceEnum = z.enum(["seed", "manual", "worker_web"]);
const EvidenceSourceTypeEnum = z.enum(INDUSTRY_EVIDENCE_SOURCE_TYPES);
const EvidenceTrustTierEnum = z.enum(INDUSTRY_EVIDENCE_TRUST_TIERS);
const ProposalStatusEnum = z.enum(INDUSTRY_PROPOSAL_STATUSES);
const MaintenanceTriggerEnum = z.enum(INDUSTRY_MAINTENANCE_TRIGGER_REASONS);
const IndustryReviewAttestationSchema = z.object({
  schemaVersion: z.literal("industry-review-attestation.v1"),
  inputFingerprint: z.string().min(1),
  decisionMode: z.enum(["standard", "risk_override"]),
  acknowledgedRiskFlags: z.array(z.enum(INDUSTRY_REVIEW_RISK_FLAGS)),
  cncEvidenceAcknowledged: z.boolean(),
  acknowledgementReason: z.string(),
});

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
  currentRevisionId: z.string().optional(),
  reviewedAt: z.number().optional(),
  reviewedBy: z.string().optional(),
  sourceCount: z.number().optional(),
  freshnessState: z.enum(INDUSTRY_EVIDENCE_FRESHNESS_STATES).optional(),
  nextReviewAt: z.number().optional(),
  catalogVersion: z.number().optional(),
  compatibilityState: z
    .enum(["legacy_seed", "reviewed", "strict_reviewed"])
    .optional(),
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

// ---------------------------------------------------------------------------
// Governed industry evidence stewardship
// ---------------------------------------------------------------------------

const IndustryProposalSchema = z.object({
  _id: z.string(),
  proposalId: z.string(),
  companyKey: z.string().optional(),
  normalizedEmployerSurface: z.string().optional(),
  triggerReasons: z.array(MaintenanceTriggerEnum),
  priority: z.number(),
  sampleReferences: z
    .array(
      z.object({
        workspaceSlug: z.string(),
        resumeIdentity: z.string(),
        workEntryFingerprint: z.string().optional(),
      }),
    )
    .optional(),
  currentRevisionId: z.string().optional(),
  suggestedIndustryClass: IndustryClassEnum.optional(),
  suggestedVerificationLevel: VerificationLevelEnum.optional(),
  materialChangeSummary: z.string().optional(),
  status: ProposalStatusEnum,
  requestedBy: z.string().optional(),
  researchStartedAt: z.number().optional(),
  readyForReviewAt: z.number().optional(),
  reviewedAt: z.number().optional(),
  reviewedBy: z.string().optional(),
  reviewNote: z.string().optional(),
  createdAt: z.number(),
  updatedAt: z.number(),
});

const IndustryEvidenceSourceSchema = z.object({
  _id: z.string(),
  sourceId: z.string(),
  companyKey: z.string().optional(),
  proposalId: z.string().optional(),
  url: z.string().url(),
  sourceDomain: z.string(),
  sourceType: EvidenceSourceTypeEnum,
  trustTier: EvidenceTrustTierEnum,
  title: z.string().optional(),
  evidenceExcerpt: z.string().optional(),
  fetchedAt: z.number().optional(),
  lastSuccessfulFetchAt: z.number().optional(),
  contentFingerprint: z.string().optional(),
  fetchStatus: z.enum(["pending", "fetched", "failed", "unavailable"]),
  suggestedIndustryClass: IndustryClassEnum.optional(),
  workerConfidence: z.number().optional(),
  reviewStatus: z.enum(["unreviewed", "approved", "rejected", "disputed"]),
  reviewedAt: z.number().optional(),
  reviewedBy: z.string().optional(),
  reviewerNote: z.string().optional(),
  sourceState: z.enum(["active", "superseded", "unavailable", "disputed"]),
  supersededBySourceId: z.string().optional(),
  createdAt: z.number(),
  updatedAt: z.number(),
});

const IndustryVerdictRevisionSchema = z.object({
  _id: z.string(),
  revisionId: z.string(),
  companyKey: z.string(),
  industryClass: IndustryClassEnum,
  verificationLevel: z.enum(["verified", "rejected"]),
  approvedSourceIds: z.array(z.string()),
  evidenceSummary: z.string(),
  reviewedBy: z.string(),
  reviewedAt: z.number(),
  decisionReason: z.string(),
  taxonomyVersion: z.string(),
  ruleVersion: z.string().optional(),
  reviewAttestation: IndustryReviewAttestationSchema.optional(),
  supersedesRevisionId: z.string().optional(),
  proposalId: z.string().optional(),
  createdAt: z.number(),
});

const IndustryRecomputeRunSchema = z.object({
  runId: z.string(),
  workspaceSlug: z.string(),
  companyKey: z.string(),
  targetRevisionId: z.string(),
  proposalId: z.string().optional(),
  requestedBy: z.string().optional(),
  status: z.enum([
    "queued",
    "running",
    "waiting",
    "completed",
    "partial_failed",
    "failed",
    "superseded",
  ]),
  attempt: z.number(),
  cursor: z.string().optional(),
  sourceDone: z.boolean(),
  pageCount: z.number(),
  affectedCount: z.number(),
  alreadyCurrentCount: z.number(),
  scheduledCount: z.number(),
  readyCount: z.number(),
  failureCount: z.number(),
  batchCount: z.number(),
  failures: z.array(
    z.object({
      resumeId: z.string().optional(),
      stage: z.string(),
      message: z.string(),
      occurredAt: z.number(),
    }),
  ),
  lastError: z.string().optional(),
  supersededByRevisionId: z.string().optional(),
  createdAt: z.number(),
  startedAt: z.number().optional(),
  completedAt: z.number().optional(),
  updatedAt: z.number(),
  operatorSummary: z.string(),
});

const listIndustryProposalsRoute = createRoute({
  method: "get",
  path: "/api/company-industry-proposals",
  tags: ["company-industry-evidence"],
  summary: "List governed company-industry review proposals (paginated)",
  request: {
    query: z.object({
      status: ProposalStatusEnum.optional(),
      limit: z.coerce.number().int().min(1).max(100).optional().default(100),
      cursor: z.string().optional(),
    }),
  },
  responses: {
    200: {
      content: {
        "application/json": {
          schema: z.object({
            success: z.literal(true),
            items: z.array(IndustryProposalSchema),
            nextCursor: z.string().optional(),
          }),
        },
      },
      description: "Proposal queue page; pass nextCursor to continue",
    },
  },
});

app.openapi(listIndustryProposalsRoute, async (c) => {
  const { status, limit, cursor } = c.req.valid("query");
  const page = await listIndustryProposalsPage({ status, limit, cursor });
  return c.json(
    {
      success: true as const,
      items: page.items,
      ...(page.nextCursor ? { nextCursor: page.nextCursor } : {}),
    },
    200,
  );
});

const IndustryReviewActionEnum = z.enum(INDUSTRY_REVIEW_ACTIONS);
const IndustryReviewConfidenceEnum = z.enum(INDUSTRY_REVIEW_CONFIDENCE_BANDS);
const IndustryReviewRiskFlagEnum = z.enum(INDUSTRY_REVIEW_RISK_FLAGS);
const IndustryReviewSourceReasonCodeEnum = z.enum(
  INDUSTRY_REVIEW_SOURCE_REASON_CODES,
);
const IndustryReviewWarningSchema = z.object({
  code: z.string(),
  message: z.string(),
  action: z.string().optional(),
});
const IndustryReviewRecommendationSchema = z.object({
  proposalId: z.string(),
  proposalStatus: ProposalStatusEnum,
  recommendedAction: IndustryReviewActionEnum,
  recommendedVerificationLevel: z.enum(["verified", "rejected"]),
  recommendedIndustryClass: IndustryClassEnum,
  recommendedSourceIds: z.array(z.string()),
  sourceDecisions: z.array(
    z.object({
      sourceId: z.string(),
      approvalSafe: z.boolean(),
      recommended: z.boolean(),
      reasonCodes: z.array(IndustryReviewSourceReasonCodeEnum),
    }),
  ),
  confidenceBand: IndustryReviewConfidenceEnum,
  riskFlags: z.array(IndustryReviewRiskFlagEnum),
  reasons: z.array(z.string()),
  excludedSourceReasons: z.record(z.string(), z.string()),
  riskDecision: z.object({
    requiresAcknowledgement: z.boolean(),
    nonOverridableRiskFlags: z.array(IndustryReviewRiskFlagEnum),
    canApproveWithRiskOverride: z.boolean(),
  }),
  evidenceSummaryDraft: z.string(),
  decisionReasonDraft: z.string(),
  requiresHumanReview: z.literal(true),
});
const IndustryReviewMaintenanceRunSchema = z.object({
  runId: z.string(),
  status: z.string().optional(),
  triggerSource: z.string().optional(),
  triggerContext: z.string().optional(),
  operatorSummary: z.string().optional(),
  failureMessage: z.string().optional(),
  partial: z.boolean().optional(),
  startedAt: z.number().optional(),
  finishedAt: z.number().optional(),
  counts: z.object({
    proposalsResearched: z.number(),
    readyCreated: z.number(),
    sourcesDemoted: z.number(),
    freshnessChecked: z.number(),
    freshnessRefreshed: z.number(),
    errors: z.number(),
  }),
});
const IndustryReviewMaintenanceContextSchema = z.object({
  latest: IndustryReviewMaintenanceRunSchema.nullable(),
  lastFailed: IndustryReviewMaintenanceRunSchema.nullable(),
});
const IndustryResearchRequestSummarySchema = z.object({
  requestId: z.string(),
  proposalId: z.string(),
  origin: z.enum(INDUSTRY_EVIDENCE_RESEARCH_ORIGINS),
  state: z.enum([
    "queued",
    "leased",
    "completed",
    "needs_identity_review",
    "needs_more_evidence",
    "retry_wait",
    "failed",
    "cancelled",
  ]),
  priority: z.number(),
  requestedAt: z.number(),
  demandCount: z.number(),
  attemptCount: z.number(),
  nextAttemptAt: z.number().optional(),
  leaseExpiresAt: z.number().optional(),
  lastRunId: z.string().optional(),
  lastOutcome: z.string().optional(),
  lastErrorCode: z.enum([
    "worker_unreachable",
    "timeout",
    "provider_limited",
    "fetch_failed",
    "identity_ambiguous",
    "proposal_terminal",
  ]).optional(),
  updatedAt: z.number(),
  canRetry: z.boolean(),
  canCancel: z.boolean(),
});
const IndustryResearchSummarySchema = z.object({
  featureEnabled: z.boolean(),
  active: IndustryResearchRequestSummarySchema.nullable(),
  history: z.array(IndustryResearchRequestSummarySchema),
});
const IndustryIdentityCandidateSchema = z.object({
  candidateFingerprint: z.string(),
  proposalId: z.string(),
  normalizedLegalName: z.string(),
  jurisdiction: z.string().optional(),
  registrationNumber: z.string().optional(),
  sourceIds: z.array(z.string()),
  confidence: z.number(),
  conflictCodes: z.array(z.string()),
  reviewState: z.enum(["candidate", "reviewed", "rejected", "needs_more_evidence"]),
  extractionVersion: z.string(),
  createdAt: z.number(),
  updatedAt: z.number(),
});
const IndustryReviewEnvelopeFields = {
  success: z.literal(true),
  ok: z.literal(true),
  schemaVersion: z.literal(INDUSTRY_REVIEW_SCHEMA_VERSION),
};

const IndustryReviewConflictSchema = z.object({
  success: z.literal(false),
  error: z.string(),
  code: z.literal(INDUSTRY_REVIEW_STALE_CODE),
});

const IndustryReviewCursorConflictSchema = z.object({
  success: z.literal(false),
  error: z.string(),
  code: z.literal("INDUSTRY_REVIEW_CURSOR_STALE"),
});

function industryReviewConflictResponse(error: unknown) {
  return {
    success: false as const,
    error: industryReviewStaleReason(error),
    code: INDUSTRY_REVIEW_STALE_CODE,
  };
}

const listIndustryReviewQueueRoute = createRoute({
  method: "get",
  path: "/api/company-industry-proposals/review-queue",
  tags: ["company-industry-evidence"],
  summary: "List industry proposals with shared review recommendations",
  request: {
    query: z.object({
      status: ProposalStatusEnum.optional(),
      limit: z.coerce.number().int().min(1).max(100).optional(),
      cursor: z.string().min(1).optional(),
      riskFlag: IndustryReviewRiskFlagEnum.optional(),
      confidenceBand: IndustryReviewConfidenceEnum.optional(),
      recommendedAction: IndustryReviewActionEnum.optional(),
    }),
  },
  responses: {
    200: {
      content: {
        "application/json": {
          schema: z.object({
            ...IndustryReviewEnvelopeFields,
            items: z.array(
              z.object({
                proposal: IndustryProposalSchema,
                recommendation: IndustryReviewRecommendationSchema,
                inputFingerprint: z.string(),
                sourceCount: z.number(),
              }),
            ),
            maintenance: IndustryReviewMaintenanceContextSchema,
            nextCursor: z.string().optional(),
          }),
        },
      },
      description: "Proposal queue with deterministic review recommendations",
    },
    409: {
      content: {
        "application/json": { schema: IndustryReviewCursorConflictSchema },
      },
      description: "Review queue cursor no longer matches the advisory index",
    },
  },
});

app.openapi(listIndustryReviewQueueRoute, async (c) => {
  const { status, limit, cursor, riskFlag, confidenceBand, recommendedAction } =
    c.req.valid("query");
  const { listIndustryReviewQueue } = await import(
    "../services/company-industry-review-service.js"
  );
  try {
    const result = await listIndustryReviewQueue({
      status,
      limit,
      cursor,
      riskFlag,
      confidenceBand,
      recommendedAction,
      workspaceSlug: c.var.workspaceSlug,
    });
    return c.json(result, 200);
  } catch (error) {
    if (
      error instanceof Error &&
      (error.message === "INDUSTRY_REVIEW_CURSOR_STALE" ||
        error.message.startsWith("INDUSTRY_REVIEW_CURSOR_STALE:"))
    ) {
      return c.json(
        {
          success: false as const,
          error: error.message,
          code: "INDUSTRY_REVIEW_CURSOR_STALE" as const,
        },
        409,
      );
    }
    throw error;
  }
});

const getIndustryReviewRecommendationRoute = createRoute({
  method: "get",
  path: "/api/company-industry-proposals/:proposalId/recommendation",
  tags: ["company-industry-evidence"],
  summary: "Get a recommendation-only industry review projection",
  request: { params: z.object({ proposalId: z.string().min(1) }) },
  responses: {
    200: {
      content: {
        "application/json": {
          schema: z.object({
            ...IndustryReviewEnvelopeFields,
            operation: z.object({
              id: z.string(),
              kind: z.literal("recommendation"),
              state: z.literal("computed"),
            }),
            dataset: z.object({
              revision: z.string(),
              inputFingerprint: z.string(),
              generatedAt: z.number(),
              proposalUpdatedAt: z.number(),
              sourceVersions: z.array(
                z.object({ sourceId: z.string(), updatedAt: z.number() }),
              ),
              gitSha: z.string().optional(),
            }),
            recommendation: IndustryReviewRecommendationSchema,
            warnings: z.array(IndustryReviewWarningSchema),
          }),
        },
      },
      description: "Recommendation-only review projection",
    },
    404: {
      content: {
        "application/json": {
          schema: z.object({ success: z.literal(false), error: z.string() }),
        },
      },
      description: "Proposal not found",
    },
  },
});

app.openapi(getIndustryReviewRecommendationRoute, async (c) => {
  const { proposalId } = c.req.valid("param");
  const { getIndustryReviewRecommendation } = await import(
    "../services/company-industry-review-service.js"
  );
  const recommendation = await getIndustryReviewRecommendation(
    proposalId,
    c.var.workspaceSlug,
  );
  if (!recommendation) {
    return c.json({ success: false as const, error: "Industry proposal not found" }, 404);
  }
  return c.json(recommendation, 200);
});

const getIndustryReviewPacketRoute = createRoute({
  method: "get",
  path: "/api/company-industry-proposals/:proposalId/review-packet",
  tags: ["company-industry-evidence"],
  summary: "Get a proposal, evidence, and shared review recommendation packet",
  request: { params: z.object({ proposalId: z.string().min(1) }) },
  responses: {
    200: {
      content: {
        "application/json": {
          schema: z.object({
            ...IndustryReviewEnvelopeFields,
            operation: z.object({
              id: z.string(),
              kind: z.literal("recommendation"),
              state: z.literal("computed"),
            }),
            dataset: z.object({
              revision: z.string(),
              inputFingerprint: z.string(),
              generatedAt: z.number(),
              proposalUpdatedAt: z.number(),
              sourceVersions: z.array(
                z.object({ sourceId: z.string(), updatedAt: z.number() }),
              ),
              gitSha: z.string().optional(),
            }),
            recommendation: IndustryReviewRecommendationSchema,
            warnings: z.array(IndustryReviewWarningSchema),
            proposal: IndustryProposalSchema,
            sources: z.array(IndustryEvidenceSourceSchema),
            reviewContext: z.object({
              profile: IndustryProfileSchema.nullable(),
              revisions: z.array(IndustryVerdictRevisionSchema),
            }),
            recomputeRuns: z.array(IndustryRecomputeRunSchema),
            maintenance: IndustryReviewMaintenanceContextSchema,
            research: IndustryResearchSummarySchema,
            identityCandidates: z.array(IndustryIdentityCandidateSchema),
          }),
        },
      },
      description: "Review packet with proposal revision and input fingerprint",
    },
    404: {
      content: {
        "application/json": {
          schema: z.object({ success: z.literal(false), error: z.string() }),
        },
      },
      description: "Proposal not found",
    },
  },
});

app.openapi(getIndustryReviewPacketRoute, async (c) => {
  const { proposalId } = c.req.valid("param");
  const { getIndustryReviewPacket } = await import(
    "../services/company-industry-review-service.js"
  );
  const packet = await getIndustryReviewPacket(proposalId, c.var.workspaceSlug);
  if (!packet) {
    return c.json({ success: false as const, error: "Industry proposal not found" }, 404);
  }
  return c.json(packet, 200);
});

const enqueueIndustryResearchRequestRoute = createRoute({
  method: "post",
  path: "/api/company-industry-proposals/:proposalId/research-requests",
  tags: ["company-industry-evidence"],
  summary: "Queue exact industry evidence research for one proposal",
  request: {
    params: z.object({ proposalId: z.string().min(1) }),
    body: {
      content: {
        "application/json": {
          schema: z.object({
            origin: z.enum(INDUSTRY_EVIDENCE_RESEARCH_ORIGINS).default("admin_review"),
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
            request: IndustryResearchRequestSummarySchema,
            disposition: z.enum(["created", "already_queued", "reprioritized"]),
            dispatch: z.object({ runId: z.string().nullable(), coalesced: z.boolean() }),
          }),
        },
      },
      description: "Research request queued or coalesced",
    },
    409: {
      content: {
        "application/json": {
          schema: z.object({ success: z.literal(false), code: z.string(), error: z.string() }),
        },
      },
      description: "Feature disabled or proposal is not requestable",
    },
    404: {
      content: {
        "application/json": {
          schema: z.object({ success: z.literal(false), code: z.string(), error: z.string() }),
        },
      },
      description: "Proposal was not found",
    },
  },
});

app.openapi(enqueueIndustryResearchRequestRoute, async (c) => {
  const { proposalId } = c.req.valid("param");
  const body = c.req.valid("json");
  try {
    const result = await enqueueIndustryEvidenceResearch({
      workspaceSlug: c.var.workspaceSlug,
      proposalId,
      origin: body.origin,
      requestedBy: getAuthenticatedActorId(c),
    });
    return c.json({ success: true as const, ...result }, 200);
  } catch (error) {
    if (error instanceof IndustryEvidenceResearchError) {
      return c.json({ success: false as const, code: error.code, error: error.message }, error.status as 404 | 409);
    }
    throw error;
  }
});

const listIndustryResearchRequestsRoute = createRoute({
  method: "get",
  path: "/api/company-industry-proposals/:proposalId/research-requests",
  tags: ["company-industry-evidence"],
  summary: "Read exact industry evidence research progress",
  request: {
    params: z.object({ proposalId: z.string().min(1) }),
    query: z.object({ limit: z.coerce.number().int().min(1).max(20).optional() }),
  },
  responses: {
    200: {
      content: {
        "application/json": {
          schema: z.object({ success: z.literal(true), item: IndustryResearchSummarySchema }),
        },
      },
      description: "Current-workspace research request summary",
    },
  },
});

app.openapi(listIndustryResearchRequestsRoute, async (c) => {
  const { proposalId } = c.req.valid("param");
  const { limit } = c.req.valid("query");
  const item = await getIndustryEvidenceResearchSummary({
    workspaceSlug: c.var.workspaceSlug,
    proposalId,
    limit,
  });
  return c.json({ success: true as const, item }, 200);
});

const retryIndustryResearchRequestRoute = createRoute({
  method: "post",
  path: "/api/company-industry-proposals/:proposalId/research-requests/:requestId/retry",
  tags: ["company-industry-evidence"],
  summary: "Retry one failed industry evidence research request",
  request: { params: z.object({ proposalId: z.string().min(1), requestId: z.string().min(1) }) },
  responses: {
    200: {
      content: { "application/json": { schema: z.object({ success: z.literal(true) }) } },
      description: "Request returned to the queue",
    },
    404: {
      content: { "application/json": { schema: z.object({ success: z.literal(false), code: z.string(), error: z.string() }) } },
      description: "Request was not found for this proposal",
    },
    409: {
      content: { "application/json": { schema: z.object({ success: z.literal(false), code: z.string(), error: z.string() }) } },
      description: "Request cannot be retried",
    },
  },
});

app.openapi(retryIndustryResearchRequestRoute, async (c) => {
  const { proposalId, requestId } = c.req.valid("param");
  try {
    await retryIndustryEvidenceResearch({ workspaceSlug: c.var.workspaceSlug, proposalId, requestId });
    return c.json({ success: true as const }, 200);
  } catch (error) {
    if (error instanceof IndustryEvidenceResearchError) {
      return c.json({ success: false as const, code: error.code, error: error.message }, error.status as 404 | 409);
    }
    throw error;
  }
});

const cancelIndustryResearchRequestRoute = createRoute({
  method: "post",
  path: "/api/company-industry-proposals/:proposalId/research-requests/:requestId/cancel",
  tags: ["company-industry-evidence"],
  summary: "Cancel one queued industry evidence research request",
  request: { params: z.object({ proposalId: z.string().min(1), requestId: z.string().min(1) }) },
  responses: {
    200: {
      content: { "application/json": { schema: z.object({ success: z.literal(true), cancelled: z.boolean() }) } },
      description: "Request cancelled",
    },
    404: {
      content: { "application/json": { schema: z.object({ success: z.literal(false), code: z.string(), error: z.string() }) } },
      description: "Request was not found for this proposal",
    },
    409: {
      content: { "application/json": { schema: z.object({ success: z.literal(false), code: z.string(), error: z.string() }) } },
      description: "Request is no longer active",
    },
  },
});

app.openapi(cancelIndustryResearchRequestRoute, async (c) => {
  const { proposalId, requestId } = c.req.valid("param");
  try {
    const result = await cancelIndustryEvidenceResearch({ workspaceSlug: c.var.workspaceSlug, proposalId, requestId });
    return c.json({ success: true as const, ...result }, 200);
  } catch (error) {
    if (error instanceof IndustryEvidenceResearchError) {
      return c.json({ success: false as const, code: error.code, error: error.message }, error.status as 404 | 409);
    }
    throw error;
  }
});

const resolveIndustryProposalIdentityRoute = createRoute({
  method: "post",
  path: "/api/company-industry-proposals/:proposalId/identity-resolution",
  tags: ["company-industry-evidence"],
  summary: "Attend an evidence-backed industry proposal identity mapping",
  request: {
    params: z.object({ proposalId: z.string().min(1) }),
    body: {
      content: {
        "application/json": {
          schema: z.object({
            expectedProposalUpdatedAt: z.number(),
            candidateFingerprint: z.string().min(1),
            mappingMode: z.enum(["existing", "create_provisional"]),
            companyKey: z.string().optional(),
            provisionalDisplayName: z.string().optional(),
            provisionalAlias: z.string().optional(),
            sourceIds: z.array(z.string()).max(20),
            reviewNote: z.string().optional(),
          }),
        },
      },
    },
  },
  responses: {
    200: {
      content: {
        "application/json": {
          schema: z.object({ success: z.literal(true), proposalId: z.string(), companyKey: z.string(), auditId: z.string() }),
        },
      },
      description: "Identity mapping recorded",
    },
    409: {
      content: { "application/json": { schema: IndustryReviewConflictSchema } },
      description: "Proposal changed during identity review",
    },
  },
});

app.openapi(resolveIndustryProposalIdentityRoute, async (c) => {
  const { proposalId } = c.req.valid("param");
  try {
    const result = await resolveIndustryProposalIdentity({
      proposalId,
      ...c.req.valid("json"),
      workspaceSlug: c.var.workspaceSlug,
      actor: getAuthenticatedActorId(c),
    });
    return c.json({ success: true as const, ...result }, 200);
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("INDUSTRY_REVIEW_STALE:")) {
      return c.json({ success: false as const, error: error.message, code: INDUSTRY_REVIEW_STALE_CODE }, 409);
    }
    throw error;
  }
});

const upsertIndustryProposalRoute = createRoute({
  method: "post",
  path: "/api/company-industry-proposals",
  tags: ["company-industry-evidence"],
  summary: "Create or coalesce a governed company-industry proposal",
  request: {
    body: {
      content: {
        "application/json": {
          schema: z.object({
            proposalId: z.string().min(1),
            companyKey: z.string().optional(),
            normalizedEmployerSurface: z.string().optional(),
            triggerReasons: z.array(MaintenanceTriggerEnum).min(1),
            priority: z.number().min(0).max(100),
            sampleReferences: z
              .array(
                z.object({
                  workspaceSlug: z.string().min(1),
                  resumeIdentity: z.string().min(1),
                  workEntryFingerprint: z.string().optional(),
                }),
              )
              .optional(),
            currentRevisionId: z.string().optional(),
            suggestedIndustryClass: IndustryClassEnum.optional(),
            suggestedVerificationLevel: VerificationLevelEnum.optional(),
            materialChangeSummary: z.string().optional(),
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
            proposalId: z.string(),
            created: z.boolean(),
          }),
        },
      },
      description: "Proposal created or coalesced; current truth is unchanged",
    },
  },
});

app.openapi(upsertIndustryProposalRoute, async (c) => {
  const result = await upsertIndustryProposal({
    ...c.req.valid("json"),
    requestedBy: getAuthenticatedActorId(c),
  });
  return c.json({ success: true as const, ...result }, 200);
});

const getIndustryProposalRoute = createRoute({
  method: "get",
  path: "/api/company-industry-proposals/:proposalId",
  tags: ["company-industry-evidence"],
  summary: "Get one governed company-industry proposal",
  request: { params: z.object({ proposalId: z.string().min(1) }) },
  responses: {
    200: {
      content: {
        "application/json": {
          schema: z.object({
            success: z.literal(true),
            item: IndustryProposalSchema.nullable(),
          }),
        },
      },
      description: "Proposal detail",
    },
  },
});

app.openapi(getIndustryProposalRoute, async (c) => {
  const { proposalId } = c.req.valid("param");
  const item = await getIndustryProposal(proposalId);
  return c.json({ success: true as const, item }, 200);
});

const approveIndustryProposalRoute = createRoute({
  method: "post",
  path: "/api/company-industry-proposals/:proposalId/approve",
  tags: ["company-industry-evidence"],
  summary: "Approve a proposal into an immutable verdict revision",
  request: {
    params: z.object({ proposalId: z.string().min(1) }),
    body: {
      content: {
        "application/json": {
          schema: z.object({
            revisionId: z.string().min(1),
            expectedCurrentRevisionId: z.string().optional(),
            expectedProposalUpdatedAt: z.number().optional(),
            expectedInputFingerprint: z.string().optional(),
            expectedSourceVersions: z
              .array(z.object({ sourceId: z.string().min(1), updatedAt: z.number() }))
              .max(200)
              .optional(),
            verificationLevel: z.enum(["verified", "rejected"]),
            industryClass: IndustryClassEnum,
            approvedSourceIds: z.array(z.string().min(1)).min(1),
            evidenceSummary: z.string().min(1),
            decisionReason: z.string().min(1),
            taxonomyVersion: z.string().min(1),
            ruleVersion: z.string().optional(),
            nextReviewAt: z.number().optional(),
            reviewAttestation: IndustryReviewAttestationSchema.optional(),
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
            proposalId: z.string(),
            revisionId: z.string(),
            companyKey: z.string(),
            recompute: IndustryRecomputeRunSchema,
          }),
        },
      },
      description: "Approved immutable revision",
    },
    409: {
      content: {
        "application/json": { schema: IndustryReviewConflictSchema },
      },
      description: "Review packet or current revision is stale",
    },
    422: {
      content: {
        "application/json": {
          schema: z.object({
            success: z.literal(false),
            error: z.string(),
            code: z.string(),
          }),
        },
      },
      description: "Review attestation or evidence policy rejected the decision",
    },
  },
});

app.openapi(approveIndustryProposalRoute, async (c) => {
  const { proposalId } = c.req.valid("param");
  const body = c.req.valid("json");
  try {
    const shouldLoadPacket = Boolean(
      body.expectedInputFingerprint ||
        body.reviewAttestation ||
        body.industryClass === "cnc",
    );
    let packet: IndustryReviewPacket | null = null;
    if (shouldLoadPacket) {
      const { getIndustryReviewPacket } = await import(
        "../services/company-industry-review-service.js"
      );
      packet = await getIndustryReviewPacket(proposalId, c.var.workspaceSlug);
      if (!packet) {
        throw new Error("Industry proposal not found");
      }
      if (
        body.expectedInputFingerprint &&
        packet.dataset.inputFingerprint !== body.expectedInputFingerprint
      ) {
        throw new IndustryReviewStaleError(
          "Refresh the recommendation before approving this proposal.",
        );
      }
      const visibleRiskFlags = packet.recommendation.riskFlags;
      const requiresAttestation =
        visibleRiskFlags.length > 0 || body.industryClass === "cnc";
      if (requiresAttestation && !body.reviewAttestation) {
        return c.json(
          {
            success: false as const,
            error: "A review attestation is required before this elevated decision.",
            code: "INDUSTRY_REVIEW_ATTESTATION_REQUIRED",
          },
          422,
        );
      }
      if (body.reviewAttestation) {
        const validation = validateIndustryReviewAttestation({
          attestation: body.reviewAttestation as unknown as IndustryReviewAttestation,
          expectedInputFingerprint:
            body.expectedInputFingerprint ?? packet.dataset.inputFingerprint,
          visibleRiskFlags,
          recommendedIndustryClass: body.industryClass,
        });
        if (!validation.ok) {
          return c.json(
            {
              success: false as const,
              error: "The review attestation does not satisfy the current evidence policy.",
              code: validation.code,
            },
            422,
          );
        }
      }
    }
    const approvalInput = {
      proposalId,
      workspaceSlug: c.var.workspaceSlug,
      ...body,
      ...(body.reviewAttestation
        ? {
            reviewAttestation: {
              ...body.reviewAttestation,
              acknowledgedRiskFlags:
                body.reviewAttestation
                  .acknowledgedRiskFlags as IndustryReviewAttestation["acknowledgedRiskFlags"],
            } as IndustryReviewAttestation,
          }
        : {}),
    } as Parameters<typeof approveIndustryProposalAndStartRecompute>[0];
    const result = await approveIndustryProposalAndStartRecompute(
      approvalInput,
      getAuthenticatedActorId(c),
    );
    // Approval hook: enqueue a maintenance run so recycled needs_more_evidence
    // proposals re-chew automatically after a human approval. Fire-and-forget;
    // coalescing prevents duplicate runs if multiple approvals land in sequence.
    void enqueueIndustryMaintenance({
      workspaceSlug: c.var.workspaceSlug,
      triggerSource: "approval",
      triggerContext: proposalId,
    });
    return c.json({ success: true as const, ...result }, 200);
  } catch (error) {
    if (isIndustryReviewStaleError(error)) {
      return c.json(industryReviewConflictResponse(error), 409);
    }
    throw error;
  }
});

const undoIndustryProposalRoute = createRoute({
  method: "post",
  path: "/api/company-industry-proposals/:proposalId/undo-approval",
  tags: ["company-industry-evidence"],
  summary: "Undo an approval through an immutable compensating revision",
  request: {
    params: z.object({ proposalId: z.string().min(1) }),
    body: {
      content: {
        "application/json": {
          schema: z.object({
            approvedRevisionId: z.string().min(1),
            expectedCurrentRevisionId: z.string().min(1).optional(),
            expectedProposalUpdatedAt: z.number().finite().optional(),
            recomputeRunId: z.string().min(1).optional(),
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
            proposalId: z.string(),
            reversalRevisionId: z.string(),
            restoredRevisionId: z.string().optional(),
            status: z.literal("ready_for_review"),
            recompute: z
              .object({
                previousRunId: z.string().optional(),
                previousRunStatus: z.string().optional(),
                replacementRunId: z.string().optional(),
                status: z.string(),
              })
              .optional(),
          }),
        },
      },
      description: "Reopened proposal after an audit-safe approval reversal",
    },
    409: {
      content: {
        "application/json": { schema: IndustryReviewConflictSchema },
      },
      description: "Approval changed during undo",
    },
  },
});

app.openapi(undoIndustryProposalRoute, async (c) => {
  const { proposalId } = c.req.valid("param");
  try {
    const result = await undoIndustryProposalApproval(
      {
        proposalId,
        ...c.req.valid("json"),
        workspaceSlug: c.var.workspaceSlug,
      },
      getAuthenticatedActorId(c),
    );
    return c.json({ success: true as const, ...result }, 200);
  } catch (error) {
    if (isIndustryReviewStaleError(error)) {
      return c.json(industryReviewConflictResponse(error), 409);
    }
    throw error;
  }
});

const resolveIndustryProposalRoute = createRoute({
  method: "post",
  path: "/api/company-industry-proposals/:proposalId/resolve",
  tags: ["company-industry-evidence"],
  summary: "Reject, supersede, or request more evidence for a proposal",
  request: {
    params: z.object({ proposalId: z.string().min(1) }),
    body: {
      content: {
        "application/json": {
          schema: z.object({
            resolution: z.enum([
              "rejected",
              "needs_more_evidence",
              "superseded",
            ]),
            reviewNote: z.string().optional(),
            expectedProposalUpdatedAt: z.number().optional(),
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
            proposalId: z.string(),
            status: ProposalStatusEnum,
          }),
        },
      },
      description: "Proposal resolution",
    },
    409: {
      content: {
        "application/json": { schema: IndustryReviewConflictSchema },
      },
      description: "Proposal changed during review",
    },
  },
});

app.openapi(resolveIndustryProposalRoute, async (c) => {
  const { proposalId } = c.req.valid("param");
  try {
    const result = await resolveIndustryProposal(
      { proposalId, ...c.req.valid("json") },
      getAuthenticatedActorId(c),
    );
    return c.json({ success: true as const, ...result }, 200);
  } catch (error) {
    if (isIndustryReviewStaleError(error)) {
      return c.json(industryReviewConflictResponse(error), 409);
    }
    throw error;
  }
});

const listIndustryEvidenceSourcesRoute = createRoute({
  method: "get",
  path: "/api/company-industry-evidence-sources",
  tags: ["company-industry-evidence"],
  summary: "List governed evidence sources by company or proposal",
  request: {
    query: z.object({
      companyKey: z.string().optional(),
      proposalId: z.string().optional(),
    }),
  },
  responses: {
    200: {
      content: {
        "application/json": {
          schema: z.object({
            success: z.literal(true),
            items: z.array(IndustryEvidenceSourceSchema),
          }),
        },
      },
      description: "Evidence source list",
    },
  },
});

app.openapi(listIndustryEvidenceSourcesRoute, async (c) => {
  const items = await listIndustryEvidenceSources(c.req.valid("query"));
  return c.json({ success: true as const, items }, 200);
});

const upsertIndustryEvidenceSourceRoute = createRoute({
  method: "post",
  path: "/api/company-industry-evidence-sources",
  tags: ["company-industry-evidence"],
  summary: "Create or update an unapproved evidence-source candidate",
  request: {
    body: {
      content: {
        "application/json": {
          schema: z.object({
            sourceId: z.string().min(1),
            companyKey: z.string().optional(),
            proposalId: z.string().optional(),
            url: z.string().url(),
            sourceType: EvidenceSourceTypeEnum,
            trustTier: EvidenceTrustTierEnum,
            title: z.string().optional(),
            evidenceExcerpt: z.string().optional(),
            fetchedAt: z.number().optional(),
            contentFingerprint: z.string().optional(),
            fetchStatus: z.enum([
              "pending",
              "fetched",
              "failed",
              "unavailable",
            ]),
            suggestedIndustryClass: IndustryClassEnum.optional(),
            workerConfidence: z.number().min(0).max(1).optional(),
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
            sourceId: z.string(),
            created: z.boolean(),
          }),
        },
      },
      description: "Evidence source upserted without changing current truth",
    },
  },
});

app.openapi(upsertIndustryEvidenceSourceRoute, async (c) => {
  const result = await upsertIndustryEvidenceSource(c.req.valid("json"));
  return c.json({ success: true as const, ...result }, 200);
});

const listIndustryVerdictRevisionsRoute = createRoute({
  method: "get",
  path: "/api/company-industry-revisions/:companyKey",
  tags: ["company-industry-evidence"],
  summary: "List immutable verdict revisions for a company",
  request: { params: z.object({ companyKey: z.string().min(1) }) },
  responses: {
    200: {
      content: {
        "application/json": {
          schema: z.object({
            success: z.literal(true),
            items: z.array(IndustryVerdictRevisionSchema),
          }),
        },
      },
      description: "Immutable revision history",
    },
  },
});

app.openapi(listIndustryVerdictRevisionsRoute, async (c) => {
  const { companyKey } = c.req.valid("param");
  const items = await listIndustryVerdictRevisions(companyKey);
  return c.json({ success: true as const, items }, 200);
});

const listIndustryRecomputeRunsRoute = createRoute({
  method: "get",
  path: "/api/company-industry-recompute-runs",
  tags: ["company-industry-evidence"],
  summary: "List durable targeted recompute runs for a company",
  request: {
    query: z.object({
      companyKey: z.string().min(1),
      limit: z.coerce.number().int().min(1).max(100).optional(),
    }),
  },
  responses: {
    200: {
      content: {
        "application/json": {
          schema: z.object({
            success: z.literal(true),
            items: z.array(IndustryRecomputeRunSchema),
          }),
        },
      },
      description: "Targeted recompute run history",
    },
  },
});

app.openapi(listIndustryRecomputeRunsRoute, async (c) => {
  const { companyKey, limit } = c.req.valid("query");
  const items = await companyIndustryRecomputeService.list({
    workspaceSlug: c.var.workspaceSlug,
    companyKey,
    limit,
  });
  return c.json({ success: true as const, items }, 200);
});

const getIndustryRecomputeRunRoute = createRoute({
  method: "get",
  path: "/api/company-industry-recompute-runs/:runId",
  tags: ["company-industry-evidence"],
  summary: "Get one durable targeted recompute run",
  request: { params: z.object({ runId: z.string().min(1) }) },
  responses: {
    200: {
      content: {
        "application/json": {
          schema: z.object({
            success: z.literal(true),
            item: IndustryRecomputeRunSchema.nullable(),
          }),
        },
      },
      description: "Targeted recompute run",
    },
  },
});

app.openapi(getIndustryRecomputeRunRoute, async (c) => {
  const { runId } = c.req.valid("param");
  const item = await companyIndustryRecomputeService.get(runId);
  return c.json({ success: true as const, item }, 200);
});

// ---------------------------------------------------------------------------
// Industry coverage summary (operator health for Industry verification).
// ---------------------------------------------------------------------------

const IndustryCoverageMaintenanceRunSchema = z.object({
  runId: z.string(),
  status: z.string().optional(),
  triggerSource: z.string().optional(),
  triggerContext: z.string().optional(),
  operatorSummary: z.string().optional(),
  failureMessage: z.string().optional(),
  startedAt: z.number().optional(),
  finishedAt: z.number().optional(),
  counts: z.object({
    proposalsResearched: z.number(),
    readyCreated: z.number(),
    sourcesDemoted: z.number(),
    freshnessChecked: z.number(),
    freshnessRefreshed: z.number(),
    errors: z.number(),
  }),
});

const IndustryCoverageSummarySchema = z.object({
  generatedAt: z.number(),
  workspaceSlug: z.string(),
  proposalsByStatus: z.record(z.string(), z.number()),
  openTotal: z.number(),
  openWithSources: z.number(),
  openWithoutSources: z.number(),
  emptyEvidenceBottleneck: z.boolean(),
  readyBacklogBottleneck: z.boolean(),
  resumes: z.object({
    total: z.number(),
    withVerifiedEvidence: z.number(),
  }),
  profiles: z.object({
    total: z.number(),
    verified: z.number(),
    rejected: z.number(),
  }),
  maintenance: z.object({
    latest: IndustryCoverageMaintenanceRunSchema.nullable(),
    lastUseful: IndustryCoverageMaintenanceRunSchema.nullable(),
    lastFailed: IndustryCoverageMaintenanceRunSchema.nullable(),
  }),
  researchQueue: z.object({
    active: z.number(),
    queued: z.number(),
    leased: z.number(),
    retryWait: z.number(),
    needsIdentityReview: z.number(),
    failed: z.number(),
    byOrigin: z.record(z.string(), z.number()),
    oldestRequestedAt: z.number().nullable(),
    oldestPriority: z.number().nullable(),
    alerts: z.object({
      oldestDirectDemandAgeMs: z.number(),
      highRetryRate: z.boolean(),
      providerLimitedBacklog: z.number(),
      workerUnreachableRuns: z.number(),
    }),
  }),
});

const getIndustryCoverageSummaryRoute = createRoute({
  method: "get",
  path: "/api/company-industry-coverage",
  tags: ["company-industry-evidence"],
  summary: "Industry verification coverage and research health summary",
  responses: {
    200: {
      content: {
        "application/json": {
          schema: z.object({
            success: z.literal(true),
            item: IndustryCoverageSummarySchema,
          }),
        },
      },
      description: "Coverage summary for resumes, proposals, and maintenance",
    },
  },
});

app.openapi(getIndustryCoverageSummaryRoute, async (c) => {
  const item = await getIndustryCoverageSummary(c.var.workspaceSlug);
  return c.json({ success: true as const, item }, 200);
});

// ---------------------------------------------------------------------------
// Industry maintenance run registry + ledger read endpoints.
// ---------------------------------------------------------------------------

const listIndustryMaintenanceRunsRoute = createRoute({
  method: "get",
  path: "/api/company-industry-maintenance-runs",
  tags: ["company-industry-evidence"],
  summary: "List industry-evidence maintenance runs",
  request: {
    query: z.object({
      status: z.enum(["queued", "running", "completed", "failed", "skipped"]).optional(),
      limit: z.coerce.number().int().min(1).max(100).optional(),
    }),
  },
  responses: {
    200: {
      content: {
        "application/json": {
          schema: z.object({
            success: z.literal(true),
            items: z.array(z.unknown()),
          }),
        },
      },
      description: "Maintenance run history",
    },
  },
});

app.openapi(listIndustryMaintenanceRunsRoute, async (c) => {
  const { status, limit } = c.req.valid("query");
  const items = await callConvexQuery("companies:listIndustryMaintenanceRuns", {
    workspaceSlug: c.var.workspaceSlug,
    ...(status ? { status } : {}),
    ...(limit ? { limit } : {}),
    writeSecret: config.auth.convexWriteSecret,
  });
  return c.json({ success: true as const, items: (items as unknown[]) ?? [] }, 200);
});

const getIndustryMaintenanceRunRoute = createRoute({
  method: "get",
  path: "/api/company-industry-maintenance-runs/:runId",
  tags: ["company-industry-evidence"],
  summary: "Get one industry-evidence maintenance run",
  request: { params: z.object({ runId: z.string().min(1) }) },
  responses: {
    200: {
      content: {
        "application/json": {
          schema: z.object({
            success: z.literal(true),
            item: z.unknown().nullable(),
          }),
        },
      },
      description: "Maintenance run detail",
    },
  },
});

app.openapi(getIndustryMaintenanceRunRoute, async (c) => {
  const { runId } = c.req.valid("param");
  const item = await callConvexQuery("companies:getIndustryMaintenanceRun", {
    runId,
    writeSecret: config.auth.convexWriteSecret,
  });
  return c.json({ success: true as const, item: item ?? null }, 200);
});

const listIndustryMaintenanceLedgerByRunRoute = createRoute({
  method: "get",
  path: "/api/company-industry-maintenance-runs/:runId/ledger",
  tags: ["company-industry-evidence"],
  summary: "List per-proposal ledger rows for one maintenance run",
  request: { params: z.object({ runId: z.string().min(1) }) },
  responses: {
    200: {
      content: {
        "application/json": {
          schema: z.object({
            success: z.literal(true),
            items: z.array(z.unknown()),
          }),
        },
      },
      description: "Maintenance run ledger",
    },
  },
});

app.openapi(listIndustryMaintenanceLedgerByRunRoute, async (c) => {
  const { runId } = c.req.valid("param");
  const items = await callConvexQuery("companies:listIndustryMaintenanceLedger", {
    runId,
    writeSecret: config.auth.convexWriteSecret,
  });
  return c.json({ success: true as const, items: (items as unknown[]) ?? [] }, 200);
});

const listIndustryMaintenanceLedgerByProposalRoute = createRoute({
  method: "get",
  path: "/api/company-industry-proposals/:proposalId/maintenance-ledger",
  tags: ["company-industry-evidence"],
  summary: "List maintenance ledger history for one proposal across runs",
  request: { params: z.object({ proposalId: z.string().min(1) }) },
  responses: {
    200: {
      content: {
        "application/json": {
          schema: z.object({
            success: z.literal(true),
            items: z.array(z.unknown()),
          }),
        },
      },
      description: "Per-proposal maintenance ledger history",
    },
  },
});

app.openapi(listIndustryMaintenanceLedgerByProposalRoute, async (c) => {
  const { proposalId } = c.req.valid("param");
  const items = await callConvexQuery("companies:listIndustryMaintenanceLedger", {
    proposalId,
    writeSecret: config.auth.convexWriteSecret,
  });
  return c.json({ success: true as const, items: (items as unknown[]) ?? [] }, 200);
});

const advanceIndustryRecomputeRunRoute = createRoute({
  method: "post",
  path: "/api/company-industry-recompute-runs/:runId/advance",
  tags: ["company-industry-evidence"],
  summary: "Advance one idempotent step of a targeted recompute run",
  request: { params: z.object({ runId: z.string().min(1) }) },
  responses: {
    200: {
      content: {
        "application/json": {
          schema: z.object({
            success: z.literal(true),
            item: IndustryRecomputeRunSchema,
          }),
        },
      },
      description: "Updated recompute state",
    },
  },
});

app.openapi(advanceIndustryRecomputeRunRoute, async (c) => {
  const { runId } = c.req.valid("param");
  const item = await companyIndustryRecomputeService.advance(runId);
  return c.json({ success: true as const, item }, 200);
});

const retryIndustryRecomputeRunRoute = createRoute({
  method: "post",
  path: "/api/company-industry-recompute-runs/:runId/retry",
  tags: ["company-industry-evidence"],
  summary: "Retry a failed targeted recompute run idempotently",
  request: { params: z.object({ runId: z.string().min(1) }) },
  responses: {
    200: {
      content: {
        "application/json": {
          schema: z.object({
            success: z.literal(true),
            item: IndustryRecomputeRunSchema,
          }),
        },
      },
      description: "Retried recompute state",
    },
  },
});

app.openapi(retryIndustryRecomputeRunRoute, async (c) => {
  const { runId } = c.req.valid("param");
  const item = await companyIndustryRecomputeService.retry(runId, {
    requestedBy: getAuthenticatedActorId(c),
  });
  return c.json({ success: true as const, item }, 200);
});

const getCompanyIndustryEvidenceBundleRoute = createRoute({
  method: "get",
  path: "/api/company-industry-bundles/:companyKey",
  tags: ["company-industry-evidence"],
  summary: "Get the materialized approved profile, sources, and revision history",
  request: { params: z.object({ companyKey: z.string().min(1) }) },
  responses: {
    200: {
      content: {
        "application/json": {
          schema: z.object({
            success: z.literal(true),
            profile: IndustryProfileSchema.nullable(),
            revisions: z.array(IndustryVerdictRevisionSchema),
            sources: z.array(IndustryEvidenceSourceSchema),
          }),
        },
      },
      description: "Approved company evidence and immutable history",
    },
  },
});

app.openapi(getCompanyIndustryEvidenceBundleRoute, async (c) => {
  const { companyKey } = c.req.valid("param");
  const bundle = await getCompanyIndustryEvidenceBundle(companyKey);
  return c.json({ success: true as const, ...bundle }, 200);
});

const requestCompanyIndustryEvidenceRefreshRoute = createRoute({
  method: "post",
  path: "/api/company-industry-refresh-requests",
  tags: ["company-industry-evidence"],
  summary: "Request governed refresh of current approved company evidence",
  request: {
    body: {
      content: {
        "application/json": {
          schema: z.object({
            companyKey: z.string().min(1).max(160),
            verdictRevisionId: z.string().min(1).max(200),
            resumeId: z.string().min(1).max(200).optional(),
            reasonCode: z
              .enum(["stale", "incomplete", "incorrect", "other"])
              .optional(),
            note: z.string().max(300).optional(),
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
            proposalId: z.string(),
            coalesced: z.boolean(),
          }),
        },
      },
      description:
        "Refresh request accepted or coalesced without changing current truth",
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
      description: "Invalid refresh request",
    },
    404: {
      content: {
        "application/json": {
          schema: z.object({
            success: z.literal(false),
            error: z.string(),
          }),
        },
      },
      description: "No approved profile",
    },
    409: {
      content: {
        "application/json": {
          schema: z.object({
            success: z.literal(false),
            error: z.string(),
          }),
        },
      },
      description: "Stale revision",
    },
  },
});

app.openapi(requestCompanyIndustryEvidenceRefreshRoute, async (c) => {
  const body = c.req.valid("json");
  try {
    const result = await requestCompanyIndustryEvidenceRefresh({
      companyKey: body.companyKey,
      currentRevisionId: body.verdictRevisionId,
      workspaceSlug: c.var.workspaceSlug,
      requesterId: getAuthenticatedActorId(c),
      reasonCode: body.reasonCode ?? "stale",
      ...(body.note ? { note: body.note } : {}),
      ...(body.resumeId ? { resumeIdentity: body.resumeId } : {}),
    });
    return c.json(
      {
        success: true as const,
        proposalId: result.proposalId,
        coalesced: result.status === "already_pending",
      },
      200,
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes("No approved industry evidence profile")) {
      return c.json({ success: false as const, error: message }, 404);
    }
    if (message.includes("revision is stale")) {
      return c.json({ success: false as const, error: message }, 409);
    }
    return c.json({ success: false as const, error: message }, 400);
  }
});

export default app;
