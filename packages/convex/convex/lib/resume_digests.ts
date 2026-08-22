import {
    type AnalysisRoleSignalLike,
    buildLatestWorkHistoryEvidence,
    formatLocationHierarchySearchText,
    getVerifiedRoleSignalYears,
    isRecord,
    matchesResumeDigestFilters,
    normalizeEducationLevel,
    normalizeResumeLocationHierarchy,
    parseVerifiedIndustryEvidenceSummary,
    parseRawSalaryRange,
    resolveExperienceYears,
    type VerifiedIndustryEvidenceSummary,
} from "@trends/shared";
import type { Doc } from "../_generated/dataModel";
import {
    resolveResumeAge,
} from "./resumes_list_projections";
import {
    type ResumeAnalysisBlob,
} from "./resume_analysis_read.js";
import {
    appendMissingSearchTokens,
    buildIngestSearchTokens,
    buildSearchText,
    deriveProseSearchTokens,
    normalizeWhitespace,
    toTextFragments,
} from "../search_text.js";

export { matchesResumeDigestFilters };

const MAX_DIGEST_FRAGMENT_LENGTH = 160;
const MAX_DIGEST_SEARCH_TEXT_LENGTH = 1500;

export type ResumeDigest = Omit<Doc<"resume_digests">, "_creationTime" | "_id">;

export function buildResumeDigest(
    resume: Doc<"resumes">,
    now: number,
    activeAnalysis: ResumeAnalysisBlob = {},
): ResumeDigest {
    const content = isRecord(resume.content) ? resume.content : {};
    const locationHierarchy = normalizeResumeLocationHierarchy(content, resume.source);
    const locationText = formatLocationHierarchySearchText(locationHierarchy) || (typeof content.location === "string" ? content.location : undefined);
    const educationLevel = normalizeEducationLevel(typeof content.education === "string" ? content.education : undefined) ?? undefined;
    const salary = parseRawSalaryRange(
        typeof content.expectedSalary === "string" ? content.expectedSalary : undefined,
    );
    const rawIngestData = isRecord(resume.ingestData) ? resume.ingestData : undefined;
    const evidenceProjectionVersion = toNumber(rawIngestData?.evidenceProjectionVersion);
    const strictEvidenceProjection = rawIngestData
        ? collectStrictEvidenceProjection(rawIngestData)
        : undefined;
    const roleYearsByType = collectRoleYearsByType(resume, strictEvidenceProjection);
    const roleTypes = collectRoleTypes(resume, roleYearsByType);
    const evidenceProjection = collectEvidenceProjection(
        rawIngestData,
        evidenceProjectionVersion,
        strictEvidenceProjection,
    );

    return {
        resumeId: resume._id,
        identityKey: resume.identityKey,
        externalId: resume.externalId,
        source: resume.source,
        sourceKey: resume.sourceKey,
        searchText: buildCompactDigestSearchText(content, resume.ingestData, {
            coldSearchText: resume.searchText,
            locationHierarchy,
            locationText,
            educationLevel,
            roleYearsByType,
        }),
        isArchived: resume.isArchived,
        archivedAt: resume.archivedAt,
        primaryRuleScore: resume.primaryRuleScore,
        crawledAt: resume.crawledAt,
        age: resolveResumeAge(resume, content) ?? undefined,
        locationText,
        educationLevel,
        salaryMin: salary?.min,
        salaryMax: salary?.max,
        experienceYears: resolveExperienceYears(typeof content.experience === "string" ? content.experience : undefined, content.workHistory) ?? undefined,
        roleTypes,
        roleYearsByType,
        ...evidenceProjection,
        displayScore: resolveDisplayScore(activeAnalysis.analysis),
        displayRecommendation: resolveDisplayRecommendation(activeAnalysis.analysis),
        displayBreakdown: resolveDisplayBreakdown(activeAnalysis.analysis),
        displaySummary: resolveDisplaySummary(activeAnalysis.analysis),
        displayConfirmedScore: resume.confirmedScore,
        displayConfirmedAt: resume.confirmedAt,
        updatedAt: now,
    };
}

type CompactDigestSearchOptions = {
    coldSearchText?: string;
    locationHierarchy: ReturnType<typeof normalizeResumeLocationHierarchy>;
    locationText?: string;
    educationLevel?: string;
    roleYearsByType: Record<string, number>;
};

