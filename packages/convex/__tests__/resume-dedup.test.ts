/**
 * Tests for item #9 resume dedup heuristics:
 * - contact-signal normalization (email / phone / linkedin)
 * - block-key derivation + maintenance via submitResumes
 * - merge-pair scoring (pure) + suggestMergeCandidates query
 *
 * Uses convex-test with real schema validation — no mocks.
 */
import { createTest } from "./test-helpers.js";
import { describe, expect, it } from "vitest";
import { api } from "../convex/_generated/api.js";
import {
    normalizeEmailAddress,
    normalizePhoneNumber,
    normalizeLinkedinUrl,
    deriveResumeContactSignals,
    deriveResumeBlockKeys,
    deriveResumeSignalKey,
    deriveResumeDisplayName,
    areContactSignalsEqual,
    collectResumeCompanyNames,
    collectResumeEducationSchools,
    deriveResumeTimelineYears,
    companyNameTokens,
} from "../convex/lib/resume_identity.js";
import { scoreMergePair } from "../convex/resume_dedup.js";

let _resumeCounter = 0;
function makeResume(overrides: Record<string, unknown> = {}) {
    _resumeCounter += 1;
    return {
        externalId: `ext-${_resumeCounter}`,
        content: { name: `User ${_resumeCounter}` },
        hash: `hash-${_resumeCounter}`,
        source: "test",
        tags: ["test"],
        ...overrides,
    };
}

// ---------------------------------------------------------------------------
// Pure normalizers
// ---------------------------------------------------------------------------

describe("resume_identity: contact signal normalizers", () => {
    it("normalizes email addresses", () => {
        expect(normalizeEmailAddress("  Alice.Chen+work@Example.COM ")).toBe("alice.chen+work@example.com");
        expect(normalizeEmailAddress("a@b.co")).toBe("a@b.co");
        expect(normalizeEmailAddress("a@b")).toBeNull();
        expect(normalizeEmailAddress("a b@c.com")).toBeNull();
        expect(normalizeEmailAddress("a@b@c.com")).toBeNull();
        expect(normalizeEmailAddress("")).toBeNull();
        expect(normalizeEmailAddress(42)).toBeNull();
    });

    it("normalizes phone numbers (digits, CN prefix)", () => {
        expect(normalizePhoneNumber("+86 138 1234 5678")).toBe("13812345678");
        expect(normalizePhoneNumber("0086-138-1234-5678")).toBe("13812345678");
        expect(normalizePhoneNumber("(021) 5555-1234")).toBe("02155551234");
        expect(normalizePhoneNumber("1234567")).toBe("1234567");
        expect(normalizePhoneNumber("123456")).toBeNull();
        expect(normalizePhoneNumber("1234567890123456")).toBeNull();
        expect(normalizePhoneNumber("86123")).toBeNull();
    });

    it("normalizes linkedin urls", () => {
        expect(normalizeLinkedinUrl("https://www.linkedin.com/in/alicechen/")).toBe("linkedin.com/in/alicechen");
        expect(normalizeLinkedinUrl("cn.linkedin.com/in/alicechen")).toBe("cn.linkedin.com/in/alicechen");
        expect(normalizeLinkedinUrl("https://evil.com/linkedin")).toBeNull();
        expect(normalizeLinkedinUrl("not a url")).toBeNull();
    });

    it("derives contact signals from content", () => {
        const signals = deriveResumeContactSignals({
            name: "Alice Chen",
            email: "Alice.Chen@Example.COM",
            phone: "+86 138 1234 5678",
            linkedin: "https://www.linkedin.com/in/alicechen/",
        });
        expect(signals).toEqual({
            email: "alice.chen@example.com",
            phone: "13812345678",
            linkedin: "linkedin.com/in/alicechen",
        });
        expect(deriveResumeContactSignals({ name: "No PII" })).toBeNull();
        expect(deriveResumeContactSignals("not a record")).toBeNull();
        expect(deriveResumeDisplayName({ name: "Alice Chen" })).toBe("Alice Chen");
    });

    it("derives block keys with source isolation", () => {
        const signals = deriveResumeContactSignals({
            email: "alice.chen@example.com",
            phone: "+86 138 1234 5678",
        });
        expect(deriveResumeBlockKeys(signals, "job5156")).toEqual([
            "phone:1381234|job5156",
            "email:example.com|job5156",
        ]);
        expect(deriveResumeBlockKeys(signals, "SEEK")).toEqual([
            "phone:1381234|seek",
            "email:example.com|seek",
        ]);
        expect(deriveResumeBlockKeys(null, "job5156")).toEqual([]);
        expect(deriveResumeSignalKey("phone:1381234|job5156")).toBe("phone:1381234");
        expect(deriveResumeSignalKey("email:example.com|seek")).toBe("email:example.com");
    });

    it("compares contact signals null-safely", () => {
        expect(areContactSignalsEqual(
            { email: "a@b.com", phone: "123", linkedin: "x" },
            { email: "a@b.com", phone: "123", linkedin: "x" },
        )).toBe(true);
        expect(areContactSignalsEqual(
            { email: "a@b.com" },
            { email: "a@b.com", phone: "123" },
        )).toBe(false);
        expect(areContactSignalsEqual(null, undefined)).toBe(true);
        expect(areContactSignalsEqual({}, undefined)).toBe(true);
    });
});

