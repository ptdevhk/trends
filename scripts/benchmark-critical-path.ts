import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import type { VerifyMode, VerifyStatus } from "./verify-critical-path";

type RunnerCommand = {
    command: string;
    args: string[];
};

type CliOptions = {
    runs: number;
    warmup: number;
    modes: VerifyMode[];
    keyword: string;
    location: string;
    baseline: string | null;
    strict: boolean;
    json: boolean;
    out: string | "auto" | null;
};

export type BenchmarkRun = {
    mode: VerifyMode;
    runIndex: number;
    overallStatus: VerifyStatus;
    collectionStatus: VerifyStatus;
    searchStatus: VerifyStatus;
    analysisStatus: VerifyStatus;
    durationMs: number;
    exitCode: number | null;
    stderr: string | null;
    error: string | null;
};

export type BenchmarkModeSummary = {
    count: number;
    passRate: number;
    degradedRate: number;
    failRate: number;
    medianMs: number | null;
    p95Ms: number | null;
    minMs: number | null;
    maxMs: number | null;
};

export type RegressionSeverity = "ok" | "warning" | "failure";

export type RegressionComparison = {
    mode: string;
    metric: "medianMs" | "p95Ms";
    baselineMs: number;
    currentMs: number;
    deltaMs: number;
    deltaPct: number;
    severity: RegressionSeverity;
};

export type RegressionReport = {
    baselinePath: string;
    strict: boolean;
    comparisons: RegressionComparison[];
    warnings: RegressionComparison[];
    failures: RegressionComparison[];
};

type BenchmarkReport = {
    startedAt: string;
    finishedAt: string;
    options: {
        runs: number;
        warmup: number;
        modes: VerifyMode[];
        keyword: string;
        location: string;
        baseline: string | null;
        strict: boolean;
    };
    environment: {
        AI_ANALYSIS_PARALLELISM: string | null;
        SUBMIT_RESUME_PARALLELISM: string | null;
    };
    runs: BenchmarkRun[];
    summaryByMode: Record<string, BenchmarkModeSummary>;
    regression: RegressionReport | null;
};

type ParsedVerification = {
    overallStatus: VerifyStatus;
    collectionStatus: VerifyStatus;
    searchStatus: VerifyStatus;
    analysisStatus: VerifyStatus;
    durationMs: number;
};

const DEFAULT_RUNS = 10;
const DEFAULT_WARMUP = 1;
const DEFAULT_MODES: VerifyMode[] = ["seeded", "dual"];
const DEFAULT_KEYWORD = "CNC";
const DEFAULT_LOCATION = "广东";

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null;
}

function commandExists(command: string): boolean {
    const result = spawnSync(command, ["--version"], { stdio: "ignore" });
    return result.status === 0;
}

