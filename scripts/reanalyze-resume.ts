/**
 * Re-run AI analysis for a specific resume and show before/after score comparison.
 *
 * Usage:
 *   source apps/web/.env.local && bun scripts/reanalyze-resume.ts <resumeId> [keyword1] [keyword2] ...
 *
 * Examples:
 *   source apps/web/.env.local && bun scripts/reanalyze-resume.ts k176vysz02hg8ac87nwtv230r584x3x5 CNC 销售
 *   source apps/web/.env.local && bun scripts/reanalyze-resume.ts k176vysz02hg8ac87nwtv230r584x3x5
 */
import { ConvexHttpClient } from "convex/browser";
import { api } from "../packages/convex/convex/_generated/api.js";

const CONVEX_URL = process.env.VITE_CONVEX_URL;
if (!CONVEX_URL) {
    console.error("Error: VITE_CONVEX_URL is required.");
    console.error("Run: source apps/web/.env.local && bun scripts/reanalyze-resume.ts <resumeId> [keywords...]");
    process.exit(1);
}

const [resumeId, ...keywords] = process.argv.slice(2);
if (!resumeId) {
    console.error("Usage: bun scripts/reanalyze-resume.ts <resumeId> [keyword1 keyword2 ...]");
    process.exit(1);
}

const client = new ConvexHttpClient(CONVEX_URL);

function formatRoleSignals(ingestData: Record<string, unknown> | undefined): string {
    const signals = ingestData?.roleSignals;
    if (!Array.isArray(signals) || signals.length === 0) return "(none)";
    return (signals as Array<Record<string, unknown>>).map((s) => {
        const verified = typeof s.industryVerifiedYears === "number" ? s.industryVerifiedYears : 0;
        return `${s.type}:${s.years}y verified:${verified}y`;
    }).join(" | ");
}

async function main() {
    const resume = await client.query(api.resumes.getResumeDetail, { resumeId: resumeId as never });
    if (!resume) {
        console.error(`Resume not found: ${resumeId}`);
        process.exit(1);
    }

    const r0 = resume as Record<string, unknown>;
    const content = r0.content as Record<string, unknown> | undefined;
    const name = content?.name ?? resumeId;
    const analysis0 = r0.analysis as Record<string, unknown> | undefined;
    const beforeScore = analysis0?.score ?? "(none)";
    const beforeBreakdown = analysis0?.breakdown;
    const ingestData = r0.ingestData as Record<string, unknown> | undefined;

    console.log(`\n═══ Resume: ${name} (${resumeId}) ═══`);
    console.log(`Before score : ${beforeScore}`);
    if (beforeBreakdown && typeof beforeBreakdown === "object") {
        const bd = beforeBreakdown as Record<string, unknown>;
        console.log(`Before breakdown: related_exp=${bd.related_exp} industry_db=${bd.industry_db}`);
    }
    console.log(`Role signals : ${formatRoleSignals(ingestData)}`);
    console.log(`Brand hits   : ${(ingestData?.brandHits as unknown[] | undefined)?.map((b) => {
        const bObj = b as Record<string, unknown>;
        return `${bObj.brand ?? b}(${bObj.context ?? "?"})`;
    }).join(", ") ?? "(none)"}`);
    if (keywords.length > 0) {
        console.log(`Keywords     : ${keywords.join(", ")}`);
    } else {
        console.log(`Keywords     : (none — pass keywords as CLI args for domain ceiling to apply)`);
    }

    console.log(`\nRunning AI analysis...`);

    const result = await client.action(api.analyze.analyzeResume, {
        resumeId: resumeId as never,
        ...(keywords.length > 0 ? { keywords } : {}),
    });

    const r = result as Record<string, unknown>;
    const bd = r.breakdown as Record<string, number> | undefined;

    console.log(`\nAfter score  : ${r.score}  (${r.recommendation})`);
    if (bd) {
        console.log(`After breakdown: related_exp=${bd.related_exp} industry_db=${bd.industry_db}`);
    }
    console.log(`\nSummary: ${r.summary}`);
    if (Array.isArray(r.concerns) && r.concerns.length > 0) {
        console.log(`Concerns: ${(r.concerns as string[]).join("; ")}`);
    }

    const scoreDiff = typeof r.score === "number" && typeof beforeScore === "number"
        ? r.score - beforeScore
        : "n/a";
    console.log(`\nScore change : ${beforeScore} → ${r.score}  (${scoreDiff >= 0 ? "+" : ""}${scoreDiff})`);
    console.log(`\n✅ Score updated in DB. Refresh the UI to see the new value.`);

}

main().catch((err) => {
    console.error("\n❌ Failed:", err instanceof Error ? err.message : err);
    process.exit(1);
});
