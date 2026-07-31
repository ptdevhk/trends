import crypto from "node:crypto";

import { IndustryDataService } from "./industry-data-service.js";

/**
 * Seed importer: load current `config/industry-data` files and upsert them into the
 * Convex `industry_data_entries` table as canonical entries. Idempotent — entryIds
 * are stable per source row, so re-running upserts the same ids (no duplicates).
 *
 * entryId scheme: brand-<id> / company-<id> / keyword-<category>-<id> / url-<hash>.
 * keyword ids are only unique within a category (sub-sections restart numbering), so
 * the category is part of the key. url entries have no natural id → content hash.
 */

export interface SeedEntry {
    entryType: "company" | "keyword" | "brand" | "url";
    entryId: string;
    data: unknown;
    sortOrder?: number;
}

export interface SeedDeps {
    upsert: (entry: SeedEntry) => Promise<{ entryId: string }> | { entryId: string };
}

function urlHash(url: string): string {
    return crypto.createHash("sha1").update(url).digest("hex").slice(0, 12);
}

export async function seedIndustryDataFromFiles(
    projectRoot: string,
    deps: SeedDeps,
): Promise<{ imported: number }> {
    const data = new IndustryDataService(projectRoot).loadAll();
    const entries: SeedEntry[] = [];

    data.brands.forEach((b, i) =>
        entries.push({
            entryType: "brand",
            entryId: `brand-${b.id}`,
            data: b,
            sortOrder: i,
        }),
    );
    data.companies.forEach((c, i) =>
        entries.push({
            entryType: "company",
            entryId: `company-${c.category}-${c.id}`,
            data: c,
            sortOrder: i,
        }),
    );
    // Keyword ids restart within merged sub-sections, so <category>-<id> can still
    // collide. Track seen ids and append an occurrence suffix to guarantee uniqueness.
    const seenKeywordIds = new Map<string, number>();
    data.keywords.forEach((k, i) => {
        const base = `keyword-${k.category}-${k.id}`;
        const occurrence = seenKeywordIds.get(base) ?? 0;
        seenKeywordIds.set(base, occurrence + 1);
        entries.push({
            entryType: "keyword",
            entryId: occurrence === 0 ? base : `${base}-${occurrence + 1}`,
            data: k,
            sortOrder: i,
        });
    });
    data.companyUrls.forEach((u, i) =>
        entries.push({
            entryType: "url",
            entryId: `url-${urlHash(u)}`,
            data: u,
            sortOrder: i,
        }),
    );

    for (const entry of entries) {
        await deps.upsert(entry);
    }
    return { imported: entries.length };
}
