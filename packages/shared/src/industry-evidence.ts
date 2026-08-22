export const MACHINE_ORIGINS = [
  "international",
  "domestic",
  "unknown",
] as const;

export type MachineOrigin = (typeof MACHINE_ORIGINS)[number];

export const INDUSTRY_CLASSES = [
  "cnc",
  "automation",
  "metrology",
  "industrial",
  "non_industry",
  "unknown",
] as const;

export type IndustryClass = (typeof INDUSTRY_CLASSES)[number];

export const INDUSTRY_VERIFICATION_LEVELS = [
  "verified",
  "candidate",
  "rejected",
] as const;

export type IndustryVerificationLevel =
  (typeof INDUSTRY_VERIFICATION_LEVELS)[number];

export const INDUSTRY_EVIDENCE_SOURCE_TYPES = [
  "official_site",
  "registry",
  "taxonomy",
  "oem_partner",
  "trade_body",
  "directory",
  "reporting",
  "other",
  "search_result",
] as const;

export type IndustryEvidenceSourceType =
  (typeof INDUSTRY_EVIDENCE_SOURCE_TYPES)[number];

export const INDUSTRY_EVIDENCE_TRUST_TIERS = [
  "primary",
  "authoritative",
  "corroborating",
  "discovery",
] as const;

export type IndustryEvidenceTrustTier =
  (typeof INDUSTRY_EVIDENCE_TRUST_TIERS)[number];

export const INDUSTRY_EVIDENCE_FRESHNESS_STATES = [
  "fresh",
  "refresh_due",
  "checking",
  "changed",
  "unavailable",
  "conflict",
] as const;

export type IndustryEvidenceFreshnessState =
  (typeof INDUSTRY_EVIDENCE_FRESHNESS_STATES)[number];

export const INDUSTRY_MAINTENANCE_TRIGGER_REASONS = [
  "unknown_employer",
  "weak_employer_evidence",
  "high_value_candidate",
  "frequent_employer",
  "missing_approved_profile",
  "evidence_conflict",
  "scheduled_freshness",
  "material_source_change",
  "source_unavailable",
  "recruiter_refresh_request",
  "curated",
  "corpus_evidence",
  "manual",
] as const;

export type IndustryMaintenanceTriggerReason =
  (typeof INDUSTRY_MAINTENANCE_TRIGGER_REASONS)[number];

export const INDUSTRY_PROPOSAL_STATUSES = [
  "new",
  "researching",
  "ready_for_review",
  "needs_more_evidence",
  "approved",
  "rejected",
  "superseded",
] as const;

export type IndustryProposalStatus =
  (typeof INDUSTRY_PROPOSAL_STATUSES)[number];

export const MAX_RECRUITER_INDUSTRY_EVIDENCE_SOURCES = 3;

/**
 * Revision of the bounded recruiter-facing evidence projection stored on
 * resume ingest data and digests. Bump when the materialized summary contract
 * or its strict revision-matching semantics change.
 */
export const CURRENT_INDUSTRY_EVIDENCE_PROJECTION_VERSION = 1;

export interface IndustryEvidenceSourcePreview {
  sourceId: string;
  url: string;
  sourceDomain: string;
  sourceType: Exclude<IndustryEvidenceSourceType, "search_result">;
  trustTier: Exclude<IndustryEvidenceTrustTier, "discovery">;
  title?: string;
  evidenceExcerpt?: string;
  fetchedAt?: number;
  reviewedAt?: number;
}

export interface IndustryVerdictRevisionRef {
  verdictRevisionId: string;
  industryClass: IndustryClass;
  verificationLevel: "verified";
  reviewedAt: number;
  reviewedBy?: string;
}

export interface VerifiedIndustryEvidenceSummary
  extends IndustryVerdictRevisionRef {
  companyKey: string;
  companyName: string;
  evidenceSummary: string;
  machineOrigin?: MachineOrigin;
  verifiedYears?: number;
  roleTypes?: string[];
  latestRoleAt?: number;
  sourceCount: number;
  sourcePreviews: IndustryEvidenceSourcePreview[];
  additionalSourceCount: number;
  freshnessState?: IndustryEvidenceFreshnessState;
}

export interface NormalizedIndustryEvidenceUrl {
  url: string;
  sourceDomain: string;
}