describe("resume_identity: soft-signal extractors", () => {
    it("collects company names from workHistory and top level", () => {
        expect(collectResumeCompanyNames({
            workHistory: [{ companyName: "ACME Corp" }, { company: "Beta Ltd" }],
        })).toEqual(["acme corp", "beta ltd"]);
        expect(collectResumeCompanyNames({ companyName: "Gamma Inc" })).toEqual(["gamma inc"]);
        expect(collectResumeCompanyNames({ experience: [{ employer: "Delta" }] })).toEqual(["delta"]);
        expect(collectResumeCompanyNames({ name: "Alice" })).toEqual([]);
    });

    it("collects education schools from multiple shapes", () => {
        expect(collectResumeEducationSchools({
            profileEducation: [{ schoolName: "Tsinghua University" }],
        })).toEqual(["tsinghua university"]);
        expect(collectResumeEducationSchools({
            education: [{ school: "Peking University" }],
        })).toEqual(["peking university"]);
        expect(collectResumeEducationSchools({ institution: "Fudan" })).toEqual(["fudan"]);
    });

    it("derives timeline years from workHistory dates", () => {
        expect(deriveResumeTimelineYears({
            workHistory: [{ startDate: "2020-03", endDate: "2023-06" }],
        })).toEqual([2020, 2023]);
        expect(deriveResumeTimelineYears({
            workHistory: [{ period: "2015.09-2019.07" }],
        })).toEqual([2015, 2019]);
        expect(deriveResumeTimelineYears({ workHistory: [{ duration: "5 years" }] })).toEqual([]);
        expect(deriveResumeTimelineYears({ name: "1980" })).toEqual([]);
    });

    it("tokenizes company names with stoplist", () => {
        expect(Array.from(companyNameTokens(["ACME Technology", "Acme Ltd"]))).toEqual(["acme", "technology"]);
        expect(Array.from(companyNameTokens(["北京百度科技有限公司"]))).toEqual(["北京百度科技有限公司"]);
        expect(Array.from(companyNameTokens(["A"]))).toEqual([]);
    });
});

// ---------------------------------------------------------------------------
// scoreMergePair (pure)
// ---------------------------------------------------------------------------

