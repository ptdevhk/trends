export type ResumeIdentitySource = "profileUrl" | "resumeId" | "perUserId" | "externalId";

export type ResumeIdentityInput = {
    content: unknown;
    externalId: string;
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

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null;
}

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

function normalizeProfileUrl(value: string): string | null {
    const trimmed = value.trim();
    if (!trimmed) {
        return null;
    }

    const lowered = trimmed.toLowerCase();
    if (lowered === "javascript:;" || lowered === "javascript:void(0)" || lowered === "#") {
        return null;
    }

    let parsed: URL | null = null;
    try {
        parsed = new URL(trimmed);
    } catch (error) {
        try {
            parsed = new URL(`https://${trimmed}`);
        } catch (fallbackError) {
            console.error("Failed to normalize profile URL for resume identity.", error, fallbackError);
            parsed = null;
        }
    }

    if (!parsed) {
        const fallback = lowered
            .replace(/^https?:\/\//, "")
            .replace(/#.*$/, "")
            .replace(/\/+$/, "");
        return fallback || null;
    }

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

    const normalizedProfileUrl = candidates.profileUrl ? normalizeProfileUrl(candidates.profileUrl) : null;
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
