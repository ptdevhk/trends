import { ConvexHttpClient } from "convex/browser";
import { api } from "../packages/convex/convex/_generated/api.js";

async function main() {
  const client = new ConvexHttpClient("http://127.0.0.1:3210");
  const all: any[] = await client.query(api.resumes.list as any, { limit: 500 });
  const bySource = new Map<string, number>();
  const sourceSamples = new Map<string, any>();
  for (const row of all) {
    const s = row.source ?? "unknown";
    bySource.set(s, (bySource.get(s) ?? 0) + 1);
    if (!sourceSamples.has(s)) sourceSamples.set(s, row);
  }
  console.log("TOTAL:", all.length);
  for (const [source, n] of bySource) {
    console.log("=== source:", source, "n=", n);
    const row = sourceSamples.get(source)!;
    const c = row.content ?? {};
    console.log("  KEYS:", Object.keys(c).join(","));
    for (const k of ["name","contact","phone","email","linkedin","basicInfo","personal","candidateName","currentTitle","profileUrl","externalId","summary","location"]) {
      if (c[k] !== undefined) console.log(`  ${k}:`, JSON.stringify(c[k]).slice(0, 160));
    }
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
