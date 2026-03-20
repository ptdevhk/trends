import { describe, expect, it } from "vitest";

import { buildLatestWorkHistoryEvidence } from "@trends/shared";

import { buildAiTaggingIdentity, buildEvidenceTextFromWorkHistory, resolveAiTaggingEvidence, stableHash } from "../ai_tagging_results";

describe("buildEvidenceTextFromWorkHistory", () => {
    it("normalizes whitespace and preserves line boundaries", () => {
        const evidence = buildEvidenceTextFromWorkHistory({
            workHistory: ["  Foo   Bar  ", " Baz "],
        });

        expect(evidence.lines).toEqual(["Foo Bar", "Baz"]);
        expect(evidence.text).toBe("foo bar\nbaz");
    });

    it("accepts both string and {raw} workHistory entries", () => {
        const fromStrings = buildEvidenceTextFromWorkHistory({
            workHistory: ["销售 工程师", "CNC 机床"],
        });
        const fromObjects = buildEvidenceTextFromWorkHistory({
            workHistory: [{ raw: "销售 工程师" }, { raw: "CNC 机床" }],
        });

        expect(fromStrings.text).toBe(fromObjects.text);
    });

    it("produces stable hashes under whitespace differences", () => {
        const a = buildEvidenceTextFromWorkHistory({
            workHistory: ["  Sales   Engineer ", "CNC"],
        });
        const b = buildEvidenceTextFromWorkHistory({
            workHistory: [{ raw: "Sales Engineer" }, { raw: " CNC " }],
        });

        expect(stableHash(a.text)).toBe(stableHash(b.text));
    });

    it("matches the shared helper output", () => {
        const input = {
            workHistory: ["  Sales   Engineer ", { raw: " CNC 机床 " }],
        };

        expect(buildEvidenceTextFromWorkHistory(input)).toEqual(buildLatestWorkHistoryEvidence(input));
    });
});

describe("resolveAiTaggingEvidence", () => {
    it("uses persisted ingestData.evidenceText as the canonical strict evidence lane", () => {
        expect(resolveAiTaggingEvidence({
            content: {
                workHistory: [{ raw: "Sales narrative from content should not be used" }],
            },
            ingestData: {
                evidenceText: "2020-2025 sales engineer\ncnc 机床",
                industryTags: [],
                synonymHits: [],
                ruleScores: {},
                experienceLevel: "unknown",
                computedAt: 1,
                skillsVersion: 1,
            },
        })).toEqual({
            lines: ["2020-2025 sales engineer", "cnc 机床"],
            text: "2020-2025 sales engineer\ncnc 机床",
        });
    });

    it("does not fall back to resume.content when persisted evidence is missing", () => {
        expect(resolveAiTaggingEvidence({
            content: {
                workHistory: [{ raw: "Sales narrative from content should not be used" }],
            },
            ingestData: undefined,
        })).toBeNull();
    });

    it("matches legacy backfill output for stable queue identity", () => {
        const evidenceText = buildLatestWorkHistoryEvidence({
            workHistory: [
                { raw: " 2020-2025 Sales Engineer " },
                { raw: " CNC 机床 " },
            ],
        }).text;

        const resolved = resolveAiTaggingEvidence({
            content: {
                workHistory: [{ raw: "new content should not matter after backfill" }],
            },
            ingestData: {
                evidenceText,
                industryTags: [],
                synonymHits: [],
                ruleScores: {},
                experienceLevel: "unknown",
                computedAt: 1,
                skillsVersion: 1,
            },
        });

        expect(resolved?.text).toBe(evidenceText);
        expect(buildAiTaggingIdentity({
            profileKey: "cnc-sales-strict",
            evidenceText: resolved?.text ?? "",
            promptVersion: "v1",
            model: "gpt-test",
        }).evidenceHash).toBe(stableHash(evidenceText));
    });
});

describe("buildAiTaggingIdentity", () => {
    it("is stable for repeated inputs", () => {
        const evidence = buildEvidenceTextFromWorkHistory({
            workHistory: ["Sales Engineer", "CNC"],
        });

        const a = buildAiTaggingIdentity({
            profileKey: "cnc-sales-strict",
            evidenceText: evidence.text,
            promptVersion: "v1",
            model: "gpt-test",
        });
        const b = buildAiTaggingIdentity({
            profileKey: "cnc-sales-strict",
            evidenceText: evidence.text,
            promptVersion: "v1",
            model: "gpt-test",
        });

        expect(a).toEqual(b);
    });

    it("changes when promptVersion or model changes", () => {
        const evidence = buildEvidenceTextFromWorkHistory({
            workHistory: ["Sales Engineer", "CNC"],
        });

        const base = buildAiTaggingIdentity({
            profileKey: "cnc-sales-strict",
            evidenceText: evidence.text,
            promptVersion: "v1",
            model: "gpt-test",
        });

        const changedPrompt = buildAiTaggingIdentity({
            profileKey: "cnc-sales-strict",
            evidenceText: evidence.text,
            promptVersion: "v2",
            model: "gpt-test",
        });

        const changedModel = buildAiTaggingIdentity({
            profileKey: "cnc-sales-strict",
            evidenceText: evidence.text,
            promptVersion: "v1",
            model: "gpt-test-2",
        });

        expect(changedPrompt.idempotencyKey).not.toBe(base.idempotencyKey);
        expect(changedModel.idempotencyKey).not.toBe(base.idempotencyKey);
    });
});

