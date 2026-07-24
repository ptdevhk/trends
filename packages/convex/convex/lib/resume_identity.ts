import { isRecord } from "@trends/shared";

export type ResumeIdentitySource = "profileUrl" | "resumeId" | "perUserId" | "externalId";

export type ResumeIdentityInput = {
    content: unknown;
    externalId: string;
    source?: string;
};

export type ResumeIdentity = {
    identityKey: string;
    source: ResumeIdentitySource;
    rawValue: string;
    normalizedValue: string;
};

const PROFILE_URL_KEYS = ["profileUrl", "profile_url", "profileURL", "url"];
const RESUME_ID_KEYS = ["resumeId", "resume_id"];
const PROFILE_RESUME_ID_KEYS = ["profileResumeId", "profile_resume_id"];
const PROFILE_ID_KEYS = ["profileId", "profile_id"];
const PER_USER_ID_KEYS = ["perUserId", "per_user_id"];
const EXTERNAL_ID_KEYS = ["externalId", "external_id"];
const JOB5156_HOST = "hr.job5156.com";
export const SEEK_HOST_SUFFIX = ".employer.seek.com";
const PROFILE_RESUME_ID_QUERY_KEYS = new Set(["resumeid", "resume_id", "profileresumeid"]);
const PROFILE_RESUME_ID_RE = /(?<!\d)(\d{6,12})(?!\d)/;

export type ResumeIdentityAliases = {
    profileUrl?: string;
    profileResumeId?: string;
    profileUrlKeys: string[];
    profileResumeIds: string[];
    externalIds: string[];
    identityKeys: string[];
};


function readString(value: unknown): string | null {
    if (typeof value === "number" && Number.isFinite(value)) {
        return String(value);
    }
    if (typeof value !== "string") {
        return null;
    }
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
}

export function normalizeResumeIdentityToken(value: string): string | null {
    const trimmed = value.trim();
    if (!trimmed) {
        return null;
    }
    return trimmed.toLowerCase();
}

export function isPlaceholderResumeExternalId(value: string): boolean {
    const normalized = normalizeResumeIdentityToken(value);
    return normalized === "unknown" || normalized === "externalid:unknown";
}

function decodeURIComponentSafe(value: string): string {
    try {
        return decodeURIComponent(value);
    } catch {
        return value;
    }
}

