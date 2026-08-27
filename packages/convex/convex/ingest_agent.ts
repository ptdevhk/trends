/// <reference path="./convex-env.d.ts" />
import { internal } from "./_generated/api";
import { api } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { action, internalAction, internalQuery, mutation, query } from "./_generated/server";
import { v } from "convex/values";
import type { ResumeScanRow } from "./resumes";
import {
  CURRENT_INGEST_COMPUTE_EPOCH,
  isRecord,
  resolveBffApiUrl,
  shouldSelectForReingest,
  type BrandOrigin,
  type MachineOrigin,
  type ProductClass,
  type StaleSelectionMode,
} from "@trends/shared";
import { computeProtectedAttributeHashes } from "./audit.js";
import {
  collectResumeIdentityAliases,
  deriveResumeIdentityKey,
  isPlaceholderResumeExternalId,
  normalizeResumeIdentityKey,
  normalizeResumeIdentityToken,
  normalizeResumeProfileUrl,
} from "./lib/resume_identity.js";
import {
  PAGINATE_MAX_BYTES_READ,
  PAGINATE_MAX_ROWS_READ,
} from "./lib/resumes_pagination.js";
import { belongsToWorkspace } from "./search_profiles.js";

interface BrandHit {
  brand: string;
  role: string;
  source: string;
  context: string;
  companyId?: number;
  origin?: BrandOrigin;
  productClass?: ProductClass;
}

interface IndustryDbV2RawComponents {
  companyScore: number;
  brandScore: number;
  weightedBrandUnits: number;
  uniqueCompanies: number;
  brandUnitCount: number;
}

interface RoleSignal {
  type: string;
  matchedSignals: string[];
  signalCount: number;
  occurrences: number;
  years: number;
  industryVerifiedYears?: number;
  roleRelevantYears?: number;
  industryVerifiedRelevantYears?: number;
  matchedWorkEntries?: Array<{
    companyName?: string;
    companyKey?: string;
    jobTitle?: string;
    years: number;
    industryVerified: boolean;
    verdictRevisionId?: string;
    workEntryFingerprint?: string;
    matchedSignals: string[];
    directRoleMatch?: boolean;
  }>;
  verifyIn: string;
}

interface TaggingEnvelope {
  schemaVersion: number;
  generatedAt: number;
  entries: Array<{
    tag: string;
    source: string;
    confidence: number;
    version: number;
    provenance: {
      stage: string;
      generatedBy: string;
      evidence: string[];
    };
  }>;
}

/**
 * Background ingest agent (M3)
 *
 * Processes new resumes by computing industryTags, synonymHits, ruleScores, and experienceLevel
 * via BFF API, then stores results in Convex.
 */

function getBffApiUrl(): string {
  // Shared resolver (packages/shared bff-api-url): explicit BFF_API_URL wins.
  // Preview Docker: TRENDS_DEPLOYMENT_ROLE=preview + public BFF origin (not container loopback).
  // Production host: loopback on production API port via resolveBffApiUrl defaults.
  return resolveBffApiUrl(process.env);
}

function readIngestComputeEpochFromPayload(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) {
    return value;
  }
  return CURRENT_INGEST_COMPUTE_EPOCH;
}

const EXACT_REINGEST_BATCH_SIZE = 50;
const EXACT_REINGEST_SCAN_BATCH_SIZE = 50;
const MAX_EXACT_REINGEST_TARGETS = 500;
const MAX_EXACT_REINGEST_SCAN_PAGES = 10_000;

const exactReingestTargetValidator = v.object({
  referenceResumeId: v.optional(v.string()),
  currentResumeId: v.optional(v.string()),
  profileResumeId: v.optional(v.string()),
  profileUrl: v.optional(v.string()),
  externalId: v.optional(v.string()),
  identityKey: v.optional(v.string()),
  source: v.optional(v.string()),
});

type ExactReingestTargetInput = {
  referenceResumeId?: string;
  currentResumeId?: string;
  profileResumeId?: string;
  profileUrl?: string;
  externalId?: string;
  identityKey?: string;
  source?: string;
};

type ExactReingestSelectorKind =
  | "currentResumeId"
  | "profileUrl"
  | "profileResumeId"
  | "externalId"
  | "identityKey";

type NormalizedExactReingestTarget = {
  targetIndex: number;
  referenceResumeId?: string;
  currentResumeId?: string;
  profileResumeId?: string;
  profileUrlKey?: string;
  externalId?: string;
  identityKey?: string;
  source?: string;
};

type ExactReingestCandidateMatch = {
  targetIndex: number;
  resumeId: string;
  matchedSelectors: ExactReingestSelectorKind[];
  canonicalIdentityKey: string;
  externalId: string;
  profileUrl?: string;
  profileResumeId?: string;
  source: string;
  workspaceSlug?: string;
  isArchived: boolean;
};

