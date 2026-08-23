import { v } from "convex/values";
import {
  mutation,
  query,
} from "./_generated/server";
import {
  INDUSTRY_MAINTENANCE_TRIGGER_REASONS,
  normalizeCompanyAlias,
} from "@trends/shared";
import {
  findIndustryProposal,
  industryClassValidator,
  machineOriginValidator,
  normalizeCompanyKey,
  normalizeWorkspaceSlug,
  OPEN_INDUSTRY_PROPOSAL_STATUSES,
  requireReadSecret,
  requireWriteSecret,
  uniqueSortedStrings,
  verificationLevelValidator,
} from "./lib/company_shared.js";

// ---------------------------------------------------------------------------
// Governed industry evidence proposals, sources, and immutable revisions
// ---------------------------------------------------------------------------

const industryProposalStatusValidator = v.union(
  v.literal("new"),
  v.literal("researching"),
  v.literal("ready_for_review"),
  v.literal("needs_more_evidence"),
  v.literal("approved"),
  v.literal("rejected"),
  v.literal("superseded"),
);

const industryProposalSampleReferenceValidator = v.object({
  workspaceSlug: v.string(),
  resumeIdentity: v.string(),
  workEntryFingerprint: v.optional(v.string()),
});

const industryRefreshReasonValidator = v.union(
  v.literal("stale"),
  v.literal("incomplete"),
  v.literal("incorrect"),
  v.literal("other"),
);

function mergeSampleReferences(
  current: Array<{
    workspaceSlug: string;
    resumeIdentity: string;
    workEntryFingerprint?: string;
  }> | undefined,
  incoming: Array<{
    workspaceSlug: string;
    resumeIdentity: string;
    workEntryFingerprint?: string;
  }> | undefined,
) {
  const byKey = new Map<
    string,
    {
      workspaceSlug: string;
      resumeIdentity: string;
      workEntryFingerprint?: string;
    }
  >();
  for (const reference of [...(current ?? []), ...(incoming ?? [])]) {
    const workspaceSlug = reference.workspaceSlug.trim();
    const resumeIdentity = reference.resumeIdentity.trim();
    const workEntryFingerprint = reference.workEntryFingerprint?.trim();
    if (!workspaceSlug || !resumeIdentity) {
      continue;
    }
    const key = `${workspaceSlug}\u0000${resumeIdentity}\u0000${workEntryFingerprint ?? ""}`;
    byKey.set(key, {
      workspaceSlug,
      resumeIdentity,
      ...(workEntryFingerprint ? { workEntryFingerprint } : {}),
    });
  }
  return Array.from(byKey.entries())
    .sort(([left], [right]) => left.localeCompare(right))
    .slice(0, 10)
    .map(([, reference]) => reference);
}

const MACHINE_ORIGIN_SUGGESTION_CAP: Record<
  "evidence" | "sourceUrl" | "sourceTitle" | "model",
  number
> = {
  evidence: 600,
  sourceUrl: 500,
  sourceTitle: 300,
  model: 200,
};

interface MachineOriginSuggestionInput {
  suggestedMachineOrigin?: "international" | "domestic" | "unknown";
  machineOriginSuggestionConfidence?: number;
  machineOriginSuggestionEvidence?: string;
  machineOriginSuggestionSourceUrl?: string;
  machineOriginSuggestionSourceTitle?: string;
  machineOriginSuggestionModel?: string;
}

function machineOriginSuggestionPatch(
  args: MachineOriginSuggestionInput,
): Record<string, unknown> {
  return {
    ...(args.suggestedMachineOrigin !== undefined
      ? { suggestedMachineOrigin: args.suggestedMachineOrigin }
      : {}),
    ...(args.machineOriginSuggestionConfidence !== undefined
      ? { machineOriginSuggestionConfidence: args.machineOriginSuggestionConfidence }
      : {}),
    ...(args.machineOriginSuggestionEvidence?.trim()
      ? {
          machineOriginSuggestionEvidence:
            args.machineOriginSuggestionEvidence.trim().slice(
              0,
              MACHINE_ORIGIN_SUGGESTION_CAP.evidence,
            ),
        }
      : {}),
    ...(args.machineOriginSuggestionSourceUrl?.trim()
      ? {
          machineOriginSuggestionSourceUrl:
            args.machineOriginSuggestionSourceUrl.trim().slice(
              0,
              MACHINE_ORIGIN_SUGGESTION_CAP.sourceUrl,
            ),
        }
      : {}),
    ...(args.machineOriginSuggestionSourceTitle?.trim()
      ? {
          machineOriginSuggestionSourceTitle:
            args.machineOriginSuggestionSourceTitle.trim().slice(
              0,
              MACHINE_ORIGIN_SUGGESTION_CAP.sourceTitle,
            ),
        }
      : {}),
    ...(args.machineOriginSuggestionModel?.trim()
      ? {
          machineOriginSuggestionModel: args.machineOriginSuggestionModel.trim().slice(
            0,
            MACHINE_ORIGIN_SUGGESTION_CAP.model,
          ),
        }
      : {}),
  };
}

