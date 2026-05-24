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
const PER_USER_ID_KEYS = ["perUserId", "per_user_id"];
const EXTERNAL_ID_KEYS = ["externalId", "external_id"];
const JOB5156_HOST = "hr.job5156.com";
export const SEEK_HOST_SUFFIX = ".employer.seek.com";


function readString(value: unknown): string | null {
    if (typeof value !== "string") {
        return null;
    }
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
}

function normalizeToken(value: string): string | null {
    const trimmed = value.trim();
    if (!trimmed) {
        return null;
    }
    return trimmed.toLowerCase();
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

    const openProfileIdParam = parsed.searchParams.get("openProfileId");
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

function normalizeProfileUrl(value: string, source?: string): string | null {
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
    perUserId: string | null;
    externalId: string | null;
} {
    if (!isRecord(content)) {
        return {
            profileUrl: null,
            resumeId: null,
            perUserId: null,
            externalId: null,
        };
    }

    return {
        profileUrl: readCandidate(content, PROFILE_URL_KEYS),
        resumeId: readCandidate(content, RESUME_ID_KEYS),
        perUserId: readCandidate(content, PER_USER_ID_KEYS),
        externalId: readCandidate(content, EXTERNAL_ID_KEYS),
    };
}

export function deriveResumeIdentity(input: ResumeIdentityInput): ResumeIdentity {
    const candidates = readIdentityCandidates(input.content);

    const normalizedProfileUrl = candidates.profileUrl ? normalizeProfileUrl(candidates.profileUrl, input.source) : null;
    if (normalizedProfileUrl) {
        return {
            identityKey: `profileUrl:${normalizedProfileUrl}`,
            source: "profileUrl",
            rawValue: candidates.profileUrl ?? normalizedProfileUrl,
            normalizedValue: normalizedProfileUrl,
        };
    }

    const normalizedResumeId = candidates.resumeId ? normalizeToken(candidates.resumeId) : null;
    if (normalizedResumeId) {
        return {
            identityKey: `resumeId:${normalizedResumeId}`,
            source: "resumeId",
            rawValue: candidates.resumeId ?? normalizedResumeId,
            normalizedValue: normalizedResumeId,
        };
    }

    const normalizedPerUserId = candidates.perUserId ? normalizeToken(candidates.perUserId) : null;
    if (normalizedPerUserId) {
        return {
            identityKey: `perUserId:${normalizedPerUserId}`,
            source: "perUserId",
            rawValue: candidates.perUserId ?? normalizedPerUserId,
            normalizedValue: normalizedPerUserId,
        };
    }

    const externalIdCandidate = candidates.externalId ?? input.externalId;
    const normalizedExternalId = normalizeToken(externalIdCandidate);
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
