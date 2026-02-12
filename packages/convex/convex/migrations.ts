import { internalMutation } from "./_generated/server";

export const backfillSearchText = internalMutation({
    args: {},
    handler: async (ctx) => {
        const resumes = await ctx.db.query("resumes").collect();
        let count = 0;
        for (const resume of resumes) {
            if (resume.searchText) continue;

            const content = resume.content || {};
            const parts = [
                content.name,
                content.jobIntention,
                content.selfIntro,
                content.education,
                content.location,
                content.expectedSalary,
                ...(Array.isArray(content.workHistory) ? content.workHistory.map((w: any) => typeof w === 'string' ? w : w?.raw) : []),
            ].filter(Boolean);

            const searchText = parts.join(" ").toLowerCase();

            await ctx.db.patch(resume._id, { searchText });
            count++;
        }
        return `Backfilled ${count} resumes`;
    },
});
