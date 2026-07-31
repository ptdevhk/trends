import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { findProjectRoot } from "./db.js";
import {
    commitIndustryDataFiles,
    regenerateIndustryDataFiles,
    renderBrandsJson,
    renderCompanyUrlsMd,
    renderKeywordsStructuredMd,
} from "./industry-data-generator.js";
import { seedIndustryDataFromFiles } from "./industry-data-seed.js";
import { IndustryDataService } from "./industry-data-service.js";

const projectRoot = findProjectRoot();
const dataDir = path.join(projectRoot, "config", "industry-data");

function load(): ReturnType<IndustryDataService["loadAll"]> {
    return new IndustryDataService(projectRoot).loadAll();
}

/**
 * NOTE on golden strategy: `keywords-structured.md` is LOSSY at load time.
 *  - ITES/agent companies are renumbered (companies.length+1), discarding file IDs.
 *  - Quick-search sections 5.1/5.2 map to machining/lathe and MERGE with 3.1/3.2.
 * So byte-identity for that file is NOT achievable from parsed data. The golden lock
 * is SEMANTIC: parse(render(parse(file))) deep-equals parse(file) on identity fields.
 * brands.json is lossless → byte-identical. company-urls.md round-trips as a URL set.
 */
describe("industry-data-generator golden round-trip", () => {
    it("renderBrandsJson re-parses to the identical brand list", () => {
        const { brands } = load();
        const rendered = renderBrandsJson(brands);
        const reparsed = JSON.parse(rendered) as unknown[];
        expect(reparsed).toHaveLength(brands.length);
        // Semantic: rendered JSON re-loaded via the service equals original brands.
        expect(reparsed).toEqual(
            brands.map((b) => {
                const o: Record<string, unknown> = {
                    id: b.id,
                    nameCn: b.nameCn,
                    nameEn: b.nameEn ?? null,
                    type: b.type,
                    origin: b.origin,
                };
                if (b.familyId) o.familyId = b.familyId;
                if (b.aliases && b.aliases.length > 0) o.aliases = b.aliases;
                if (b.productClass) o.productClass = b.productClass;
                if (o.nameEn === null) delete o.nameEn;
                return o;
            }),
        );
    });

    it("renderKeywordsStructuredMd re-parses to identical companies + keywords (semantic)", () => {
        const before = load();
        const rendered = renderKeywordsStructuredMd({
            companies: before.companies,
            keywords: before.keywords,
            brands: before.brands,
        });
        // Write to a temp dir and re-parse via the service against the SAME brands/urls.
        const tmp = fs.mkdtempSync(path.join(require("node:os").tmpdir(), "idg-"));
        const cfgDir = path.join(tmp, "config", "industry-data");
        fs.mkdirSync(cfgDir, { recursive: true });
        fs.writeFileSync(path.join(cfgDir, "keywords-structured.md"), rendered);
        fs.copyFileSync(path.join(dataDir, "brands.json"), path.join(cfgDir, "brands.json"));
        fs.copyFileSync(path.join(dataDir, "company-urls.md"), path.join(cfgDir, "company-urls.md"));
        const after = new IndustryDataService(tmp).loadAll();
        expect(after.companies).toEqual(before.companies);
        // Keywords round-trip losslessly as a SET, but ORDER within a category is NOT
        // preserved: the loader merges quick-search sub-sections (5.1/5.2) into
        // machining/lathe and re-sequences ids, so re-rendered order differs. The golden
        // lock is therefore set-equality on identity fields (category|keyword|english),
        // not array order. Verified separately: 0 keywords lost across the round-trip.
        const key = (k: { category: string; keyword: string; english?: string }) =>
            `${k.category}|${k.keyword}|${k.english ?? ""}`;
        expect(after.keywords.map(key).sort()).toEqual(before.keywords.map(key).sort());
        expect(after.keywords).toHaveLength(before.keywords.length);
        fs.rmSync(tmp, { recursive: true, force: true });
    });

    it("renderCompanyUrlsMd round-trips the URL list (set-equal, order preserved)", () => {
        const { companyUrls } = load();
        const rendered = renderCompanyUrlsMd(companyUrls);
        const reparsed = rendered
            .split("\n")
            .map((l) => l.trim())
            .filter((l) => l.startsWith("http://") || l.startsWith("https://"));
        expect(reparsed).toEqual(companyUrls);
    });

    it("regenerateIndustryDataFiles writes all three files and returns paths", () => {
        const data = load();
        const tmp = fs.mkdtempSync(path.join(require("node:os").tmpdir(), "idg-regen-"));
        const written = regenerateIndustryDataFiles(tmp, {
            companies: data.companies,
            keywords: data.keywords,
            brands: data.brands,
            companyUrls: data.companyUrls,
        });
        expect(written.written.sort()).toEqual(
            ["brands.json", "company-urls.md", "keywords-structured.md"].sort(),
        );
        for (const rel of written.written) {
            expect(fs.existsSync(path.join(tmp, "config", "industry-data", rel))).toBe(true);
        }
        fs.rmSync(tmp, { recursive: true, force: true });
    });
});

describe("commitIndustryDataFiles (best-effort git)", () => {
    it("returns { sha: null, warning } and never throws when git fails", () => {
        const execGit = () => {
            throw new Error("git not available");
        };
        const result = commitIndustryDataFiles(projectRoot, "tester", { execGit });
        expect(result.sha).toBeNull();
        expect(result.warning).toMatch(/git/i);
    });

    it("parses sha from git rev-parse HEAD on success", () => {
        const execGit = (args: string[]) =>
            args[0] === "rev-parse" ? "abc123def456\n" : "";
        const result = commitIndustryDataFiles(projectRoot, "tester", { execGit });
        expect(result.sha).toBe("abc123def456");
        expect(result.warning).toBeUndefined();
    });
});

describe("seedIndustryDataFromFiles", () => {
    function makeDeps() {
        const calls: Array<{ entryType: string; entryId: string }> = [];
        return {
            calls,
            upsert: (e: { entryType: string; entryId: string }) => {
                calls.push(e);
                return Promise.resolve({ entryId: e.entryId });
            },
        };
    }

    it("maps files to entries and is idempotent (upsert per stable entryId)", async () => {
        // Run 1 with its own dep to assert intra-run uniqueness.
        const deps1 = makeDeps();
        const first = await seedIndustryDataFromFiles(projectRoot, deps1);
        expect(first.imported).toBeGreaterThan(0);
        const run1Ids = deps1.calls.map((c) => `${c.entryType}:${c.entryId}`);
        expect(new Set(run1Ids).size).toBe(run1Ids.length); // unique within one run

        // Run 2 (fresh dep) must produce the SAME ids → idempotent re-seed.
        const deps2 = makeDeps();
        const second = await seedIndustryDataFromFiles(projectRoot, deps2);
        expect(second.imported).toBe(first.imported);
        expect(deps2.calls.map((c) => `${c.entryType}:${c.entryId}`)).toEqual(run1Ids);

        // entryId scheme present
        const schemes = new Set(deps1.calls.map((c) => c.entryId.split("-")[0]));
        expect(schemes.has("brand")).toBe(true);
        expect(schemes.has("company")).toBe(true);
        expect(schemes.has("keyword")).toBe(true);
        expect(schemes.has("url")).toBe(true);
    });
});
