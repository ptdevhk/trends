import { ConvexHttpClient } from "convex/browser";
import { api } from "/root/workspace/packages/convex/convex/_generated/api.js";

const client = new ConvexHttpClient("http://127.0.0.1:3210");
const secret = process.env.CONVEX_WRITE_SECRET!;

async function main() {
  const companies = (await client.query(api.company_registry.list, { writeSecret: secret })) as any[];
  console.log("=== COMPANIES (polywell/pro-technic) ===");
  for (const c of companies) {
    const s = JSON.stringify(c);
    if (/polywell|pro.?technic/i.test(s)) {
      console.log(JSON.stringify({ companyKey: c.companyKey, displayName: c.displayName, aliases: c.aliases, status: c.status, isArchived: c.isArchived }));
    }
  }
  console.log("total companies:", companies.length);

  const revisions = (await client.query(api.company_registry.listPoliciesForScope, { scopeId: "hr", scopeType: "workspace", writeSecret: secret })) as any[];
  console.log("\n=== POLICY REVISIONS (hr) ===");
  for (const rev of revisions) {
    console.log(JSON.stringify({ companyKey: rev.companyKey, policy: rev.policy, status: rev.status, reason: rev.reason, decidedAt: rev.decidedAt }));
  }
  console.log("total revisions:", revisions.length);
}
main().catch((err) => { console.error("FAILED:", err.message ?? err); process.exit(1); });