export const upsertIndustryProposal = mutation({
  args: {
    writeSecret: v.optional(v.string()),
    proposalId: v.string(),
    companyKey: v.optional(v.string()),
    normalizedEmployerSurface: v.optional(v.string()),
    triggerReasons: v.array(v.string()),
    priority: v.number(),
    sampleReferences: v.optional(v.array(industryProposalSampleReferenceValidator)),
    currentRevisionId: v.optional(v.string()),
    suggestedIndustryClass: v.optional(industryClassValidator),
    suggestedVerificationLevel: v.optional(verificationLevelValidator),
    suggestedMachineOrigin: v.optional(machineOriginValidator),
    machineOriginSuggestionConfidence: v.optional(v.number()),
    machineOriginSuggestionEvidence: v.optional(v.string()),
    machineOriginSuggestionSourceUrl: v.optional(v.string()),
    machineOriginSuggestionSourceTitle: v.optional(v.string()),
    machineOriginSuggestionModel: v.optional(v.string()),
    materialChangeSummary: v.optional(v.string()),
    requestedBy: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    requireWriteSecret(args.writeSecret);
    for (const reason of args.triggerReasons) {
      if (
        !(INDUSTRY_MAINTENANCE_TRIGGER_REASONS as readonly string[]).includes(
          reason,
        )
      ) {
        throw new Error(
          `Unknown industry proposal trigger reason: ${reason}`,
        );
      }
    }
    const proposalId = args.proposalId.trim();
    const companyKey = args.companyKey
      ? normalizeCompanyKey(args.companyKey)
      : undefined;
    const normalizedEmployerSurface = args.normalizedEmployerSurface
      ? normalizeCompanyAlias(args.normalizedEmployerSurface)
      : undefined;
    if (!proposalId || (!companyKey && !normalizedEmployerSurface)) {
      throw new Error(
        "proposalId and either companyKey or normalizedEmployerSurface are required",
      );
    }

    if (companyKey) {
      const companies = await ctx.db
        .query("companies")
        .withIndex("by_company_key", (q) => q.eq("companyKey", companyKey))
        .collect();
      if (!companies[0]) {
        throw new Error(`Unknown companyKey: ${companyKey}`);
      }
    }

    const candidates = companyKey
      ? await ctx.db
          .query("company_industry_review_proposals")
          .withIndex("by_company_status", (q) => q.eq("companyKey", companyKey))
          .collect()
      : await ctx.db
          .query("company_industry_review_proposals")
          .withIndex("by_surface_status", (q) =>
            q.eq("normalizedEmployerSurface", normalizedEmployerSurface),
          )
          .collect();
    // When the caller resolved a canonical company AND supplied the employer
    // surface, also look up by surface so an existing unmapped proposal
    // (created before the company was resolved) is found and gets the
    // companyKey attached instead of spawning a duplicate.
    const surfaceCandidates =
      companyKey && normalizedEmployerSurface
        ? await ctx.db
            .query("company_industry_review_proposals")
            .withIndex("by_surface_status", (q) =>
              q.eq("normalizedEmployerSurface", normalizedEmployerSurface),
            )
            .collect()
        : [];
    const existing =
      candidates.find((candidate) =>
        OPEN_INDUSTRY_PROPOSAL_STATUSES.has(candidate.status),
      ) ??
      surfaceCandidates.find((candidate) =>
        OPEN_INDUSTRY_PROPOSAL_STATUSES.has(candidate.status),
      );
    const now = Date.now();
    const triggerReasons = uniqueSortedStrings([
      ...(existing?.triggerReasons ?? []),
      ...args.triggerReasons,
    ].filter((reason) =>
      (INDUSTRY_MAINTENANCE_TRIGGER_REASONS as readonly string[]).includes(
        reason,
      ),
    ));
    const sampleReferences = mergeSampleReferences(
      existing?.sampleReferences,
      args.sampleReferences,
    );

    if (existing) {
      await ctx.db.patch(existing._id, {
        triggerReasons,
        priority: Math.max(existing.priority, args.priority),
        ...(sampleReferences.length > 0 ? { sampleReferences } : {}),
        // Attach the canonical company when the caller resolved one — an
        // unmapped surface proposal becomes auto-approvable (Lane A) only
        // once it has a companyKey.
        ...(companyKey && !existing.companyKey ? { companyKey } : {}),
        ...(args.currentRevisionId !== undefined
          ? { currentRevisionId: args.currentRevisionId }
          : {}),
        ...(args.suggestedIndustryClass !== undefined
          ? { suggestedIndustryClass: args.suggestedIndustryClass }
          : {}),
        ...(args.suggestedVerificationLevel !== undefined
          ? { suggestedVerificationLevel: args.suggestedVerificationLevel }
          : {}),
        ...machineOriginSuggestionPatch(args),
        ...(args.materialChangeSummary !== undefined
          ? { materialChangeSummary: args.materialChangeSummary.trim() }
          : {}),
        ...(args.requestedBy !== undefined
          ? { requestedBy: args.requestedBy.trim() }
          : {}),
        updatedAt: now,
      });
      return {
        proposalId: existing.proposalId,
        created: false,
        _id: existing._id,
      };
    }

    const duplicateId = await findIndustryProposal(ctx, proposalId);
    if (duplicateId) {
      throw new Error(`proposalId already exists: ${proposalId}`);
    }

    const id = await ctx.db.insert("company_industry_review_proposals", {
      proposalId,
      ...(companyKey ? { companyKey } : {}),
      ...(normalizedEmployerSurface ? { normalizedEmployerSurface } : {}),
      triggerReasons,
      priority: args.priority,
      ...(sampleReferences.length > 0 ? { sampleReferences } : {}),
      ...(args.currentRevisionId !== undefined
        ? { currentRevisionId: args.currentRevisionId.trim() }
        : {}),
      ...(args.suggestedIndustryClass !== undefined
        ? { suggestedIndustryClass: args.suggestedIndustryClass }
        : {}),
      ...(args.suggestedVerificationLevel !== undefined
        ? { suggestedVerificationLevel: args.suggestedVerificationLevel }
        : {}),
      ...machineOriginSuggestionPatch(args),
      ...(args.materialChangeSummary !== undefined
        ? { materialChangeSummary: args.materialChangeSummary.trim() }
        : {}),
      ...(args.requestedBy !== undefined
        ? { requestedBy: args.requestedBy.trim() }
        : {}),
      status: "new",
      createdAt: now,
      updatedAt: now,
    });
    return { proposalId, created: true, _id: id };
  },
});

