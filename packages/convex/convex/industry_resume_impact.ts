import { v } from "convex/values";
import { query } from "./_generated/server";

function requireReadSecret(writeSecret: string | undefined): void {
  const expected = process.env.CONVEX_WRITE_SECRET;
  if (!expected || writeSecret !== expected) {
    throw new Error("Unauthorized Convex read");
  }
}

function normalizeCompanyKey(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, "-");
}

/**
 * Resume-impact counts per company key: the number of company_resume_links
 * rows per companyKey (one index scan per key, bounded to 200 keys), used to
 * order industry-evidence sweep work by employer resume frequency first.
 * Missing keys are returned as 0 so callers never need to special-case them.
 */
export const getIndustryResumeImpactByCompanyKey = query({
  args: {
    writeSecret: v.optional(v.string()),
    companyKeys: v.array(v.string()),
  },
  handler: async (ctx, args) => {
    requireReadSecret(args.writeSecret);
    const keys = Array.from(
      new Set(
        args.companyKeys
          .map(normalizeCompanyKey)
          .filter((key) => Boolean(key)),
      ),
    ).slice(0, 200);
    const counts: Record<string, number> = {};
    for (const companyKey of keys) {
      const rows = await ctx.db
        .query("company_resume_links")
        .withIndex("by_company", (index) =>
          index.eq("companyKey", companyKey),
        )
        .collect();
      counts[companyKey] = rows.length;
    }
    return counts;
  },
});
