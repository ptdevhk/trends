import { v } from "convex/values";
import {
  mutation,
  query,
} from "./_generated/server";
import {
  hasAutoApprovableEvidence,
  hasExplicitCncEvidence,
  normalizeIndustryEvidenceUrl,
} from "@trends/shared";
import { scheduleCompanyLinkBackfill } from "./company_resume_links.js";
import {
  assertExpectedIndustryProposalUpdatedAt,
  findIndustryEvidenceSource,
  findIndustryProposal,
  findIndustryRecomputeRun,
  industryClassValidator,
  INDUSTRY_REVIEW_STALE_PREFIX,
  nextIndustryEvidenceReviewAt,
  normalizeCompanyKey,
  OPEN_INDUSTRY_PROPOSAL_STATUSES,
  requireReadSecret,
  requireWriteSecret,
  TERMINAL_INDUSTRY_RECOMPUTE_STATUSES,
  uniqueSortedStrings,
} from "./lib/company_shared.js";

const approvedVerificationLevelValidator = v.union(
  v.literal("verified"),
  v.literal("rejected"),
);

const industryReviewRiskFlagValidator = v.union(
  v.literal("canonical_mapping_missing"),
  v.literal("only_discovery_sources"),
  v.literal("source_conflict"),
  v.literal("weak_industry_signal"),
  v.literal("cnc_claim_inferred"),
  v.literal("stale_or_failed_source"),
  v.literal("low_source_diversity"),
  v.literal("worker_unreachable"),
  v.literal("recompute_pending"),
);

const industryReviewAttestationValidator = v.object({
  schemaVersion: v.literal("industry-review-attestation.v1"),
  inputFingerprint: v.string(),
  decisionMode: v.union(v.literal("standard"), v.literal("risk_override")),
  acknowledgedRiskFlags: v.array(industryReviewRiskFlagValidator),
  cncEvidenceAcknowledged: v.boolean(),
  acknowledgementReason: v.string(),
  batchId: v.optional(v.string()),
});

async function findIndustryVerdictRevision(
  ctx: { db: any },
  revisionId: string,
) {
  const rows = await ctx.db
    .query("company_industry_verdict_revisions")
    .withIndex("by_revision_id", (q: any) => q.eq("revisionId", revisionId))
    .collect();
  return rows[0] ?? null;
}

export const approveIndustryProposal = mutation({
  args: {
    writeSecret: v.optional(v.string()),
    proposalId: v.string(),
    revisionId: v.string(),
    expectedCurrentRevisionId: v.optional(v.string()),
    expectedProposalUpdatedAt: v.optional(v.number()),
    expectedInputFingerprint: v.optional(v.string()),
    expectedSourceVersions: v.optional(
      v.array(v.object({ sourceId: v.string(), updatedAt: v.number() })),
    ),
    verificationLevel: approvedVerificationLevelValidator,
    industryClass: industryClassValidator,
    approvedSourceIds: v.array(v.string()),
    evidenceSummary: v.string(),
    reviewer: v.string(),
    decisionReason: v.string(),
    taxonomyVersion: v.string(),
    ruleVersion: v.optional(v.string()),
    nextReviewAt: v.optional(v.number()),
    reviewAttestation: v.optional(industryReviewAttestationValidator),
  },
  handler: async (ctx, args) => {
    requireWriteSecret(args.writeSecret);
    return commitIndustryVerdictApproval(ctx, {
      proposalId: args.proposalId,
      revisionId: args.revisionId,
      expectedCurrentRevisionId: args.expectedCurrentRevisionId,
      expectedProposalUpdatedAt: args.expectedProposalUpdatedAt,
      expectedInputFingerprint: args.expectedInputFingerprint,
      expectedSourceVersions: args.expectedSourceVersions,
      verificationLevel: args.verificationLevel,
      industryClass: args.industryClass,
      approvedSourceIds: args.approvedSourceIds,
      evidenceSummary: args.evidenceSummary,
      reviewer: args.reviewer,
      reviewerType: "human",
      decisionReason: args.decisionReason,
      taxonomyVersion: args.taxonomyVersion,
      ruleVersion: args.ruleVersion,
      nextReviewAt: args.nextReviewAt,
      reviewAttestation: args.reviewAttestation,
    });
  },
});