function buildCompactDigestSearchText(
    content: Record<string, unknown>,
    ingestData: unknown,
    options: CompactDigestSearchOptions,
): string | undefined {
    const compactContent = dropUndefined({
        name: compactFragment(content.name),
        desiredPosition: compactFragment(
            content.desiredPosition
            ?? content.jobIntention
            ?? content.title
            ?? content.position,
        ),
        education: compactFragment(content.education ?? options.educationLevel),
        expectedSalary: compactFragment(content.expectedSalary),
        skills: compactArray(content.skills, 20),
        companies: compactArray(content.companies, 20),
        locationHierarchy: options.locationHierarchy,
        workHistory: compactWorkHistory(content.workHistory),
    });

    const base = buildSearchText(compactContent);
    const ingestTokens = collectIngestTokens(ingestData);
    const domainTokens = collectDomainPresenceTokens(options.coldSearchText);
    const roleTokens = Object.keys(options.roleYearsByType);
    // Ordering contract: domain tokens (cnc/数控/销售/sales/机床) are appended
    // before role/ingest tokens, AND limitSearchText emits them with cap
    // priority. The 1500-char cap breaks on overflow, so tokens appended later
    // can silently drop under long content — putting domain presence tokens
    // first in both the append order and the cap guarantees they always
    // survive a rebuild (observed live: one CN resume lost its 销售 token
    // when digest tokens were appended after long work-history text).
    const withDigestFields = appendMissingSearchTokens(base, [
        ...domainTokens,
        options.locationText,
        options.educationLevel,
        ...roleTokens,
        ...ingestTokens,
        // selfIntro is excluded from the compact content, so its word tokens
        // (and 机床/machine-tool aliases) are appended at the lowest cap
        // priority: present when the 1500-char cap is not exhausted.
        ...deriveProseSearchTokens(
            typeof content.selfIntro === "string" ? content.selfIntro : undefined,
        ),
    ].filter((value): value is string => typeof value === "string" && value.length > 0));
    return limitSearchText(withDigestFields, domainTokens);
}

function dropUndefined(record: Record<string, unknown>): Record<string, unknown> {
    return Object.fromEntries(
        Object.entries(record).filter(([, value]) => value !== undefined),
    );
}

function compactFragment(value: unknown): string | undefined {
    const normalized = normalizeWhitespace(toTextFragments(value).join(" "));
    if (!normalized) return undefined;
    return normalized.length > MAX_DIGEST_FRAGMENT_LENGTH
        ? normalized.slice(0, MAX_DIGEST_FRAGMENT_LENGTH)
        : normalized;
}

function compactArray(value: unknown, limit: number): string[] | undefined {
    const values = Array.isArray(value)
        ? value.flatMap((item) => toTextFragments(item))
        : toTextFragments(value);
    const compacted = values
        .map((item) => compactFragment(item))
        .filter((item): item is string => typeof item === "string" && item.length > 0)
        .slice(0, limit);
    return compacted.length > 0 ? compacted : undefined;
}

function compactWorkHistory(value: unknown): string[] | undefined {
    const lines = buildLatestWorkHistoryEvidence(value, { limit: 3 }).lines
        .map((line) => compactFragment(line))
        .filter((line): line is string => typeof line === "string" && line.length > 0);
    return lines.length > 0 ? lines : undefined;
}

function collectIngestTokens(value: unknown): string[] {
    if (!isRecord(value)) return [];
    return buildIngestSearchTokens({
        industryTags: toStringArray(value.industryTags),
        synonymHits: toStringArray(value.synonymHits),
        brandHits: toBrandHits(value.brandHits),
        companyHits: toStringArray(value.companyHits),
        companyPatternAliasTokens: typeof value.companyPatternAliasTokens === "string"
            ? value.companyPatternAliasTokens
            : undefined,
    });
}

function toStringArray(value: unknown): string[] | undefined {
    if (!Array.isArray(value)) return undefined;
    const result = value.filter((item): item is string => typeof item === "string" && item.trim().length > 0);
    return result.length > 0 ? result : undefined;
}

function toBrandHits(value: unknown): Array<{ brand: string }> | undefined {
    if (!Array.isArray(value)) return undefined;
    const result = value.flatMap((item) => {
        if (isRecord(item) && typeof item.brand === "string" && item.brand.trim()) {
            return [{ brand: item.brand }];
        }
        if (typeof item === "string" && item.trim()) {
            return [{ brand: item }];
        }
        return [];
    });
    return result.length > 0 ? result : undefined;
}

