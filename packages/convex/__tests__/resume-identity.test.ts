import { describe, expect, it } from "vitest";
import {
    collectResumeIdentityAliases,
    deriveResumeIdentity,
    deriveResumeIdentityKey,
    normalizeResumeIdentityKey,
    normalizeResumeProfileUrl,
} from "../convex/lib/resume_identity.js";

// ---------------------------------------------------------------------------
// deriveResumeIdentityKey tests
// ---------------------------------------------------------------------------

describe("deriveResumeIdentityKey", () => {
    it("prefers normalized profileUrl over other identifiers", () => {
        const key = deriveResumeIdentityKey({
            externalId: "external-123",
            content: {
                profileUrl: "https://HR.Job5156.com/Candidate/123/?b=2&a=1&utm_source=wechat",
                resumeId: "R-001",
                perUserId: "P-001",
                externalId: "EXT-001",
            },
        });

        expect(key).toBe("profileUrl:hr.job5156.com/candidate/123?a=1&b=2");
    });

    it("maps Job5156 old/new profile routes to the same identity key", () => {
        const oldRouteKey = deriveResumeIdentityKey({
            externalId: "external-old",
            content: {
                profileUrl: "https://hr.job5156.com/api/com/resume/123456?from=list",
            },
        });
        const newRouteKey = deriveResumeIdentityKey({
            externalId: "external-new",
            content: {
                profileUrl: "https://hr.job5156.com/resume/view/123456",
            },
        });
        const relativeRouteKey = deriveResumeIdentityKey({
            externalId: "external-relative",
            content: {
                profileUrl: "/resume/view/123456",
            },
        });

        expect(oldRouteKey).toBe("profileUrl:hr.job5156.com/api/com/resume/123456");
        expect(newRouteKey).toBe(oldRouteKey);
        expect(relativeRouteKey).toBe(oldRouteKey);
    });

    it("falls back with precedence resumeId -> perUserId -> externalId", () => {
        const byResumeId = deriveResumeIdentity({
            externalId: "external-1",
            content: {
                resumeId: " Resume-ABC ",
                perUserId: "per-user-1",
                externalId: "ext-1",
            },
        });
        const byPerUserId = deriveResumeIdentity({
            externalId: "external-2",
            content: {
                perUserId: " PER-USER-2 ",
                externalId: "ext-2",
            },
        });
        const byExternal = deriveResumeIdentity({
            externalId: " EXTERNAL-3 ",
            content: {},
        });

        expect(byResumeId.identityKey).toBe("resumeId:resume-abc");
        expect(byResumeId.source).toBe("resumeId");
        expect(byPerUserId.identityKey).toBe("perUserId:per-user-2");
        expect(byPerUserId.source).toBe("perUserId");
        expect(byExternal.identityKey).toBe("externalId:external-3");
        expect(byExternal.source).toBe("externalId");
    });

    it("returns stable keys for mixed identifier input order", () => {
        const first = deriveResumeIdentityKey({
            externalId: "ignored",
            content: {
                resumeId: "A-100",
                profileUrl: "https://example.com/path?id=2&id=1",
            },
        });
        const second = deriveResumeIdentityKey({
            externalId: "ignored",
            content: {
                profileUrl: "https://EXAMPLE.com/path/?id=1&id=2",
                resumeId: "A-100",
            },
        });

        expect(first).toBe(second);
    });

    it("normalizes Seek candidate profile URLs with source awareness", () => {
        const directProfile = deriveResumeIdentityKey({
            externalId: "hk.employer.seek.com:profile:503033454",
            source: "hk.employer.seek.com",
            content: {
                profileUrl: "https://hk.employer.seek.com/candidates/503033454?x=1&utm_source=extension",
            },
        });
        const nestedProfile = deriveResumeIdentityKey({
            externalId: "my.employer.seek.com:profile:503033454",
            source: "my.employer.seek.com",
            content: {
                profileUrl: "https://my.employer.seek.com/candidates/profiles/503033454/overview",
            },
        });

        expect(directProfile).toBe("profileUrl:hk.employer.seek.com/candidates/503033454");
        expect(nestedProfile).toBe("profileUrl:my.employer.seek.com/candidates/503033454");
    });

    it("normalizes Seek recommended URL format (openProfileId) to same identity as path format", () => {
        const recommendedUrl = deriveResumeIdentityKey({
            externalId: "hk.employer.seek.com:profile:503033454",
            source: "hk.employer.seek.com",
            content: {
                profileUrl: "https://hk.employer.seek.com/candidates/recommended?jobId=90842915&openProfileId=503033454",
            },
        });
        const pathUrl = deriveResumeIdentityKey({
            externalId: "hk.employer.seek.com:profile:503033454",
            source: "hk.employer.seek.com",
            content: {
                profileUrl: "https://hk.employer.seek.com/candidates/503033454",
            },
        });

        expect(recommendedUrl).toBe("profileUrl:hk.employer.seek.com/candidates/503033454");
        expect(recommendedUrl).toBe(pathUrl);
    });

    it("normalizes Seek openProfileId query keys case-insensitively", () => {
        const recommendedUrl = deriveResumeIdentityKey({
            externalId: "hk.employer.seek.com:profile:503033454",
            source: "hk.employer.seek.com",
            content: {
                profileUrl: "https://hk.employer.seek.com/candidates/recommended?OPENPROFILEID=503033454",
            },
        });

        expect(recommendedUrl).toBe("profileUrl:hk.employer.seek.com/candidates/503033454");
    });

    it("keeps same numeric ids distinct across different sources", () => {
        const seekIdentity = deriveResumeIdentityKey({
            externalId: "hk.employer.seek.com:profile:123456",
            source: "hk.employer.seek.com",
            content: {
                profileUrl: "https://hk.employer.seek.com/candidates/123456",
            },
        });
        const job5156Identity = deriveResumeIdentityKey({
            externalId: "hr.job5156.com:resume:123456",
            source: "hr.job5156.com",
            content: {
                profileUrl: "https://hr.job5156.com/resume/view/123456",
            },
        });

        expect(seekIdentity).not.toBe(job5156Identity);
        expect(job5156Identity).toBe("profileUrl:hr.job5156.com/api/com/resume/123456");
    });

    it("does not use Seek talentsearch name-search profileUrl as identity (keeps UUID externalIds distinct)", () => {
        const sharedNameSearchUrl =
            "https://hk.employer.seek.com/talentsearch/profiles/search?searchQuery=Ahmad%20Razak&market=MY&pageNumber=1";
        const first = deriveResumeIdentity({
            externalId: "hk.employer.seek.com:profile:52a6b466-895d-11ea-8ede-005056b16351",
            source: "hk.employer.seek.com",
            content: {
                profileUrl: sharedNameSearchUrl,
                profileId: "52a6b466-895d-11ea-8ede-005056b16351",
                seekProfileGuid: "52a6b466-895d-11ea-8ede-005056b16351",
                name: "Ahmad Razak",
            },
        });
        const second = deriveResumeIdentity({
            externalId: "hk.employer.seek.com:profile:aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
            source: "hk.employer.seek.com",
            content: {
                profileUrl: sharedNameSearchUrl,
                profileId: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
                seekProfileGuid: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
                name: "Ahmad Razak",
            },
        });

        expect(first.source).toBe("externalId");
        expect(second.source).toBe("externalId");
        expect(first.identityKey).toBe(
            "externalId:hk.employer.seek.com:profile:52a6b466-895d-11ea-8ede-005056b16351",
        );
        expect(second.identityKey).toBe(
            "externalId:hk.employer.seek.com:profile:aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
        );
        expect(first.identityKey).not.toBe(second.identityKey);
    });

    it("does not use Seek /candidates/recommended list URL as identity (keeps externalIds distinct)", () => {
        // Real capture shape: every resume on the same recommended results page
        // shares the same profileUrl (jobId+pageNumber only, no openProfileId).
        const sharedRecommendedUrl =
            "https://hk.employer.seek.com/candidates/recommended?jobId=93388470&pageNumber=1";
        const first = deriveResumeIdentity({
            externalId: "hk.employer.seek.com:recommended:dom-93388470-1-1",
            source: "hk.employer.seek.com",
            content: { profileUrl: sharedRecommendedUrl },
        });
        const second = deriveResumeIdentity({
            externalId: "hk.employer.seek.com:recommended:dom-93388470-1-2",
            source: "hk.employer.seek.com",
            content: { profileUrl: sharedRecommendedUrl },
        });

        expect(first.source).toBe("externalId");
        expect(second.source).toBe("externalId");
        expect(first.identityKey).toBe("externalId:hk.employer.seek.com:recommended:dom-93388470-1-1");
        expect(second.identityKey).toBe("externalId:hk.employer.seek.com:recommended:dom-93388470-1-2");
        expect(first.identityKey).not.toBe(second.identityKey);
    });
});