/**
 * Governed Lane A auto-approval (auto-verify-bot).
 *
 * Automation may approve ONLY when every Lane A condition holds:
 *   - every selected source is a structured registry/taxonomy record with
 *     explicit CNC/industrial signal text (never prose — official sites,
 *     reporting, OEM pages, directories route to the human cockpit);
 *   - all sources fetched + active + unreviewed (not disputed/rejected);
 *   - the proposal has a canonical companyKey (no identity ambiguity);
 *   - verificationLevel is "verified" only — "rejected" is human-only;
 *   - the proposal is not already approved (idempotent re-run is a no-op).
 *
 * The revisionId is deterministic: derived from the proposal, the selected
 * source versions, and the input fingerprint, so re-approving the same
 * proposal is a no-op instead of creating a duplicate revision.
 */

export const autoApproveIndustryProposal = mutation({
  args: {
    writeSecret: v.optional(v.string()),
    proposalId: v.string(),
    industryClass: industryClassValidator,
    approvedSourceIds: v.array(v.string()),
    evidenceSummary: v.string(),
    decisionReason: v.string(),
    taxonomyVersion: v.string(),
    ruleVersion: v.optional(v.string()),
    expectedInputFingerprint: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    requireWriteSecret(args.writeSecret);
    const proposalId = args.proposalId.trim();
    const proposal = await findIndustryProposal(ctx, proposalId);
    if (!proposal || !proposal.companyKey) {
      throw new Error(`Proposal is missing a canonical company: ${proposalId}`);
    }
    if (proposal.status === "approved") {
      // Idempotent re-run: the deterministic revisionId already exists.
      const existing = await findIndustryVerdictRevision(
        ctx,
        deterministicAutoRevisionId(proposalId, args.approvedSourceIds, args.expectedInputFingerprint),
      );
      if (existing) {
        return {
          proposalId,
          revisionId: existing.revisionId,
          companyKey: proposal.companyKey,
          sourceCount: existing.approvedSourceIds.length,
          idempotent: true,
        };
      }
      throw new Error(`Proposal is not open for approval: ${proposal.status}`);
    }
    if (!OPEN_INDUSTRY_PROPOSAL_STATUSES.has(proposal.status)) {
      throw new Error(`Proposal is not open for approval: ${proposal.status}`);
    }

    const approvedSourceIds = uniqueSortedStrings(args.approvedSourceIds);
    if (approvedSourceIds.length === 0) {
      throw new Error("At least one approved evidence source is required");
    }
    const sources = [];
    for (const sourceId of approvedSourceIds) {
      const source = await findIndustryEvidenceSource(ctx, sourceId);
      if (!source) {
        throw new Error(`Unknown evidence source: ${sourceId}`);
      }
      if (
        (source.companyKey && source.companyKey !== proposal.companyKey) ||
        (source.proposalId && source.proposalId !== proposalId)
      ) {
        throw new Error(`Evidence source is not attached to this proposal: ${sourceId}`);
      }
      sources.push(source);
    }

    // Lane A gate: structured registry/taxonomy only, explicit CNC text,
    // fetched + active + unreviewed. Prose evidence is never auto-approvable.
    if (!hasAutoApprovableEvidence(sources)) {
      throw new Error(
        "AUTO_VERIFY_LANE_A_REQUIRED: every selected source must be a fetched, active, unreviewed registry/taxonomy record with explicit CNC evidence",
      );
    }

    const revisionId = deterministicAutoRevisionId(
      proposalId,
      approvedSourceIds,
      args.expectedInputFingerprint,
    );
    return commitIndustryVerdictApproval(ctx, {
      proposalId,
      revisionId,
      verificationLevel: "verified",
      industryClass: args.industryClass,
      approvedSourceIds,
      evidenceSummary: args.evidenceSummary,
      reviewer: "auto-verify-bot",
      reviewerType: "auto-verify-bot",
      decisionReason: args.decisionReason,
      taxonomyVersion: args.taxonomyVersion,
      ruleVersion: args.ruleVersion,
      reviewAttestation: {
        schemaVersion: "industry-review-attestation.v1",
        inputFingerprint:
          args.expectedInputFingerprint ??
          // The bot lane re-validates the full evidence set atomically inside
          // this mutation, so the fingerprint is derived from the actual
          // sources rather than a caller-supplied review packet.
          `auto-${deterministicAutoRevisionId(proposalId, approvedSourceIds, undefined)}`,
        decisionMode: "standard",
        acknowledgedRiskFlags: [],
        cncEvidenceAcknowledged: true,
        acknowledgementReason:
          "Governed Lane A auto-approval: structured registry/taxonomy evidence with explicit CNC signal text",
      },
    });
  },
});

