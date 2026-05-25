/**
 * Unit tests for lib/resume_identity.ts
 */
import { describe, expect, it } from "vitest";
import { deriveResumeIdentity, deriveResumeIdentityKey } from "../lib/resume_identity.js";

describe("deriveResumeIdentity", () => {
    it("derives identity from profileUrl", () => {
        const result = deriveResumeIdentity({
            content: { profileUrl: "https://example.com/profile/123" },
            externalId: "ext-1",
        });
        expect(result.source).toBe("profileUrl");
        expect(result.identityKey).toMatch(/^profileUrl:/);
    });

    it("derives identity from resumeId when no profileUrl", () => {
        const result = deriveResumeIdentity({
            content: { resumeId: "RES-456" },
            externalId: "ext-1",
        });
        expect(result.source).toBe("resumeId");
        expect(result.normalizedValue).toBe("res-456");
    });

    it("derives identity from perUserId when no profileUrl or resumeId", () => {
        const result = deriveResumeIdentity({
            content: { perUserId: "USER-789" },
            externalId: "ext-1",
        });
        expect(result.source).toBe("perUserId");
        expect(result.normalizedValue).toBe("user-789");
    });

    it("derives identity from externalId when no other candidates", () => {
        const result = deriveResumeIdentity({
            content: {},
            externalId: "EXT-123",
        });
        expect(result.source).toBe("externalId");
        expect(result.normalizedValue).toBe("ext-123");
    });

    it("prefers profileUrl over other candidates", () => {
        const result = deriveResumeIdentity({
            content: {
                profileUrl: "https://example.com/profile/1",
                resumeId: "RES-2",
                perUserId: "USER-3",
            },
            externalId: "EXT-4",
        });
        expect(result.source).toBe("profileUrl");
    });

    it("handles non-record content", () => {
        const result = deriveResumeIdentity({
            content: "not a record",
            externalId: "ext-fallback",
        });
        expect(result.source).toBe("externalId");
        expect(result.normalizedValue).toBe("ext-fallback");
    });

    it("normalizes Job5156 profile URLs", () => {
        const result = deriveResumeIdentity({
            content: { profileUrl: "https://hr.job5156.com/resume/view/ABC123" },
            externalId: "ext-1",
            source: "51job",
        });
        expect(result.source).toBe("profileUrl");
        expect(result.normalizedValue).toContain("hr.job5156.com");
    });

    it("normalizes Seek profile URLs", () => {
        const result = deriveResumeIdentity({
            content: { profileUrl: "https://talent.employer.seek.com/candidates/12345" },
            externalId: "ext-1",
            source: "seek",
        });
        expect(result.source).toBe("profileUrl");
        expect(result.normalizedValue).toContain("employer.seek.com");
    });

    it("skips javascript: URLs", () => {
        const result = deriveResumeIdentity({
            content: { profileUrl: "javascript:;", resumeId: "RES-1" },
            externalId: "ext-1",
        });
        expect(result.source).toBe("resumeId");
    });

    it("falls back to externalId:unknown for empty inputs", () => {
        const result = deriveResumeIdentity({
            content: {},
            externalId: "",
        });
        expect(result.source).toBe("externalId");
        expect(result.normalizedValue).toBe("unknown");
    });
});

describe("deriveResumeIdentityKey", () => {
    it("returns just the identity key string", () => {
        const key = deriveResumeIdentityKey({
            content: { resumeId: "RES-1" },
            externalId: "ext-1",
        });
        expect(key).toMatch(/^resumeId:/);
    });
});
