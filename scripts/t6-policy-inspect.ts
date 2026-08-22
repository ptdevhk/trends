import { ConvexHttpClient } from "convex/browser";
import { api } from "../packages/convex/convex/_generated/api.js";
const client = new ConvexHttpClient("http://127.0.0.1:3210");
const secret = process.env.CONVEX_WRITE_SECRET!;
async function main() {
  const revisions = (await client.query(api.company_registry.listPoliciesForScope, { scopeId: "hr", scopeType: "workspace", writeSecret: secret })) as any[];
  console.log(JSON.stringify(revisions, null, 2));
}
main().catch((err) => { console.error("FAILED:", err.message ?? err); process.exit(1); });