/**
 * Deterministic revisionId for governed auto-approval: derived from the
 * proposal, the selected source IDs, and the review input fingerprint so a
 * re-run of the same approval is a no-op (no duplicate revisions).
 */

function deterministicAutoRevisionId(
  proposalId: string,
  approvedSourceIds: string[],
  inputFingerprint: string | undefined,
): string {
  const material = [
    "auto",
    proposalId,
    ...approvedSourceIds,
    inputFingerprint ?? "",
  ].join("|");
  let hash = 2166136261;
  for (const char of material) {
    hash ^= char.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 16777619);
  }
  return `auto-${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

/**
 * Shared approval core used by the attended human mutation and the governed
 * auto-approve mutation. Validates the proposal/source state, writes the
 * immutable verdict revision (with reviewerType), patches sources + profile,
 * and marks the proposal approved with recompute pending.
 */

async function commitIndustryVerdictApproval(
  ctx: { db: any; scheduler?: any },
  args: {
    proposalId: string;
    revisionId: string;
    expectedCurrentRevisionId?: string;
    expectedProposalUpdatedAt?: number;
    expectedInputFingerprint?: string;
    expectedSourceVersions?: Array<{ sourceId: string; updatedAt: number }>;
    verificationLevel: "verified" | "rejected";
    industryClass: string;
    approvedSourceIds: string[];
    evidenceSummary: string;
    reviewer: string;
    reviewerType: "human" | "auto-verify-bot";
    decisionReason: string;
    taxonomyVersion: string;
    ruleVersion?: string;
    nextReviewAt?: number;
    reviewAttestation?: {
      schemaVersion: "industry-review-attestation.v1";
      inputFingerprint: string;
      decisionMode: "standard" | "risk_override";
      acknowledgedRiskFlags: string[];
      cncEvidenceAcknowledged: boolean;
      acknowledgementReason: string;
    };
  },
) {
  const proposalId = args.proposalId.trim();
  const revisionId = args.revisionId.trim();
  const reviewer = args.reviewer.trim();
  const decisionReason = args.decisionReason.trim();
  const evidenceSummary = args.evidenceSummary.trim();
  const taxonomyVersion = args.taxonomyVersion.trim();
  if (
    !proposalId ||
    !revisionId ||
    !reviewer ||
    !decisionReason ||
    !evidenceSummary ||
    !taxonomyVersion
  ) {
    throw new Error("Approval requires proposal, revision, reviewer, reason, summary, and taxonomy");
  }
  const proposal = await findIndustryProposal(ctx, proposalId);
  if (!proposal || !proposal.companyKey) {
    throw new Error(`Proposal is missing a canonical company: ${proposalId}`);
  }
  const companyKey = proposal.companyKey;
  const profiles = await ctx.db
    .query("company_industry_profiles")
    .withIndex("by_company_key", (q: any) => q.eq("companyKey", companyKey))
    .collect();
  const profile = profiles[0];
  const currentRevisionId = profile?.currentRevisionId;
  if (
    proposal.status === "approved" &&
    proposal.approvedRevisionId === revisionId &&
    currentRevisionId === revisionId
  ) {
    const revisions = await ctx.db
      .query("company_industry_verdict_revisions")
      .withIndex("by_revision_id", (q: any) => q.eq("revisionId", revisionId))
      .collect();
    const revision = revisions[0];
    if (
      !revision ||
      revision.companyKey !== companyKey ||
      revision.proposalId !== proposalId
    ) {
      throw new Error("Approved proposal revision is inconsistent");
    }
    return {
      proposalId,
      revisionId,
      companyKey,
      ...(revision.supersedesRevisionId
        ? { supersedesRevisionId: revision.supersedesRevisionId }
        : {}),
      sourceCount: revision.approvedSourceIds.length,
    };
  }
  if (!OPEN_INDUSTRY_PROPOSAL_STATUSES.has(proposal.status)) {
    throw new Error(`Proposal is not open for approval: ${proposal.status}`);
  }
  if (
    args.reviewAttestation &&
    args.expectedInputFingerprint !== undefined &&
    args.reviewAttestation.inputFingerprint !== args.expectedInputFingerprint
  ) {
    throw new Error(
      `${INDUSTRY_REVIEW_STALE_PREFIX} recommendation fingerprint changed during review`,
    );
  }
  if (
    args.reviewAttestation &&
    args.reviewAttestation.decisionMode === "risk_override" &&
    !args.reviewAttestation.acknowledgementReason.trim()
  ) {
    throw new Error("INDUSTRY_REVIEW_ATTESTATION_INVALID: risk override reason is required");
  }
  if (
    args.industryClass === "cnc" &&
    (!args.reviewAttestation || !args.reviewAttestation.cncEvidenceAcknowledged)
  ) {
    throw new Error(
      "INDUSTRY_REVIEW_CNC_ACK_REQUIRED: explicit CNC evidence acknowledgement is required",
    );
  }
  if (
    args.expectedCurrentRevisionId !== undefined &&
    currentRevisionId !== args.expectedCurrentRevisionId
  ) {
    throw new Error(
      `${INDUSTRY_REVIEW_STALE_PREFIX} current industry revision changed during review`,
    );
  }
  if (
    proposal.currentRevisionId !== undefined &&
    currentRevisionId !== proposal.currentRevisionId
  ) {
    throw new Error(
      `${INDUSTRY_REVIEW_STALE_PREFIX} proposal current revision changed during review`,
    );
  }
  assertExpectedIndustryProposalUpdatedAt(proposal, args.expectedProposalUpdatedAt);
  if (args.expectedSourceVersions !== undefined) {
    const currentSources = await ctx.db
      .query("company_industry_evidence_sources")
      .withIndex("by_proposal", (q: any) => q.eq("proposalId", proposalId))
      .collect();
    const expectedVersions = new Map(
      args.expectedSourceVersions.map((item) => [item.sourceId.trim(), item.updatedAt]),
    );
    if (
      expectedVersions.size !== args.expectedSourceVersions.length ||
      expectedVersions.size !== currentSources.length ||
      currentSources.some(
        (source: { sourceId: string; updatedAt: number }) =>
          expectedVersions.get(source.sourceId) !== source.updatedAt,
      )
    ) {
      throw new Error(
        `${INDUSTRY_REVIEW_STALE_PREFIX} evidence source changed during review`,
      );
    }
  }

  const existingRevisions = await ctx.db
    .query("company_industry_verdict_revisions")
    .withIndex("by_revision_id", (q: any) => q.eq("revisionId", revisionId))
    .collect();
  if (existingRevisions[0]) {
    throw new Error(`revisionId already exists: ${revisionId}`);
  }

  const approvedSourceIds = uniqueSortedStrings(args.approvedSourceIds);
  if (approvedSourceIds.length === 0) {
    throw new Error("At least one approved evidence source is required");
  }
  const sources = [];
  for (const sourceId of approvedSourceIds) {
    const source = await findIndustryEvidenceSource(ctx, sourceId);
    if (!source) {
      throw new Error(`Unknown evidence source: ${sourceId}`);
    }
    if (
      (source.companyKey && source.companyKey !== companyKey) ||
      (source.proposalId && source.proposalId !== proposalId)
    ) {
      throw new Error(`Evidence source is not attached to this proposal: ${sourceId}`);
    }
    if (
      source.sourceType === "search_result" ||
      source.trustTier === "discovery" ||
      normalizeIndustryEvidenceUrl(source.url) === null ||
      source.fetchStatus !== "fetched" ||
      source.sourceState !== "active" ||
      source.reviewStatus === "disputed" ||
      source.reviewStatus === "rejected"
    ) {
      throw new Error(`Evidence source is not approval-safe: ${sourceId}`);
    }
    sources.push(source);
  }

  if (
    args.industryClass === "cnc" &&
    !hasExplicitCncEvidence(sources)
  ) {
    throw new Error(
      "INDUSTRY_REVIEW_CNC_EVIDENCE_REQUIRED: selected sources do not contain explicit CNC evidence",
    );
  }

  const now = Date.now();
  await ctx.db.insert("company_industry_verdict_revisions", {
    revisionId,
    companyKey,
    industryClass: args.industryClass,
    verificationLevel: args.verificationLevel,
    approvedSourceIds,
    evidenceSummary,
    reviewedBy: reviewer,
    reviewerType: args.reviewerType,
    reviewedAt: now,
    decisionReason,
    taxonomyVersion,
    ...(args.ruleVersion?.trim()
      ? { ruleVersion: args.ruleVersion.trim() }
      : {}),
    ...(args.reviewAttestation
      ? { reviewAttestation: args.reviewAttestation }
      : {}),
    ...(currentRevisionId
      ? { supersedesRevisionId: currentRevisionId }
      : {}),
    proposalId,
    createdAt: now,
  });

  for (const source of sources) {
    await ctx.db.patch(source._id, {
      reviewStatus: "approved",
      reviewedAt: now,
      reviewedBy: reviewer,
      reviewerNote: decisionReason,
      updatedAt: now,
    });
  }

  const primarySource = sources[0];
  const nextReviewAt =
    args.nextReviewAt ??
    Math.min(
      ...sources.map((source) =>
        nextIndustryEvidenceReviewAt(
          source.sourceType,
          source.trustTier,
          now,
        ),
      ),
    );
  const profilePayload = {
    companyKey,
    industryClass: args.industryClass,
    verificationLevel: args.verificationLevel,
    evidenceSource: "manual" as const,
    summary: evidenceSummary,
    ...(primarySource
      ? {
          sourceUrl: primarySource.url,
          sourceDomain: primarySource.sourceDomain,
          sourceType: primarySource.sourceType,
        }
      : {}),
    currentRevisionId: revisionId,
    reviewedAt: now,
    reviewedBy: reviewer,
    sourceCount: approvedSourceIds.length,
    freshnessState: "fresh" as const,
    nextReviewAt,
    catalogVersion: (profile?.catalogVersion ?? 0) + 1,
    compatibilityState: "reviewed" as const,
    updatedAt: now,
    updatedBy: reviewer,
  };
  if (profile) {
    await ctx.db.patch(profile._id, profilePayload);
  } else {
    await ctx.db.insert("company_industry_profiles", profilePayload);
  }

  await ctx.db.patch(proposal._id, {
    status: "approved",
    reviewedAt: now,
    reviewedBy: reviewer,
    reviewNote: decisionReason,
    approvedRevisionId: revisionId,
    applicationState: "recompute_pending",
    updatedAt: now,
  });

  // F1: after a verified verdict commits, backfill company-resume links so the
  // affected-resumes list finds rows and the targeted recompute processes them.
  // Rejected verdicts never schedule a backfill. The backfill is idempotent
  // and self-chains, so re-runs are safe.
  await scheduleCompanyLinkBackfill(ctx, {
    companyKey,
    verificationLevel: args.verificationLevel,
  });

  return {
    proposalId,
    revisionId,
    companyKey,
    ...(currentRevisionId
      ? { supersedesRevisionId: currentRevisionId }
      : {}),
    sourceCount: approvedSourceIds.length,
  };
}

export const undoIndustryProposalApproval = mutation({
  args: {
    writeSecret: v.optional(v.string()),
    proposalId: v.string(),
    approvedRevisionId: v.string(),
    expectedCurrentRevisionId: v.optional(v.string()),
    expectedProposalUpdatedAt: v.optional(v.number()),
    recomputeRunId: v.optional(v.string()),
    reviewer: v.string(),
  },
  handler: async (ctx, args) => {
    requireWriteSecret(args.writeSecret);
    const proposalId = args.proposalId.trim();
    const approvedRevisionId = args.approvedRevisionId.trim();
    const reviewer = args.reviewer.trim();
    if (!proposalId || !approvedRevisionId || !reviewer) {
      throw new Error("Undo requires proposal, approved revision, and reviewer");
    }

    const proposal = await findIndustryProposal(ctx, proposalId);
    if (!proposal || !proposal.companyKey) {
      throw new Error(`Unknown industry proposal: ${proposalId}`);
    }
    const companyKey = proposal.companyKey;
    const profiles = await ctx.db
      .query("company_industry_profiles")
      .withIndex("by_company_key", (q: any) => q.eq("companyKey", companyKey))
      .collect();
    const profile = profiles[0] ?? null;
    const currentRevisionId = profile?.currentRevisionId;
    const reversalRevisionId = `undo-${approvedRevisionId}`;
    const existingReversal = await findIndustryVerdictRevision(
      ctx,
      reversalRevisionId,
    );

    if (
      existingReversal &&
      existingReversal.supersedesRevisionId === approvedRevisionId &&
      existingReversal.proposalId === proposalId &&
      proposal.status === "ready_for_review" &&
      currentRevisionId === reversalRevisionId
    ) {
      const existingApprovedRevision = await findIndustryVerdictRevision(
        ctx,
        approvedRevisionId,
      );
      const previousRunId =
        args.recomputeRunId?.trim() || proposal.recomputeRunId;
      const previousRun = previousRunId
        ? await findIndustryRecomputeRun(ctx, previousRunId)
        : null;
      if (previousRun && previousRun.targetRevisionId !== approvedRevisionId) {
        throw new Error(
          `${INDUSTRY_REVIEW_STALE_PREFIX} recompute run no longer targets the approved revision`,
        );
      }
      return {
        proposalId,
        companyKey,
        reversalRevisionId,
        ...(existingApprovedRevision?.supersedesRevisionId
          ? { restoredRevisionId: existingApprovedRevision.supersedesRevisionId }
          : {}),
        ...(previousRun
          ? {
              previousRunId: previousRun.runId,
              previousRunStatus: previousRun.status,
            }
          : {}),
        replacementRecomputeRequired: previousRun?.status === "completed",
        idempotent: true,
      };
    }

    if (
      !profile ||
      currentRevisionId !== approvedRevisionId ||
      proposal.status !== "approved" ||
      proposal.approvedRevisionId !== approvedRevisionId
    ) {
      throw new Error(
        `${INDUSTRY_REVIEW_STALE_PREFIX} approved industry revision is no longer current`,
      );
    }
    if (
      args.expectedCurrentRevisionId !== undefined &&
      currentRevisionId !== args.expectedCurrentRevisionId
    ) {
      throw new Error(
        `${INDUSTRY_REVIEW_STALE_PREFIX} current industry revision changed during Undo`,
      );
    }
    assertExpectedIndustryProposalUpdatedAt(
      proposal,
      args.expectedProposalUpdatedAt,
    );

    const approvedRevision = await findIndustryVerdictRevision(
      ctx,
      approvedRevisionId,
    );
    if (
      !approvedRevision ||
      approvedRevision.companyKey !== companyKey ||
      approvedRevision.proposalId !== proposalId
    ) {
      throw new Error(
        `${INDUSTRY_REVIEW_STALE_PREFIX} approved revision does not belong to this proposal`,
      );
    }
    const previousRevisionId = approvedRevision.supersedesRevisionId;
    const previousRevision = previousRevisionId
      ? await findIndustryVerdictRevision(ctx, previousRevisionId)
      : null;
    if (previousRevisionId && !previousRevision) {
      throw new Error(
        `${INDUSTRY_REVIEW_STALE_PREFIX} previous industry revision is unavailable`,
      );
    }

    const previousRunId =
      args.recomputeRunId?.trim() || proposal.recomputeRunId;
    const previousRun = previousRunId
      ? await findIndustryRecomputeRun(ctx, previousRunId)
      : null;
    if (previousRunId && !previousRun) {
      throw new Error(
        `${INDUSTRY_REVIEW_STALE_PREFIX} recompute run is unavailable`,
      );
    }
    if (
      previousRun &&
      (previousRun.targetRevisionId !== approvedRevisionId ||
        (previousRun.proposalId && previousRun.proposalId !== proposalId) ||
        previousRun.companyKey !== companyKey)
    ) {
      throw new Error(
        `${INDUSTRY_REVIEW_STALE_PREFIX} recompute run no longer targets the approved revision`,
      );
    }

    const restoredSourceIds = previousRevision?.approvedSourceIds ?? [];
    const restoredSources = [];
    for (const sourceId of restoredSourceIds) {
      const source = await findIndustryEvidenceSource(ctx, sourceId);
      if (source && source.companyKey === companyKey) {
        restoredSources.push(source);
      }
    }
    const primarySource = restoredSources[0];
    const now = Date.now();
    const restoredIndustryClass = previousRevision?.industryClass ?? "unknown";
    const restoredVerificationLevel =
      previousRevision?.verificationLevel ?? "rejected";
    const restoredEvidenceSummary =
      previousRevision?.evidenceSummary ??
      `Undo restored no verified industry truth after ${approvedRevisionId}.`;
    const restoredDecisionReason = previousRevision
      ? `Undo approval ${approvedRevisionId}; restored revision ${previousRevision.revisionId}.`
      : `Undo approval ${approvedRevisionId}; no prior verified industry truth existed.`;
    const restoredNextReviewAt =
      restoredSources.length > 0
        ? Math.min(
            ...restoredSources.map((source) =>
              nextIndustryEvidenceReviewAt(
                source.sourceType,
                source.trustTier,
                now,
              ),
            ),
          )
        : undefined;

    await ctx.db.insert("company_industry_verdict_revisions", {
      revisionId: reversalRevisionId,
      companyKey,
      industryClass: restoredIndustryClass,
      verificationLevel: restoredVerificationLevel,
      approvedSourceIds: restoredSourceIds,
      evidenceSummary: restoredEvidenceSummary,
      reviewedBy: reviewer,
      reviewerType: "human",
      reviewedAt: now,
      decisionReason: restoredDecisionReason,
      taxonomyVersion: previousRevision?.taxonomyVersion ?? approvedRevision.taxonomyVersion,
      ...(previousRevision?.ruleVersion
        ? { ruleVersion: previousRevision.ruleVersion }
        : approvedRevision.ruleVersion
          ? { ruleVersion: approvedRevision.ruleVersion }
          : {}),
      supersedesRevisionId: approvedRevisionId,
      proposalId,
      createdAt: now,
    });

    const restoredProfile = {
      companyKey,
      industryClass: restoredIndustryClass,
      verificationLevel: restoredVerificationLevel,
      evidenceSource: "manual" as const,
      ...(profile.officialDomain
        ? { officialDomain: profile.officialDomain }
        : {}),
      summary: restoredEvidenceSummary,
      ...(primarySource
        ? {
            sourceUrl: primarySource.url,
            sourceDomain: primarySource.sourceDomain,
            sourceType: primarySource.sourceType,
          }
        : {}),
      ...(profile.msicCode ? { msicCode: profile.msicCode } : {}),
      ...(profile.msicDescription
        ? { msicDescription: profile.msicDescription }
        : {}),
      ...(profile.fetchedAt ? { fetchedAt: profile.fetchedAt } : {}),
      currentRevisionId: reversalRevisionId,
      reviewedAt: now,
      reviewedBy: reviewer,
      sourceCount: restoredSourceIds.length,
      freshnessState: restoredSourceIds.length > 0 ? ("fresh" as const) : ("changed" as const),
      ...(restoredNextReviewAt !== undefined
        ? { nextReviewAt: restoredNextReviewAt }
        : {}),
      catalogVersion: (profile.catalogVersion ?? 0) + 1,
      compatibilityState: "reviewed" as const,
      updatedAt: now,
      updatedBy: reviewer,
    };
    await ctx.db.replace(profile._id, restoredProfile);

    if (previousRun) {
      if (!TERMINAL_INDUSTRY_RECOMPUTE_STATUSES.has(previousRun.status)) {
        await ctx.db.patch(previousRun._id, {
          status: "superseded",
          supersededByRevisionId: reversalRevisionId,
          completedAt: now,
          updatedAt: now,
        });
      }
    }

    await ctx.db.patch(proposal._id, {
      status: "ready_for_review",
      reviewedAt: now,
      reviewedBy: reviewer,
      reviewNote: restoredDecisionReason,
      approvedRevisionId: undefined,
      applicationState: undefined,
      appliedRevisionId: undefined,
      appliedAt: undefined,
      updatedAt: now,
    });

    return {
      proposalId,
      companyKey,
      reversalRevisionId,
      ...(previousRevisionId ? { restoredRevisionId: previousRevisionId } : {}),
      ...(previousRun
        ? {
            previousRunId: previousRun.runId,
            previousRunStatus: previousRun.status,
          }
        : {}),
      replacementRecomputeRequired: previousRun?.status === "completed",
      idempotent: false,
    };
  },
});

export const resolveIndustryProposal = mutation({
  args: {
    writeSecret: v.optional(v.string()),
    proposalId: v.string(),
    resolution: v.union(
      v.literal("rejected"),
      v.literal("needs_more_evidence"),
      v.literal("superseded"),
    ),
    expectedProposalUpdatedAt: v.optional(v.number()),
    reviewer: v.string(),
    reviewNote: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    requireWriteSecret(args.writeSecret);
    const proposal = await findIndustryProposal(ctx, args.proposalId.trim());
    if (!proposal) {
      throw new Error(`Unknown proposalId: ${args.proposalId}`);
    }
    if (!OPEN_INDUSTRY_PROPOSAL_STATUSES.has(proposal.status)) {
      throw new Error(`Proposal is not open: ${proposal.status}`);
    }
    assertExpectedIndustryProposalUpdatedAt(proposal, args.expectedProposalUpdatedAt);
    const now = Date.now();
    await ctx.db.patch(proposal._id, {
      status: args.resolution,
      reviewedAt: now,
      reviewedBy: args.reviewer.trim(),
      reviewNote: (args.reviewNote ?? "").trim(),
      updatedAt: now,
    });
    return { proposalId: proposal.proposalId, status: args.resolution };
  },
});

export const listIndustryVerdictRevisions = query({
  args: {
    writeSecret: v.optional(v.string()),
    companyKey: v.string(),
  },
  handler: async (ctx, args) => {
    requireReadSecret(args.writeSecret);
    const companyKey = normalizeCompanyKey(args.companyKey);
    const rows = await ctx.db
      .query("company_industry_verdict_revisions")
      .withIndex("by_company_created", (q) => q.eq("companyKey", companyKey))
      .collect();
    return rows.sort(
      (left, right) =>
        right.createdAt - left.createdAt ||
        right.revisionId.localeCompare(left.revisionId),
    );
  },
});

/**
 * List verdict revisions advanced by the governed auto-verify-bot lane
 * (reviewerType = auto-verify-bot), newest first. Used by the sampling-audit
 * script to select ~10% of auto-approved verdicts for human re-review and to
 * track the override rate.
 *
 * Legacy rows (pre-Lane-A) lack reviewerType; they are treated as
 * auto-approved when reviewedBy is "auto-verify-bot" (the migration-bot
 * approvals from the v0.4.23 upgrade).
 */

export const listAutoApprovedVerdictRevisions = query({
  args: {
    writeSecret: v.optional(v.string()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    requireReadSecret(args.writeSecret);
    const limit = Math.min(1000, Math.max(1, Math.floor(args.limit ?? 200)));
    const rows = await ctx.db
      .query("company_industry_verdict_revisions")
      .collect();
    return rows
      .filter(
        (row) =>
          row.reviewerType === "auto-verify-bot" ||
          (row.reviewerType === undefined && row.reviewedBy === "auto-verify-bot"),
      )
      .sort(
        (left, right) =>
          right.createdAt - left.createdAt ||
          right.revisionId.localeCompare(left.revisionId),
      )
      .slice(0, limit);
  },
});

/**
 * Page verdict-revision audit rows (decision history) newest-first, with an
 * optional filter over the batch attestation id (C6 audit UI).
 *
 * No write-secret gate: served to the workspace-admin-gated web audit
 * surface via the Convex React client, mirroring other web-facing queries.
 * The revisions table is a bounded audit trail (one row per decision), so a
 * full scan stays far under the ~10.5k system-op ceiling.
 */
export const listIndustryVerdictRevisionsPage = query({
  args: {
    batchId: v.optional(v.string()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const limit = Math.min(500, Math.max(1, Math.floor(args.limit ?? 100)));
    const batchId = args.batchId?.trim() || undefined;
    const rows = await ctx.db
      .query("company_industry_verdict_revisions")
      .collect();
    return rows
      .filter((row) => !batchId || row.reviewAttestation?.batchId === batchId)
      .sort(
        (left, right) =>
          right.reviewedAt - left.reviewedAt ||
          right.revisionId.localeCompare(left.revisionId),
      )
      .slice(0, limit);
  },
});
