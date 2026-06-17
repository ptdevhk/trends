import { describe, expect, it } from "vitest";

import {
    buildCompanyPatternAliasLookup,
    normalizeCompanyPatternIdentifier,
    type CompanyPattern,
} from "../skills-knowledge";

describe("normalizeCompanyPatternIdentifier", () => {
    it("lowercases and trims the input", () => {
        expect(normalizeCompanyPatternIdentifier("  Fanuc  ")).toBe("fanuc");
    });

    it("returns empty string for whitespace-only input", () => {
        expect(normalizeCompanyPatternIdentifier("   ")).toBe("");
    });

    it("handles mixed case with special characters", () => {
        expect(normalizeCompanyPatternIdentifier("DMG MORI")).toBe("dmg mori");
    });
});

describe("buildCompanyPatternAliasLookup", () => {
    it("maps canonical name to itself", () => {
        const patterns: CompanyPattern[] = [
            { name: "Fanuc", allNames: ["Fanuc"], displayName: "Fanuc-style", aliases: [], displayAliases: [], role: "equipment" },
        ];
        const lookup = buildCompanyPatternAliasLookup(patterns);
        expect(lookup.get("fanuc")).toBe("fanuc");
    });

    it("maps aliases to canonical name", () => {
        const patterns: CompanyPattern[] = [
            { name: "Fanuc", allNames: ["Fanuc", "FANUC", "发那科"], displayName: "Fanuc-style", aliases: [], displayAliases: [], role: "equipment" },
        ];
        const lookup = buildCompanyPatternAliasLookup(patterns);
        expect(lookup.get("fanuc")).toBe("fanuc");
        expect(lookup.get("发那科")).toBe("fanuc");
    });

    it("skips empty names", () => {
        const patterns: CompanyPattern[] = [
            { name: "  ", allNames: ["Fanuc"], displayName: "Fanuc-style", aliases: [], displayAliases: [], role: "equipment" },
        ];
        const lookup = buildCompanyPatternAliasLookup(patterns);
        expect(lookup.has("")).toBe(false);
        expect(lookup.get("fanuc")).toBeUndefined();
    });

    it("handles multiple patterns without collision", () => {
        const patterns: CompanyPattern[] = [
            { name: "Fanuc", allNames: ["Fanuc"], displayName: "Fanuc-style", aliases: [], displayAliases: [], role: "equipment" },
            { name: "Mazak", allNames: ["Mazak", "山崎马扎克"], displayName: "Fanuc-style", aliases: [], displayAliases: [], role: "equipment" },
        ];
        const lookup = buildCompanyPatternAliasLookup(patterns);
        expect(lookup.get("fanuc")).toBe("fanuc");
        expect(lookup.get("mazak")).toBe("mazak");
        expect(lookup.get("山崎马扎克")).toBe("mazak");
    });

    it("returns empty map for empty input", () => {
        const lookup = buildCompanyPatternAliasLookup([]);
        expect(lookup.size).toBe(0);
    });
});
