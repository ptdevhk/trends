import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { DEFAULT_WORKSPACE_SLUG } from "./sessions";

type TaxonomyStatus = "active" | "draft" | "archived";

function normalizeWorkspaceSlug(input: string | undefined): string {
    const normalized = input?.trim();
    return normalized && normalized.length > 0 ? normalized : DEFAULT_WORKSPACE_SLUG;
}

function normalizeOptionalString(input: string | undefined): string | undefined {
    const normalized = input?.trim();
    return normalized && normalized.length > 0 ? normalized : undefined;
}

function normalizeStringList(values: string[]): string[] {
    const seen = new Set<string>();
    const normalized: string[] = [];

    values.forEach((value) => {
        const token = value.trim();
        const key = token.toLowerCase();
        if (!token || seen.has(key)) {
            return;
        }

        seen.add(key);
        normalized.push(token);
    });

    return normalized;
}

function slugify(value: string): string {
    return value
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "");
}

function deriveSuggestionKey(tag: string): string {
    const normalized = tag.trim().toLowerCase();
    if (!normalized) {
        return "";
    }

    const tokens = normalized.split(/[\s/_-]+/g).filter((token) => token.length > 0);
    return tokens[0] ?? normalized;
}

function toTitleCase(value: string): string {
    return value
        .split(/[\s_-]+/g)
        .filter((token) => token.length > 0)
        .map((token) => token.charAt(0).toUpperCase() + token.slice(1))
        .join(" ");
}

export const list = query({
    args: {
        workspaceSlug: v.optional(v.string()),
        status: v.optional(v.union(v.literal("active"), v.literal("draft"), v.literal("archived"))),
    },
    handler: async (ctx, args) => {
        const workspaceSlug = normalizeWorkspaceSlug(args.workspaceSlug);
        const records = args.status
            ? await ctx.db
                .query("taxonomy_clusters")
                .withIndex("by_workspace_status", (q) =>
                    q.eq("workspaceSlug", workspaceSlug).eq("status", args.status as TaxonomyStatus)
                )
                .collect()
            : await ctx.db
                .query("taxonomy_clusters")
                .withIndex("by_workspace", (q) => q.eq("workspaceSlug", workspaceSlug))
                .collect();

        return records.sort((left, right) => {
            if (left.status !== right.status) {
                const order: Record<TaxonomyStatus, number> = { active: 0, draft: 1, archived: 2 };
                return order[left.status] - order[right.status];
            }

            return right.updatedAt - left.updatedAt;
        });
    },
});

export const upsert = mutation({
    args: {
        id: v.optional(v.id("taxonomy_clusters")),
        workspaceSlug: v.optional(v.string()),
        name: v.string(),
        slug: v.string(),
        parentSlug: v.optional(v.string()),
        tags: v.array(v.string()),
        source: v.union(v.literal("human"), v.literal("ai"), v.literal("merged")),
        confidence: v.optional(v.number()),
        status: v.union(v.literal("active"), v.literal("draft"), v.literal("archived")),
    },
    handler: async (ctx, args) => {
        const workspaceSlug = normalizeWorkspaceSlug(args.workspaceSlug);
        const name = args.name.trim();
        const slug = slugify(args.slug || args.name);
        const tags = normalizeStringList(args.tags);
        const parentSlug = normalizeOptionalString(args.parentSlug);
        const updatedAt = Date.now();

        if (!name || !slug || tags.length === 0) {
            throw new Error("Missing taxonomy cluster fields");
        }

        const existingBySlug = await ctx.db
            .query("taxonomy_clusters")
            .withIndex("by_workspace_slug", (q) => q.eq("workspaceSlug", workspaceSlug).eq("slug", slug))
            .unique();
        const existing = args.id
            ? await ctx.db.get(args.id)
            : existingBySlug;

        const patch = {
            workspaceSlug,
            name,
            slug,
            parentSlug,
            tags,
            source: args.source,
            confidence: args.confidence,
            status: args.status,
            updatedAt,
        };

        if (existing) {
            await ctx.db.patch(existing._id, patch);
            return await ctx.db.get(existing._id);
        }

        const createdAt = updatedAt;
        const id = await ctx.db.insert("taxonomy_clusters", {
            ...patch,
            createdAt,
        });
        return await ctx.db.get(id);
    },
});