/**
 * Paginated proposal listing. The plain listIndustryProposals caps at 500
 * rows (silently hiding older proposals on large datasets — observed
 * 2026-08-09); this page form carries an opaque cursor so clients can walk
 * the full corpus. Ordering follows the by_status_priority index descending
 * (priority first, deterministic tie-break).
 */

export const listIndustryProposalsPage = query({
  args: {
    writeSecret: v.optional(v.string()),
    status: v.optional(industryProposalStatusValidator),
    limit: v.optional(v.number()),
    cursor: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    requireReadSecret(args.writeSecret);
    const numItems = Math.min(200, Math.max(1, Math.floor(args.limit ?? 100)));
    const base = args.status
      ? ctx.db
          .query("company_industry_review_proposals")
          .withIndex("by_status_priority", (q) => q.eq("status", args.status!))
      : ctx.db.query("company_industry_review_proposals");
    const page = await base
      .order("desc")
      .paginate({ cursor: args.cursor ?? null, numItems });
    return {
      items: page.page,
      nextCursor: page.isDone ? undefined : page.continueCursor,
    };
  },
});

export const listIndustryProposals = query({
  args: {
    writeSecret: v.optional(v.string()),
    status: v.optional(industryProposalStatusValidator),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    requireReadSecret(args.writeSecret);
    const maxLimit = args.limit ?? 500;
    const rows = args.status
      ? await ctx.db
          .query("company_industry_review_proposals")
          .withIndex("by_status_priority", (q) => q.eq("status", args.status!))
          .take(maxLimit)
      : await ctx.db.query("company_industry_review_proposals").take(maxLimit);
    return rows.sort(
      (left, right) =>
        right.priority - left.priority ||
        right.updatedAt - left.updatedAt ||
        left.proposalId.localeCompare(right.proposalId),
    );
  },
});