describe("resume_dedup: scoreMergePair", () => {
    it("scores a full same-person match", () => {
        const left = {
            content: {
                name: "Alice Chen",
                workHistory: [{ companyName: "ACME Technology", startDate: "2020-01" }],
                profileEducation: [{ schoolName: "Tsinghua University" }],
            },
            contactSignals: { email: "alice.chen@example.com", phone: "13812345678", linkedin: "linkedin.com/in/alicechen" },
        };
        const right = {
            content: {
                name: "alice chen",
                workHistory: [{ companyName: "Acme Technology", endDate: "2020-06" }],
                education: [{ school: "Tsinghua University" }],
            },
            contactSignals: { email: "alice.chen@example.com", phone: "13812345678", linkedin: "linkedin.com/in/alicechen" },
        };
        const { score, evidence } = scoreMergePair(left, right);
        expect(score).toBe(9.75);
        expect(evidence).toEqual(expect.arrayContaining([
            "shared email: alice.chen@example.com",
            "shared phone: 13812345678",
            "shared linkedin: linkedin.com/in/alicechen",
            "shared name: Alice Chen",
            "shared company tokens: acme, technology",
            "overlapping timeline years: 2020",
            "shared education: tsinghua university",
        ]));
    });

    it("scores phone-only at 2 and disjoint at 0", () => {
        const phoneOnly = scoreMergePair(
            { content: { name: "A" }, contactSignals: { phone: "13812345678" } },
            { content: { name: "B" }, contactSignals: { phone: "13812345678" } },
        );
        expect(phoneOnly.score).toBe(2);
        expect(phoneOnly.evidence).toEqual(["shared phone: 13812345678"]);

        const disjoint = scoreMergePair(
            { content: { name: "A" }, contactSignals: { phone: "1112223333" } },
            { content: { name: "B" }, contactSignals: { phone: "4445556666" } },
        );
        expect(disjoint.score).toBe(0);
        expect(disjoint.evidence).toEqual([]);
    });
});

// ---------------------------------------------------------------------------
// Integration: submitResumes → contactSignals + blocks + suggestions
// ---------------------------------------------------------------------------

