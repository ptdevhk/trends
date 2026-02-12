import { mutation } from "./_generated/server";
import { buildSearchText } from "./search_text";

export const backfillSearchText = mutation({
    args: {},
    handler: async (ctx) => {
        const resumes = await ctx.db.query("resumes").collect();
        let count = 0;
        for (const resume of resumes) {
            if (resume.searchText) continue;

            const searchText = buildSearchText(resume.content);

            await ctx.db.patch(resume._id, { searchText });
            count++;
        }
        return `Backfilled ${count} resumes`;
    },
});

export const reindexSearchText = mutation({
    args: {},
    handler: async (ctx) => {
        const resumes = await ctx.db.query("resumes").collect();
        let count = 0;
        for (const resume of resumes) {
            const searchText = buildSearchText(resume.content);
            if (searchText !== resume.searchText) {
                await ctx.db.patch(resume._id, { searchText });
                count++;
            }
        }
        return `Reindexed ${count} resumes`;
    },
});