// ---------------------------------------------------------------------------
// Edge cases / missing tests from original set (14 new tests below)
// ---------------------------------------------------------------------------

describe("deriveResumeIdentity — empty / unknown fallback", () => {
    it("returns externalId:unknown when content is null and externalId is empty", () => {
        const result = deriveResumeIdentity({ content: null, externalId: "" });
        expect(result.identityKey).toBe("externalId:unknown");
        expect(result.source).toBe("externalId");
        expect(result.normalizedValue).toBe("unknown");
        expect(result.rawValue).toBe("");
    });

    it("returns externalId:unknown when content is undefined and externalId is empty", () => {
        const result = deriveResumeIdentity({ content: undefined, externalId: "" });
        expect(result.identityKey).toBe("externalId:unknown");
        expect(result.normalizedValue).toBe("unknown");
    });

    it("returns externalId:unknown when content is an empty object and no externalId", () => {
        const result = deriveResumeIdentity({ content: {}, externalId: "" });
        expect(result.identityKey).toBe("externalId:unknown");
    });

    it("returns externalId:unknown when content is a non-object (string) and no externalId", () => {
        const result = deriveResumeIdentity({ content: "just a string", externalId: "" });
        expect(result.identityKey).toBe("externalId:unknown");
    });

    it("returns externalId:unknown when content is an array (non-record) and no externalId", () => {
        const result = deriveResumeIdentity({ content: ["a", "b"], externalId: "" });
        expect(result.identityKey).toBe("externalId:unknown");
    });
});