const industryClassSet = new Set<string>(INDUSTRY_CLASSES);
const machineOriginSet = new Set<string>(MACHINE_ORIGINS);
const sourceTypeSet = new Set<string>(INDUSTRY_EVIDENCE_SOURCE_TYPES);
const trustTierSet = new Set<string>(INDUSTRY_EVIDENCE_TRUST_TIERS);
const freshnessStateSet = new Set<string>(
  INDUSTRY_EVIDENCE_FRESHNESS_STATES,
);

const sourceTrustRank: Record<
  Exclude<IndustryEvidenceTrustTier, "discovery">,
  number
> = {
  primary: 0,
  authoritative: 1,
  corroborating: 2,
};

const sourceTypeRank: Record<
  Exclude<IndustryEvidenceSourceType, "search_result">,
  number
> = {
  official_site: 0,
  registry: 1,
  taxonomy: 2,
  oem_partner: 3,
  trade_body: 4,
  directory: 5,
  reporting: 6,
  other: 7,
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function toNonEmptyString(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const normalized = value.trim();
  return normalized || undefined;
}

function toOptionalFiniteNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined;
}

function isPrivateIpv4(hostname: string): boolean {
  const parts = hostname.split(".");
  if (parts.length !== 4 || parts.some((part) => !/^\d{1,3}$/.test(part))) {
    return false;
  }
  const octets = parts.map(Number);
  if (octets.some((octet) => octet < 0 || octet > 255)) {
    return false;
  }
  const [first, second] = octets;
  return (
    first === 0 ||
    first === 10 ||
    first === 127 ||
    (first === 169 && second === 254) ||
    (first === 172 && second !== undefined && second >= 16 && second <= 31) ||
    (first === 192 && second === 168)
  );
}

function isPrivateHostname(hostname: string): boolean {
  const normalized = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (
    normalized === "localhost" ||
    normalized.endsWith(".localhost") ||
    normalized.endsWith(".local") ||
    normalized === "::1" ||
    normalized.startsWith("fc") ||
    normalized.startsWith("fd") ||
    normalized.startsWith("fe80:")
  ) {
    return true;
  }
  return isPrivateIpv4(normalized);
}

export function normalizeIndustryEvidenceUrl(
  value: unknown,
): NormalizedIndustryEvidenceUrl | null {
  const candidate = toNonEmptyString(value);
  if (!candidate) {
    return null;
  }

  let parsed: URL;
  try {
    parsed = new URL(candidate);
  } catch {
    return null;
  }

  if (
    (parsed.protocol !== "https:" && parsed.protocol !== "http:") ||
    parsed.username ||
    parsed.password
  ) {
    return null;
  }

  const sourceDomain = parsed.hostname.toLowerCase().replace(/\.$/, "");
  if (!sourceDomain || isPrivateHostname(sourceDomain)) {
    return null;
  }

  parsed.hostname = sourceDomain;
  if (
    (parsed.protocol === "https:" && parsed.port === "443") ||
    (parsed.protocol === "http:" && parsed.port === "80")
  ) {
    parsed.port = "";
  }

  return {
    url: parsed.toString(),
    sourceDomain,
  };
}

export function parseSourcePreview(
  value: unknown,
): IndustryEvidenceSourcePreview | null {
  if (!isRecord(value)) {
    return null;
  }

  const sourceId = toNonEmptyString(value.sourceId);
  const normalizedUrl = normalizeIndustryEvidenceUrl(value.url);
  const sourceType = toNonEmptyString(value.sourceType);
  const trustTier = toNonEmptyString(value.trustTier);
  if (
    !sourceId ||
    !normalizedUrl ||
    !sourceType ||
    !sourceTypeSet.has(sourceType) ||
    sourceType === "search_result" ||
    !trustTier ||
    !trustTierSet.has(trustTier) ||
    trustTier === "discovery"
  ) {
    return null;
  }

  const title = toNonEmptyString(value.title);
  const evidenceExcerpt = toNonEmptyString(value.evidenceExcerpt);
  const fetchedAt = toOptionalFiniteNumber(value.fetchedAt);
  const reviewedAt = toOptionalFiniteNumber(value.reviewedAt);

  return {
    sourceId,
    ...normalizedUrl,
    sourceType: sourceType as IndustryEvidenceSourcePreview["sourceType"],
    trustTier: trustTier as IndustryEvidenceSourcePreview["trustTier"],
    ...(title ? { title } : {}),
    ...(evidenceExcerpt ? { evidenceExcerpt } : {}),
    ...(fetchedAt === undefined ? {} : { fetchedAt }),
    ...(reviewedAt === undefined ? {} : { reviewedAt }),
  };
}

