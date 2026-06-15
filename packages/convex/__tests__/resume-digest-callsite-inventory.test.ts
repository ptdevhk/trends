/**
 * Inventory gate: fails while any production consumer of the cold
 * resumes.search_body search index remains in resumes_search.ts.
 *
 * This is the Phase 1A gate from the digest-first-everywhere refactor.
 * It must pass before the cold search index can be removed from schema.ts.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

function collectColdResumeSearchConsumers(source: string): string[] {
    const matches: string[] = [];
    const pattern = /query\("resumes"\)[\s\S]{0,240}\.withSearchIndex\("search_body"/g;
    for (const match of source.matchAll(pattern)) {
        const before = source.slice(0, match.index ?? 0);
        const line = before.split("\n").length;
        matches.push(`packages/convex/convex/resumes_search.ts:${line}`);
    }
    return matches;
}

describe("digest-first resume search call-site inventory", () => {
    it("has no production consumers of the cold resumes.search_body index", () => {
        const source = readFileSync(
            new URL("../convex/resumes_search.ts", import.meta.url),
            "utf8",
        );

        expect(collectColdResumeSearchConsumers(source)).toEqual([]);
    });
});