type ExactReingestResolvedTarget = {
  referenceResumeId?: string;
  currentResumeId: string;
  profileResumeId?: string;
  profileUrl?: string;
  externalId: string;
  source: string;
  canonicalIdentityKey: string;
  outcome: "resolved";
  selectors: Array<{ kind: ExactReingestSelectorKind; value: string }>;
};

type ExactReingestResolutionResult = {
  requested: number;
  resolved: number;
  resumeIds: string[];
  targets: ExactReingestResolvedTarget[];
};

function readOptionalString(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function requireExactReingestWriteSecret(writeSecret: string | undefined): void {
  const expected = process.env.CONVEX_WRITE_SECRET;
  if (!expected || writeSecret !== expected) {
    throw new Error("Unauthorized Convex write");
  }
}

function exactTargetError(targetIndex: number, message: string): Error {
  return new Error(`Exact re-ingest target ${targetIndex + 1} ${message}`);
}

function normalizeExactReingestTarget(
  target: ExactReingestTargetInput,
  targetIndex: number,
): NormalizedExactReingestTarget {
  const referenceResumeId = readOptionalString(target.referenceResumeId);
  const currentResumeId = readOptionalString(target.currentResumeId);
  const source = readOptionalString(target.source);
  const profileResumeId = target.profileResumeId
    ? normalizeResumeIdentityToken(target.profileResumeId) ?? undefined
    : undefined;
  const externalId = target.externalId && !isPlaceholderResumeExternalId(target.externalId)
    ? normalizeResumeIdentityToken(target.externalId) ?? undefined
    : undefined;
  const profileUrl = readOptionalString(target.profileUrl);
  const normalizedProfileUrl = profileUrl
    ? normalizeResumeProfileUrl(profileUrl, source)
    : undefined;
  const profileUrlKey = normalizedProfileUrl
    ? `profileUrl:${normalizedProfileUrl}`
    : undefined;
  const identityKey = target.identityKey
    ? normalizeResumeIdentityKey(target.identityKey, source) ?? undefined
    : undefined;

  if (target.profileResumeId && !profileResumeId) {
    throw exactTargetError(targetIndex, "has an invalid profileResumeId selector");
  }
  if (target.externalId && !externalId) {
    throw exactTargetError(targetIndex, "has an invalid externalId selector");
  }
  if (profileUrl && !profileUrlKey) {
    throw exactTargetError(targetIndex, "has an invalid profileUrl selector");
  }
  if (target.identityKey && !identityKey) {
    throw exactTargetError(targetIndex, "has an invalid identityKey selector");
  }
  if (!currentResumeId && !profileUrlKey && !profileResumeId && !externalId && !identityKey) {
    throw exactTargetError(targetIndex, "is missing a stable selector or current resume ID");
  }

  return {
    targetIndex,
    referenceResumeId,
    currentResumeId,
    profileResumeId,
    profileUrlKey,
    externalId,
    identityKey,
    source,
  };
}

function targetSelectors(target: NormalizedExactReingestTarget): Array<{
  kind: ExactReingestSelectorKind;
  value: string;
}> {
  const selectors: Array<{ kind: ExactReingestSelectorKind; value: string }> = [];
  if (target.currentResumeId) selectors.push({ kind: "currentResumeId", value: target.currentResumeId });
  if (target.profileUrlKey) selectors.push({ kind: "profileUrl", value: target.profileUrlKey });
  if (target.profileResumeId) selectors.push({ kind: "profileResumeId", value: target.profileResumeId });
  if (target.externalId) selectors.push({ kind: "externalId", value: target.externalId });
  if (target.identityKey) selectors.push({ kind: "identityKey", value: target.identityKey });
  return selectors;
}

export const scanExactReingestCandidates = internalQuery({
  args: {
    cursor: v.optional(v.string()),
    targets: v.array(v.object({
      targetIndex: v.number(),
      currentResumeId: v.optional(v.string()),
      profileResumeId: v.optional(v.string()),
      profileUrlKey: v.optional(v.string()),
      externalId: v.optional(v.string()),
      identityKey: v.optional(v.string()),
    })),
  },
  handler: async (ctx, args): Promise<{
    continueCursor: string;
    isDone: boolean;
    matches: ExactReingestCandidateMatch[];
  }> => {
    const page = await ctx.db.query("resumes").order("desc").paginate({
      cursor: args.cursor ?? null,
      numItems: EXACT_REINGEST_SCAN_BATCH_SIZE,
      maximumBytesRead: PAGINATE_MAX_BYTES_READ,
      maximumRowsRead: PAGINATE_MAX_ROWS_READ,
    });
    const matches: ExactReingestCandidateMatch[] = [];

    for (const resume of page.page) {
      const aliases = collectResumeIdentityAliases({
        content: resume.content,
        externalId: resume.externalId,
        source: resume.source,
      });
      const profileUrlKeys = new Set(aliases.profileUrlKeys);
      const profileResumeIds = new Set(aliases.profileResumeIds);
      const externalIds = new Set(aliases.externalIds);
      const identityKeys = new Set(aliases.identityKeys);
      const storedIdentityKey = resume.identityKey
        ? normalizeResumeIdentityKey(resume.identityKey, resume.source)
        : null;
      if (storedIdentityKey) {
        identityKeys.add(storedIdentityKey);
      }

      for (const target of args.targets) {
        const matchedSelectors: ExactReingestSelectorKind[] = [];
        if (target.currentResumeId === String(resume._id)) matchedSelectors.push("currentResumeId");
        if (target.profileUrlKey && profileUrlKeys.has(target.profileUrlKey)) matchedSelectors.push("profileUrl");
        if (target.profileResumeId && profileResumeIds.has(target.profileResumeId)) matchedSelectors.push("profileResumeId");
        if (target.externalId && externalIds.has(target.externalId)) matchedSelectors.push("externalId");
        if (target.identityKey && identityKeys.has(target.identityKey)) matchedSelectors.push("identityKey");
        if (matchedSelectors.length === 0) {
          continue;
        }

        matches.push({
          targetIndex: target.targetIndex,
          resumeId: String(resume._id),
          matchedSelectors,
          canonicalIdentityKey: storedIdentityKey ?? deriveResumeIdentityKey({
            content: resume.content,
            externalId: resume.externalId,
            source: resume.source,
          }),
          externalId: resume.externalId,
          profileUrl: aliases.profileUrl,
          profileResumeId: aliases.profileResumeId,
          source: resume.source,
          workspaceSlug: resume.workspaceSlug,
          isArchived: resume.isArchived === true,
        });
      }
    }

    return {
      continueCursor: page.continueCursor,
      isDone: page.isDone,
      matches,
    };
  },
});

export const resolveExactReingestTargets = action({
  args: {
    workspaceSlug: v.string(),
    writeSecret: v.optional(v.string()),
    targets: v.array(exactReingestTargetValidator),
  },
  handler: async (ctx, args): Promise<ExactReingestResolutionResult> => {
    requireExactReingestWriteSecret(args.writeSecret);
    if (args.targets.length === 0) {
      throw new Error("Exact re-ingest requires at least one target");
    }
    if (args.targets.length > MAX_EXACT_REINGEST_TARGETS) {
      throw new Error(`Exact re-ingest supports at most ${MAX_EXACT_REINGEST_TARGETS} targets`);
    }

    const workspaceSlug = args.workspaceSlug.trim();
    if (!workspaceSlug) {
      throw new Error("Exact re-ingest requires a workspaceSlug");
    }
    const targets = args.targets.map(normalizeExactReingestTarget);
    const scanTargets = targets.map((target) => ({
      targetIndex: target.targetIndex,
      currentResumeId: target.currentResumeId,
      profileResumeId: target.profileResumeId,
      profileUrlKey: target.profileUrlKey,
      externalId: target.externalId,
      identityKey: target.identityKey,
    }));
    const matchesByTarget = targets.map(() => new Map<ExactReingestSelectorKind, Set<string>>());
    const candidatesById = new Map<string, ExactReingestCandidateMatch>();
    let cursor: string | undefined;
    let isDone = false;

    for (let pageIndex = 0; pageIndex < MAX_EXACT_REINGEST_SCAN_PAGES && !isDone; pageIndex += 1) {
      const page: {
        continueCursor: string;
        isDone: boolean;
        matches: ExactReingestCandidateMatch[];
      } = await ctx.runQuery(internal.ingest_agent.scanExactReingestCandidates, {
        cursor,
        targets: scanTargets,
      });

      for (const match of page.matches) {
        candidatesById.set(match.resumeId, match);
        const selectorMatches = matchesByTarget[match.targetIndex];
        for (const selector of match.matchedSelectors) {
          const resumeIds = selectorMatches.get(selector) ?? new Set<string>();
          resumeIds.add(match.resumeId);
          selectorMatches.set(selector, resumeIds);
        }
      }

      isDone = page.isDone;
      cursor = page.continueCursor || undefined;
    }
    if (!isDone) {
      throw new Error("Exact re-ingest target resolution exceeded the scan page limit");
    }

    const resolvedTargets: ExactReingestResolvedTarget[] = [];
    const orderedResumeIds: string[] = [];
    const seenResumeIds = new Set<string>();

    for (const target of targets) {
      const resolvedBySelector = matchesByTarget[target.targetIndex];
      const resolvedIds = new Set<string>();
      for (const selector of targetSelectors(target)) {
        const matchingIds = resolvedBySelector.get(selector.kind) ?? new Set<string>();
        if (matchingIds.size === 0) {
          throw exactTargetError(target.targetIndex, `selector ${selector.kind} did not match any resume`);
        }
        if (matchingIds.size > 1) {
          throw exactTargetError(
            target.targetIndex,
            `selector ${selector.kind} matched multiple resumes: ${Array.from(matchingIds).join(", ")}`,
          );
        }
        resolvedIds.add(Array.from(matchingIds)[0]);
      }
      if (resolvedIds.size !== 1) {
        throw exactTargetError(target.targetIndex, "selectors conflict and resolve to different resumes");
      }

      const currentResumeId = Array.from(resolvedIds)[0];
      const candidate = candidatesById.get(currentResumeId);
      if (!candidate) {
        throw exactTargetError(target.targetIndex, "could not load the resolved resume");
      }
      if (candidate.isArchived) {
        throw exactTargetError(target.targetIndex, `resolved to archived resume ${currentResumeId}`);
      }
      if (!belongsToWorkspace(candidate.workspaceSlug, workspaceSlug)) {
        throw exactTargetError(
          target.targetIndex,
          `resolved to workspace ${candidate.workspaceSlug ?? "dev"}, not ${workspaceSlug}`,
        );
      }

      resolvedTargets.push({
        referenceResumeId: target.referenceResumeId,
        currentResumeId,
        profileResumeId: candidate.profileResumeId ?? target.profileResumeId,
        profileUrl: candidate.profileUrl,
        externalId: candidate.externalId,
        source: candidate.source,
        canonicalIdentityKey: candidate.canonicalIdentityKey,
        outcome: "resolved",
        selectors: targetSelectors(target),
      });
      if (!seenResumeIds.has(currentResumeId)) {
        seenResumeIds.add(currentResumeId);
        orderedResumeIds.push(currentResumeId);
      }
    }

    return {
      requested: targets.length,
      resolved: orderedResumeIds.length,
      resumeIds: orderedResumeIds,
      targets: resolvedTargets,
    };
  },
});

/**
 * Shared exact-reingest target validation: each target must exist, be
 * unarchived, and belong to the workspace. Used by scheduleExactReingest
 * (mutation, ctx.db reads) and runExactReingestSync (action, internal-query
 * reads) — the fetch mechanism differs, the contract does not.
 */
function validateExactReingestTargets(
  resumeIds: Id<"resumes">[],
  resumes: Array<Doc<"resumes"> | null>,
  workspaceSlug: string,
): void {
  for (let index = 0; index < resumeIds.length; index += 1) {
    const resume = resumes[index];
    if (!resume) {
      throw new Error(
        `Exact re-ingest resume ${String(resumeIds[index])} no longer exists`,
      );
    }
    if (resume.isArchived === true) {
      throw new Error(`Exact re-ingest resume ${String(resume._id)} is archived`);
    }
    if (!belongsToWorkspace(resume.workspaceSlug, workspaceSlug)) {
      throw new Error(
        `Exact re-ingest resume ${String(resume._id)} belongs to workspace ${resume.workspaceSlug ?? "dev"}, not ${workspaceSlug}`,
      );
    }
  }
}

export const scheduleExactReingest = mutation({
  args: {
    workspaceSlug: v.string(),
    writeSecret: v.optional(v.string()),
    resumeIds: v.array(v.id("resumes")),
  },
  handler: async (ctx, args): Promise<{
    requested: number;
    resolved: number;
    scheduled: number;
    batches: number;
    resumeIds: Id<"resumes">[];
    dispatchedAt: number;
  }> => {
    requireExactReingestWriteSecret(args.writeSecret);
    if (args.resumeIds.length === 0) {
      throw new Error("Exact re-ingest requires at least one resolved resume ID");
    }
    if (args.resumeIds.length > MAX_EXACT_REINGEST_TARGETS) {
      throw new Error(`Exact re-ingest supports at most ${MAX_EXACT_REINGEST_TARGETS} targets`);
    }

    const workspaceSlug = args.workspaceSlug.trim();
    if (!workspaceSlug) {
      throw new Error("Exact re-ingest requires a workspaceSlug");
    }
    const resumeIds = Array.from(new Set(args.resumeIds));
    const resumes: Array<Doc<"resumes"> | null> = await Promise.all(
      resumeIds.map((resumeId) => ctx.db.get(resumeId)),
    );
    validateExactReingestTargets(resumeIds, resumes, workspaceSlug);

    const dispatchedAt = Date.now();
    let batches = 0;
    for (let index = 0; index < resumeIds.length; index += EXACT_REINGEST_BATCH_SIZE) {
      await ctx.scheduler.runAfter(0, internal.ingest_agent.processNewResumes, {
        resumeIds: resumeIds.slice(index, index + EXACT_REINGEST_BATCH_SIZE),
      });
      batches += 1;
    }

    return {
      requested: args.resumeIds.length,
      resolved: resumeIds.length,
      scheduled: resumeIds.length,
      batches,
      resumeIds,
      dispatchedAt,
    };
  },
});

/**
 * Synchronous (scheduler-free) variant of scheduleExactReingest for
 * environments where scheduler jobs never execute (preview). Mirrors the same
 * validation (non-empty, capped, deduped, exists, not archived, workspace
 * match) and then runs processNewResumes inline via runAction, returning the
 * processing outcome directly instead of scheduling batches.
 */
export const runExactReingestSync = action({
  args: {
    writeSecret: v.optional(v.string()),
    workspaceSlug: v.string(),
    resumeIds: v.array(v.id("resumes")),
  },
  handler: async (ctx, args): Promise<{
    processed: number;
    error: string | null;
    requested: number;
  }> => {
    requireExactReingestWriteSecret(args.writeSecret);
    if (args.resumeIds.length === 0) {
      throw new Error("Exact re-ingest requires at least one resolved resume ID");
    }
    if (args.resumeIds.length > MAX_EXACT_REINGEST_TARGETS) {
      throw new Error(`Exact re-ingest supports at most ${MAX_EXACT_REINGEST_TARGETS} targets`);
    }

    const workspaceSlug = args.workspaceSlug.trim();
    if (!workspaceSlug) {
      throw new Error("Exact re-ingest requires a workspaceSlug");
    }
    const resumeIds = Array.from(new Set(args.resumeIds));
    // Action contexts have no direct db reader: fetch via internal query and
    // diff against the requested set to detect missing resumes.
    const fetched = await ctx.runQuery(internal.resumes_search.getResumesByIds, {
      resumeIds,
    });
    const fetchedById = new Map(
      fetched.map((resume) => [String(resume._id), resume]),
    );
    validateExactReingestTargets(
      resumeIds,
      resumeIds.map((resumeId) => fetchedById.get(String(resumeId)) ?? null),
      workspaceSlug,
    );

    const result = await ctx.runAction(internal.ingest_agent.processNewResumes, {
      resumeIds,
    });
    return {
      processed: result.processed,
      error: result.error,
      requested: resumeIds.length,
    };
  },
});

export const getExactReingestReadiness = query({
  args: {
    workspaceSlug: v.string(),
    writeSecret: v.optional(v.string()),
    resumeIds: v.array(v.id("resumes")),
    dispatchedAt: v.number(),
    expectedSkillsVersion: v.number(),
    expectedCompanyKey: v.optional(v.string()),
    expectedVerdictRevisionId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    requireExactReingestWriteSecret(args.writeSecret);
    if (args.resumeIds.length === 0) {
      throw new Error("Exact re-ingest readiness requires at least one resume ID");
    }
    if (args.resumeIds.length > MAX_EXACT_REINGEST_TARGETS) {
      throw new Error(`Exact re-ingest readiness supports at most ${MAX_EXACT_REINGEST_TARGETS} targets`);
    }

    const workspaceSlug = args.workspaceSlug.trim();
    if (!workspaceSlug) {
      throw new Error("Exact re-ingest readiness requires a workspaceSlug");
    }
    const resumeIds = Array.from(new Set(args.resumeIds));
    const resumes = await Promise.all(resumeIds.map((resumeId) => ctx.db.get(resumeId)));
    const expectedCompanyKey = args.expectedCompanyKey?.trim().toLowerCase();
    const expectedVerdictRevisionId =
      args.expectedVerdictRevisionId?.trim();
    const targets = await Promise.all(resumes.map(async (resume, index) => {
      const currentResumeId = String(resumeIds[index]);
      if (!resume) {
        return {
          currentResumeId,
          state: "invalid" as const,
          phase2FieldsPresent: false,
          reasons: ["resume_missing"],
        };
      }
      if (resume.isArchived === true) {
        return {
          currentResumeId,
          state: "invalid" as const,
          computedAt: resume.ingestData?.computedAt,
          skillsVersion: resume.ingestData?.skillsVersion,
          phase2FieldsPresent: false,
          reasons: ["resume_archived"],
        };
      }
      if (!belongsToWorkspace(resume.workspaceSlug, workspaceSlug)) {
        return {
          currentResumeId,
          state: "invalid" as const,
          computedAt: resume.ingestData?.computedAt,
          skillsVersion: resume.ingestData?.skillsVersion,
          phase2FieldsPresent: false,
          reasons: ["workspace_mismatch"],
        };
      }

      const computedAt = resume.ingestData?.computedAt;
      const skillsVersion = resume.ingestData?.skillsVersion;
      const phase2FieldsPresent = typeof resume.ingestData?.brandOrigin === "string"
        && typeof resume.ingestData?.productClass === "string";
      const reasons: string[] = [];
      if (typeof computedAt !== "number") {
        reasons.push("computed_at_missing");
      } else if (computedAt < args.dispatchedAt) {
        reasons.push("computed_before_dispatch");
      }
      if (skillsVersion !== args.expectedSkillsVersion) {
        reasons.push("skills_version_mismatch");
      }
      if (!phase2FieldsPresent) {
        reasons.push("phase_2_fields_missing");
      }
      if (expectedCompanyKey && expectedVerdictRevisionId) {
        const companyLinks = await ctx.db
          .query("company_resume_links")
          .withIndex("by_resume", (query) =>
            query.eq("resumeId", resumeIds[index]),
          )
          .collect();
        const companyLink = companyLinks.find(
          (link) => link.companyKey === expectedCompanyKey,
        );
        if (!companyLink) {
          reasons.push("industry_evidence_company_link_missing");
        } else if (
          companyLink.currentVerdictRevisionId !== expectedVerdictRevisionId
        ) {
          reasons.push("industry_evidence_revision_mismatch");
        }
      }

      return {
        currentResumeId,
        state: reasons.length === 0 ? "ready" as const : "pending" as const,
        computedAt,
        skillsVersion,
        phase2FieldsPresent,
        reasons,
      };
    }));
    const ready = targets.filter((target) => target.state === "ready").length;
    const pending = targets.filter((target) => target.state === "pending").length;
    const invalid = targets.filter((target) => target.state === "invalid").length;

    return {
      allReady: ready === targets.length,
      ready,
      pending,
      invalid,
      checkedAt: Date.now(),
      dispatchedAt: args.dispatchedAt,
      expectedSkillsVersion: args.expectedSkillsVersion,
      targets,
    };
  },
});

export const processNewResumes = internalAction({
  args: {
    resumeIds: v.array(v.id("resumes")),
  },
  handler: async (
    ctx,
    args
  ): Promise<{ processed: number; error: string | null }> => {
    const { resumeIds } = args;

    if (resumeIds.length === 0) {
      return { processed: 0, error: null };
    }

    console.debug(`[ingest_agent] Processing ${resumeIds.length} resumes...`);

    try {
      // 1. Fetch resume documents
      const resumes: Array<{ _id: Id<"resumes">; content: Record<string, unknown>; sourceKey?: string; workspaceSlug?: string }> = await ctx.runQuery(internal.resumes_search.getResumesByIds, {
        resumeIds,
      });

      if (resumes.length === 0) {
        console.debug("[ingest_agent] No resumes found");
        return { processed: 0, error: null };
      }

      // 2. Prepare payload for BFF (include sourceKey for market derivation)
      const payload = {
        resumes: resumes.map((resume: { _id: Id<"resumes">; content: Record<string, unknown>; sourceKey?: string; workspaceSlug?: string }) => ({
          resumeId: resume._id,
          content: resume.content,
          sourceKey: resume.sourceKey,
          workspaceSlug: resume.workspaceSlug ?? "dev",
        })),
      };

      // 3. Call BFF ingest compute endpoint
      const bffUrl = getBffApiUrl();
      const endpoint = `${bffUrl}/api/resumes/ingest-compute`;

      console.debug(`[ingest_agent] Calling BFF at ${endpoint}...`);

      const headers: Record<string, string> = {
        "Content-Type": "application/json",
      };
      const writeSecret = readOptionalString(process.env.CONVEX_WRITE_SECRET);
      if (writeSecret) {
        headers["X-Convex-Write-Secret"] = writeSecret;
      }

      const response = await fetch(endpoint, {
        method: "POST",
        headers,
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        const text = await response.text();
        const error = `BFF API error: ${response.status} ${response.statusText} - ${text}`;
        console.error(`[ingest_agent] ${error}`);
        return { processed: 0, error };
      }

      const result = (await response.json()) as {
        success?: boolean;
        results?: unknown[];
      };

      if (!result.success || !Array.isArray(result.results)) {
        const error = `Invalid BFF response: ${JSON.stringify(result)}`;
        console.error(`[ingest_agent] ${error}`);
        return { processed: 0, error };
      }

      // 4. Store results via mutation
      const updates = (result.results as Array<Record<string, unknown>>).map((item) => ({
        resumeId: item.resumeId as Id<"resumes">,
        ingestData: {
          market: item.market as string,
          evidenceText: (item.evidenceText as string) || "",
          industryTags: item.industryTags as string[],
          synonymHits: item.synonymHits as string[],
          brandHits: (item.brandHits as BrandHit[]) || [],
          brandOrigin: item.brandOrigin as BrandOrigin | undefined,
          machineOrigin: item.machineOrigin as MachineOrigin | undefined,
          productClass: item.productClass as ProductClass | undefined,
          companyHits: (item.companyHits as string[]) || [],
          industryDbV2Raw: item.industryDbV2Raw as number | undefined,
          industryDbV2RawComponents: (item.industryDbV2RawComponents as IndustryDbV2RawComponents) || undefined,
          roleSignals: (item.roleSignals as RoleSignal[]) || [],
          verifiedRoleYears: (item.verifiedRoleYears as Record<string, number>) || undefined,
          taggingEnvelope: (item.taggingEnvelope as TaggingEnvelope) || undefined,
          ruleScores: item.ruleScores as Record<string, number>,
          experienceLevel: item.experienceLevel as string,
          computedAt: item.computedAt as number,
          skillsVersion: item.skillsVersion as number,
          ingestComputeEpoch: readIngestComputeEpochFromPayload(item.ingestComputeEpoch),
          evidenceProjectionVersion:
            typeof item.evidenceProjectionVersion === "number"
              ? item.evidenceProjectionVersion
              : undefined,
          verifiedIndustryEvidenceSummaries:
            Array.isArray(item.verifiedIndustryEvidenceSummaries)
              ? item.verifiedIndustryEvidenceSummaries
              : undefined,
          industryEvidenceCatalogState:
            item.industryEvidenceCatalogState === "ready"
              ? ("ready" as const)
              : item.industryEvidenceCatalogState === "degraded"
                ? ("degraded" as const)
                : undefined,
        },
        companyPatternAliasTokens: (item.companyPatternAliasTokens as string) || "",
        primaryRuleScore: typeof item.primaryRuleScore === "number" ? item.primaryRuleScore : 0,
      }));

      await ctx.runMutation(internal.resumes_mutations.updateIngestDataBatch, {
        updates,
      });

      // Audit log — EU AI Act compliance for automated rank/tag decisions
      for (const update of updates) {
        try {
          const resumeDoc = resumes.find((r) => String(r._id) === String(update.resumeId));
          const protectedHashes = computeProtectedAttributeHashes({
            source: resumeDoc?.sourceKey ?? undefined,
          });
          const auditLogId = await ctx.runMutation(internal.audit.logAnalysisDecision, {
            resumeId: update.resumeId,
            workspaceSlug: "default",
            decisionType: "rank",
            actionRef: "ingest_agent:processNewResumes",
            inputSnapshot: {},
            modelMeta: {
              model: "rule-based",
              provider: "internal",
            },
            output: {
              score: update.primaryRuleScore > 0 ? update.primaryRuleScore : undefined,
              tags: update.ingestData.industryTags,
            },
            protectedAttributeHashes: protectedHashes,
            decidedAt: update.ingestData.computedAt ?? Date.now(),
          });
          await ctx.runMutation(api.audit.setAuditOutcome, {
            auditLogId,
            outcome: "accepted",
            setBy: "system:ingest_agent",
          });
        } catch (auditError) {
          console.error(`[audit] Failed to log ingest decision for resume ${String(update.resumeId)}:`, auditError);
        }
      }

      console.debug(`[ingest_agent] Successfully processed ${updates.length} resumes`);

      return { processed: updates.length, error: null };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[ingest_agent] Error:`, message);
      return { processed: 0, error: message };
    }
  },
});

export const reIngestAllResumes = internalAction({
  args: {},
  handler: async (ctx): Promise<{ scheduled: number; batches: number }> => {
    const batchSize = 50;
    let cursor: string | undefined;
    let scheduled = 0;
    let batches = 0;

    while (true) {
      const batch: {
        continueCursor: string;
        isDone: boolean;
        page: ResumeScanRow[];
      } = await ctx.runQuery(internal.resumes.listResumeScanBatch, { cursor });

      const resumeIds = batch.page.map((resume) => resume._id);

      for (let index = 0; index < resumeIds.length; index += batchSize) {
        await ctx.scheduler.runAfter(0, internal.ingest_agent.processNewResumes, {
          resumeIds: resumeIds.slice(index, index + batchSize),
        });
        batches += 1;
      }

      scheduled += resumeIds.length;

      if (batch.isDone) {
        break;
      }

      cursor = batch.continueCursor;
    }

    return { scheduled, batches };
  },
});

function resolveStaleSelectionMode(value: string | undefined): StaleSelectionMode {
  if (value === "skills" || value === "compute" || value === "any") {
    return value;
  }
  return "any";
}

export type ReIngestStaleResult = {
  scheduled: number;
  batches: number;
  currentVersion: number;
  currentIngestComputeEpoch: number;
  hasMore: boolean;
  cursor: string | null;
  mode: StaleSelectionMode;
  dryRun: boolean;
  /** Resume rows actually scanned in this invocation (page rows fetched, not the requested limit). */
  scannedRows: number;
  /** Rows seen in this scan that are skills-stale (may exceed scheduled when dry-run/count capped). */
  skillsStaleCount: number;
  /** Rows seen in this scan that are compute-stale. */
  computeStaleCount: number;
  /** Rows selected under `mode` in this scan (before limit truncate for schedule). */
  matchedCount: number;
};

export const reIngestStaleResumes = internalAction({
  args: {
    limit: v.optional(v.number()),
    cursor: v.optional(v.string()),
    /** skills | compute | any (default any — skills lag OR compute epoch lag) */
    mode: v.optional(v.string()),
    /** When true, scan and count only — do not schedule processNewResumes */
    dryRun: v.optional(v.boolean()),
  },
  handler: async (ctx, args): Promise<ReIngestStaleResult> => {
    const limit = Math.max(1, Math.min(args.limit ?? 200, 1000));
    const mode = resolveStaleSelectionMode(args.mode);
    const dryRun = args.dryRun === true;
    const bffUrl = getBffApiUrl();
    const versionHeaders: Record<string, string> = {
      Accept: "application/json",
    };
    const writeSecret = readOptionalString(process.env.CONVEX_WRITE_SECRET);
    if (writeSecret) {
      versionHeaders["X-Convex-Write-Secret"] = writeSecret;
    }
    const versionResponse = await fetch(`${bffUrl}/api/resumes/skills-version`, {
      headers: versionHeaders,
    });

    if (!versionResponse.ok) {
      const text = await versionResponse.text();
      throw new Error(`Failed to get skills version: ${versionResponse.status} ${versionResponse.statusText} - ${text}`);
    }

    const versionPayload: unknown = await versionResponse.json();
    if (!isRecord(versionPayload)) {
      throw new Error("Invalid skills version response: expected object");
    }

    const currentVersion = versionPayload.version;
    if (typeof currentVersion !== "number" || !Number.isFinite(currentVersion)) {
      throw new Error("Invalid skills version response: version must be a number");
    }

    const currentEpoch =
      typeof versionPayload.ingestComputeEpoch === "number"
        && Number.isFinite(versionPayload.ingestComputeEpoch)
        ? versionPayload.ingestComputeEpoch
        : CURRENT_INGEST_COMPUTE_EPOCH;

    const batchSize = 100;
    let cursor = args.cursor;
    let nextCursor: string | null = null;
    const resumeIds: Id<"resumes">[] = [];
    let batches = 0;
    let scannedRows = 0;
    let skillsStaleCount = 0;
    let computeStaleCount = 0;
    let matchedCount = 0;

    while (resumeIds.length < limit) {
      const batch: {
        continueCursor: string;
        isDone: boolean;
        page: ResumeScanRow[];
      } = await ctx.runQuery(internal.resumes.listResumeScanBatch, {
        cursor,
        limit: Math.min(batchSize, limit - resumeIds.length),
      });

      if (!batch.isDone && !batch.continueCursor) {
        throw new Error("Resume scan returned an unfinished page without a continuation cursor");
      }
      nextCursor = batch.isDone ? null : batch.continueCursor;
      scannedRows += batch.page.length;

      for (const resume of batch.page) {
        // Skills path historically required ingestData present.
        const hasIngest = resume.ingestData !== undefined;
        if (hasIngest && shouldSelectForReingest(resume.ingestData, "skills", currentVersion, currentEpoch)) {
          skillsStaleCount += 1;
        }
        if (hasIngest && shouldSelectForReingest(resume.ingestData, "compute", currentVersion, currentEpoch)) {
          computeStaleCount += 1;
        }
        const selected =
          hasIngest
          && shouldSelectForReingest(resume.ingestData, mode, currentVersion, currentEpoch);
        if (!selected) {
          continue;
        }
        matchedCount += 1;
        resumeIds.push(resume._id);
      }

      if (resumeIds.length >= limit) {
        break;
      }

      if (batch.isDone) {
        break;
      }

      cursor = batch.continueCursor;
    }

    const hasMore = nextCursor !== null;

    if (dryRun || resumeIds.length === 0) {
      return {
        scheduled: 0,
        batches: 0,
        currentVersion,
        currentIngestComputeEpoch: currentEpoch,
        hasMore,
        cursor: nextCursor,
        mode,
        dryRun,
        scannedRows,
        skillsStaleCount,
        computeStaleCount,
        matchedCount: Math.min(matchedCount, limit),
      };
    }

    for (let index = 0; index < resumeIds.length; index += batchSize) {
      await ctx.scheduler.runAfter(0, internal.ingest_agent.processNewResumes, {
        resumeIds: resumeIds.slice(index, index + batchSize),
      });
      batches += 1;
    }

    return {
      scheduled: resumeIds.length,
      batches,
      currentVersion,
      currentIngestComputeEpoch: currentEpoch,
      hasMore,
      cursor: nextCursor,
      mode,
      dryRun: false,
      scannedRows,
      skillsStaleCount,
      computeStaleCount,
      matchedCount: resumeIds.length,
    };
  },
});
