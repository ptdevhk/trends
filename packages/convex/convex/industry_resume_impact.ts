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

function assertAsciiFieldName(value: string, context: string): void {
  if (/[^\x00-\x7F]/.test(value)) {
    throw new Error(
      `companyKey ${JSON.stringify(value)} (${context}) contains non-ASCII characters; Convex field names must be ASCII`,
    );
  }
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
    const entries: Array<[string, number]> = [];
    for (const companyKey of keys) {
      assertAsciiFieldName(companyKey, "resume-impact query");
      const rows = await ctx.db
        .query("company_resume_links")
        .withIndex("by_company", (index) =>
          index.eq("companyKey", companyKey),
        )
        .collect();
      entries.push([companyKey, rows.length]);
    }
    return Object.fromEntries(entries);
  },
});
