import { createHash } from "node:crypto";

import {
  INDUSTRY_CLASSES,
  INDUSTRY_EVIDENCE_SOURCE_TYPES,
  INDUSTRY_EVIDENCE_TRUST_TIERS,
  normalizeIndustryEvidenceUrl,
  type IndustryClass,
  type IndustryEvidenceSourceType,
  type IndustryEvidenceTrustTier,
} from "@trends/shared";

export type MyBootstrapSourceInput = {
  url: string;
  sourceType: Exclude<IndustryEvidenceSourceType, "search_result">;
  trustTier: Exclude<IndustryEvidenceTrustTier, "discovery">;
  title?: string;
  evidenceExcerpt?: string;
  fetchedAt?: number;
  contentFingerprint?: string;
};

export type MyBootstrapCompanyInput = {
  companyKey: string;
  employerName: string;
  industryClass: IndustryClass;
  verificationLevel: "verified" | "rejected";
  evidenceSummary: string;
  decisionReason: string;
  taxonomyVersion: string;
  ruleVersion?: string;
  nextReviewAt?: number;
  sources: MyBootstrapSourceInput[];
};

export type MyBootstrapSourcePlan = MyBootstrapSourceInput & {
  sourceId: string;
  companyKey: string;
  proposalId: string;
  url: string;
  sourceDomain: string;
};

export type MyBootstrapCompanyPlan = Omit<MyBootstrapCompanyInput, "sources"> & {
  proposalId: string;
  revisionId: string;
  sources: MyBootstrapSourcePlan[];
};

export type MyBootstrapPlan = {
  schemaVersion: 1;
  generatedAt: string;
  companies: MyBootstrapCompanyPlan[];
};

export type MyBootstrapBeforeState = {
  companyKey: string;
  currentRevisionId?: string;
  profile?: unknown;
};

export type MyBootstrapApplyResult = {
  companyKey: string;
  proposalId: string;
  revisionId: string;
  sourceIds: string[];
  success: boolean;
  error?: string;
};

export type MyBootstrapRollbackPacket = {
  schemaVersion: 1;
  generatedAt: string;
  mode: "compensating_revision_required";
  warning: string;
  entries: Array<{
    companyKey: string;
    importedProposalId: string;
    importedRevisionId: string;
    importedSourceIds: string[];
    previousCurrentRevisionId?: string;
    previousProfile?: unknown;
    applySucceeded: boolean;
    error?: string;
  }>;
};

const industryClasses = new Set<IndustryClass>(INDUSTRY_CLASSES);
const SOURCE_TYPES = new Set<MyBootstrapSourceInput["sourceType"]>(
  INDUSTRY_EVIDENCE_SOURCE_TYPES.filter(
    (sourceType): sourceType is MyBootstrapSourceInput["sourceType"] =>
      sourceType !== "search_result",
  ),
);
const TRUST_TIERS = new Set<MyBootstrapSourceInput["trustTier"]>(
  INDUSTRY_EVIDENCE_TRUST_TIERS.filter(
    (trustTier): trustTier is MyBootstrapSourceInput["trustTier"] =>
      trustTier !== "discovery",
  ),
);