describe("deriveResumeIdentity — fallback to input-level externalId", () => {
    it("uses externalId from input when content has no identifiers", () => {
        const result = deriveResumeIdentity({ content: {}, externalId: "fallback-001" });
        expect(result.identityKey).toBe("externalId:fallback-001");
        expect(result.source).toBe("externalId");
    });

    it("uses externalId from input when content has only useless profileUrl values", () => {
        const result = deriveResumeIdentity({
            content: { profileUrl: "javascript:;" },
            externalId: "fallback-002",
        });
        expect(result.identityKey).toBe("externalId:fallback-002");
    });

    it("prefers externalId from content over input-level externalId", () => {
        const result = deriveResumeIdentity({
            content: { externalId: "content-ext" },
            externalId: "input-ext",
        });
        expect(result.identityKey).toBe("externalId:content-ext");
    });
});

describe("deriveResumeIdentityKey — edge values ignored for profileUrl", () => {
    it("ignores javascript:; profileUrl and falls through", () => {
        const key = deriveResumeIdentityKey({
            externalId: "ext-js",
            content: { profileUrl: "javascript:;", resumeId: "R-999" },
        });
        expect(key).toBe("resumeId:r-999");
    });

    it("ignores javascript:void(0) profileUrl and falls through", () => {
        const key = deriveResumeIdentityKey({
            externalId: "ext-void",
            content: { profileUrl: "javascript:void(0)", resumeId: "R-888" },
        });
        expect(key).toBe("resumeId:r-888");
    });

    it("ignores hash-only profileUrl and falls through", () => {
        const key = deriveResumeIdentityKey({
            externalId: "ext-hash",
            content: { profileUrl: "#", resumeId: "R-777" },
        });
        expect(key).toBe("resumeId:r-777");
    });
});

