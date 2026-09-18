#!/usr/bin/env npx tsx
/**
 * Search-data freshness doctor (local/dev + deploy hook).
 *
 * Reports current ingestComputeEpoch, lag counts via dry-run reingest,
 * and golden MY/CN minRoleYears availability / semantic checks when the API
 * is reachable.
 *
 * Exit codes:
 *   0 — ok, or login unreachable / unauthenticated offline note
 *   2 — compute-stale rows above threshold
 *   3 — golden query availability or semantic check failed
 *   1 — request/auth error, or authenticated but lag unverifiable
 *
 * Usage:
 *   TRENDS_AUTH_USERNAME=demo-admin TRENDS_AUTH_PASSWORD=demo-admin \
 *     npx tsx scripts/search-data-freshness-doctor.ts --api-url http://localhost:3000
 */
import {
  CURRENT_INGEST_COMPUTE_EPOCH,
  SEARCH_FRESHNESS_GOLDEN_QUERIES,
} from "@trends/shared";
import {
  resolveSearchFreshnessDoctorFallbackExit,
  resolveSearchFreshnessPreferredExit,
} from "./lib/search-freshness-doctor-exit.ts";
import {
  SEARCH_FRESHNESS_DOCTOR_FALLBACK_FETCH_TIMEOUT_MS,
  SEARCH_FRESHNESS_DOCTOR_FETCH_TIMEOUT_MS,
  fetchWithSearchFreshnessDoctorTimeout,
} from "./lib/search-freshness-doctor-fetch.ts";

type Args = {
  apiUrl: string;
  workspace: string;
  username?: string;
  password?: string;
  scanLimit: number;
  skipGolden: boolean;
  json: boolean;
};

function parseArgs(argv: string[]): Args {
  const args: Args = {
    apiUrl: process.env.API_URL || process.env.BFF_API_URL || "http://localhost:3000",
    workspace: process.env.TRENDS_WORKSPACE || "dev",
    username: process.env.TRENDS_AUTH_USERNAME,
    password: process.env.TRENDS_AUTH_PASSWORD,
    scanLimit: 200,
    skipGolden: false,
    json: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--api-url" && argv[i + 1]) {
      args.apiUrl = argv[++i]!;
    } else if (a === "--workspace" && argv[i + 1]) {
      args.workspace = argv[++i]!;
    } else if (a === "--scan-limit" && argv[i + 1]) {
      args.scanLimit = Number(argv[++i]);
    } else if (a === "--skip-golden") {
      args.skipGolden = true;
    } else if (a === "--json") {
      args.json = true;
    } else if (a === "--username" && argv[i + 1]) {
      args.username = argv[++i];
    } else if (a === "--password" && argv[i + 1]) {
      args.password = argv[++i];
    }
  }
  return args;
}

async function login(apiUrl: string, workspace: string, username: string, password: string): Promise<string> {
  const response = await fetch(`${apiUrl.replace(/\/$/, "")}/api/auth/login`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Workspace-Slug": workspace,
    },
    body: JSON.stringify({ username, password }),
  });
  if (!response.ok) {
    throw new Error(`login failed HTTP ${response.status}`);
  }
  const setCookie = response.headers.getSetCookie?.() ?? [];
  const cookieHeader = setCookie.map((c) => c.split(";")[0]).join("; ");
  if (!cookieHeader) {
    // Node fetch may not expose set-cookie; try body-only session cookie name fallback
    const raw = response.headers.get("set-cookie");
    if (raw) {
      return raw.split(",").map((p) => p.split(";")[0]!.trim()).join("; ");
    }
  }
  return cookieHeader;
}