/**
 * Cap the digest search text at MAX_DIGEST_SEARCH_TEXT_LENGTH (1500 chars).
 *
 * `priorityTokens` are emitted FIRST (deduplicated, normalized) so they always
 * fit under the cap regardless of how long the base content is. The digest
 * rebuild path passes the domain presence tokens (cnc/数控/销售/sales/机床)
 * here: they are the keyword-search surface, so losing them to the cap would
 * silently break queries after a rebuild.
 */
function limitSearchText(value: string, priorityTokens: string[] = []): string | undefined {
    const tokens = normalizeWhitespace(value).toLowerCase().split(/\s+/g).filter((token) => token.length > 0);
    const seen = new Set<string>();
    const result: string[] = [];
    let length = 0;
    const push = (token: string): boolean => {
        if (seen.has(token)) {
            return true;
        }
        const nextLength = length + token.length + (result.length > 0 ? 1 : 0);
        if (nextLength > MAX_DIGEST_SEARCH_TEXT_LENGTH) {
            return false;
        }
        seen.add(token);
        result.push(token);
        length = nextLength;
        return true;
    };
    for (const token of priorityTokens) {
        const normalized = normalizeWhitespace(token).toLowerCase();
        if (!normalized) {
            continue;
        }
        push(normalized);
    }
    for (const token of tokens) {
        if (!push(token)) {
            break;
        }
    }
    return result.length > 0 ? result.join(" ") : undefined;
}

function collectDomainPresenceTokens(value: string | undefined): string[] {
    if (!value) return [];
    const normalized = value.toLowerCase();
    const tokens: string[] = [];
    if (/\bcnc\b/.test(normalized) || normalized.includes("数控")) {
        tokens.push("cnc", "数控");
    }
    if (normalized.includes("销售") || /\bsales?\b/.test(normalized)) {
        tokens.push("销售", "sales");
    }
    if (normalized.includes("机床") || normalized.includes("machine tool")) {
        tokens.push("机床", "machine tool", "machine tools");
    }
    return tokens;
}

function collectRoleTypes(resume: Doc<"resumes">, roleYearsByType: Record<string, number>): string[] {
    const raw = resume.ingestData as Record<string, unknown> | null | undefined;
    if (!raw) return Object.keys(roleYearsByType).sort();

    const out = new Set<string>(Object.keys(roleYearsByType));
    const roleSignals = parseAnalysisRoleSignals(raw.roleSignals);
    for (const signal of roleSignals) {
        const key = signal.type.trim().toLowerCase();
        if (key) {
            out.add(key);
        }
    }
    return Array.from(out).sort();
}

/**
 * Build digest roleYearsByType used by list/search minRoleYears gates.
 *
 * Persist gate years exclusively from verified evidence. Keep roleTypes broad
 * for UI/filter presence even when no verified years exist for that type.
 *
 * Two modes:
 *
 * - Evidence mode (any revision-backed evidence exists on the resume): only
 *   revision-checked years from the projection may pass the gate. Legacy
 *   aggregates are never trusted here, so superseded-revision totals cannot
 *   satisfy minRoleYears.
 * - Legacy mode (no revision-backed evidence anywhere — the common case
 *   before companies are reviewed): fall back to the legacy verified
 *   aggregates (verifiedRoleYears + verified role-signal years). Without
 *   this, every unreviewed resume would compute zero gate years and
 *   minRoleYears searches would silently return no results.
 */