describe("deriveResumeIdentity — URL normalization", () => {
    it("lowercases hostname in profile URL", () => {
        const result = deriveResumeIdentityKey({
            externalId: "x",
            content: { profileUrl: "HTTPS://EXAMPLE.ORG/Profile" },
        });
        expect(result).toBe("profileUrl:example.org/profile");
    });

    it("removes trailing slashes from profile URL", () => {
        const result = deriveResumeIdentityKey({
            externalId: "x",
            content: { profileUrl: "https://example.com/path///" },
        });
        expect(result).toBe("profileUrl:example.com/path");
    });

    it("sorts query parameters alphabetically", () => {
        const result = deriveResumeIdentityKey({
            externalId: "x",
            content: { profileUrl: "https://example.com/p?z=1&a=2&m=3" },
        });
        expect(result).toBe("profileUrl:example.com/p?a=2&m=3&z=1");
    });

    it("strips utm_ query parameters", () => {
        const result = deriveResumeIdentityKey({
            externalId: "x",
            content: { profileUrl: "https://example.com/p?utm_source=google&id=5&utm_campaign=test" },
        });
        expect(result).toBe("profileUrl:example.com/p?id=5");
    });
});

describe("deriveResumeIdentity — values trimmed and lowered", () => {
    it("trims and lowercases resumeId", () => {
        const result = deriveResumeIdentity({
            externalId: "x",
            content: { resumeId: "  Resume-ABC-123  " },
        });
        expect(result.identityKey).toBe("resumeId:resume-abc-123");
        // rawValue is readString-trimmed by readCandidate before identity derivation
        expect(result.rawValue).toBe("Resume-ABC-123");
        expect(result.normalizedValue).toBe("resume-abc-123");
    });

    it("trims and lowercases perUserId", () => {
        const result = deriveResumeIdentity({
            externalId: "x",
            content: { perUserId: "  USER-001  " },
        });
        expect(result.identityKey).toBe("perUserId:user-001");
        expect(result.normalizedValue).toBe("user-001");
    });

    it("trims and lowercases externalId", () => {
        const result = deriveResumeIdentity({
            externalId: "  EXT-001  ",
            content: {},
        });
        expect(result.identityKey).toBe("externalId:ext-001");
        expect(result.normalizedValue).toBe("ext-001");
    });
});

describe("deriveResumeIdentity — rawValue vs normalizedValue", () => {
    it("preserves rawValue and provides normalizedValue for profileUrl", () => {
        const result = deriveResumeIdentity({
            externalId: "x",
            content: { profileUrl: "  https://EXAMPLE.com/PATH/  " },
        });
        // profileUrl is trimmed before URL parsing
        expect(result.rawValue).toBe("https://EXAMPLE.com/PATH/");
        expect(result.normalizedValue).toBe("example.com/path");
    });
});

describe("deriveResumeIdentity — alternative key names", () => {
    it("reads profile_url as alternative to profileUrl", () => {
        const key = deriveResumeIdentityKey({
            externalId: "x",
            content: { profile_url: "https://example.com/alt", resumeId: "R-1" },
        });
        expect(key).toBe("profileUrl:example.com/alt");
    });
});

describe("deriveResumeIdentity — Seek UUID profile matching", () => {
    it("normalizes Seek profile with UUID path to stable key", () => {
        const key = deriveResumeIdentityKey({
            externalId: "au.employer.seek.com:uuid:abc123",
            source: "au.employer.seek.com",
            content: {
                profileUrl: "https://au.employer.seek.com/candidates/3f7e2c1a-b5d8-4f0a-9c3e-6a1b2d8f7e0c",
            },
        });
        expect(key).toBe("profileUrl:au.employer.seek.com/candidates/3f7e2c1a-b5d8-4f0a-9c3e-6a1b2d8f7e0c");
    });
});

