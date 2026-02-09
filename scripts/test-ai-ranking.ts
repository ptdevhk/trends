
import { ConvexHttpClient } from "convex/browser";
import { api } from "../packages/convex/convex/_generated/api.js";

const CONVEX_URL = process.env.VITE_CONVEX_URL;
if (!CONVEX_URL) {
    console.error("Error: VITE_CONVEX_URL environment variable is required.");
    console.error("Run with: source apps/web/.env.local && bun scripts/test-ai-ranking.ts");
    process.exit(1);
}

const client = new ConvexHttpClient(CONVEX_URL);

async function main() {
    console.log(`Connecting to Convex at ${CONVEX_URL}...`);

    // 1. Fetch a resume to test
    const resumes = await client.query(api.resumes.list);
    if (resumes.length === 0) {
        console.error("No resumes found in database. Please crawl some data first.");
        process.exit(1);
    }

    const targetResume = resumes[0];
    console.log(`Selected Resume: ${targetResume._id}`);
    console.log(`Name: ${targetResume.content.name || "Unknown"}`);
    console.log(`Job Intention: ${targetResume.content.jobIntention || targetResume.content.desiredPosition || "Unknown"}`);

    // 2. Define Matching Rules (Mocking what would be parsed from JD markdown)
    const matchingRules = {
        weights: {
            experience: 30,
            skills: 25,
            industry_db: 25,
            education: 10,
            location: 10
        },
        thresholds: {
            min_score: 60,
            auto_shortlist: 85
        },
        industry_db: {
            match_companies: true,
            match_brands: true,
            preferred_types: ["key_company", "agent"]
        }
    };

    const jobDescription = {
        title: "车床销售工程师 (Test)",
        requirements: "2年以上经验，熟悉机床行业，有客户资源优先。"
    };

    console.log("\nAnalyzing with AI...");
    console.log("Rules:", JSON.stringify(matchingRules, null, 2));

    try {
        const result = await client.action(api.analyze.analyzeResume, {
            resumeId: targetResume._id,
            jobDescription,
            matchingRules
        });

        console.log("\n✅ Analysis Complete!");
        console.log(JSON.stringify(result, null, 2));
    } catch (error) {
        console.error("\n❌ Analysis Failed:");
        console.error(error);
    }
}

main().catch(console.error);
