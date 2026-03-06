import { describe, expect, it } from "vitest";

import { buildAiTaggingIdentity, buildEvidenceTextFromWorkHistory, stableHash } from "../ai_tagging_results";

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