describe("resume_dedup: submitResumes integration", () => {
    it("captures contactSignals and writes blocks on insert", async () => {
        const t = createTest();
        const piiContent = {
            name: "Alice Chen",
            email: "alice.chen@example.com",
            phone: "+86 138 1234 5678",
            linkedin: "https://www.linkedin.com/in/alicechen/",
        };

        const result = await t.mutation(api.resume_tasks.submitResumes, {
            resumes: [
                makeResume({ externalId: "ext-a", content: piiContent, hash: "hash-a", source: "job5156" }),
                makeResume({ externalId: "ext-b", content: piiContent, hash: "hash-b", source: "seek" }),
            ],
        });
        expect(result.inserted).toBe(2);

        const resumes = await t.run(async (ctx) => ctx.db.query("resumes").collect());
        expect(resumes).toHaveLength(2);
        for (const resume of resumes) {
            expect(resume.contactSignals).toEqual({
                email: "alice.chen@example.com",
                phone: "13812345678",
                linkedin: "linkedin.com/in/alicechen",
            });
            // identityKey semantics untouched: falls back to externalId
            expect(resume.identityKey).toMatch(/^externalId:ext-/);
        }

        const blocks = await t.run(async (ctx) => ctx.db.query("resume_dedup_blocks").collect());
        expect(blocks).toHaveLength(4);
        expect(blocks.map((b) => b.blockKey).sort()).toEqual([
            "email:example.com|job5156",
            "email:example.com|seek",
            "phone:1381234|job5156",
            "phone:1381234|seek",
        ]);
        expect(blocks.every((b) => b.signalKey === "phone:1381234" || b.signalKey === "email:example.com")).toBe(true);
    });

    it("suggests cross-source merge candidates with evidence", async () => {
        const t = createTest();
        const piiContent = {
            name: "Alice Chen",
            email: "alice.chen@example.com",
            phone: "+86 138 1234 5678",
        };
        await t.mutation(api.resume_tasks.submitResumes, {
            resumes: [
                makeResume({ externalId: "ext-a", content: piiContent, hash: "hash-a", source: "job5156" }),
                makeResume({ externalId: "ext-b", content: piiContent, hash: "hash-b", source: "seek" }),
            ],
        });

        const result = await t.query(api.resume_dedup.suggestMergeCandidates, {});
        expect(result.scannedBlocks).toBe(4);
        expect(result.candidates).toHaveLength(1);
        const candidate = result.candidates[0];
        expect(candidate.score).toBe(5.5);
        expect(candidate.evidence).toEqual(expect.arrayContaining([
            "shared email: alice.chen@example.com",
            "shared phone: 13812345678",
            "shared name: Alice Chen",
        ]));
        expect(candidate.left.resumeId).not.toBe(candidate.right.resumeId);
        expect(candidate.left.source).toBe("job5156");
        expect(candidate.right.source).toBe("seek");
        expect(candidate.left.contactSignals?.email).toBe("alice.chen@example.com");
    });

    it("clears blocks when PII is removed on update", async () => {
        const t = createTest();
        const piiContent = {
            name: "Alice Chen",
            email: "alice.chen@example.com",
            phone: "+86 138 1234 5678",
        };
        await t.mutation(api.resume_tasks.submitResumes, {
            resumes: [
                makeResume({ externalId: "ext-a", content: piiContent, hash: "hash-a", source: "job5156" }),
                makeResume({ externalId: "ext-b", content: piiContent, hash: "hash-b", source: "seek" }),
            ],
        });

        const result = await t.mutation(api.resume_tasks.submitResumes, {
            resumes: [
                makeResume({ externalId: "ext-a", content: { name: "Alice Chen" }, hash: "hash-a2", source: "job5156" }),
            ],
        });
        expect(result.updated).toBe(1);

        const resumeA = await t.run(async (ctx) =>
            ctx.db.query("resumes").withIndex("by_externalId", (q) => q.eq("externalId", "ext-a")).unique());
        expect(resumeA?.contactSignals).toBeUndefined();

        const blocks = await t.run(async (ctx) => ctx.db.query("resume_dedup_blocks").collect());
        expect(blocks).toHaveLength(2); // only ext-b's remain
        expect(blocks.every((b) => b.resumeId !== resumeA?._id)).toBe(true);

        const suggestions = await t.query(api.resume_dedup.suggestMergeCandidates, {});
        expect(suggestions.candidates).toHaveLength(0);
    });

    it("does not suggest same-source pairs", async () => {
        const t = createTest();
        const content = { name: "Bob", phone: "+86 139 0000 1111" };
        await t.mutation(api.resume_tasks.submitResumes, {
            resumes: [
                makeResume({ externalId: "ext-c1", content, hash: "hash-c1", source: "job5156" }),
                makeResume({ externalId: "ext-c2", content, hash: "hash-c2", source: "job5156" }),
            ],
        });

        const blocks = await t.run(async (ctx) => ctx.db.query("resume_dedup_blocks").collect());
        expect(blocks).toHaveLength(2);

        const result = await t.query(api.resume_dedup.suggestMergeCandidates, {});
        expect(result.candidates).toHaveLength(0);
    });

    it("respects minScore and skips equal identityKeys", async () => {
        const t = createTest();
        const content = { name: "Same Name", email: "a@corp.com" };
        await t.mutation(api.resume_tasks.submitResumes, {
            resumes: [
                makeResume({ externalId: "ext-d1", content, hash: "hash-d1", source: "job5156" }),
                makeResume({ externalId: "ext-d2", content: { ...content, email: "b@corp.com" }, hash: "hash-d2", source: "seek" }),
            ],
        });

        // Name-only overlap scores 1.5: surfaced at default minScore, hidden at 2.
        const atDefault = await t.query(api.resume_dedup.suggestMergeCandidates, {});
        expect(atDefault.candidates).toHaveLength(1);
        expect(atDefault.candidates[0].score).toBe(1.5);

        const strict = await t.query(api.resume_dedup.suggestMergeCandidates, { minScore: 2 });
        expect(strict.candidates).toHaveLength(0);

        // Equal identityKeys are never suggested even when blocked.
        await t.run(async (ctx) => {
            const a = await ctx.db.insert("resumes", {
                externalId: "same-ext", identityKey: "externalId:same-ext",
                content: { name: "Dupe" }, hash: "h1", tags: [], source: "s1", crawledAt: 1,
            });
            const b = await ctx.db.insert("resumes", {
                externalId: "same-ext", identityKey: "externalId:same-ext",
                content: { name: "Dupe" }, hash: "h2", tags: [], source: "s2", crawledAt: 1,
            });
            await ctx.db.insert("resume_dedup_blocks", {
                blockKey: "phone:1112223|s1", signalKey: "phone:1112223", resumeId: a, source: "s1", createdAt: 1,
            });
            await ctx.db.insert("resume_dedup_blocks", {
                blockKey: "phone:1112223|s2", signalKey: "phone:1112223", resumeId: b, source: "s2", createdAt: 1,
            });
        });

        const afterSameKey = await t.query(api.resume_dedup.suggestMergeCandidates, {});
        expect(afterSameKey.candidates).toHaveLength(1); // only the name-overlap pair
    });
});