function collectRoleYearsByType(
    resume: Doc<"resumes">,
    strictEvidenceProjection?: ReturnType<typeof collectStrictEvidenceProjection>,
): Record<string, number> {
    const raw = resume.ingestData as Record<string, unknown> | null | undefined;
    if (!raw) return {};

    const roleSignals = parseAnalysisRoleSignals(raw.roleSignals);
    const rawRoleSignals = Array.isArray(raw.roleSignals) ? raw.roleSignals : [];

    if (strictEvidenceProjection) {
        // Approved evidence revisions govern every role with a revisioned
        // entry: affirmed roles get the revision-checked years, governed roles
        // without revision-checked support are revoked outright. Roles with no
        // revisioned entries at all (catalog not yet reviewed) keep their
        // legacy verified aggregates below.
        const governedRoles = new Set<string>();
        const affirmed = new Map<string, number>();
        for (const rawSignal of rawRoleSignals) {
            if (!isRecord(rawSignal) || typeof rawSignal.type !== "string") continue;
            const key = rawSignal.type.trim().toLowerCase();
            if (!key || !Array.isArray(rawSignal.matchedWorkEntries)) continue;
            for (const entry of rawSignal.matchedWorkEntries) {
                if (!isRecord(entry)) continue;
                const companyKey = typeof entry.companyKey === "string"
                    ? entry.companyKey.trim().toLowerCase()
                    : "";
                const revisionId = typeof entry.verdictRevisionId === "string"
                    ? entry.verdictRevisionId.trim()
                    : "";
                if (entry.industryVerified === true && companyKey && revisionId) {
                    governedRoles.add(key);
                }
            }
        }
        for (const [key, years] of Object.entries(strictEvidenceProjection.roleYearsByType)) {
            if (years > 0) affirmed.set(key, years);
        }

        if (governedRoles.size === 0 && affirmed.size === 0) {
            // No revision-backed evidence anywhere (empty catalog): keep the
            // legacy verified aggregates so unreviewed resumes still pass the
            // minRoleYears gate.
        } else {
            const result: Record<string, number> = {};
            for (const [key, years] of affirmed) {
                result[key] = years;
            }
            // Evidence mode is active: only revision-checked years may pass
            // the gate. Legacy aggregates (verifiedRoleYears, pre-evidence
            // industryVerified entries) are never trusted in this mode — that
            // is the guard that keeps superseded-revision totals from
            // satisfying minRoleYears.
            return result;
        }
    }

    const result: Record<string, number> = {};

    const verifiedRoleYears = raw.verifiedRoleYears as Record<string, unknown> | null | undefined;
    if (isRecord(verifiedRoleYears)) {
        for (const [key, value] of Object.entries(verifiedRoleYears)) {
            const normalizedKey = key.trim().toLowerCase();
            if (normalizedKey && typeof value === "number" && Number.isFinite(value) && value > 0) {
                result[normalizedKey] = Math.max(result[normalizedKey] ?? 0, value);
            }
        }
    }

    for (const signal of roleSignals) {
        const key = signal.type.trim().toLowerCase();
        if (!key) {
            continue;
        }
        const years = getVerifiedRoleSignalYears(roleSignals, key, signal.verifyIn);
        if (years > 0) {
            result[key] = Math.max(result[key] ?? 0, years);
        }
    }
    return result;
}

function collectEvidenceProjection(
    raw: Record<string, unknown> | undefined,
    evidenceProjectionVersion: number | undefined,
    strictEvidenceProjection?: ReturnType<typeof collectStrictEvidenceProjection>,
): Pick<
    ResumeDigest,
    | "evidenceProjectionVersion"
    | "verifiedIndustryEvidenceSummaries"
    | "industryEvidenceCatalogState"
    | "industryEvidenceStale"
> {
    if (
        evidenceProjectionVersion === undefined
        || !raw
        || !strictEvidenceProjection
    ) {
        return {};
    }
    return {
        evidenceProjectionVersion,
        verifiedIndustryEvidenceSummaries: strictEvidenceProjection.summaries,
        ...(raw.industryEvidenceCatalogState === "ready"
            || raw.industryEvidenceCatalogState === "degraded"
            ? { industryEvidenceCatalogState: raw.industryEvidenceCatalogState }
            : {}),
        ...(strictEvidenceProjection.stale ? { industryEvidenceStale: true } : {}),
    };
}

function collectStrictEvidenceProjection(raw: Record<string, unknown>): {
    summaries: VerifiedIndustryEvidenceSummary[];
    roleYearsByType: Record<string, number>;
    stale: boolean;
} {
    const rawSummaries = Array.isArray(raw.verifiedIndustryEvidenceSummaries)
        ? raw.verifiedIndustryEvidenceSummaries
        : [];
    const summaries = rawSummaries
        .map(parseVerifiedIndustryEvidenceSummary)
        .filter((item): item is VerifiedIndustryEvidenceSummary => item !== null);
    const revisionByCompany = new Map(
        summaries.map((summary) => [summary.companyKey, summary.verdictRevisionId]),
    );
    const roleYearsByType: Record<string, number> = {};
    const fingerprintsByRole = new Map<string, Set<string>>();
    let stale = summaries.length !== rawSummaries.length;

    const roleSignals = Array.isArray(raw.roleSignals) ? raw.roleSignals : [];
    for (const rawSignal of roleSignals) {
        if (!isRecord(rawSignal) || typeof rawSignal.type !== "string") continue;
        const roleType = rawSignal.type.trim().toLowerCase();
        if (!roleType || !Array.isArray(rawSignal.matchedWorkEntries)) continue;
        const seen = fingerprintsByRole.get(roleType) ?? new Set<string>();
        let years = roleYearsByType[roleType] ?? 0;
        for (const rawEntry of rawSignal.matchedWorkEntries) {
            if (!isRecord(rawEntry) || rawEntry.industryVerified !== true) continue;
            const companyKey =
                typeof rawEntry.companyKey === "string"
                    ? rawEntry.companyKey.trim().toLowerCase()
                    : "";
            const verdictRevisionId =
                typeof rawEntry.verdictRevisionId === "string"
                    ? rawEntry.verdictRevisionId.trim()
                    : "";
            const expectedRevision = revisionByCompany.get(companyKey);
            if (!companyKey || !verdictRevisionId || expectedRevision !== verdictRevisionId) {
                stale = true;
                continue;
            }
            if (rawEntry.directRoleMatch !== true) continue;
            const entryYears = toNumber(rawEntry.years);
            if (entryYears === undefined || entryYears <= 0) continue;
            const fingerprint =
                typeof rawEntry.workEntryFingerprint === "string"
                    && rawEntry.workEntryFingerprint.trim()
                    ? rawEntry.workEntryFingerprint.trim()
                    : `${companyKey}\u0000${verdictRevisionId}\u0000${entryYears}`;
            if (seen.has(fingerprint)) continue;
            seen.add(fingerprint);
            years += entryYears;
        }
        fingerprintsByRole.set(roleType, seen);
        if (years > 0) {
            roleYearsByType[roleType] = Number(years.toFixed(2));
        }
    }

    return { summaries, roleYearsByType, stale };
}

