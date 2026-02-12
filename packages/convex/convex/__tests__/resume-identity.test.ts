import { describe, expect, it } from "vitest";

import { deriveResumeIdentity, deriveResumeIdentityKey } from "../lib/resume_identity";

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
});
