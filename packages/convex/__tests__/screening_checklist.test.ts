import { describe, expect, it } from "vitest";
import {
    parseScreeningChecklist,
    cleanEvidence,
} from "../convex/lib/screening_checklist.js";
import { normalizeAnalysisResult } from "../convex/lib/analysis_normalization.js";

describe("screening_checklist", () => {
    describe("cleanEvidence", () => {
        it("returns undefined for non-strings", () => {
            expect(cleanEvidence(null)).toBeUndefined();
            expect(cleanEvidence(123)).toBeUndefined();
            expect(cleanEvidence({})).toBeUndefined();
            expect(cleanEvidence("   ")).toBeUndefined();
        });

        it("flattens newlines and extra spaces", () => {
            const result = cleanEvidence("Line 1\nLine 2\r\nLine 3\t\twith   spaces");
            expect(result).toBe("Line 1 Line 2 Line 3 with spaces");
        });

        it("truncates evidence longer than 120 chars", () => {
            const longStr = "a".repeat(150);
            const result = cleanEvidence(longStr);
            expect(result?.length).toBe(120);
            expect(result).toBe("a".repeat(120));
        });
    });

    describe("parseScreeningChecklist", () => {
        it("1. valid full AI bundle round-trips (5 verdicts + evidence preserved, generatedBy 'ai')", () => {
            const rawAi = {
                sellsMachines: { verdict: "yes", evidence: "Sold CNC machines for 5 years" },
                machineOrigin: { verdict: "international", evidence: "Mazak and DMG Mori experience" },
                channel: { verdict: "direct", evidence: "Direct sales to tier 1 auto suppliers" },
                region: { verdict: "East China (Jiangsu/Zhejiang)", evidence: "Based in Suzhou" },
                contactStatus: { verdict: "valid", evidence: "Phone and WeChat active" },
            };

            const checklist = parseScreeningChecklist(rawAi, {});

            expect(checklist).toEqual({
                generatedBy: "ai",
                sellsMachines: { verdict: "yes", evidence: "Sold CNC machines for 5 years" },
                machineOrigin: { verdict: "international", evidence: "Mazak and DMG Mori experience" },
                channel: { verdict: "direct", evidence: "Direct sales to tier 1 auto suppliers" },
                region: { verdict: "East China (Jiangsu/Zhejiang)", evidence: "Based in Suzhou" },
                contactStatus: { verdict: "valid", evidence: "Phone and WeChat active" },
            });
        });

        it("2. ingestData.brandOrigin=domestic overrides AI machineOrigin=international (generatedBy 'rules+ai')", () => {
            const rawAi = {
                sellsMachines: { verdict: "yes", evidence: "Selling machines" },
                machineOrigin: { verdict: "international", evidence: "AI thought it was foreign" },
                channel: { verdict: "distributor", evidence: "Distributor partner" },
                region: { verdict: "Guangdong", evidence: "Dongguan" },
                contactStatus: { verdict: "valid" },
            };

            const resume = {
                ingestData: {
                    brandOrigin: "domestic",
                },
            };

            const checklist = parseScreeningChecklist(rawAi, resume);

            expect(checklist.generatedBy).toBe("rules+ai");
            expect(checklist.machineOrigin.verdict).toBe("domestic");
            expect(checklist.machineOrigin.evidence).toBe("来源: ingestData.brandOrigin=domestic");
            expect(checklist.sellsMachines.verdict).toBe("yes");
            expect(checklist.channel.verdict).toBe("distributor");
        });

        it("2b. complete_machine brand hit overrides AI sellsMachines='no' to 'unclear' (generatedBy 'rules+ai')", () => {
            const rawAi = {
                sellsMachines: { verdict: "no", evidence: "AI says candidate only sells parts" },
                machineOrigin: { verdict: "international" },
                channel: { verdict: "unclear" },
                region: { verdict: "" },
                contactStatus: { verdict: "valid" },
            };

            const resume = {
                ingestData: {
                    brandHits: [
                        { brand: "Mazak", productClass: "complete_machine" },
                    ],
                },
            };

            const checklist = parseScreeningChecklist(rawAi, resume);

            expect(checklist.generatedBy).toBe("rules+ai");
            expect(checklist.sellsMachines.verdict).toBe("unclear");
            expect(checklist.sellsMachines.evidence).toContain("complete_machine");
        });

        it("3. invalid enum AI verdicts dropped to fallback; garbage raw does not throw, yields rules-only defaults", () => {
            const rawAi = {
                sellsMachines: { verdict: "maybe_or_not" },
                machineOrigin: { verdict: "alien" },
                channel: { verdict: "both" },
                region: { verdict: 12345 }, // invalid type -> empty string
                contactStatus: { verdict: "disconnected" },
            };

            const checklist = parseScreeningChecklist(rawAi, {});

            expect(checklist).toEqual({
                generatedBy: "rules",
                sellsMachines: { verdict: "unclear" },
                machineOrigin: { verdict: "unknown" },
                channel: { verdict: "unclear" },
                region: { verdict: "" },
                contactStatus: { verdict: "unclear" },
            });

            // Garbage raw non-objects
            expect(parseScreeningChecklist("not an object", {})).toEqual({
                generatedBy: "rules",
                sellsMachines: { verdict: "unclear" },
                machineOrigin: { verdict: "unknown" },
                channel: { verdict: "unclear" },
                region: { verdict: "" },
                contactStatus: { verdict: "unclear" },
            });

            expect(parseScreeningChecklist([1, 2, 3], null)).toEqual({
                generatedBy: "rules",
                sellsMachines: { verdict: "unclear" },
                machineOrigin: { verdict: "unknown" },
                channel: { verdict: "unclear" },
                region: { verdict: "" },
                contactStatus: { verdict: "unclear" },
            });
        });

        it("4. evidence flattening: multiline evidence -> single-spaced, >120 chars -> truncated", () => {
            const multilineEvidence = "Line 1\r\nLine 2\nLine 3\tTabbed\n" + "x".repeat(150);
            const rawAi = {
                sellsMachines: { verdict: "yes", evidence: multilineEvidence },
            };

            const checklist = parseScreeningChecklist(rawAi, {});
            expect(checklist.sellsMachines.evidence?.length).toBe(120);
            expect(checklist.sellsMachines.evidence?.startsWith("Line 1 Line 2 Line 3 Tabbed x")).toBe(true);
            expect(checklist.sellsMachines.evidence).not.toContain("\n");
            expect(checklist.sellsMachines.evidence).not.toContain("\r");
        });

        it("5. normalizeAnalysisResult returns screeningChecklist and does not change score for an existing test fixture", () => {
            const fixtureLlm = {
                score: 80,
                summary: "Test candidate",
                recommendation: "match",
                breakdown: { related_exp: 60 },
                screeningChecklist: {
                    sellsMachines: { verdict: "yes", evidence: "Verified sales" },
                    machineOrigin: { verdict: "domestic" },
                    channel: { verdict: "direct" },
                    region: { verdict: "Shanghai" },
                    contactStatus: { verdict: "valid" },
                },
            };

            const resume = {
                ingestData: { industryDbV2Raw: 30 },
            };

            const result = normalizeAnalysisResult(fixtureLlm, resume);

            // Existing score calculation untouched: round(60 * 0.5) + 30 = 60
            expect(result.score).toBe(60);
            expect(result.recommendation).toBe("potential");
            expect(result.screeningChecklist).toEqual({
                generatedBy: "ai",
                sellsMachines: { verdict: "yes", evidence: "Verified sales" },
                machineOrigin: { verdict: "domestic" },
                channel: { verdict: "direct" },
                region: { verdict: "Shanghai" },
                contactStatus: { verdict: "valid" },
            });
        });

        it("6. missing screeningChecklist input -> checklist still produced with defaults, generatedBy 'rules', and old-shape callers unaffected", () => {
            const fixtureLlm = {
                score: 70,
                summary: "Old shape without checklist",
                recommendation: "match",
                breakdown: { related_exp: 50 },
            };

            const resume = {
                ingestData: {
                    brandOrigin: "domestic",
                },
            };

            const result = normalizeAnalysisResult(fixtureLlm, resume);

            expect(result.screeningChecklist).toEqual({
                generatedBy: "rules",
                sellsMachines: { verdict: "unclear" },
                machineOrigin: { verdict: "domestic", evidence: "来源: ingestData.brandOrigin=domestic" },
                channel: { verdict: "unclear" },
                region: { verdict: "" },
                contactStatus: { verdict: "unclear" },
            });
        });
    });
});