function extractJob5156ResumeId(pathname: string): string | null {
    const oldRouteMatch = pathname.match(/^\/api\/com\/resume\/([^/?#]+)/i);
    if (oldRouteMatch && oldRouteMatch[1]) {
        return decodeURIComponentSafe(oldRouteMatch[1]);
    }

    const viewRouteMatch = pathname.match(/^\/resume\/view\/([^/?#]+)/i);
    if (viewRouteMatch && viewRouteMatch[1]) {
        return decodeURIComponentSafe(viewRouteMatch[1]);
    }

    return null;
}

function normalizeJob5156ProfileUrlForIdentity(value: string): string | null {
    const directResumeId = extractJob5156ResumeId(value);
    if (directResumeId) {
        return `${JOB5156_HOST}/api/com/resume/${encodeURIComponent(directResumeId)}`.toLowerCase();
    }

    let parsed: URL | null = null;
    try {
        parsed = new URL(value);
    } catch {
        try {
            parsed = new URL(`https://${value}`);
        } catch {
            parsed = null;
        }
    }

    if (!parsed || parsed.hostname.toLowerCase() !== JOB5156_HOST) {
        return null;
    }

    const resumeId = extractJob5156ResumeId(parsed.pathname);
    if (!resumeId) {
        return null;
    }

    return `${JOB5156_HOST}/api/com/resume/${encodeURIComponent(resumeId)}`.toLowerCase();
}

function parseUrlLike(value: string): URL | null {
    try {
        return new URL(value);
    } catch (error) {
        try {
            return new URL(`https://${value}`);
        } catch (fallbackError) {
            console.error("Failed to normalize profile URL for resume identity.", error, fallbackError);
            return null;
        }
    }
}

function readQueryParamCaseInsensitive(parsed: URL, key: string): string | null {
    const normalizedKey = key.toLowerCase();
    for (const [candidateKey, value] of parsed.searchParams.entries()) {
        if (candidateKey.toLowerCase() === normalizedKey) {
            return value;
        }
    }
    return null;
}

function normalizeUrlForIdentity(parsed: URL): string {
    const path = parsed.pathname.replace(/\/+$/, "") || "/";
    const sortedParams = Array.from(parsed.searchParams.entries())
        .filter(([key]) => !key.toLowerCase().startsWith("utm_"))
        .sort(([leftKey, leftValue], [rightKey, rightValue]) => {
            if (leftKey === rightKey) {
                return leftValue.localeCompare(rightValue);
            }
            return leftKey.localeCompare(rightKey);
        });

    const query = sortedParams.length > 0
        ? `?${sortedParams
            .map(([key, paramValue]) => `${encodeURIComponent(key)}=${encodeURIComponent(paramValue)}`)
            .join("&")}`
        : "";

    return `${parsed.hostname.toLowerCase()}${path}${query}`.toLowerCase();
}

function isSeekNameSearchProfileUrl(parsed: URL): boolean {
    const path = parsed.pathname.toLowerCase().replace(/\/+$/, "") || "/";
    // List-lane "open by name" URLs used when talentsearch cards have no stable profile path.
    // These are NOT unique person identifiers (many candidates can share a name).
    if (path === "/talentsearch/profiles/search" || path.endsWith("/talentsearch/profiles/search")) {
        return true;
    }
    if (path === "/talentsearch" && readQueryParamCaseInsensitive(parsed, "searchQuery")) {
        return true;
    }
    return false;
}

function normalizeSeekProfileUrlForIdentity(value: string, source: string | undefined): string | null {
    const parsed = parseUrlLike(value);
    if (!parsed) {
        return null;
    }

    const hostname = parsed.hostname.toLowerCase();
    const normalizedSource = source?.trim().toLowerCase();
    const isSeekHost = hostname.endsWith(SEEK_HOST_SUFFIX) || normalizedSource?.endsWith(SEEK_HOST_SUFFIX);
    if (!isSeekHost) {
        return null;
    }

    // Reject non-unique name-search URLs so identity falls through to externalId /
    // profileGuid (UUID). Using name-search URLs as identityKey collapses distinct
    // talentsearch candidates that share a display name (e.g. 100 submitted → 99 rows).
    if (isSeekNameSearchProfileUrl(parsed)) {
        return null;
    }

    const openProfileIdParam = readQueryParamCaseInsensitive(parsed, "openProfileId");
    if (openProfileIdParam && /^\d+$/.test(openProfileIdParam)) {
        return `${hostname}/candidates/${openProfileIdParam}`.toLowerCase();
    }

    // Numeric profileId: /candidates/{profileId} or /candidates/profiles/{profileId}/...
    const profileIdMatch = parsed.pathname.match(/\/candidates\/(?:profiles\/)?(\d+)(?:\/|$)/i);
    if (profileIdMatch && profileIdMatch[1]) {
        return `${hostname}/candidates/${profileIdMatch[1]}`.toLowerCase();
    }

    // UUID profileGuid (talentsearch): /candidates/{uuid}
    const uuidMatch = parsed.pathname.match(/\/candidates\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(?:\/|$)/i);
    if (uuidMatch && uuidMatch[1]) {
        return `${hostname}/candidates/${uuidMatch[1]}`.toLowerCase();
    }

    return normalizeUrlForIdentity(parsed);
}

export function normalizeResumeProfileUrl(value: string, source?: string): string | null {
    const trimmed = value.trim();
    if (!trimmed) {
        return null;
    }

    const lowered = trimmed.toLowerCase();
    if (lowered === "javascript:;" || lowered === "javascript:void(0)" || lowered === "#") {
        return null;
    }

    const normalizedJob5156 = normalizeJob5156ProfileUrlForIdentity(trimmed);
    if (normalizedJob5156) {
        return normalizedJob5156;
    }

    const normalizedSeek = normalizeSeekProfileUrlForIdentity(trimmed, source);
    if (normalizedSeek) {
        return normalizedSeek;
    }

    const parsed = parseUrlLike(trimmed);
    if (!parsed) {
        const fallback = lowered
            .replace(/^https?:\/\//, "")
            .replace(/#.*$/, "")
            .replace(/\/+$/, "");
        return fallback || null;
    }

    // Seek name-search URLs intentionally return null from the Seek normalizer.
    // Do not re-accept them via the generic URL normalizer — they are not unique.
    const hostname = parsed.hostname.toLowerCase();
    const normalizedSource = source?.trim().toLowerCase();
    const isSeekHost = hostname.endsWith(SEEK_HOST_SUFFIX) || normalizedSource?.endsWith(SEEK_HOST_SUFFIX);
    if (isSeekHost && isSeekNameSearchProfileUrl(parsed)) {
        return null;
    }

    return normalizeUrlForIdentity(parsed);
}

function readCandidate(record: Record<string, unknown>, keys: string[]): string | null {
    for (const key of keys) {
        const candidate = readString(record[key]);
        if (candidate) {
            return candidate;
        }
    }
    return null;
}

function readIdentityCandidates(content: unknown): {
    profileUrl: string | null;
    resumeId: string | null;
    profileResumeId: string | null;
    profileId: string | null;
    perUserId: string | null;
    externalId: string | null;
} {
    if (!isRecord(content)) {
        return {
            profileUrl: null,
            resumeId: null,
            profileResumeId: null,
            profileId: null,
            perUserId: null,
            externalId: null,
        };
    }

    return {
        profileUrl: readCandidate(content, PROFILE_URL_KEYS),
        resumeId: readCandidate(content, RESUME_ID_KEYS),
        profileResumeId: readCandidate(content, PROFILE_RESUME_ID_KEYS),
        profileId: readCandidate(content, PROFILE_ID_KEYS),
        perUserId: readCandidate(content, PER_USER_ID_KEYS),
        externalId: readCandidate(content, EXTERNAL_ID_KEYS),
    };
}

function uniqueStrings(values: Array<string | null | undefined>): string[] {
    const seen = new Set<string>();
    const result: string[] = [];
    for (const value of values) {
        if (!value || seen.has(value)) {
            continue;
        }
        seen.add(value);
        result.push(value);
    }
    return result;
}

function extractProfileResumeIdFromUrl(value: string): string | null {
    const directJob5156Id = extractJob5156ResumeId(value);
    if (directJob5156Id) {
        return normalizeResumeIdentityToken(directJob5156Id);
    }

    const parsed = parseUrlLike(value);
    if (parsed) {
        for (const [key, paramValue] of parsed.searchParams.entries()) {
            if (PROFILE_RESUME_ID_QUERY_KEYS.has(key.toLowerCase())) {
                const normalized = normalizeResumeIdentityToken(paramValue);
                if (normalized) {
                    return normalized;
                }
            }
        }

        const seekProfileId = readQueryParamCaseInsensitive(parsed, "openProfileId");
        if (seekProfileId) {
            const normalized = normalizeResumeIdentityToken(seekProfileId);
            if (normalized) {
                return normalized;
            }
        }

        const candidatePathId = parsed.pathname.match(/\/candidates\/(?:profiles\/)?([^/?#]+)(?:\/|$)/i)?.[1];
        if (candidatePathId) {
            const normalized = normalizeResumeIdentityToken(decodeURIComponentSafe(candidatePathId));
            if (normalized) {
                return normalized;
            }
        }
    }

    const numericMatch = value.match(PROFILE_RESUME_ID_RE)?.[1];
    return numericMatch ? normalizeResumeIdentityToken(numericMatch) : null;
}

export function normalizeResumeIdentityKey(value: string, source?: string): string | null {
    const separator = value.indexOf(":");
    if (separator <= 0) {
        return null;
    }

    const prefix = value.slice(0, separator).trim().toLowerCase();
    const rawValue = value.slice(separator + 1).trim();
    if (!rawValue) {
        return null;
    }

    if (prefix === "profileurl") {
        const normalized = normalizeResumeProfileUrl(rawValue, source);
        return normalized ? `profileUrl:${normalized}` : null;
    }

    const normalized = normalizeResumeIdentityToken(rawValue);
    if (!normalized || (prefix === "externalid" && normalized === "unknown")) {
        return null;
    }

    switch (prefix) {
        case "resumeid":
            return `resumeId:${normalized}`;
        case "peruserid":
            return `perUserId:${normalized}`;
        case "externalid":
            return `externalId:${normalized}`;
        default:
            return null;
    }
}

export function collectResumeIdentityAliases(input: ResumeIdentityInput): ResumeIdentityAliases {
    const candidates = readIdentityCandidates(input.content);
    const normalizedProfileUrl = candidates.profileUrl
        ? normalizeResumeProfileUrl(candidates.profileUrl, input.source)
        : null;
    const normalizedResumeId = candidates.resumeId
        ? normalizeResumeIdentityToken(candidates.resumeId)
        : null;
    const normalizedPerUserId = candidates.perUserId
        ? normalizeResumeIdentityToken(candidates.perUserId)
        : null;
    const externalIds = uniqueStrings([
        candidates.externalId ? normalizeResumeIdentityToken(candidates.externalId) : null,
        normalizeResumeIdentityToken(input.externalId),
    ]);
    const profileResumeIds = uniqueStrings([
        candidates.profileResumeId ? normalizeResumeIdentityToken(candidates.profileResumeId) : null,
        normalizedResumeId,
        candidates.profileId ? normalizeResumeIdentityToken(candidates.profileId) : null,
        candidates.profileUrl ? extractProfileResumeIdFromUrl(candidates.profileUrl) : null,
    ]);
    const identityKeys = uniqueStrings([
        normalizedProfileUrl ? `profileUrl:${normalizedProfileUrl}` : null,
        normalizedResumeId ? `resumeId:${normalizedResumeId}` : null,
        normalizedPerUserId ? `perUserId:${normalizedPerUserId}` : null,
        ...externalIds.map((externalId) => `externalId:${externalId}`),
    ]);

    return {
        profileUrl: candidates.profileUrl ?? undefined,
        profileResumeId: profileResumeIds[0],
        profileUrlKeys: normalizedProfileUrl ? [`profileUrl:${normalizedProfileUrl}`] : [],
        profileResumeIds,
        externalIds,
        identityKeys,
    };
}

export function deriveResumeIdentity(input: ResumeIdentityInput): ResumeIdentity {
    const candidates = readIdentityCandidates(input.content);

    const normalizedProfileUrl = candidates.profileUrl ? normalizeResumeProfileUrl(candidates.profileUrl, input.source) : null;
    if (normalizedProfileUrl) {
        return {
            identityKey: `profileUrl:${normalizedProfileUrl}`,
            source: "profileUrl",
            rawValue: candidates.profileUrl ?? normalizedProfileUrl,
            normalizedValue: normalizedProfileUrl,
        };
    }

    const normalizedResumeId = candidates.resumeId ? normalizeResumeIdentityToken(candidates.resumeId) : null;
    if (normalizedResumeId) {
        return {
            identityKey: `resumeId:${normalizedResumeId}`,
            source: "resumeId",
            rawValue: candidates.resumeId ?? normalizedResumeId,
            normalizedValue: normalizedResumeId,
        };
    }

    const normalizedPerUserId = candidates.perUserId ? normalizeResumeIdentityToken(candidates.perUserId) : null;
    if (normalizedPerUserId) {
        return {
            identityKey: `perUserId:${normalizedPerUserId}`,
            source: "perUserId",
            rawValue: candidates.perUserId ?? normalizedPerUserId,
            normalizedValue: normalizedPerUserId,
        };
    }

    const externalIdCandidate = candidates.externalId ?? input.externalId;
    const normalizedExternalId = normalizeResumeIdentityToken(externalIdCandidate);
    if (normalizedExternalId) {
        return {
            identityKey: `externalId:${normalizedExternalId}`,
            source: "externalId",
            rawValue: externalIdCandidate,
            normalizedValue: normalizedExternalId,
        };
    }

    return {
        identityKey: "externalId:unknown",
        source: "externalId",
        rawValue: "",
        normalizedValue: "unknown",
    };
}

export function deriveResumeIdentityKey(input: ResumeIdentityInput): string {
    return deriveResumeIdentity(input).identityKey;
}
