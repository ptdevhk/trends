import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { buildSearchText } from "./search_text";

const jobDescriptionType = v.union(v.literal("system"), v.literal("custom"));

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
        items: v.array(
            v.object({
                title: v.string(),
                content: v.string(),
                type: jobDescriptionType,
            })
        ),
    },
    handler: async (ctx, args) => {
        const existingJobDescriptions = await ctx.db.query("job_descriptions").collect();
        const existingKeys = new Set(existingJobDescriptions.map((item) => `${item.title}::${item.type}`));

        let inserted = 0;
        let skipped = 0;

        for (const item of args.items) {
            const key = `${item.title}::${item.type}`;
            if (existingKeys.has(key)) {
                skipped += 1;
                continue;
            }

            await ctx.db.insert("job_descriptions", {
                title: item.title,
                content: item.content,
                type: item.type,
                enabled: true,
                lastModified: Date.now(),
            });
            existingKeys.add(key);
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
                tags: v.array(v.string()),
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
            const searchText = buildSearchText(resume.content);

            if (existing) {
                if (!existing.searchText) {
                    await ctx.db.patch(existing._id, { searchText });
                }
                skipped += 1;
                continue;
            }

            await ctx.db.insert("resumes", {
                externalId: resume.externalId,
                content: resume.content,
                hash: resume.hash,
                searchText,
                source: resume.source,
                tags: resume.tags,
                crawledAt: Date.now(),
            });
            inserted += 1;
        }

        return { inserted, skipped };
    },
});

export const clearAll = mutation({
    args: {},
    handler: async (ctx) => {
        const jds = await ctx.db.query("job_descriptions").collect();
        for (const jd of jds) await ctx.db.delete(jd._id);

        const resumes = await ctx.db.query("resumes").collect();
        for (const resume of resumes) await ctx.db.delete(resume._id);

        const tasks = await ctx.db.query("collection_tasks").collect();
        for (const task of tasks) await ctx.db.delete(task._id);

        const analysisTasks = await ctx.db.query("analysis_tasks").collect();
        for (const task of analysisTasks) await ctx.db.delete(task._id);

        return { success: true };
    },
});