export function compareSourcePreviews(
  left: IndustryEvidenceSourcePreview,
  right: IndustryEvidenceSourcePreview,
): number {
  return (
    sourceTrustRank[left.trustTier] - sourceTrustRank[right.trustTier] ||
    sourceTypeRank[left.sourceType] - sourceTypeRank[right.sourceType] ||
    left.sourceDomain.localeCompare(right.sourceDomain) ||
    left.sourceId.localeCompare(right.sourceId)
  );
}

export function parseVerifiedIndustryEvidenceSummary(
  value: unknown,
): VerifiedIndustryEvidenceSummary | null {
  if (!isRecord(value) || value.verificationLevel !== "verified") {
    return null;
  }

  const companyKey = toNonEmptyString(value.companyKey);
  const companyName = toNonEmptyString(value.companyName);
  const industryClass = toNonEmptyString(value.industryClass);
  const verdictRevisionId = toNonEmptyString(value.verdictRevisionId);
  const evidenceSummary = toNonEmptyString(value.evidenceSummary);
  const reviewedAt = toOptionalFiniteNumber(value.reviewedAt);

  if (
    !companyKey ||
    !companyName ||
    !industryClass ||
    !industryClassSet.has(industryClass) ||
    !verdictRevisionId ||
    !evidenceSummary ||
    reviewedAt === undefined
  ) {
    return null;
  }

  const parsedSources = Array.isArray(value.sourcePreviews)
    ? value.sourcePreviews
        .map(parseSourcePreview)
        .filter(
          (source): source is IndustryEvidenceSourcePreview => source !== null,
        )
    : [];
  parsedSources.sort(compareSourcePreviews);

  const uniqueSources: IndustryEvidenceSourcePreview[] = [];
  const seenSourceIds = new Set<string>();
  for (const source of parsedSources) {
    if (seenSourceIds.has(source.sourceId)) {
      continue;
    }
    seenSourceIds.add(source.sourceId);
    uniqueSources.push(source);
  }

  const sourcePreviews = uniqueSources.slice(
    0,
    MAX_RECRUITER_INDUSTRY_EVIDENCE_SOURCES,
  );
  const rawSourceCount = toOptionalFiniteNumber(value.sourceCount);
  const sourceCount = Math.max(
    sourcePreviews.length,
    Math.floor(Math.max(0, rawSourceCount ?? uniqueSources.length)),
  );
  const verifiedYears = toOptionalFiniteNumber(value.verifiedYears);
  const latestRoleAt = toOptionalFiniteNumber(value.latestRoleAt);
  const reviewedBy = toNonEmptyString(value.reviewedBy);
  const roleTypes = Array.isArray(value.roleTypes)
    ? Array.from(
        new Set(
          value.roleTypes
            .map(toNonEmptyString)
            .filter((roleType): roleType is string => roleType !== undefined),
        ),
      ).sort()
    : undefined;
  const freshnessState = toNonEmptyString(value.freshnessState);
  const machineOrigin = toNonEmptyString(value.machineOrigin);

  return {
    companyKey,
    companyName,
    industryClass: industryClass as IndustryClass,
    verificationLevel: "verified",
    verdictRevisionId,
    evidenceSummary,
    reviewedAt,
    ...(reviewedBy ? { reviewedBy } : {}),
    ...(machineOrigin && machineOriginSet.has(machineOrigin)
      ? { machineOrigin: machineOrigin as MachineOrigin }
      : {}),
    ...(verifiedYears === undefined
      ? {}
      : { verifiedYears: Math.max(0, verifiedYears) }),
    ...(roleTypes && roleTypes.length > 0 ? { roleTypes } : {}),
    ...(latestRoleAt === undefined ? {} : { latestRoleAt }),
    sourceCount,
    sourcePreviews,
    additionalSourceCount: Math.max(0, sourceCount - sourcePreviews.length),
    ...(freshnessState && freshnessStateSet.has(freshnessState)
      ? { freshnessState: freshnessState as IndustryEvidenceFreshnessState }
      : {}),
  };
}
