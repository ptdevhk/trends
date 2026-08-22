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

    it("never collects a search-index result set", () => {
        // Convex search indexes cap scans at 1024 rows; .collect() on a
        // search query therefore silently truncates long-tail result sets.
        // Every search call site must bound with .take() or .paginate().
        const source = readFileSync(
            new URL("../convex/resumes_search.ts", import.meta.url),
            "utf8",
        );

        const callSites = [...source.matchAll(/\.withSearchIndex\("search_body"/g)];
        expect(callSites.length).toBeGreaterThan(0);

        const violations: string[] = [];
        for (const match of callSites) {
            const tail = source.slice(match.index ?? 0, (match.index ?? 0) + 300);
            const before = source.slice(0, match.index ?? 0);
            const line = before.split("\n").length;
            if (tail.includes(".collect(")) {
                violations.push(`packages/convex/convex/resumes_search.ts:${line} uses .collect()`);
            }
            if (!tail.includes(".take(") && !tail.includes(".paginate(")) {
                violations.push(`packages/convex/convex/resumes_search.ts:${line} is unbounded`);
            }
        }
        expect(violations).toEqual([]);
    });
});