describe("deriveResumeIdentity — Seek source from input.source when hostname does not match", () => {
    it("matches Seek normalization when source ends with .employer.seek.com even if hostname doesn't", () => {
        const key = deriveResumeIdentityKey({
            externalId: "seek:profile:12345",
            source: "au.employer.seek.com",
            content: {
                // Not a seek hostname, but source identifies it as seek
                profileUrl: "https://some-other-domain.com/candidates/12345",
            },
        });
        expect(key).toBe("profileUrl:some-other-domain.com/candidates/12345");
    });
});

describe("deriveResumeIdentity — Job5156 canonical form detail", () => {
    it("normalizes stand-alone api/com/resume URL to canonical form", () => {
        const key = deriveResumeIdentityKey({
            externalId: "x",
            content: {
                profileUrl: "https://hr.job5156.com/api/com/resume/some-user-id?t=1",
            },
        });
        expect(key).toBe("profileUrl:hr.job5156.com/api/com/resume/some-user-id");
    });

    it("normalizes relative api/com/resume URL to canonical form", () => {
        const key = deriveResumeIdentityKey({
            externalId: "x",
            content: {
                profileUrl: "//hr.job5156.com/api/com/resume/abc-def-123",
            },
        });
        expect(key).toBe("profileUrl:hr.job5156.com/api/com/resume/abc-def-123");
    });

    it("returns identityKey for content with both resume_id and per_user_id (alternative key names)", () => {
        const byResumeId = deriveResumeIdentity({
            externalId: "x",
            content: { resume_id: " R1 ", per_user_id: "P1" },
        });
        expect(byResumeId.identityKey).toBe("resumeId:r1");
        expect(byResumeId.source).toBe("resumeId");

        const byPerUserId = deriveResumeIdentity({
            externalId: "x",
            content: { per_user_id: " P2 " },
        });
        expect(byPerUserId.identityKey).toBe("perUserId:p2");
    });

    it("prefers profileURL (camelCase) over other identifiers", () => {
        const key = deriveResumeIdentityKey({
            externalId: "x",
            content: { profileURL: "https://example.com/prof", resumeId: "R-1" },
        });
        expect(key).toBe("profileUrl:example.com/prof");
    });
});

describe("resume identity selector normalization", () => {
    it("normalizes equivalent profile URLs with the canonical URL rules", () => {
        expect(normalizeResumeProfileUrl(
            "https://ehire.51job.com/Revision/talent/resume/detail?utm_source=a&resumeId=123456&contentType=",
        )).toBe("ehire.51job.com/revision/talent/resume/detail?contenttype=&resumeid=123456");
    });

    it("normalizes supported identity-key prefixes and rejects unknown keys", () => {
        expect(normalizeResumeIdentityKey(" ResumeId:ABC-123 ")).toBe("resumeId:abc-123");
        expect(normalizeResumeIdentityKey("profileUrl:https://example.com/candidate/1/"))
            .toBe("profileUrl:example.com/candidate/1");
        expect(normalizeResumeIdentityKey("name:alice")).toBeNull();
    });

    it("collects profile resume IDs from explicit fields and profile URLs", () => {
        const aliases = collectResumeIdentityAliases({
            content: {
                profileUrl: "https://ehire.51job.com/Revision/talent/resume/detail?contentType=&resumeId=123456",
                resumeId: "123456",
                profileId: "seek-profile-7",
            },
            externalId: "51job:resume:123456",
            source: "ehire.51job.com",
        });

        expect(aliases.profileResumeIds).toEqual(["123456", "seek-profile-7"]);
        expect(aliases.profileUrlKeys).toEqual([
            "profileUrl:ehire.51job.com/revision/talent/resume/detail?contenttype=&resumeid=123456",
        ]);
        expect(aliases.externalIds).toEqual(["51job:resume:123456"]);
        expect(aliases.identityKeys).toContain("resumeId:123456");
    });
});
