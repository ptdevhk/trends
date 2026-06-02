/**
 * P1: context-derived evidence ceiling evaluator for the related_exp factor.
 *
 * Computes an `evidenceBandMax` from ingest evidence + search context and applies
 * it as a lower-only cap on the LLM-assigned `related_exp` score.
 *
 *   effectiveRaw = min(llmRaw, recommendationMax, evidenceBandMax)
 *
 * The evaluator is generic (no domain-specific vocabulary). Coverage is derived
 * purely from structural evidence fields — `directRoleMatch`, `industryVerifiedRelevantYears`,
 * and `minRoleYears` from context.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type RelatedExpCoverage = "full" | "partial" | "weak" | "none";

export interface RelatedExpContextInput {
    /** "sales" | "technical" | "any" — role type required by the JD/search profile */
    roleFilterType?: string;
    /** Minimum domain-role years required (from search profile or JD) */
    minRoleYears?: number;
    /** "CN" | "MY" — market context */
    market?: string;
    /** Output locale — "zh" | "en" */
    locale?: string;
}

export interface RelatedExpIngestEvidence {
    /** True when a work entry's role directly matches the required role type */
    directRoleMatch?: boolean;
    /** Domain-verified relevant years from ingest pipeline */
    industryVerifiedRelevantYears?: number;
    /** Text evidence snippets from matched work entries (for missingReasons) */
    matchedWorkEntries?: string[];
}

export interface RelatedExpEvidenceInput {
    context: RelatedExpContextInput;
    llmRaw: number;
    llmRecommendation: string;
    ingestEvidence: RelatedExpIngestEvidence;
}

export interface RelatedExpEvidenceResult {
    /** 100 | 65 | 45 | 30 — derived from coverage band */
    evidenceBandMax: number;
    coverage: RelatedExpCoverage;
    /** Reasons why the ceiling was applied (empty when full coverage) */
    missingReasons: string[];
    /** min(llmRaw, recommendationMax, evidenceBandMax) — lower-only */
    effectiveRaw: number;
    llmRaw: number;
    recommendationMax: number;
    /** Stable hash of the sorted context for provenance */
    contextHash: string;
    /** Version string for this rubric — bump when coverage logic changes */
    rubricVersion: string;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const RUBRIC_VERSION = "1.0.0";

const RECOMMENDATION_MAX: Record<string, number> = {
    strong_match: 100,
    match: 100,
    potential: 60,
    no_match: 30,
};

const EVIDENCE_BAND_MAX: Record<RelatedExpCoverage, number> = {
    full: 100,
    partial: 65,
    weak: 45,
    none: 30,
};

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/** FNV-1a 32-bit hash — same algorithm as analysis-key.ts:stableHash */
function stableHash(seed: string): string {
    let hash = 2166136261;
    for (const char of seed) {
        hash ^= char.codePointAt(0) ?? 0;
        hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(16);
}

function buildContextHash(context: RelatedExpContextInput): string {
    const sorted = Object.entries(context)
        .filter(([, v]) => v !== undefined)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([k, v]) => `${k}:${v}`)
        .join("|");
    return stableHash(sorted);
}

function clamp(value: number, min: number, max: number): number {
    return Math.min(max, Math.max(min, value));
}

// ---------------------------------------------------------------------------
// Coverage classification
// ---------------------------------------------------------------------------

function classifyCoverage(
    directRoleMatch: boolean,
    domainYears: number,
    minRoleYears: number,
): { coverage: RelatedExpCoverage; missingReasons: string[] } {
    const missingReasons: string[] = [];

    if (directRoleMatch && domainYears >= minRoleYears) {
        return { coverage: "full", missingReasons: [] };
    }

    if (!directRoleMatch) {
        missingReasons.push("no direct role match in work history");
    }

    // none: no domain evidence at all
    if (domainYears === 0) {
        missingReasons.push("zero domain-verified relevant years");
        return { coverage: "none", missingReasons };
    }

    if (domainYears < minRoleYears) {
        missingReasons.push(
            `insufficient domain-verified years (${domainYears} < ${minRoleYears} required)`,
        );
    }

    if (!directRoleMatch && domainYears >= minRoleYears) {
        // Has domain years meeting threshold but no direct role match
        return { coverage: "partial", missingReasons };
    }

    // directRoleMatch=false AND domainYears > 0 AND domainYears < minRoleYears
    return { coverage: "weak", missingReasons };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Evaluate the evidence band ceiling for a resume's `related_exp` score.
 *
 * @param input - LLM output, ingest evidence, and search context
 * @returns Evidence result with effectiveRaw = min(llmRaw, recommendationMax, evidenceBandMax)
 */
export function evaluateRelatedExpEvidence(
    input: RelatedExpEvidenceInput,
): RelatedExpEvidenceResult {
    const { context, llmRaw, llmRecommendation, ingestEvidence } = input;

    const directRoleMatch = ingestEvidence.directRoleMatch ?? false;
    const domainYears = typeof ingestEvidence.industryVerifiedRelevantYears === "number"
        && Number.isFinite(ingestEvidence.industryVerifiedRelevantYears)
        ? Math.max(0, ingestEvidence.industryVerifiedRelevantYears)
        : 0;
    const minRoleYears = typeof context.minRoleYears === "number"
        && Number.isFinite(context.minRoleYears)
        ? Math.max(0, context.minRoleYears)
        : 0;

    const recommendationMax = RECOMMENDATION_MAX[llmRecommendation] ?? 30;
    const { coverage, missingReasons } = classifyCoverage(directRoleMatch, domainYears, minRoleYears);
    const evidenceBandMax = EVIDENCE_BAND_MAX[coverage];

    const safeRaw = clamp(typeof llmRaw === "number" && Number.isFinite(llmRaw) ? llmRaw : 0, 0, 100);
    const effectiveRaw = Math.min(safeRaw, recommendationMax, evidenceBandMax);

    return {
        evidenceBandMax,
        coverage,
        missingReasons,
        effectiveRaw,
        llmRaw: safeRaw,
        recommendationMax,
        contextHash: buildContextHash(context),
        rubricVersion: RUBRIC_VERSION,
    };
}
