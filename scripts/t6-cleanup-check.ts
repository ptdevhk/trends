import "dotenv/config";
import { ConvexHttpClient } from "convex/browser";
import { api } from "../packages/convex/convex/_generated/api.js";

async function main() {
  const convex = new ConvexHttpClient("http://127.0.0.1:3210");
  const writeSecret = process.env.CONVEX_WRITE_SECRET!;

  const overrides = await convex.query(api.candidate_policy_overrides.list, {
    paginationOpts: { cursor: null, numItems: 100 },
    workspaceSlug: "hr",
    writeSecret,
  });
  console.log("overrides after cleanup:", JSON.stringify(overrides.page));

  const resumes = await convex.query(api.resumes.list, { limit: 500 });
  const fixture = (resumes as any[]).filter((r) =>
    String(r.externalId).includes("fixture.polywell"),
  );
  console.log("fixture resumes remaining:", fixture.length);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
