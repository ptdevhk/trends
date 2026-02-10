import { mutation, query } from "./_generated/server";
import { v } from "convex/values";

export const status = query({
    args: {},
    handler: async (ctx) => {
        const [jobDescriptions, resumes, collectionTasks] = await Promise.all([
            ctx.db.query("job_descriptions").collect(),
            ctx.db.query("resumes").collect(),
            ctx.db.query("collection_tasks").collect(),
        ]);

        const counts = {
            jobDescriptions: jobDescriptions.length,
            resumes: resumes.length,
            collectionTasks: collectionTasks.length,
        };

        return {
            ...counts,
            isEmpty: counts.jobDescriptions === 0 && counts.resumes === 0 && counts.collectionTasks === 0,
        };
    },
});

export const seedJobDescriptions = mutation({
    args: {
        jobDescriptions: v.array(
            v.object({
                title: v.string(),
                content: v.string(),
                type: v.union(v.literal("system"), v.literal("custom")),
            })
        ),
    },
    handler: async (ctx, args) => {
        let inserted = 0;
        let skipped = 0;

        for (const jd of args.jobDescriptions) {
            const existing = await ctx.db
                .query("job_descriptions")
                .filter((q) =>
                    q.and(
                        q.eq(q.field("title"), jd.title),
                        q.eq(q.field("type"), jd.type)
                    )
                )
                .first();

            if (existing) {
                skipped += 1;
                continue;
            }

            await ctx.db.insert("job_descriptions", {
                title: jd.title,
                content: jd.content,
                type: jd.type,
                enabled: true,
                lastModified: Date.now(),
            });
            inserted += 1;
        }

        return { inserted, skipped };
    },
});

export const seedResumes = mutation({
    args: {
        resumes: v.array(
            v.object({
                externalId: v.string(),
                content: v.any(),
                hash: v.string(),
                source: v.string(),
                tags: v.optional(v.array(v.string())),
            })
        ),
    },
    handler: async (ctx, args) => {
        let inserted = 0;
        let skipped = 0;

        for (const resume of args.resumes) {
            const existing = await ctx.db
                .query("resumes")
                .withIndex("by_externalId", (q) => q.eq("externalId", resume.externalId))
                .unique();

            if (existing) {
                skipped += 1;
                continue;
            }

            await ctx.db.insert("resumes", {
                externalId: resume.externalId,
                content: resume.content,
                hash: resume.hash,
                source: resume.source,
                tags: resume.tags ?? [],
                crawledAt: Date.now(),
            });
            inserted += 1;
        }

        return { inserted, skipped };
    },
});