export const remove = mutation({
    args: {
        id: v.id("taxonomy_clusters"),
        workspaceSlug: v.optional(v.string()),
    },
    handler: async (ctx, args) => {
        const workspaceSlug = normalizeWorkspaceSlug(args.workspaceSlug);
        const existing = await ctx.db.get(args.id);
        if (!existing || existing.workspaceSlug !== workspaceSlug) {
            return false;
        }

        await ctx.db.delete(existing._id);
        return true;
    },
});

export const suggest = mutation({
    args: {
        workspaceSlug: v.optional(v.string()),
        limit: v.optional(v.number()),
    },
    handler: async (ctx, args) => {
        const workspaceSlug = normalizeWorkspaceSlug(args.workspaceSlug);
        const limit = Math.max(1, Math.min(args.limit ?? 12, 24));
        const existingClusters = await ctx.db
            .query("taxonomy_clusters")
            .withIndex("by_workspace", (q) => q.eq("workspaceSlug", workspaceSlug))
            .collect();
        const clusteredTags = new Set(
            existingClusters.flatMap((cluster) => cluster.tags.map((tag) => tag.trim().toLowerCase()))
        );

        const resumes = await ctx.db.query("resumes").collect();
        const tagCounts = new Map<string, number>();
        for (const resume of resumes) {
            const seen = new Set<string>();
            for (const tag of resume.ingestData?.industryTags ?? []) {
                const normalized = tag.trim();
                const key = normalized.toLowerCase();
                if (!normalized || clusteredTags.has(key) || seen.has(key)) {
                    continue;
                }
                seen.add(key);
                tagCounts.set(normalized, (tagCounts.get(normalized) ?? 0) + 1);
            }
        }

        const grouped = new Map<string, Array<{ tag: string; count: number }>>();
        for (const [tag, count] of tagCounts.entries()) {
            const suggestionKey = deriveSuggestionKey(tag);
            if (!suggestionKey) {
                continue;
            }

            const current = grouped.get(suggestionKey) ?? [];
            current.push({ tag, count });
            grouped.set(suggestionKey, current);
        }

        const suggestions = Array.from(grouped.entries())
            .map(([key, entries]) => {
                const sortedEntries = [...entries].sort((left, right) => right.count - left.count);
                const totalCount = sortedEntries.reduce((sum, entry) => sum + entry.count, 0);
                const name = toTitleCase(key);
                const slug = slugify(name);
                return {
                    key,
                    name,
                    slug,
                    tags: sortedEntries.slice(0, 6).map((entry) => entry.tag),
                    totalCount,
                    confidence: Math.min(0.95, Math.max(0.25, totalCount / 20)),
                };
            })
            .filter((entry) => entry.tags.length > 0)
            .sort((left, right) => right.totalCount - left.totalCount)
            .slice(0, limit);

        const created = [];
        for (const suggestion of suggestions) {
            const existing = await ctx.db
                .query("taxonomy_clusters")
                .withIndex("by_workspace_slug", (q) =>
                    q.eq("workspaceSlug", workspaceSlug).eq("slug", suggestion.slug)
                )
                .unique();

            const now = Date.now();
            if (existing) {
                await ctx.db.patch(existing._id, {
                    tags: normalizeStringList([...existing.tags, ...suggestion.tags]),
                    source: existing.source === "human" ? existing.source : "merged",
                    confidence: suggestion.confidence,
                    status: existing.status,
                    updatedAt: now,
                });
                const updated = await ctx.db.get(existing._id);
                if (updated) {
                    created.push(updated);
                }
                continue;
            }

            const id = await ctx.db.insert("taxonomy_clusters", {
                workspaceSlug,
                name: suggestion.name,
                slug: suggestion.slug,
                tags: suggestion.tags,
                source: "merged" as const,
                confidence: suggestion.confidence,
                status: "draft" as const,
                createdAt: now,
                updatedAt: now,
            });
            const record = await ctx.db.get(id);
            if (record) {
                created.push(record);
            }
        }

        return created;
    },
});
