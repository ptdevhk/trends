
import { ConvexHttpClient } from "convex/browser";
import { api } from "../packages/convex/convex/_generated/api.js";
import * as dotenv from "dotenv";

// Load env
dotenv.config({ path: "apps/web/.env.local" });

const client = new ConvexHttpClient(process.env.VITE_CONVEX_URL!);

async function check() {
    console.log("Checking DB Content...");
    const resumes = await client.query(api.resumes.list, { limit: 10 });

    resumes.forEach((r: any) => {
        console.log(`ID: ${r._id}, ExternalID: ${r.externalId}, Source: ${r.source}, Name: ${r.content.name}, Analyzed: ${!!r.analysis}`);
    });

    const total = await client.query(api.resumes.list, { limit: 1000 });
    const uniqueExt = new Set(total.map((r: any) => r.externalId)).size;
    console.log(`Total: ${total.length}, Unique External IDs: ${uniqueExt}`);
}

check().catch(console.error);