function parseAnalysisRoleSignals(value: unknown): AnalysisRoleSignalLike[] {
    if (!Array.isArray(value)) return [];
    return value.flatMap((item) => {
        if (!isRecord(item) || typeof item.type !== "string") return [];
        return [{
            type: item.type,
            verifyIn: typeof item.verifyIn === "string" ? item.verifyIn : undefined,
            years: toNumber(item.years),
            roleRelevantYears: toNumber(item.roleRelevantYears),
            industryVerifiedYears: toNumber(item.industryVerifiedYears),
            industryVerifiedRelevantYears: toNumber(item.industryVerifiedRelevantYears),
            matchedWorkEntries: parseMatchedWorkEntries(item.matchedWorkEntries),
        }];
    });
}

function parseMatchedWorkEntries(value: unknown): AnalysisRoleSignalLike["matchedWorkEntries"] {
    if (!Array.isArray(value)) return undefined;
    const entries = value.flatMap((item) => {
        if (!isRecord(item)) return [];
        const years = toNumber(item.years);
        if (years === undefined) return [];
        return [{
            years,
            directRoleMatch: typeof item.directRoleMatch === "boolean" ? item.directRoleMatch : undefined,
            industryVerified: typeof item.industryVerified === "boolean" ? item.industryVerified : undefined,
        }];
    });
    return entries.length > 0 ? entries : undefined;
}

function toNumber(value: unknown): number | undefined {
    return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

// ---------------------------------------------------------------------------
// Phase 3 display-field resolvers — extract scalar display data from the
// default analysis object for zero-join list/search score display.
//
// Phase 4 Step 3a: resolvers take the resolved ACTIVE analysis blob
// (cold row, with legacy hot fallback) rather than reading `resume.analysis`
// directly. Callers resolve it once via readActiveResumeAnalysis to avoid
// per-field DB round-trips. See lib/resume_analysis_read.ts.
// ---------------------------------------------------------------------------

function resolveDisplayScore(analysis: ResumeAnalysisBlob["analysis"]): number | undefined {
    return typeof analysis?.score === "number" ? analysis.score : undefined;
}

function resolveDisplayRecommendation(analysis: ResumeAnalysisBlob["analysis"]): string | undefined {
    const rec = analysis?.recommendation;
    return typeof rec === "string" && rec.trim().length > 0 ? rec : undefined;
}

function resolveDisplayBreakdown(analysis: ResumeAnalysisBlob["analysis"]): Record<string, number> | undefined {
    const breakdown = analysis?.breakdown;
    if (!isRecord(breakdown)) return undefined;
    const result: Record<string, number> = {};
    for (const [key, value] of Object.entries(breakdown)) {
        if (typeof value === "number" && Number.isFinite(value)) {
            result[key] = value;
        }
    }
    return Object.keys(result).length > 0 ? result : undefined;
}

function resolveDisplaySummary(analysis: ResumeAnalysisBlob["analysis"]): string | undefined {
    const summary = analysis?.summary;
    return typeof summary === "string" && summary.trim().length > 0
        ? summary.slice(0, 500)
        : undefined;
}
