/**
 * Bootstrap import for MY reviewed company-industry profiles.
 *
 * Reads a JSON file of reviewed employer rows and imports them into the
 * company_industry_profiles table via the API. This is the attended reviewed
 * import path: strong official-source-backed rows may be promoted directly
 * to `verified` before rollout.
 *
 * Input JSON format (array of objects):
 *   [
 *     {
 *       "companyKey": "cnc-mechatronics",
 *       "employerName": "CNC Mechatronics Sdn. Bhd.",
 *       "industryClass": "cnc",
 *       "verificationLevel": "verified",
 *       "officialDomain": "https://www.cncmechatronics.com.my",
 *       "evidenceSource": "manual",
 *       "summary": "CNC machining centre manufacturer",
 *       "sourceUrl": "https://...",
 *       "sourceDomain": "cncmechatronics.com.my",
 *       "sourceType": "official_company_site",
 *       "msicCode": "...",
 *       "msicDescription": "..."
 *     },
 *     ...
 *   ]
 *
 * Usage:
 *   npx tsx scripts/industry-data/import-my-bootstrap-profiles.ts \
 *     --input output/industry-data/my-reviewed-employers.json \
 *     --api-url http://localhost:3000 \
 *     --workspace dev
 *
 * Environment:
 *   TRENDS_AUTH_USERNAME  Required (paired with password)
 *   TRENDS_AUTH_PASSWORD  Required
 */

interface BootstrapProfileInput {
  companyKey: string;
  employerName?: string;
  industryClass: "cnc" | "automation" | "metrology" | "industrial" | "non_industry" | "unknown";
  verificationLevel: "verified" | "candidate" | "rejected";
  officialDomain?: string;
  evidenceSource?: "seed" | "manual" | "worker_web";
  summary?: string;
  sourceUrl?: string;
  sourceDomain?: string;
  sourceType?: string;
  msicCode?: string;
  msicDescription?: string;
  fetchedAt?: number;
}

interface ImportResult {
  companyKey: string;
  created: boolean;
  success: boolean;
  error?: string;
}

interface ImportSummary {
  total: number;
  imported: number;
  created: number;
  updated: number;
  failed: number;
  results: ImportResult[];
}

function usage(): string {
  return [
    "Usage:",
    "  npx tsx scripts/industry-data/import-my-bootstrap-profiles.ts \\",
    "    --input <path> [--api-url http://localhost:3000] [--workspace dev]",
    "",
    "Environment:",
    "  TRENDS_AUTH_USERNAME  API auth username",
    "  TRENDS_AUTH_PASSWORD  API auth password",
  ].join("\n");
}

function normalizeCompanyKey(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "");
}

async function loginToApi(
  apiUrl: string,
  runtime: { fetch: typeof fetch },
): Promise<{ cookie: string; csrfToken: string }> {
  const username = process.env.TRENDS_AUTH_USERNAME?.trim();
  const password = process.env.TRENDS_AUTH_PASSWORD?.trim();
  if (!username || !password) {
    throw new Error("TRENDS_AUTH_USERNAME and TRENDS_AUTH_PASSWORD are required");
  }

  const loginUrl = `${apiUrl.replace(/\/$/, "")}/api/auth/login`;
  const response = await runtime.fetch(loginUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`auth login failed (${response.status}): ${text.trim()}`);
  }

  const body = (await response.json()) as Record<string, unknown>;
  const csrfToken = typeof body.csrfToken === "string" ? body.csrfToken : "";
  if (!csrfToken) {
    throw new Error("auth login response missing csrfToken");
  }

  const setCookie = response.headers.get("set-cookie");
  const cookieMatch = setCookie?.match(/(?:^|,\s*)(trends_session=[^;]+)/i);
  const cookie = cookieMatch?.[1]?.trim();
  if (!cookie) {
    throw new Error("auth login response missing session cookie");
  }

  return { cookie, csrfToken };
}

async function upsertProfileViaApi(
  apiUrl: string,
  auth: { cookie: string; csrfToken: string },
  profile: BootstrapProfileInput,
  runtime: { fetch: typeof fetch },
): Promise<{ created: boolean }> {
  const url = `${apiUrl.replace(/\/$/, "")}/api/company-industry-profiles`;
  const response = await runtime.fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-CSRF-Token": auth.csrfToken,
      Cookie: auth.cookie,
    },
    body: JSON.stringify(profile),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`upsert failed (${response.status}): ${text.trim()}`);
  }

  const body = (await response.json()) as Record<string, unknown>;
  return { created: body.created === true };
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  let inputPath = "";
  let apiUrl = process.env.API_URL ?? "http://localhost:3000";

  for (let i = 0; i < args.length; i += 2) {
    const flag = args[i];
    const value = args[i + 1];
    if (flag === "--input" && value) {
      inputPath = value;
    } else if (flag === "--api-url" && value) {
      apiUrl = value;
    } else if (flag === "--help" || flag === "-h") {
      console.log(usage());
      process.exit(0);
    }
  }

  if (!inputPath) {
    console.error("Error: --input is required\n");
    console.error(usage());
    process.exit(1);
  }

  const { readFile } = await import("node:fs/promises");
  const content = await readFile(inputPath, "utf-8");
  const profiles: BootstrapProfileInput[] = JSON.parse(content);

  if (!Array.isArray(profiles)) {
    throw new Error("Input file must contain a JSON array of profile objects");
  }

  console.log(`-> loaded ${profiles.length} profile(s) from ${inputPath}`);

  const auth = await loginToApi(apiUrl, { fetch });

  const results: ImportResult[] = [];
  let created = 0;
  let updated = 0;
  let failed = 0;

  for (let i = 0; i < profiles.length; i++) {
    const profile = profiles[i];
    const companyKey = normalizeCompanyKey(profile.companyKey);
    if (!companyKey) {
      results.push({
        companyKey: profile.companyKey ?? "",
        created: false,
        success: false,
        error: "missing or invalid companyKey",
      });
      failed += 1;
      continue;
    }

    try {
      const result = await upsertProfileViaApi(
        apiUrl,
        auth,
        { ...profile, companyKey },
        { fetch },
      );
      results.push({
        companyKey,
        created: result.created,
        success: true,
      });
      if (result.created) {
        created += 1;
      } else {
        updated += 1;
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      results.push({
        companyKey,
        created: false,
        success: false,
        error: message,
      });
      failed += 1;
    }

    if ((i + 1) % 10 === 0 || i === profiles.length - 1) {
      console.log(`  progress: ${i + 1}/${profiles.length} (created=${created} updated=${updated} failed=${failed})`);
    }
  }

  const summary: ImportSummary = {
    total: profiles.length,
    imported: created + updated,
    created,
    updated,
    failed,
    results,
  };

  console.log(`\n-> import complete: ${summary.imported}/${summary.total} imported (${created} created, ${updated} updated, ${failed} failed)`);

  if (failed > 0) {
    console.log("\nFailed profiles:");
    for (const r of results.filter((r) => !r.success)) {
      console.log(`  ${r.companyKey}: ${r.error}`);
    }
  }

  // Write summary to output
  const summaryPath = inputPath.replace(/\.json$/, "-import-summary.json");
  const { writeFile } = await import("node:fs/promises");
  await writeFile(summaryPath, JSON.stringify(summary, null, 2), "utf-8");
  console.log(`-> summary written to ${summaryPath}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