/**
 * Resolve only exact legacy work-entry → industry-proposal relationships for
 * the current resume. This is intentionally secret-gated because proposal
 * sample references can otherwise reveal cross-workspace resume identities.
 */

export const resolveIndustryReviewTargetsForResume = query({
  args: {
    writeSecret: v.optional(v.string()),
    workspaceSlug: v.string(),
    resumeId: v.id("resumes"),
  },
  handler: async (ctx, args) => {
    requireReadSecret(args.writeSecret);
    const resume = await ctx.db.get(args.resumeId);
    if (!resume) {
      return null;
    }

    const workspaceSlug = normalizeWorkspaceSlug(args.workspaceSlug);
    if (normalizeWorkspaceSlug(resume.workspaceSlug) !== workspaceSlug) {
      return { targets: [] };
    }

    const resumeIdentities = new Set(
      [String(resume._id), resume.identityKey, resume.externalId]
        .map((value) => value?.trim())
        .filter((value): value is string => Boolean(value)),
    );
    const legacyEntries = new Map<string, { workEntryKey: string; employerLabel: string }>();
    for (const roleSignal of resume.ingestData?.roleSignals ?? []) {
      for (const workEntry of roleSignal.matchedWorkEntries ?? []) {
        const workEntryKey = workEntry.workEntryFingerprint?.trim();
        const employerLabel = workEntry.companyName?.trim();
        if (
          !workEntry.industryVerified ||
          workEntry.verdictRevisionId?.trim() ||
          !workEntryKey ||
          !employerLabel ||
          legacyEntries.has(workEntryKey)
        ) {
          continue;
        }
        legacyEntries.set(workEntryKey, { workEntryKey, employerLabel });
      }
    }

    if (legacyEntries.size === 0) {
      return { targets: [] };
    }

    const proposals = await ctx.db.query("company_industry_review_proposals").collect();
    const candidatesByWorkEntryKey = new Map<
      string,
      Map<string, (typeof proposals)[number]>
    >();
    for (const proposal of proposals) {
      for (const reference of proposal.sampleReferences ?? []) {
        const workEntryKey = reference.workEntryFingerprint;
        if (
          reference.workspaceSlug !== workspaceSlug ||
          !resumeIdentities.has(reference.resumeIdentity) ||
          !workEntryKey ||
          !legacyEntries.has(workEntryKey)
        ) {
          continue;
        }
        const candidates = candidatesByWorkEntryKey.get(workEntryKey)
          ?? new Map<string, (typeof proposals)[number]>();
        candidates.set(proposal.proposalId, proposal);
        candidatesByWorkEntryKey.set(workEntryKey, candidates);
      }
    }
    const targets = Array.from(legacyEntries.values()).map((entry) => {
      let openCandidate: (typeof proposals)[number] | undefined;
      let openCandidateCount = 0;
      for (const proposal of candidatesByWorkEntryKey.get(entry.workEntryKey)?.values() ?? []) {
        if (OPEN_INDUSTRY_PROPOSAL_STATUSES.has(proposal.status)) {
          openCandidate = proposal;
          openCandidateCount += 1;
        }
      }
      const selected = openCandidateCount === 1 ? openCandidate : undefined;

      if (!selected) {
        return {
          ...entry,
          availability: "not_linked" as const,
        };
      }

      return {
        ...entry,
        proposalId: selected.proposalId,
        status: selected.status,
        availability: "target_available" as const,
      };
    });

    return {
      targets: targets.sort(
        (left, right) =>
          left.employerLabel.localeCompare(right.employerLabel) ||
          left.workEntryKey.localeCompare(right.workEntryKey),
      ),
    };
  },
});

