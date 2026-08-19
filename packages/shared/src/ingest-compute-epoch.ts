/**
 * Ingest-compute epoch — algorithm revision for stored resume computed fields.
 *
 * Distinct from skillsVersion (skills.md catalog). Bump when pure compute that
 * materializes into ingestData / digests changes, e.g.:
 * - work-history year parsing (Seek EN date ranges)
 * - roleSignals / verifiedRoleYears accumulation
 * - fields that feed minRoleYears digest gates
 *
 * Existing rows without this field are compute-stale vs CURRENT.
 */

export type IngestComputeEpochReason = {
  epoch: number;
  /** Short operator-facing reason for this epoch value */
  reason: string;
  /** ISO date when this epoch was introduced in mainline */
  introduced: string;
};

/**
 * Registry of epoch bumps (newest last). CURRENT is the last entry's epoch.
 * Do not renumber historical rows — only append.
 */
export const INGEST_COMPUTE_EPOCH_HISTORY: readonly IngestComputeEpochReason[] = [
  {
    epoch: 1,
    reason:
      "Baseline: Seek EN work-history year parse + MY/Seek role-year materialization for minRoleYears digests",
    introduced: "2026-07-21",
  },
  {
    epoch: 2,
    reason:
      "Global verified-only requested-role minRoleYears + strict resume digest projection",
    introduced: "2026-07-28",
  },
  {
    epoch: 3,
    reason:
      "Revision-backed reviewed company-industry evidence, strict role-year projection, and recruiter evidence summaries",
    introduced: "2026-07-29",
  },
  {
    epoch: 4,
    reason:
      "CJK search digest materialization: selfIntro prose tokens (jieba union) in digest searchText",
    introduced: "2026-08-19",
  },
] as const;

/** Code-required ingest compute epoch stamped on every successful compute write. */
export const CURRENT_INGEST_COMPUTE_EPOCH: number =
  INGEST_COMPUTE_EPOCH_HISTORY[INGEST_COMPUTE_EPOCH_HISTORY.length - 1]!.epoch;

export type IngestDataEpochFields = {
  skillsVersion?: number | null;
  ingestComputeEpoch?: number | null;
  evidenceProjectionVersion?: number | null;
};

/**
 * True when a materialized industry-evidence projection is missing or behind
 * the caller's required projection revision. This stays independent from the
 * general compute epoch so operators and UI can diagnose which contract is
 * stale.
 */
export function isEvidenceProjectionStale(
  ingestData: IngestDataEpochFields | null | undefined,
  currentProjectionVersion: number,
): boolean {
  if (!ingestData) {
    return true;
  }
  const version = ingestData.evidenceProjectionVersion;
  if (typeof version !== "number" || !Number.isFinite(version)) {
    return true;
  }
  return version < currentProjectionVersion;
}

/**
 * True when stored computed data is behind the code's ingest algorithm revision.
 * Missing epoch ⇒ stale (pre-epoch rows). skillsVersion may still match.
 */
export function isComputeStale(
  ingestData: IngestDataEpochFields | null | undefined,
  currentEpoch: number = CURRENT_INGEST_COMPUTE_EPOCH,
): boolean {
  if (!ingestData) {
    return true;
  }
  const epoch = ingestData.ingestComputeEpoch;
  if (typeof epoch !== "number" || !Number.isFinite(epoch)) {
    return true;
  }
  return epoch < currentEpoch;
}

/**
 * True when skills catalog version is missing or behind current skills version.
 * Independent of compute epoch.
 */
export function isSkillsStale(
  ingestData: IngestDataEpochFields | null | undefined,
  currentSkillsVersion: number,
): boolean {
  if (!ingestData) {
    return true;
  }
  const version = ingestData.skillsVersion;
  if (typeof version !== "number" || !Number.isFinite(version)) {
    return true;
  }
  return version < currentSkillsVersion;
}

/**
 * Row needs recompute if skills catalog and/or ingest algorithm is behind.
 */
export function isIngestStale(
  ingestData: IngestDataEpochFields | null | undefined,
  currentSkillsVersion: number,
  currentEpoch: number = CURRENT_INGEST_COMPUTE_EPOCH,
): boolean {
  return (
    isSkillsStale(ingestData, currentSkillsVersion)
    || isComputeStale(ingestData, currentEpoch)
  );
}

export type StaleSelectionMode = "skills" | "compute" | "any";

/**
 * Whether a row should be selected for a reingest pass under the given mode.
 * - skills: skillsVersion lag only (legacy path)
 * - compute: ingestComputeEpoch lag only
 * - any: either lag (default for operator repair after algorithm fixes)
 */
export function shouldSelectForReingest(
  ingestData: IngestDataEpochFields | null | undefined,
  mode: StaleSelectionMode,
  currentSkillsVersion: number,
  currentEpoch: number = CURRENT_INGEST_COMPUTE_EPOCH,
): boolean {
  if (ingestData === undefined) {
    // No ingest row yet — processNewResumes path handles missing; skip skills-only scan filters
    // that historically required ingestData !== undefined for skills staleness.
    return mode !== "skills";
  }
  if (ingestData === null) {
    return true;
  }
  switch (mode) {
    case "skills":
      return isSkillsStale(ingestData, currentSkillsVersion);
    case "compute":
      return isComputeStale(ingestData, currentEpoch);
    case "any":
      return isIngestStale(ingestData, currentSkillsVersion, currentEpoch);
    default:
      return false;
  }
}

/**
 * Golden search floors for search-data doctor (live API when reachable).
 *
 * Floors are intentionally well above the historical "green but wrong" band
 * (preview once reported MY minRoleYears≈30 with ~139 zeroed sales years while
 * local healthy corpus is ~142 for the same query). Floor 10 greenwashed that.
 */
export const SEARCH_FRESHNESS_GOLDEN_QUERIES = [
  {
    id: "my-cnc-sales-minRoleYears",
    location: "Malaysia",
    q: "CNC Sales",
    minRoleYears: 1,
    roleType: "sales",
    /**
     * Verified-only MY policy intentionally removes the fallback-only cohort.
     * Availability floor stays at 1; semantic sampling verifies the returned
     * rows truly carry verified direct sales evidence.
     */
    minTotalFloor: 1,
    semanticSampleLimit: 10,
  },
  {
    id: "cn-cnc-sales-minRoleYears",
    location: "China",
    q: "CNC 销售",
    minRoleYears: 1,
    roleType: "sales",
    /** Healthy CN CNC sales minRoleYears=1 corpus is 250+ on full datasets. */
    minTotalFloor: 100,
    semanticSampleLimit: 10,
  },
] as const;