function nonEmptyString(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${field} is required`);
  }
  return value.trim();
}

export function normalizeBootstrapCompanyKey(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9-]/g, "")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

function deterministicId(prefix: string, parts: unknown[]): string {
  const hash = createHash("sha256")
    .update(JSON.stringify(parts))
    .digest("hex")
    .slice(0, 24);
  return `${prefix}-${hash}`;
}

function normalizeSource(
  source: MyBootstrapSourceInput,
  context: { companyKey: string; proposalId: string },
): MyBootstrapSourcePlan {
  const normalizedUrl = normalizeIndustryEvidenceUrl(source.url);
  if (!normalizedUrl) {
    throw new Error(
      `Invalid public evidence URL for ${context.companyKey}: ${String(source.url)}`,
    );
  }
  if (!SOURCE_TYPES.has(source.sourceType)) {
    throw new Error(
      `Bootstrap approval cannot use discovery source type ${String(source.sourceType)}`,
    );
  }
  if (!TRUST_TIERS.has(source.trustTier)) {
    throw new Error(
      `Bootstrap approval cannot use discovery trust ${String(source.trustTier)}`,
    );
  }
  const sourceId = deterministicId("my-src", [
    context.companyKey,
    normalizedUrl.url,
    source.sourceType,
  ]);
  return {
    sourceId,
    companyKey: context.companyKey,
    proposalId: context.proposalId,
    url: normalizedUrl.url,
    sourceDomain: normalizedUrl.sourceDomain,
    sourceType: source.sourceType,
    trustTier: source.trustTier,
    ...(source.title?.trim() ? { title: source.title.trim() } : {}),
    ...(source.evidenceExcerpt?.trim()
      ? { evidenceExcerpt: source.evidenceExcerpt.trim() }
      : {}),
    ...(typeof source.fetchedAt === "number" &&
    Number.isFinite(source.fetchedAt)
      ? { fetchedAt: source.fetchedAt }
      : {}),
    ...(source.contentFingerprint?.trim()
      ? { contentFingerprint: source.contentFingerprint.trim() }
      : {}),
  };
}

export function buildMyBootstrapPlan(
  inputs: MyBootstrapCompanyInput[],
  generatedAt = new Date().toISOString(),
): MyBootstrapPlan {
  if (!Array.isArray(inputs) || inputs.length === 0) {
    throw new Error("Bootstrap input must contain at least one company");
  }

  const seenCompanyKeys = new Set<string>();
  const companies = inputs.map((input, index): MyBootstrapCompanyPlan => {
    const companyKey = normalizeBootstrapCompanyKey(
      nonEmptyString(input.companyKey, `companies[${index}].companyKey`),
    );
    if (!companyKey) {
      throw new Error(`companies[${index}].companyKey is invalid`);
    }
    if (seenCompanyKeys.has(companyKey)) {
      throw new Error(`Duplicate bootstrap companyKey: ${companyKey}`);
    }
    seenCompanyKeys.add(companyKey);

    if (!industryClasses.has(input.industryClass)) {
      throw new Error(`Invalid industryClass for ${companyKey}`);
    }
    if (
      input.verificationLevel !== "verified" &&
      input.verificationLevel !== "rejected"
    ) {
      throw new Error(
        `Bootstrap verdict for ${companyKey} must be verified or rejected`,
      );
    }
    const employerName = nonEmptyString(
      input.employerName,
      `${companyKey}.employerName`,
    );
    const evidenceSummary = nonEmptyString(
      input.evidenceSummary,
      `${companyKey}.evidenceSummary`,
    );
    const decisionReason = nonEmptyString(
      input.decisionReason,
      `${companyKey}.decisionReason`,
    );
    const taxonomyVersion = nonEmptyString(
      input.taxonomyVersion,
      `${companyKey}.taxonomyVersion`,
    );
    if (!Array.isArray(input.sources) || input.sources.length === 0) {
      throw new Error(`${companyKey} requires at least one approved source`);
    }

    const proposalId = deterministicId("my-bootstrap", [companyKey]);
    const sources = input.sources.map((source) =>
      normalizeSource(source, { companyKey, proposalId }),
    );
    if (new Set(sources.map((source) => source.sourceId)).size !== sources.length) {
      throw new Error(`${companyKey} contains duplicate evidence sources`);
    }
    const revisionId = deterministicId("my-rev", [
      companyKey,
      input.industryClass,
      input.verificationLevel,
      evidenceSummary,
      taxonomyVersion,
      sources.map((source) => source.sourceId).sort(),
    ]);

    return {
      companyKey,
      employerName,
      industryClass: input.industryClass,
      verificationLevel: input.verificationLevel,
      evidenceSummary,
      decisionReason,
      taxonomyVersion,
      ...(input.ruleVersion?.trim()
        ? { ruleVersion: input.ruleVersion.trim() }
        : {}),
      ...(typeof input.nextReviewAt === "number" &&
      Number.isFinite(input.nextReviewAt)
        ? { nextReviewAt: input.nextReviewAt }
        : {}),
      proposalId,
      revisionId,
      sources,
    };
  });

  return {
    schemaVersion: 1,
    generatedAt,
    companies: companies.sort((left, right) =>
      left.companyKey.localeCompare(right.companyKey),
    ),
  };
}

export function buildMyBootstrapRollbackPacket(
  plan: MyBootstrapPlan,
  beforeStates: MyBootstrapBeforeState[],
  results: MyBootstrapApplyResult[],
  generatedAt = new Date().toISOString(),
): MyBootstrapRollbackPacket {
  const beforeByCompany = new Map(
    beforeStates.map((state) => [state.companyKey, state]),
  );
  const resultByCompany = new Map(
    results.map((result) => [result.companyKey, result]),
  );
  return {
    schemaVersion: 1,
    generatedAt,
    mode: "compensating_revision_required",
    warning:
      "Verdict revisions are immutable. Rollback must create and approve a new compensating proposal/revision; never delete or mutate the imported current revision.",
    entries: plan.companies.map((company) => {
      const before = beforeByCompany.get(company.companyKey);
      const result = resultByCompany.get(company.companyKey);
      return {
        companyKey: company.companyKey,
        importedProposalId: company.proposalId,
        importedRevisionId: company.revisionId,
        importedSourceIds: company.sources.map((source) => source.sourceId),
        ...(before?.currentRevisionId
          ? { previousCurrentRevisionId: before.currentRevisionId }
          : {}),
        ...(before?.profile !== undefined
          ? { previousProfile: before.profile }
          : {}),
        applySucceeded: result?.success === true,
        ...(result?.error ? { error: result.error } : {}),
      };
    }),
  };
}