async function main(): Promise<number> {
  const args = parseArgs(process.argv.slice(2));
  const base = args.apiUrl.replace(/\/$/, "");
  const report: Record<string, unknown> = {
    currentIngestComputeEpoch: CURRENT_INGEST_COMPUTE_EPOCH,
    apiUrl: base,
    workspace: args.workspace,
  };

  let cookie = "";
  let csrf = "";
  if (args.username && args.password) {
    try {
      const loginRes = await fetch(`${base}/api/auth/login`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Workspace-Slug": args.workspace,
        },
        body: JSON.stringify({ username: args.username, password: args.password }),
      });
      const body = await loginRes.json() as { success?: boolean; csrfToken?: string; error?: string };
      if (!loginRes.ok || !body.success) {
        console.error(JSON.stringify({ success: false, error: body.error || `login HTTP ${loginRes.status}` }));
        return 1;
      }
      csrf = body.csrfToken || "";
      // Prefer undici getSetCookie
      const cookies = typeof loginRes.headers.getSetCookie === "function"
        ? loginRes.headers.getSetCookie()
        : [];
      cookie = cookies.map((c) => c.split(";")[0]).filter(Boolean).join("; ");
      if (!cookie) {
        const single = loginRes.headers.get("set-cookie");
        if (single) {
          cookie = single.split(/,(?=\s*[^;]+=)/).map((p) => p.split(";")[0]!.trim()).join("; ");
        }
      }
      report.authenticated = true;
    } catch (error) {
      report.authenticated = false;
      report.loginError = error instanceof Error ? error.message : String(error);
      if (args.json) {
        console.log(JSON.stringify(report, null, 2));
      } else {
        console.log(`API login failed: ${report.loginError}`);
        console.log(`currentIngestComputeEpoch=${CURRENT_INGEST_COMPUTE_EPOCH} (code-only; API unreachable)`);
      }
      // Offline / unreachable is not a false green for lag — exit 0 with explicit note
      return 0;
    }
  } else {
    report.authenticated = false;
    report.note = "Set TRENDS_AUTH_USERNAME/PASSWORD for full doctor (lag + golden)";
  }

  const headers: Record<string, string> = {
    "X-Workspace-Slug": args.workspace,
    Accept: "application/json",
  };
  if (cookie) {
    headers.cookie = cookie;
  }
  if (csrf) {
    headers["X-CSRF-Token"] = csrf;
  }

  // Prefer dedicated API doctor when available
  try {
    const qs = new URLSearchParams({
      scanLimit: String(args.scanLimit),
      ...(args.skipGolden ? { skipGolden: "true" } : {}),
    });
    // The lag scan can take 300–400 s on a prod-restored Convex SQLite.
    // AbortSignal.timeout(600_000) is not enough: undici still kills the
    // request at headersTimeout/bodyTimeout 300 s with TypeError "fetch
    // failed". Raise those undici timeouts to the same 600 s ceiling.
    const res = await fetchWithSearchFreshnessDoctorTimeout(
      `${base}/api/resumes/search-freshness?${qs}`,
      { headers, timeoutMs: SEARCH_FRESHNESS_DOCTOR_FETCH_TIMEOUT_MS },
    );
    if (res.ok) {
      const body = await res.json() as {
        success?: boolean;
        exitCodeHint?: number;
        currentIngestComputeEpoch?: number;
        lag?: unknown;
        goldenQueries?: unknown;
        messages?: string[];
        apiReachable?: boolean;
      };
      if (args.json) {
        console.log(JSON.stringify(body, null, 2));
      } else {
        console.log(JSON.stringify(body, null, 2));
      }
      return resolveSearchFreshnessPreferredExit(body);
    }
    report.searchFreshnessHttp = res.status;
  } catch (error) {
    report.searchFreshnessError = error instanceof Error ? error.message : String(error);
  }

  // Fallback: skills-version + dry-run trigger-reingest + golden curls
  try {
    const verRes = await fetch(`${base}/api/resumes/skills-version`, { headers });
    if (verRes.ok) {
      report.skillsVersion = await verRes.json();
    }
  } catch {
    /* ignore */
  }

  try {
    const reRes = await fetchWithSearchFreshnessDoctorTimeout(
      `${base}/api/resumes/trigger-reingest`,
      {
        method: "POST",
        headers: { ...headers, "Content-Type": "application/json" },
        body: JSON.stringify({ limit: args.scanLimit, mode: "compute", dryRun: true, adaptive: true, maxScanPages: 3 }),
        timeoutMs: SEARCH_FRESHNESS_DOCTOR_FALLBACK_FETCH_TIMEOUT_MS,
      },
    );
    if (reRes.ok) {
      report.dryRunReingest = await reRes.json();
    } else {
      report.dryRunReingestHttp = reRes.status;
    }
  } catch (error) {
    report.dryRunError = error instanceof Error ? error.message : String(error);
  }

  if (!args.skipGolden) {
    const golden: unknown[] = [];
    for (const g of SEARCH_FRESHNESS_GOLDEN_QUERIES) {
      const params = new URLSearchParams({
        source: "convex",
        location: g.location,
        q: g.q,
        minRoleYears: String(g.minRoleYears),
        limit: String(g.semanticSampleLimit),
      });
      if (g.roleType) {
        params.set("roleType", g.roleType);
      }
      try {
        const r = await fetch(`${base}/api/resumes?${params}`, { headers });
        const body = await r.json() as { success?: boolean; summary?: { total?: number } };
        const total = body.summary?.total ?? null;
        golden.push({
          id: g.id,
          total,
          minTotalFloor: g.minTotalFloor,
          ok: typeof total === "number" ? total >= g.minTotalFloor : null,
        });
      } catch (error) {
        golden.push({
          id: g.id,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
    report.goldenQueries = golden;
  }

  if (args.json || true) {
    console.log(JSON.stringify(report, null, 2));
  }

  return resolveSearchFreshnessDoctorFallbackExit(report);
}

main()
  .then((code) => {
    process.exit(code);
  })
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
