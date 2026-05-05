/**
 * Keyword Search Load Benchmark
 *
 * Runs concurrent search queries against a live Convex instance and measures
 * latency, success rate, and byte-read safety for every keyword search path.
 *
 * Usage:
 *   bun scripts/benchmark-keyword-search.ts
 *   bun scripts/benchmark-keyword-search.ts --concurrency=5 --iterations=20
 *   bun scripts/benchmark-keyword-search.ts --json
 *   bun scripts/benchmark-keyword-search.ts --out=auto
 *
 * Queries tested:
 *   1. resumes.search
 *   2. resumes.searchWithIngestData
 *   3. resumes.searchWithTagExpansion
 *   4. resumes.searchWithTagExpansionPaginated
 *   5. resumes.searchWithTagExpansionScanPage
 *   6. resumes.scanResumePageSlim
 *   7. resumes.getResumes
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { ConvexHttpClient } from "convex/browser";

import { api } from "../packages/convex/convex/_generated/api.js";

// ── Types ──────────────────────────────────────────────────────────────

type QueryName =
    | "search"
    | "searchWithIngestData"
    | "searchWithTagExpansion"
    | "searchWithTagExpansionPaginated"
    | "searchWithTagExpansionScanPage"
    | "scanResumePageSlim"
    | "getResumes";

type QueryRunResult = {
    query: QueryName;
    iteration: number;
    durationMs: number;
    success: boolean;
    resultCount: number;
    error: string | null;
};

type QueryStats = {
    query: QueryName;
    runs: number;
    successRate: number;
    minMs: number | null;
    p50Ms: number | null;
    p95Ms: number | null;
    p99Ms: number | null;
    maxMs: number | null;
    medianMs: number | null;
    avgResultCount: number | null;
};

type BenchmarkReport = {
    startedAt: string;
    finishedAt: string;
    options: {
        concurrency: number;
        iterations: number;
        keyword: string;
        location: string;
        modes: string[];
    };
    heapSnapshot: {
        initialHeapUsedMB: number;
        finalHeapUsedMB: number;
        deltaMB: number;
    };
    queryResults: QueryRunResult[];
    stats: QueryStats[];
    byteLimitSafety: {
        scanSlimBatchSize: number;
        estimatedMBPerPage: number;
        underLimit: boolean;
    };
};

// ── Defaults ───────────────────────────────────────────────────────────

const DEFAULT_CONCURRENCY = 3;
const DEFAULT_ITERATIONS = 10;
const DEFAULT_KEYWORD = "CNC";
const DEFAULT_LOCATION = "广东";
const CONVEX_16_MIB = 16 * 1024 * 1024;
const AVG_SLIM_DOC_BYTES = 1024; // ~1KB per slim doc (no content/ingestData)
const SLIM_BATCH_SIZE = 200;

const KEYWORD_GROUPS = [
    { original: "CNC", variants: ["cnc", "数控"] },
    { original: "销售", variants: ["销售", "业务", "商务", "sales"] },
];

// ── CLI parsing ────────────────────────────────────────────────────────

function readCliValue(argv: string[], name: string): string | undefined {
    const fullFlag = `--${name}`;
    for (let i = 0; i < argv.length; i += 1) {
        const arg = argv[i];
        if (arg === fullFlag) {
            const next = argv[i + 1];
            if (!next || next.startsWith("--")) return undefined;
            return next;
        }
        if (arg.startsWith(`${fullFlag}=`)) {
            return arg.slice(fullFlag.length + 1);
        }
    }
    return undefined;
}

function hasCliFlag(argv: string[], name: string): boolean {
    return argv.includes(`--${name}`);
}

function parsePositiveInt(value: string | undefined, fallback: number): number {
    if (!value) return fallback;
    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

// ── Convex URL resolution ──────────────────────────────────────────────

function readEnvVarFromFile(filePath: string, key: string): string | null {
    if (!fs.existsSync(filePath)) return null;
    const lines = fs.readFileSync(filePath, "utf8").split(/\r?\n/);
    for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith("#")) continue;
        const match = trimmed.match(/^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
        if (!match || match[1] !== key) continue;
        let value = match[2].trim();
        if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
            value = value.slice(1, -1);
        }
        return value;
    }
    return null;
}

function resolveConvexUrl(projectRoot: string): string {
    if (process.env.CONVEX_URL) return process.env.CONVEX_URL;
    if (process.env.VITE_CONVEX_URL) return process.env.VITE_CONVEX_URL;
    const candidates = [
        path.join(projectRoot, "packages", "convex", ".env.local"),
        path.join(projectRoot, "apps", "web", ".env.local"),
        path.join(projectRoot, ".env.local"),
        path.join(projectRoot, ".env"),
    ];
    for (const filePath of candidates) {
        const direct = readEnvVarFromFile(filePath, "CONVEX_URL");
        if (direct) return direct;
        const vite = readEnvVarFromFile(filePath, "VITE_CONVEX_URL");
        if (vite) return vite;
    }
    throw new Error("Cannot resolve CONVEX_URL. Set env var or create .env.local");
}

// ── Query functions ────────────────────────────────────────────────────

function buildQueryArgs(query: QueryName, keyword: string): Record<string, unknown> {
    switch (query) {
        case "search":
            return { query: keyword, limit: 50 };
        case "searchWithIngestData":
            return { query: keyword, limit: 50 };
        case "searchWithTagExpansion":
            return {
                query: keyword,
                keywordGroups: KEYWORD_GROUPS,
                mode: "OR",
                limit: 50,
            };
        case "searchWithTagExpansionPaginated":
            return {
                paginationOpts: { cursor: null, numItems: 20 },
                query: keyword,
                keywordGroups: KEYWORD_GROUPS,
                mode: "OR",
            };
        case "searchWithTagExpansionScanPage":
            return {
                paginationOpts: { cursor: null, numItems: 20 },
                query: keyword,
                keywordGroups: KEYWORD_GROUPS,
                mode: "OR",
            };
        case "scanResumePageSlim":
            return { numItems: 200 };
        case "getResumes":
            return { limit: 50 };
    }
}

function getQueryFunction(query: QueryName) {
    switch (query) {
        case "search": return api.resumes.search;
        case "searchWithIngestData": return api.resumes.searchWithIngestData;
        case "searchWithTagExpansion": return api.resumes.searchWithTagExpansion;
        case "searchWithTagExpansionPaginated": return api.resumes.searchWithTagExpansionPaginated;
        case "searchWithTagExpansionScanPage": return api.resumes.searchWithTagExpansionScanPage;
        case "scanResumePageSlim": return api.resumes.scanResumePageSlim;
        case "getResumes": return api.resumes.getResumes;
    }
}

function extractResultCount(query: QueryName, result: unknown): number {
    if (!result || typeof result !== "object") return 0;
    const rec = result as Record<string, unknown>;
    if (Array.isArray(rec.results)) return rec.results.length;
    if (Array.isArray(rec.page)) return rec.page.length;
    if (Array.isArray(rec.docs)) return rec.docs.length;
    if (Array.isArray(rec)) return rec.length;
    return 0;
}

// ── Stats computation ──────────────────────────────────────────────────

function computePercentile(sorted: number[], percentile: number): number | null {
    if (sorted.length === 0) return null;
    const rank = Math.ceil((percentile / 100) * sorted.length);
    return sorted[Math.min(sorted.length - 1, Math.max(0, rank - 1))];
}

function computeMedian(sorted: number[]): number | null {
    if (sorted.length === 0) return null;
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function computeStats(query: QueryName, runs: QueryRunResult[]): QueryStats {
    const durations = runs.filter((r) => r.success).map((r) => r.durationMs).sort((a, b) => a - b);
    const counts = runs.filter((r) => r.success && r.resultCount > 0).map((r) => r.resultCount);
    const successCount = runs.filter((r) => r.success).length;

    return {
        query,
        runs: runs.length,
        successRate: runs.length > 0 ? successCount / runs.length : 0,
        minMs: durations.length > 0 ? durations[0] : null,
        p50Ms: computePercentile(durations, 50),
        p95Ms: computePercentile(durations, 95),
        p99Ms: computePercentile(durations, 99),
        maxMs: durations.length > 0 ? durations[durations.length - 1] : null,
        medianMs: computeMedian(durations),
        avgResultCount: counts.length > 0 ? counts.reduce((a, b) => a + b, 0) / counts.length : null,
    };
}

// ── Heap tracking ──────────────────────────────────────────────────────

function getHeapUsedMB(): number {
    if (typeof globalThis.gc === "function") {
        globalThis.gc();
    }
    return process.memoryUsage().heapUsed / (1024 * 1024);
}

// ── Main benchmark runner ──────────────────────────────────────────────

async function runSingleQuery(
    client: ConvexHttpClient,
    query: QueryName,
    keyword: string,
    iteration: number,
): Promise<QueryRunResult> {
    const fn = getQueryFunction(query);
    const args = buildQueryArgs(query, keyword);
    const start = performance.now();
    try {
        const result = await client.query(fn, args);
        const durationMs = performance.now() - start;
        return {
            query,
            iteration,
            durationMs,
            success: true,
            resultCount: extractResultCount(query, result),
            error: null,
        };
    } catch (err) {
        const durationMs = performance.now() - start;
        return {
            query,
            iteration,
            durationMs,
            success: false,
            resultCount: 0,
            error: err instanceof Error ? err.message : String(err),
        };
    }
}

async function runBenchmark(): Promise<BenchmarkReport> {
    const argv = process.argv.slice(2);
    if (hasCliFlag(argv, "help") || hasCliFlag(argv, "h")) {
        console.log("Usage: benchmark-keyword-search.ts [options]");
        console.log("");
        console.log("Options:");
        console.log("  --concurrency=<N>   Parallel queries per iteration (default: 3)");
        console.log("  --iterations=<N>    Total iterations (default: 10)");
        console.log("  --keyword=<term>    Search keyword (default: CNC)");
        console.log("  --json              Print machine-readable JSON");
        console.log("  --out[=<path>]      Write JSON artifact");
        console.log("  --help              Show this help");
        process.exit(0);
    }

    const concurrency = parsePositiveInt(readCliValue(argv, "concurrency"), DEFAULT_CONCURRENCY);
    const iterations = parsePositiveInt(readCliValue(argv, "iterations"), DEFAULT_ITERATIONS);
    const keyword = (readCliValue(argv, "keyword") ?? DEFAULT_KEYWORD).trim();
    const jsonOutput = hasCliFlag(argv, "json");

    const scriptPath = fileURLToPath(import.meta.url);
    const projectRoot = path.resolve(path.dirname(scriptPath), "..");
    const convexUrl = resolveConvexUrl(projectRoot);

    if (!jsonOutput) {
        console.log(`Keyword Search Load Benchmark`);
        console.log(`Convex URL: ${convexUrl}`);
        console.log(`Concurrency: ${concurrency}, Iterations: ${iterations}`);
        console.log(`Keyword: ${keyword}`);
        console.log("");
    }

    const client = new ConvexHttpClient(convexUrl);
    const queries: QueryName[] = [
        "search",
        "searchWithIngestData",
        "searchWithTagExpansion",
        "searchWithTagExpansionPaginated",
        "searchWithTagExpansionScanPage",
        "scanResumePageSlim",
        "getResumes",
    ];

    const initialHeapMB = getHeapUsedMB();
    const allResults: QueryRunResult[] = [];
    const startedAt = new Date().toISOString();

    for (let iter = 0; iter < iterations; iter += 1) {
        if (!jsonOutput) {
            process.stdout.write(`Iteration ${iter + 1}/${iterations} ...`);
        }

        // Run queries concurrently within each iteration
        const batchPromises: Promise<QueryRunResult[]> = [];
        for (const query of queries) {
            const promises = Array.from({ length: concurrency }, (_, i) =>
                runSingleQuery(client, query, keyword, iter * concurrency + i)
            );
            batchPromises.push(Promise.all(promises));
        }

        const batchResults = await Promise.all(batchPromises);
        const flatResults = batchResults.flat();
        allResults.push(...flatResults);

        if (!jsonOutput) {
            const failed = flatResults.filter((r) => !r.success).length;
            const avgMs = flatResults.filter((r) => r.success).length > 0
                ? Math.round(flatResults.filter((r) => r.success).reduce((s, r) => s + r.durationMs, 0) / flatResults.filter((r) => r.success).length)
                : 0;
            console.log(` avg=${avgMs}ms failures=${failed}`);
        }
    }

    const finalHeapMB = getHeapUsedMB();
    const finishedAt = new Date().toISOString();

    // Compute per-query stats
    const stats: QueryStats[] = queries.map((query) => {
        const queryRuns = allResults.filter((r) => r.query === query);
        return computeStats(query, queryRuns);
    });

    // Byte-limit safety estimate
    const estimatedMBPerPage = (SLIM_BATCH_SIZE * AVG_SLIM_DOC_BYTES) / (1024 * 1024);

    const report: BenchmarkReport = {
        startedAt,
        finishedAt,
        options: {
            concurrency,
            iterations,
            keyword,
            location: DEFAULT_LOCATION,
            modes: ["OR", "AND"],
        },
        heapSnapshot: {
            initialHeapUsedMB: Math.round(initialHeapMB * 100) / 100,
            finalHeapUsedMB: Math.round(finalHeapMB * 100) / 100,
            deltaMB: Math.round((finalHeapMB - initialHeapMB) * 100) / 100,
        },
        queryResults: allResults,
        stats,
        byteLimitSafety: {
            scanSlimBatchSize: SLIM_BATCH_SIZE,
            estimatedMBPerPage: Math.round(estimatedMBPerPage * 100) / 100,
            underLimit: estimatedMBPerPage < CONVEX_16_MIB / (1024 * 1024),
        },
    };

    // Output
    if (jsonOutput) {
        console.log(JSON.stringify(report, null, 2));
    } else {
        console.log("");
        console.log("═══ Results ═══");
        for (const stat of stats) {
            console.log(
                `[${stat.query}] runs=${stat.runs} success=${(stat.successRate * 100).toFixed(0)}% ` +
                `p50=${stat.p50Ms ?? "n/a"}ms p95=${stat.p95Ms ?? "n/a"}ms p99=${stat.p99Ms ?? "n/a"}ms ` +
                `max=${stat.maxMs ?? "n/a"}ms avgResults=${stat.avgResultCount?.toFixed(1) ?? "n/a"}`
            );
        }
        console.log("");
        console.log("═══ Byte-Limit Safety ═══");
        console.log(`  scanResumePageSlim batch: ${report.byteLimitSafety.scanSlimBatchSize}`);
        console.log(`  Estimated MB/page: ${report.byteLimitSafety.estimatedMBPerPage} MB`);
        console.log(`  Under 16 MiB limit: ${report.byteLimitSafety.underLimit}`);
        console.log("");
        console.log("═══ Memory ═══");
        console.log(`  Initial heap: ${report.heapSnapshot.initialHeapUsedMB} MB`);
        console.log(`  Final heap: ${report.heapSnapshot.finalHeapUsedMB} MB`);
        console.log(`  Delta: ${report.heapSnapshot.deltaMB} MB`);

        // Failures detail
        const failures = allResults.filter((r) => !r.success);
        if (failures.length > 0) {
            console.log("");
            console.log("═══ Failures ═══");
            for (const f of failures.slice(0, 20)) {
                console.log(`  [${f.query}] iter=${f.iteration}: ${f.error}`);
            }
            if (failures.length > 20) {
                console.log(`  ... and ${failures.length - 20} more`);
            }
        }
    }

    // Write output file
    const outOption = readCliValue(argv, "out");
    if (outOption !== undefined || hasCliFlag(argv, "out")) {
        const outPath = outOption && outOption !== "true"
            ? path.resolve(process.cwd(), outOption)
            : path.join(projectRoot, "output", "benchmarks", `keyword-search-${Date.now()}.json`);
        fs.mkdirSync(path.dirname(outPath), { recursive: true });
        fs.writeFileSync(outPath, JSON.stringify(report, null, 2));
        if (!jsonOutput) {
            console.log(`\nWrote benchmark artifact: ${outPath}`);
        }
    }

    // Exit code: 1 if any query has 0% success rate
    const anyTotalFailure = stats.some((s) => s.successRate === 0);
    process.exitCode = anyTotalFailure ? 1 : 0;

    return report;
}

const isMainModule = process.argv[1]
    ? path.resolve(fileURLToPath(import.meta.url)) === path.resolve(process.argv[1])
    : false;

if (isMainModule) {
    runBenchmark().catch((error) => {
        console.error("benchmark-keyword-search failed:");
        console.error(error);
        process.exit(1);
    });
}

export { runBenchmark, computeStats, computeMedian, computePercentile };
export type { QueryRunResult, QueryStats, BenchmarkReport, QueryName };
