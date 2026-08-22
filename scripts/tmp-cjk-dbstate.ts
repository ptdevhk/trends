import "dotenv/config";
import { ConvexHttpClient } from "convex/browser";
import { api } from "../packages/convex/convex/_generated/api.js";

async function main() {
  const convex = new ConvexHttpClient("http://127.0.0.1:3210");
  const rows = (await convex.query(api.resumes.list, { limit: 50 } as any)) as any[];
  console.log("resumes total:", rows.length);
  for (const r of rows.slice(0, 10)) {
    const content: any = r?.content ?? {};
    console.log(JSON.stringify({ id: r._id, name: content.name, source: r.source }));
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