export const recordIndustryRefreshRequest = mutation({
  args: {
    writeSecret: v.optional(v.string()),
    requestId: v.string(),
    proposalId: v.string(),
    companyKey: v.string(),
    verdictRevisionId: v.string(),
    workspaceSlug: v.string(),
    requesterId: v.string(),
    reasonCode: industryRefreshReasonValidator,
    note: v.optional(v.string()),
    resumeIdentity: v.optional(v.string()),
    workEntryFingerprint: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    requireWriteSecret(args.writeSecret);
    const requestId = args.requestId.trim();
    const proposalId = args.proposalId.trim();
    const companyKey = normalizeCompanyKey(args.companyKey);
    const verdictRevisionId = args.verdictRevisionId.trim();
    const workspaceSlug = args.workspaceSlug.trim();
    const requesterId = args.requesterId.trim();
    const note = args.note?.trim();
    if (
      !requestId ||
      !proposalId ||
      !companyKey ||
      !verdictRevisionId ||
      !workspaceSlug ||
      !requesterId
    ) {
      throw new Error("Refresh request is missing governed identity fields");
    }
    if (note && note.length > 300) {
      throw new Error("Refresh request note is limited to 300 characters");
    }
    const existing = await ctx.db
      .query("company_industry_refresh_requests")
      .withIndex("by_request_id", (q) => q.eq("requestId", requestId))
      .collect();
    if (existing[0]) {
      return { requestId, created: false, proposalId: existing[0].proposalId };
    }
    const proposal = await findIndustryProposal(ctx, proposalId);
    if (
      !proposal ||
      proposal.companyKey !== companyKey ||
      proposal.currentRevisionId !== verdictRevisionId ||
      !OPEN_INDUSTRY_PROPOSAL_STATUSES.has(proposal.status)
    ) {
      throw new Error("Refresh request proposal does not match current approved truth");
    }
    const resumeIdentity = args.resumeIdentity?.trim();
    const workEntryFingerprint = args.workEntryFingerprint?.trim();
    if (resumeIdentity) {
      const links = await ctx.db
        .query("company_resume_links")
        .withIndex("by_workspace_company", (index) =>
          index
            .eq("workspaceSlug", workspaceSlug)
            .eq("companyKey", companyKey),
        )
        .take(201);
      if (links.length > 200) {
        throw new Error("Refresh request resume validation requires a narrower link page");
      }
      const matchingLink = links.find(
        (link) =>
          link.resumeIdentity === resumeIdentity &&
          link.currentVerdictRevisionId === verdictRevisionId &&
          (!workEntryFingerprint ||
            link.workEntryFingerprints.includes(workEntryFingerprint)),
      );
      if (!matchingLink) {
        throw new Error(
          "Refresh request resume reference does not match workspace, company, and revision",
        );
      }
    }
    await ctx.db.insert("company_industry_refresh_requests", {
      requestId,
      proposalId,
      companyKey,
      verdictRevisionId,
      workspaceSlug: workspaceSlug.slice(0, 80),
      requesterId: requesterId.slice(0, 200),
      reasonCode: args.reasonCode,
      ...(note ? { note } : {}),
      ...(resumeIdentity
        ? { resumeIdentity: resumeIdentity.slice(0, 200) }
        : {}),
      ...(workEntryFingerprint
        ? {
            workEntryFingerprint:
              workEntryFingerprint.slice(0, 160),
          }
        : {}),
      createdAt: Date.now(),
    });
    return { requestId, created: true, proposalId };
  },
});

export const listIndustryRefreshRequests = query({
  args: {
    writeSecret: v.optional(v.string()),
    proposalId: v.string(),
  },
  handler: async (ctx, args) => {
    requireReadSecret(args.writeSecret);
    const rows = await ctx.db
      .query("company_industry_refresh_requests")
      .withIndex("by_proposal_created", (q) =>
        q.eq("proposalId", args.proposalId.trim()),
      )
      .collect();
    return rows.sort(
      (left, right) =>
        right.createdAt - left.createdAt ||
        left.requestId.localeCompare(right.requestId),
    );
  },
});

export const getIndustryProposal = query({
  args: {
    writeSecret: v.optional(v.string()),
    proposalId: v.string(),
  },
  handler: async (ctx, args) => {
    requireReadSecret(args.writeSecret);
    return findIndustryProposal(ctx, args.proposalId.trim());
  },
});

