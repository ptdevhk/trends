import { v } from "convex/values";
import {
  mutation,
  query,
} from "./_generated/server";
import { normalizeCompanyAlias } from "@trends/shared";
import {
  assertExpectedIndustryProposalUpdatedAt,
  findIndustryEvidenceSource,
  findIndustryProposal,
  normalizeCompanyKey,
  normalizeWorkspaceSlug,
  REQUESTABLE_RESEARCH_PROPOSAL_STATUSES,
  requireReadSecret,
  requireWriteSecret,
} from "./lib/company_shared.js";

const identityMappingModeValidator = v.union(
  v.literal("existing"),
  v.literal("create_provisional"),
);

/**
 * Shape contract for persisted identity-candidate names.
 *
 * The worker extraction already enforces the same window and claims it is
 * "the same 8-80 char window the candidate pipeline accepts"; this gate
 * makes the persistence seam enforce the contract for every writer
 * (worker, scripts, UI), so page-title junk ("CNC MACHINIST CAREERS -
 * GMI CORP", observed 2026-08-09) can never enter the review queue.
 */

function isJunkIdentityCandidateName(name: string): boolean {
  if (name.length < 8 || name.length > 80) return true;
  // Page-title separators: "About | Company" style chrome.
  if (name.includes(" | ")) return true;
  // Headline-lead separators: a multi-word ALL-CAPS lead before " - " is a
  // page title, not a legal name. Legal-name separators (e.g. division
  // suffixes) are rare and re-researchable if a false positive occurs.
  if (name.includes(" - ")) {
    const lead = name.split(" - ")[0].trim();
    const words = lead.split(/\s+/).filter(Boolean);
    if (
      words.length >= 2 &&
      lead.length >= 8 &&
      /^[A-Z0-9&.'()/\- ]+$/.test(lead)
    ) {
      return true;
    }
  }
  return false;
}

export const upsertIndustryIdentityCandidate = mutation({
  args: {
    writeSecret: v.optional(v.string()),
    proposalId: v.string(),
    candidateFingerprint: v.string(),
    normalizedLegalName: v.string(),
    jurisdiction: v.optional(v.string()),
    registrationNumber: v.optional(v.string()),
    sourceIds: v.array(v.string()),
    confidence: v.number(),
    conflictCodes: v.array(v.string()),
    extractionVersion: v.string(),
  },
  handler: async (ctx, args) => {
    requireWriteSecret(args.writeSecret);
    const proposalId = args.proposalId.trim();
    const proposal = await findIndustryProposal(ctx, proposalId);
    if (!proposal) throw new Error(`Unknown proposalId: ${proposalId}`);
    const candidateFingerprint = args.candidateFingerprint.trim();
    const normalizedLegalName = args.normalizedLegalName.trim();
    const sourceIds = [...new Set(args.sourceIds.map((sourceId) => sourceId.trim()).filter(Boolean))].slice(0, 20);
    if (sourceIds.length === 0) {
      throw new Error("Identity resolution requires at least one evidence source");
    }
    if (!candidateFingerprint || !normalizedLegalName || sourceIds.length === 0) {
      throw new Error("Identity candidate requires name, fingerprint, and sourceIds");
    }
    if (isJunkIdentityCandidateName(normalizedLegalName)) {
      throw new Error(
        `Identity candidate name has an invalid shape (expected 8-80 chars, no page-title separators): ${normalizedLegalName.slice(0, 80)}`,
      );
    }
    for (const sourceId of sourceIds) {
      const source = await findIndustryEvidenceSource(ctx, sourceId);
      if (
        !source ||
        source.proposalId !== proposalId ||
        source.fetchStatus !== "fetched" ||
        source.sourceState !== "active" ||
        source.sourceType === "search_result" ||
        source.trustTier === "discovery"
      ) {
        throw new Error(`Identity source is not an allowed fetched proposal source: ${sourceId}`);
      }
    }
    const now = Date.now();
    const existing = await ctx.db
      .query("company_identity_candidates")
      .withIndex("by_proposal_fingerprint", (q: any) =>
        q.eq("proposalId", proposalId).eq("candidateFingerprint", candidateFingerprint),
      )
      .collect();
    const material = {
      normalizedLegalName,
      ...(args.jurisdiction?.trim() ? { jurisdiction: args.jurisdiction.trim() } : {}),
      ...(args.registrationNumber?.trim() ? { registrationNumber: args.registrationNumber.trim() } : {}),
      sourceIds,
      confidence: Math.max(0, Math.min(1, args.confidence)),
      conflictCodes: [...new Set(args.conflictCodes.map((code) => code.trim()).filter(Boolean))].slice(0, 20),
      extractionVersion: args.extractionVersion.trim().slice(0, 80) || "unknown",
      updatedAt: now,
    };
    if (existing[0]) {
      await ctx.db.patch(existing[0]._id, material);
      return { candidateFingerprint, created: false };
    }
    await ctx.db.insert("company_identity_candidates", {
      candidateFingerprint,
      proposalId,
      ...material,
      reviewState: "candidate",
      createdAt: now,
    });
    return { candidateFingerprint, created: true };
  },
});

export const listIndustryIdentityCandidates = query({
  args: {
    writeSecret: v.optional(v.string()),
    proposalId: v.string(),
  },
  handler: async (ctx, args) => {
    requireReadSecret(args.writeSecret);
    const rows = await ctx.db
      .query("company_identity_candidates")
      .withIndex("by_proposal", (q: any) => q.eq("proposalId", args.proposalId.trim()))
      .collect();
    rows.sort((left: any, right: any) => right.confidence - left.confidence || right.updatedAt - left.updatedAt);
    return rows;
  },
});

export const listAllIndustryIdentityCandidates = query({
  args: {
    writeSecret: v.optional(v.string()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    requireReadSecret(args.writeSecret);
    const limit = Math.min(2000, Math.max(1, Math.floor(args.limit ?? 1000)));
    const rows = await ctx.db
      .query("company_identity_candidates")
      .collect();
    rows.sort((left: any, right: any) => right.updatedAt - left.updatedAt);
    return rows.slice(0, limit);
  },
});

export const deleteIndustryIdentityCandidates = mutation({
  args: {
    writeSecret: v.optional(v.string()),
    entries: v.array(
      v.object({
        proposalId: v.string(),
        candidateFingerprint: v.string(),
      }),
    ),
  },
  handler: async (ctx, args) => {
    requireWriteSecret(args.writeSecret);
    const entries = args.entries.slice(0, 200);
    if (entries.length === 0) {
      throw new Error("deleteIndustryIdentityCandidates requires at least one entry");
    }
    let deleted = 0;
    for (const entry of entries) {
      const proposalId = entry.proposalId.trim();
      const candidateFingerprint = entry.candidateFingerprint.trim();
      const rows = await ctx.db
        .query("company_identity_candidates")
        .withIndex("by_proposal_fingerprint", (q: any) =>
          q.eq("proposalId", proposalId).eq("candidateFingerprint", candidateFingerprint),
        )
        .collect();
      for (const row of rows) {
        await ctx.db.delete(row._id);
        deleted += 1;
      }
    }
    return { deleted };
  },
});

export const resolveIndustryProposalIdentity = mutation({
  args: {
    writeSecret: v.optional(v.string()),
    workspaceSlug: v.string(),
    actor: v.string(),
    // Workspace role of the acting member, resolved server-side from the
    // session membership at the API layer (never client input).
    actorRole: v.optional(v.union(
      v.literal("admin"),
      v.literal("reviewer"),
    )),
    proposalId: v.string(),
    expectedProposalUpdatedAt: v.number(),
    candidateFingerprint: v.string(),
    mappingMode: identityMappingModeValidator,
    companyKey: v.optional(v.string()),
    provisionalDisplayName: v.optional(v.string()),
    provisionalAlias: v.optional(v.string()),
    sourceIds: v.array(v.string()),
    reviewNote: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    requireWriteSecret(args.writeSecret);
    const actor = args.actor.trim();
    const workspaceSlug = normalizeWorkspaceSlug(args.workspaceSlug);
    const proposalId = args.proposalId.trim();
    if (!actor) throw new Error("Identity resolution actor is required");
    const proposal = await findIndustryProposal(ctx, proposalId);
    if (!proposal) throw new Error(`Unknown proposalId: ${proposalId}`);
    if (!REQUESTABLE_RESEARCH_PROPOSAL_STATUSES.has(proposal.status)) {
      throw new Error(`Proposal is not open for identity resolution: ${proposal.status}`);
    }
    assertExpectedIndustryProposalUpdatedAt(proposal, args.expectedProposalUpdatedAt);
    const candidateRows = await ctx.db
      .query("company_identity_candidates")
      .withIndex("by_proposal_fingerprint", (q: any) =>
        q.eq("proposalId", proposalId).eq("candidateFingerprint", args.candidateFingerprint.trim()),
      )
      .collect();
    const candidate = candidateRows[0];
    if (!candidate || candidate.reviewState === "rejected") {
      throw new Error("Identity candidate is unavailable for resolution");
    }
    const sourceIds = [...new Set(args.sourceIds.map((sourceId) => sourceId.trim()).filter(Boolean))].slice(0, 20);
    const candidateSourceIds = new Set(candidate.sourceIds);
    if (sourceIds.some((sourceId) => !candidateSourceIds.has(sourceId))) {
      throw new Error("Identity source is not attached to the selected candidate");
    }
    const now = Date.now();
    let targetCompanyKey = "";
    if (args.mappingMode === "existing") {
      targetCompanyKey = normalizeCompanyKey(args.companyKey ?? "");
      if (!targetCompanyKey) throw new Error("Existing identity mapping requires companyKey");
      const targetRows = await ctx.db
        .query("companies")
        .withIndex("by_company_key", (q: any) => q.eq("companyKey", targetCompanyKey))
        .collect();
      if (!targetRows[0] || targetRows[0].status === "merged") {
        throw new Error("Target canonical company is unavailable");
      }
    } else {
      targetCompanyKey = `candidate-${candidate.candidateFingerprint.slice(0, 24)}`;
      const displayName = (args.provisionalDisplayName?.trim() || candidate.normalizedLegalName).slice(0, 200);
      const existingRows = await ctx.db
        .query("companies")
        .withIndex("by_company_key", (q: any) => q.eq("companyKey", targetCompanyKey))
        .collect();
      if (!existingRows[0]) {
        await ctx.db.insert("companies", {
          companyKey: targetCompanyKey,
          status: "provisional",
          displayName,
          nameEn: displayName,
          createdAt: now,
          updatedAt: now,
          createdBy: actor,
        });
      }
      const aliasDisplay = (args.provisionalAlias?.trim() || candidate.normalizedLegalName).slice(0, 200);
      const aliasNormalized = normalizeCompanyAlias(aliasDisplay);
      if (aliasNormalized) {
        const aliases = await ctx.db
          .query("company_aliases")
          .withIndex("by_alias", (q: any) => q.eq("aliasNormalized", aliasNormalized))
          .collect();
        if (aliases[0] && aliases[0].companyKey !== targetCompanyKey) {
          throw new Error("Provisional identity alias is already mapped to another company");
        }
        if (!aliases[0]) {
          await ctx.db.insert("company_aliases", {
            companyKey: targetCompanyKey,
            aliasNormalized,
            aliasDisplay,
            source: "operator",
            createdAt: now,
          });
        }
      }
    }

    for (const sourceId of sourceIds) {
      const source = await findIndustryEvidenceSource(ctx, sourceId);
      if (
        !source ||
        source.proposalId !== proposalId ||
        source.fetchStatus !== "fetched" ||
        source.sourceState !== "active" ||
        source.sourceType === "search_result" ||
        source.trustTier === "discovery"
      ) {
        throw new Error("Identity source changed or is not an allowed fetched source");
      }
      if (source.companyKey && source.companyKey !== targetCompanyKey) {
        throw new Error("Identity source is already attached to another company");
      }
      await ctx.db.patch(source._id, {
        companyKey: targetCompanyKey,
        proposalId,
        updatedAt: now,
      });
    }
    await ctx.db.patch(proposal._id, {
      companyKey: targetCompanyKey,
      reviewedBy: actor,
      ...(args.actorRole
        ? { reviewedByRole: args.actorRole }
        : {}),
      ...(args.reviewNote?.trim() ? { reviewNote: args.reviewNote.trim().slice(0, 800) } : {}),
      updatedAt: now,
    });
    await ctx.db.patch(candidate._id, { reviewState: "reviewed", updatedAt: now });
    const pendingRequests = await ctx.db
      .query("industry_evidence_research_requests")
      .withIndex("by_workspace_created", (q: any) => q.eq("workspaceSlug", workspaceSlug))
      .collect();
    for (const request of pendingRequests.filter(
      (row: any) => row.proposalId === proposalId && row.state === "needs_identity_review",
    )) {
      await ctx.db.patch(request._id, {
        state: "completed",
        lastOutcome: "identity mapped by administrator",
        updatedAt: now,
      });
    }
    const auditId = `industry-identity-${proposalId}-${now}-${candidate.candidateFingerprint.slice(0, 8)}`;
    await ctx.db.insert("industry_identity_resolution_audits", {
      auditId,
      proposalId,
      workspaceSlug,
      actor,
      ...(args.actorRole
        ? { actorRole: args.actorRole }
        : {}),
      candidateFingerprint: candidate.candidateFingerprint,
      mappingMode: args.mappingMode,
      targetCompanyKey,
      sourceIds,
      previousProposalUpdatedAt: args.expectedProposalUpdatedAt,
      ...(args.reviewNote?.trim() ? { reviewNote: args.reviewNote.trim().slice(0, 800) } : {}),
      createdAt: now,
    });
    return { proposalId, companyKey: targetCompanyKey, auditId };
  },
});

export const attachProposalToCompany = mutation({
  args: {
    proposalId: v.string(),
    companyKey: v.string(),
    sourceCompanyKey: v.optional(v.string()),
    writeSecret: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    requireWriteSecret(args.writeSecret);
    const proposal = await findIndustryProposal(ctx, args.proposalId.trim());
    if (!proposal) throw new Error(`Unknown proposalId: ${args.proposalId}`);
    const companyKey = normalizeCompanyKey(args.companyKey);
    const sources = await ctx.db
      .query("company_industry_evidence_sources")
      .withIndex("by_proposal", (q) => q.eq("proposalId", proposal.proposalId))
      .collect();
    const extraSources = args.sourceCompanyKey
      ? (
          await ctx.db
            .query("company_industry_evidence_sources")
            .withIndex("by_company_review", (q) =>
              q.eq("companyKey", args.sourceCompanyKey),
            )
            .collect()
        )
      : [];
    const now = Date.now();
    await ctx.db.patch(proposal._id, { companyKey, updatedAt: now });
    const seen = new Set<string>();
    let patchedSources = 0;
    for (const source of [...sources, ...extraSources]) {
      if (seen.has(source._id)) continue;
      seen.add(source._id);
      await ctx.db.patch(source._id, {
        companyKey,
        proposalId: proposal.proposalId,
        updatedAt: now,
      });
      patchedSources += 1;
    }
    return { proposalId: proposal.proposalId, companyKey, patchedSources };
  },
});

/**
 * List identity-resolution audit rows for a workspace (C6 audit UI),
 * newest-first, optionally filtered by proposal.
 *
 * No write-secret gate: served to the workspace-admin-gated web audit
 * surface via the Convex React client.
 */
export const listIndustryIdentityResolutionAudits = query({
  args: {
    workspaceSlug: v.string(),
    proposalId: v.optional(v.string()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const workspaceSlug = normalizeWorkspaceSlug(args.workspaceSlug);
    const limit = Math.min(500, Math.max(1, Math.floor(args.limit ?? 100)));
    const proposalId = args.proposalId?.trim() || undefined;
    const rows = await ctx.db
      .query("industry_identity_resolution_audits")
      .withIndex("by_workspace_created", (q) => q.eq("workspaceSlug", workspaceSlug))
      .collect();
    return rows
      .filter((row) => !proposalId || row.proposalId === proposalId)
      .sort((left, right) => right.createdAt - left.createdAt)
      .slice(0, limit);
  },
});
