import { ConvexHttpClient } from "convex/browser";
import { api } from "../packages/convex/convex/_generated/api.js";
import * as dotenv from "dotenv";
import { resolve } from "path";

// Load env
dotenv.config({ path: resolve(process.cwd(), "packages/convex/.env.local") });

const url = process.env.CONVEX_URL || "http://127.0.0.1:3210";
const client = new ConvexHttpClient(url);

async function main() {
    console.log("--- Fast Dev Cycle Demo: Total Reset & Bootstrap ---");

    // 1. Reset Everything
    console.log("1. Clearing Database (Resumes, Tasks, JDs, Analysis)...");
    await client.mutation(api.seed.clearAll, {});
    console.log("   Done.");

    // 2. Refresh UI State (Wait a bit for Convex to sync)
    console.log("2. Database is now empty.");

    // 3. Trigger Seed
    console.log("3. Running 'make seed' to bootstrap system JDs...");
}

main().catch(console.error);