function readCliValue(argv: string[], name: string): string | undefined {
    const fullFlag = `--${name}`;
    for (let i = 0; i < argv.length; i += 1) {
        const arg = argv[i];
        if (arg === fullFlag) {
            const next = argv[i + 1];
            if (!next || next.startsWith("--")) {
                return undefined;
            }
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

function parseBoolean(value: string | undefined): boolean {
    if (!value) {
        return false;
    }
    const normalized = value.trim().toLowerCase();
    return normalized === "1" || normalized === "true" || normalized === "yes";
}

function parseFlag(argv: string[], name: string, envValue: string | undefined): boolean {
    const explicit = readCliValue(argv, name);
    if (explicit !== undefined) {
        return parseBoolean(explicit);
    }
    if (hasCliFlag(argv, name)) {
        return true;
    }
    return parseBoolean(envValue);
}

function parsePositiveInt(value: string | undefined, fallback: number): number {
    if (!value) {
        return fallback;
    }
    const parsed = Number.parseInt(value, 10);
    if (!Number.isFinite(parsed) || parsed <= 0) {
        return fallback;
    }
    return parsed;
}

function parseNonNegativeInt(value: string | undefined, fallback: number): number {
    if (!value) {
        return fallback;
    }
    const parsed = Number.parseInt(value, 10);
    if (!Number.isFinite(parsed) || parsed < 0) {
        return fallback;
    }
    return parsed;
}

function parseMode(value: string): VerifyMode | null {
    if (value === "seeded" || value === "dual" || value === "live") {
        return value;
    }
    return null;
}

function parseModes(value: string | undefined): VerifyMode[] {
    if (!value) {
        return [...DEFAULT_MODES];
    }

    const parsedModes = Array.from(
        new Set(
            value
                .split(",")
                .map((part) => part.trim().toLowerCase())
                .filter((part) => part.length > 0)
                .map((part) => parseMode(part))
                .filter((mode): mode is VerifyMode => mode !== null)
        )
    );

    return parsedModes.length > 0 ? parsedModes : [...DEFAULT_MODES];
}

function parseOutOption(argv: string[]): string | "auto" | null {
    const explicit = readCliValue(argv, "out");
    if (explicit !== undefined) {
        const trimmed = explicit.trim();
        if (!trimmed || parseBoolean(trimmed)) {
            return "auto";
        }
        return trimmed;
    }

    if (hasCliFlag(argv, "out")) {
        return "auto";
    }

    const envValue = process.env.OUT;
    if (!envValue) {
        return null;
    }
    const trimmed = envValue.trim();
    if (!trimmed || parseBoolean(trimmed)) {
        return "auto";
    }
    return trimmed;
}

function resolveProjectRoot(): string {
    const scriptPath = fileURLToPath(import.meta.url);
    return path.resolve(path.dirname(scriptPath), "..");
}

function formatTimestampForFile(date: Date): string {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    const hour = String(date.getHours()).padStart(2, "0");
    const minute = String(date.getMinutes()).padStart(2, "0");
    const second = String(date.getSeconds()).padStart(2, "0");
    return `${year}${month}${day}-${hour}${minute}${second}`;
}

function resolveOutputPath(projectRoot: string, outOption: string | "auto" | null): string | null {
    if (!outOption) {
        return null;
    }
    if (outOption === "auto") {
        const timestamp = formatTimestampForFile(new Date());
        return path.join(projectRoot, "output", "benchmarks", `critical-path-${timestamp}.json`);
    }
    return path.resolve(process.cwd(), outOption);
}

function parseStatus(value: unknown): VerifyStatus | null {
    if (value === "PASS" || value === "DEGRADED_PASS" || value === "FAIL") {
        return value;
    }
    return null;
}

function parseJsonPayload(rawOutput: string): unknown | null {
    const trimmed = rawOutput.trim();
    if (!trimmed) {
        return null;
    }

    try {
        const parsed: unknown = JSON.parse(trimmed);
        return parsed;
    } catch {
        const firstBrace = trimmed.indexOf("{");
        const lastBrace = trimmed.lastIndexOf("}");
        if (firstBrace >= 0 && lastBrace > firstBrace) {
            const candidate = trimmed.slice(firstBrace, lastBrace + 1);
            try {
                const parsed: unknown = JSON.parse(candidate);
                return parsed;
            } catch {
                return null;
            }
        }
        return null;
    }
}

function parseVerificationOutput(rawOutput: string): ParsedVerification | null {
    const payload = parseJsonPayload(rawOutput);
    if (!isRecord(payload)) {
        return null;
    }

    const overallStatus = parseStatus(payload.overallStatus);
    const durationRaw = payload.durationMs;
    const durationMs = typeof durationRaw === "number" && Number.isFinite(durationRaw) && durationRaw >= 0
        ? durationRaw
        : null;
    const stages = payload.stages;
    if (!overallStatus || durationMs === null || !isRecord(stages)) {
        return null;
    }

    const collection = isRecord(stages.collection) ? parseStatus(stages.collection.status) : null;
    const search = isRecord(stages.search) ? parseStatus(stages.search.status) : null;
    const analysis = isRecord(stages.analysis) ? parseStatus(stages.analysis.status) : null;
    if (!collection || !search || !analysis) {
        return null;
    }

    return {
        overallStatus,
        collectionStatus: collection,
        searchStatus: search,
        analysisStatus: analysis,
        durationMs,
    };
}

function statusFromExitCode(exitCode: number | null): VerifyStatus {
    if (exitCode === 0) {
        return "PASS";
    }
    if (exitCode === 2) {
        return "DEGRADED_PASS";
    }
    return "FAIL";
}

function resolveRunner(projectRoot: string): RunnerCommand {
    if (commandExists("bun")) {
        return {
            command: "bun",
            args: [path.join(projectRoot, "scripts", "verify-critical-path.ts")],
        };
    }
    return {
        command: "npx",
        args: ["tsx", path.join(projectRoot, "scripts", "verify-critical-path.ts")],
    };
}

function runVerificationOnce(input: {
    runner: RunnerCommand;
    mode: VerifyMode;
    runIndex: number;
    keyword: string;
    location: string;
    projectRoot: string;
}): BenchmarkRun {
    const commandArgs = [
        ...input.runner.args,
        `--mode=${input.mode}`,
        `--keyword=${input.keyword}`,
        `--location=${input.location}`,
        "--json",
    ];

    const startedAt = Date.now();
    const execution = spawnSync(input.runner.command, commandArgs, {
        cwd: input.projectRoot,
        env: process.env,
        encoding: "utf8",
    });
    const elapsedMs = Date.now() - startedAt;
    const stdout = typeof execution.stdout === "string" ? execution.stdout : "";
    const stderr = typeof execution.stderr === "string" ? execution.stderr.trim() : "";
    const parsed = parseVerificationOutput(stdout);
    const fallbackStatus = statusFromExitCode(execution.status ?? null);
    const fallbackStageStatus = fallbackStatus === "DEGRADED_PASS" ? "DEGRADED_PASS" : fallbackStatus;

    return {
        mode: input.mode,
        runIndex: input.runIndex,
        overallStatus: parsed?.overallStatus ?? fallbackStatus,
        collectionStatus: parsed?.collectionStatus ?? fallbackStageStatus,
        searchStatus: parsed?.searchStatus ?? fallbackStageStatus,
        analysisStatus: parsed?.analysisStatus ?? fallbackStageStatus,
        durationMs: parsed?.durationMs ?? elapsedMs,
        exitCode: execution.status ?? null,
        stderr: stderr || null,
        error: execution.error ? execution.error.message : null,
    };
}

export function computeMedian(values: number[]): number | null {
    if (values.length === 0) {
        return null;
    }
    const sorted = [...values].sort((a, b) => a - b);
    const midpoint = Math.floor(sorted.length / 2);
    if (sorted.length % 2 === 1) {
        return sorted[midpoint];
    }
    return (sorted[midpoint - 1] + sorted[midpoint]) / 2;
}

export function computePercentile(values: number[], percentile: number): number | null {
    if (values.length === 0) {
        return null;
    }
    const sorted = [...values].sort((a, b) => a - b);
    const normalized = Math.min(100, Math.max(0, percentile));
    const rank = Math.ceil((normalized / 100) * sorted.length);
    const index = Math.min(sorted.length - 1, Math.max(0, rank - 1));
    return sorted[index];
}

export function summarizeRuns(runs: BenchmarkRun[]): BenchmarkModeSummary {
    const count = runs.length;
    const passCount = runs.filter((run) => run.overallStatus === "PASS").length;
    const degradedCount = runs.filter((run) => run.overallStatus === "DEGRADED_PASS").length;
    const failCount = runs.filter((run) => run.overallStatus === "FAIL").length;
    const durations = runs
        .map((run) => run.durationMs)
        .filter((value) => Number.isFinite(value) && value >= 0);

    return {
        count,
        passRate: count > 0 ? passCount / count : 0,
        degradedRate: count > 0 ? degradedCount / count : 0,
        failRate: count > 0 ? failCount / count : 0,
        medianMs: computeMedian(durations),
        p95Ms: computePercentile(durations, 95),
        minMs: durations.length > 0 ? Math.min(...durations) : null,
        maxMs: durations.length > 0 ? Math.max(...durations) : null,
    };
}

function parseNumber(value: unknown): number | null {
    if (typeof value === "number" && Number.isFinite(value)) {
        return value;
    }
    if (typeof value === "string") {
        const parsed = Number.parseFloat(value);
        if (Number.isFinite(parsed)) {
            return parsed;
        }
    }
    return null;
}

function parseModeSummary(summary: unknown): BenchmarkModeSummary | null {
    if (!isRecord(summary)) {
        return null;
    }

    const count = parseNumber(summary.count);
    const passRate = parseNumber(summary.passRate);
    const degradedRate = parseNumber(summary.degradedRate);
    const failRate = parseNumber(summary.failRate);

    if (count === null || passRate === null || degradedRate === null || failRate === null) {
        return null;
    }

    return {
        count: Math.max(0, Math.floor(count)),
        passRate,
        degradedRate,
        failRate,
        medianMs: parseNumber(summary.medianMs),
        p95Ms: parseNumber(summary.p95Ms),
        minMs: parseNumber(summary.minMs),
        maxMs: parseNumber(summary.maxMs),
    };
}

function parseSummaryByMode(value: unknown): Record<string, BenchmarkModeSummary> {
    if (!isRecord(value)) {
        return {};
    }

    const parsed: Record<string, BenchmarkModeSummary> = {};
    for (const [mode, summary] of Object.entries(value)) {
        const modeSummary = parseModeSummary(summary);
        if (modeSummary) {
            parsed[mode] = modeSummary;
        }
    }
    return parsed;
}

function readBaselineSummaries(baselinePath: string): Record<string, BenchmarkModeSummary> {
    const resolvedPath = path.resolve(process.cwd(), baselinePath);
    if (!fs.existsSync(resolvedPath)) {
        throw new Error(`Baseline file not found: ${resolvedPath}`);
    }

    const payload: unknown = JSON.parse(fs.readFileSync(resolvedPath, "utf8"));
    if (!isRecord(payload)) {
        throw new Error(`Baseline file is not a JSON object: ${resolvedPath}`);
    }

    const direct = parseSummaryByMode(payload.summaryByMode);
    if (Object.keys(direct).length > 0) {
        return direct;
    }

    const legacy = parseSummaryByMode(payload.summary);
    if (Object.keys(legacy).length > 0) {
        return legacy;
    }

    throw new Error(`Baseline file missing summaryByMode data: ${resolvedPath}`);
}

export function compareSummaries(
    current: Record<string, BenchmarkModeSummary>,
    baseline: Record<string, BenchmarkModeSummary>,
    baselinePath: string,
    strict: boolean
): RegressionReport {
    const comparisons: RegressionComparison[] = [];
    const metrics: Array<"medianMs" | "p95Ms"> = ["medianMs", "p95Ms"];

    for (const [mode, currentSummary] of Object.entries(current)) {
        const baselineSummary = baseline[mode];
        if (!baselineSummary) {
            continue;
        }

        for (const metric of metrics) {
            const currentValue = currentSummary[metric];
            const baselineValue = baselineSummary[metric];
            if (currentValue === null || baselineValue === null || baselineValue <= 0) {
                continue;
            }

            const deltaMs = currentValue - baselineValue;
            const deltaPct = (deltaMs / baselineValue) * 100;
            const severity: RegressionSeverity = deltaPct > 25
                ? "failure"
                : deltaPct > 15
                    ? "warning"
                    : "ok";

            comparisons.push({
                mode,
                metric,
                baselineMs: baselineValue,
                currentMs: currentValue,
                deltaMs,
                deltaPct,
                severity,
            });
        }
    }

    return {
        baselinePath: path.resolve(process.cwd(), baselinePath),
        strict,
        comparisons,
        warnings: comparisons.filter((comparison) => comparison.severity === "warning"),
        failures: comparisons.filter((comparison) => comparison.severity === "failure"),
    };
}

export function shouldFailStrict(regression: RegressionReport | null): boolean {
    return Boolean(regression?.strict && regression.failures.length > 0);
}

function buildSummaryByMode(modes: VerifyMode[], runs: BenchmarkRun[]): Record<string, BenchmarkModeSummary> {
    const summaryByMode: Record<string, BenchmarkModeSummary> = {};
    for (const mode of modes) {
        const modeRuns = runs.filter((run) => run.mode === mode);
        summaryByMode[mode] = summarizeRuns(modeRuns);
    }
    return summaryByMode;
}

function printUsage(): void {
    console.log("Usage: benchmark-critical-path.ts [options]");
    console.log("");
    console.log("Options:");
    console.log("  --runs=<number>        Measured runs per mode (default: 10)");
    console.log("  --warmup=<number>      Warmup runs per mode (default: 1)");
    console.log("  --modes=<list>         Comma-separated modes (seeded,dual,live)");
    console.log("  --keyword=<term>       Search keyword (default: CNC)");
    console.log("  --location=<term>      Collection location (default: 广东)");
    console.log("  --baseline=<path>      Baseline benchmark JSON for regression comparison");
    console.log("  --strict               Exit non-zero only when slowdown >25% vs baseline");
    console.log("  --json                 Print machine-readable JSON output");
    console.log("  --out[=<path>]         Write JSON artifact (default path when value omitted)");
    console.log("  --help                 Show this help");
}

function parseCliArgs(argv: string[]): CliOptions {
    if (hasCliFlag(argv, "help") || hasCliFlag(argv, "h")) {
        printUsage();
        process.exit(0);
    }

    const runs = parsePositiveInt(readCliValue(argv, "runs") ?? process.env.RUNS, DEFAULT_RUNS);
    const warmup = parseNonNegativeInt(readCliValue(argv, "warmup") ?? process.env.WARMUP, DEFAULT_WARMUP);
    const modes = parseModes(readCliValue(argv, "modes") ?? process.env.MODES);
    const keyword = (readCliValue(argv, "keyword") ?? process.env.KEYWORD ?? DEFAULT_KEYWORD).trim() || DEFAULT_KEYWORD;
    const location = (readCliValue(argv, "location") ?? process.env.LOCATION ?? DEFAULT_LOCATION).trim() || DEFAULT_LOCATION;
    const baselineValue = readCliValue(argv, "baseline") ?? process.env.BASELINE;
    const baseline = baselineValue && baselineValue.trim().length > 0 ? baselineValue.trim() : null;
    const strict = parseFlag(argv, "strict", process.env.STRICT);
    const json = parseFlag(argv, "json", process.env.JSON);
    const out = parseOutOption(argv);

    return {
        runs,
        warmup,
        modes,
        keyword,
        location,
        baseline,
        strict,
        json,
        out,
    };
}

function formatRate(rate: number): string {
    return `${(rate * 100).toFixed(1)}%`;
}

function printSummary(report: BenchmarkReport, outputPath: string | null): void {
    console.log(`Benchmark started: ${report.startedAt}`);
    console.log(`Benchmark finished: ${report.finishedAt}`);
    console.log(`Modes: ${report.options.modes.join(", ")}`);
    console.log(`Runs per mode: ${report.options.runs} (warmup: ${report.options.warmup})`);
    console.log(`Keyword: ${report.options.keyword}`);
    console.log(`Location: ${report.options.location}`);
    console.log("");

    for (const mode of report.options.modes) {
        const summary = report.summaryByMode[mode];
        if (!summary) {
            continue;
        }
        console.log(`[${mode}] count=${summary.count} pass=${formatRate(summary.passRate)} degraded=${formatRate(summary.degradedRate)} fail=${formatRate(summary.failRate)}`);
        console.log(`[${mode}] median=${summary.medianMs ?? "n/a"}ms p95=${summary.p95Ms ?? "n/a"}ms min=${summary.minMs ?? "n/a"}ms max=${summary.maxMs ?? "n/a"}ms`);
    }

    if (report.regression) {
        console.log("");
        console.log(`Baseline: ${report.regression.baselinePath}`);
        for (const comparison of report.regression.comparisons) {
            const sign = comparison.deltaPct >= 0 ? "+" : "";
            console.log(
                `[regression] mode=${comparison.mode} metric=${comparison.metric} baseline=${comparison.baselineMs} current=${comparison.currentMs} delta=${sign}${comparison.deltaPct.toFixed(2)}% (${comparison.severity})`
            );
        }
    }

    if (outputPath) {
        console.log("");
        console.log(`Wrote benchmark artifact: ${outputPath}`);
    }
}

function writeReport(outputPath: string, report: BenchmarkReport): void {
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(outputPath, JSON.stringify(report, null, 2));
}

function runBenchmark(options: CliOptions): BenchmarkReport {
    const projectRoot = resolveProjectRoot();
    const runner = resolveRunner(projectRoot);
    const startedAtIso = new Date().toISOString();
    const measuredRuns: BenchmarkRun[] = [];

    for (const mode of options.modes) {
        for (let warmupIndex = 0; warmupIndex < options.warmup; warmupIndex += 1) {
            runVerificationOnce({
                runner,
                mode,
                runIndex: warmupIndex + 1,
                keyword: options.keyword,
                location: options.location,
                projectRoot,
            });
        }

        for (let runIndex = 0; runIndex < options.runs; runIndex += 1) {
            const run = runVerificationOnce({
                runner,
                mode,
                runIndex: runIndex + 1,
                keyword: options.keyword,
                location: options.location,
                projectRoot,
            });
            measuredRuns.push(run);
        }
    }

    const summaryByMode = buildSummaryByMode(options.modes, measuredRuns);
    const regression = options.baseline
        ? compareSummaries(summaryByMode, readBaselineSummaries(options.baseline), options.baseline, options.strict)
        : null;

    const finishedAtIso = new Date().toISOString();
    return {
        startedAt: startedAtIso,
        finishedAt: finishedAtIso,
        options: {
            runs: options.runs,
            warmup: options.warmup,
            modes: options.modes,
            keyword: options.keyword,
            location: options.location,
            baseline: options.baseline,
            strict: options.strict,
        },
        environment: {
            AI_ANALYSIS_PARALLELISM: process.env.AI_ANALYSIS_PARALLELISM ?? null,
            SUBMIT_RESUME_PARALLELISM: process.env.SUBMIT_RESUME_PARALLELISM ?? null,
        },
        runs: measuredRuns,
        summaryByMode,
        regression,
    };
}

async function main(): Promise<void> {
    const options = parseCliArgs(process.argv.slice(2));
    const report = runBenchmark(options);
    const projectRoot = resolveProjectRoot();
    const outputPath = resolveOutputPath(projectRoot, options.out);

    if (outputPath) {
        writeReport(outputPath, report);
    }

    if (options.json) {
        console.log(JSON.stringify({ ...report, outputPath }, null, 2));
    } else {
        printSummary(report, outputPath);
    }

    process.exitCode = shouldFailStrict(report.regression) ? 1 : 0;
}

const isMainModule = process.argv[1]
    ? path.resolve(fileURLToPath(import.meta.url)) === path.resolve(process.argv[1])
    : false;

if (isMainModule) {
    main().catch((error) => {
        console.error("benchmark-critical-path failed:");
        console.error(error);
        process.exit(1);
    });
}