export const setIndustryProposalResearchState = mutation({
  args: {
    writeSecret: v.optional(v.string()),
    proposalId: v.string(),
    status: v.union(
      v.literal("researching"),
      v.literal("ready_for_review"),
      v.literal("needs_more_evidence"),
    ),
    suggestedIndustryClass: v.optional(industryClassValidator),
    suggestedVerificationLevel: v.optional(verificationLevelValidator),
    suggestedMachineOrigin: v.optional(machineOriginValidator),
    machineOriginSuggestionConfidence: v.optional(v.number()),
    machineOriginSuggestionEvidence: v.optional(v.string()),
    machineOriginSuggestionSourceUrl: v.optional(v.string()),
    machineOriginSuggestionSourceTitle: v.optional(v.string()),
    machineOriginSuggestionModel: v.optional(v.string()),
    materialChangeSummary: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    requireWriteSecret(args.writeSecret);
    const proposal = await findIndustryProposal(ctx, args.proposalId.trim());
    if (!proposal) {
      throw new Error(`Unknown proposalId: ${args.proposalId}`);
    }
    if (!OPEN_INDUSTRY_PROPOSAL_STATUSES.has(proposal.status)) {
      throw new Error(`Proposal is not open for research: ${proposal.status}`);
    }
    const now = Date.now();
    await ctx.db.patch(proposal._id, {
      status: args.status,
      ...(args.status === "researching" && proposal.researchStartedAt === undefined
        ? { researchStartedAt: now }
        : {}),
      ...(args.status === "ready_for_review"
        ? { readyForReviewAt: now }
        : {}),
      ...(args.suggestedIndustryClass !== undefined
        ? { suggestedIndustryClass: args.suggestedIndustryClass }
        : {}),
      ...(args.suggestedVerificationLevel !== undefined
        ? { suggestedVerificationLevel: args.suggestedVerificationLevel }
        : {}),
      ...machineOriginSuggestionPatch(args),
      ...(args.materialChangeSummary?.trim()
        ? { materialChangeSummary: args.materialChangeSummary.trim().slice(0, 800) }
        : {}),
      updatedAt: now,
    });
    return {
      proposalId: proposal.proposalId,
      status: args.status,
      companyKey: proposal.companyKey,
    };
  },
});

export const setIndustryProposalMachineOriginSuggestion = mutation({
  args: {
    writeSecret: v.optional(v.string()),
    proposalId: v.string(),
    suggestedMachineOrigin: machineOriginValidator,
    confidence: v.number(),
    evidenceExcerpt: v.optional(v.string()),
    sourceUrl: v.optional(v.string()),
    sourceTitle: v.optional(v.string()),
    model: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    requireWriteSecret(args.writeSecret);
    const proposal = await findIndustryProposal(ctx, args.proposalId.trim());
    if (!proposal) {
      throw new Error(`Unknown proposalId: ${args.proposalId}`);
    }
    if (!OPEN_INDUSTRY_PROPOSAL_STATUSES.has(proposal.status)) {
      throw new Error(`Proposal is not open for research: ${proposal.status}`);
    }
    const now = Date.now();
    await ctx.db.patch(proposal._id, {
      suggestedMachineOrigin: args.suggestedMachineOrigin,
      machineOriginSuggestionConfidence: args.confidence,
      ...(args.evidenceExcerpt?.trim()
        ? {
            machineOriginSuggestionEvidence: args.evidenceExcerpt.trim().slice(
              0,
              MACHINE_ORIGIN_SUGGESTION_CAP.evidence,
            ),
          }
        : {}),
      ...(args.sourceUrl?.trim()
        ? {
            machineOriginSuggestionSourceUrl: args.sourceUrl.trim().slice(
              0,
              MACHINE_ORIGIN_SUGGESTION_CAP.sourceUrl,
            ),
          }
        : {}),
      ...(args.sourceTitle?.trim()
        ? {
            machineOriginSuggestionSourceTitle: args.sourceTitle.trim().slice(
              0,
              MACHINE_ORIGIN_SUGGESTION_CAP.sourceTitle,
            ),
          }
        : {}),
      ...(args.model?.trim()
        ? {
            machineOriginSuggestionModel: args.model.trim().slice(
              0,
              MACHINE_ORIGIN_SUGGESTION_CAP.model,
            ),
          }
        : {}),
      updatedAt: now,
    });
    return { proposalId: proposal.proposalId, status: proposal.status };
  },
});
