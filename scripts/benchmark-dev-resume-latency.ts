import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { chromium, type Browser } from "playwright";

type CliOptions = {
    url: string;
    runs: number;
    warmup: number;
    timeoutMs: number;
    refresh: boolean;
    json: boolean;
    out: string | "auto" | null;
};

type ShellProbe = {
    statusCode: number | null;
    connectMs: number | null;
    ttfbMs: number | null;
    totalMs: number | null;
};

type BrowserProbe = {
    runIndex: number;
    readyMs: number;
    selectedCount: number;
    totalCount: number;
    readyText: string;
    title: string;
};

type HostSnapshot = {
    collectedAt: string;
    memAvailableMiB: number | null;
    memUsedMiB: number | null;
    swapUsedMiB: number | null;
    swapFreeMiB: number | null;
    swapTotalMiB: number | null;
    convexRssMiB: number | null;
    chromeRssMiB: number | null;
    convexStateSizeMiB: number | null;
};

type PhaseReport = {
    name: "before" | "after";
    host: HostSnapshot;
    shell: ShellProbe;
    probes: BrowserProbe[];
    summary: {
        medianReadyMs: number | null;
        minReadyMs: number | null;
        maxReadyMs: number | null;
        medianTtfbMs: number | null;
        totalCount: number | null;
    };
};

type RefreshReport = {
    status: "skipped" | "success" | "failed";
    durationMs: number;
    stdout: string;
    stderr: string;
    exitCode: number | null;
};

type BenchmarkReport = {
    startedAt: string;
    finishedAt: string;
    url: string;
    runs: number;
    warmup: number;
    timeoutMs: number;
    refresh: RefreshReport;
    before: PhaseReport;
    after: PhaseReport | null;
    delta: {
        medianReadyMs: number | null;
        shellTtfbMs: number | null;
        swapUsedMiB: number | null;
        memAvailableMiB: number | null;
        convexRssMiB: number | null;
    } | null;
};

const DEFAULT_URL = "http://127.0.0.1:5173/dev/resumes";
const DEFAULT_RUNS = 2;
const DEFAULT_WARMUP = 1;
const DEFAULT_TIMEOUT_MS = 30_000;

function printUsage(): void {
    console.log("Usage: benchmark-dev-resume-latency.ts [options]");
    console.log("");
    console.log("Options:");
    console.log("  --url=<url>            Resume page URL to probe (default: http://127.0.0.1:5173/dev/resumes)");
    console.log("  --runs=<n>             Browser probe runs per phase (default: 2)");
    console.log("  --warmup=<n>           Discarded warmup probes per phase (default: 1)");
    console.log("  --timeout-ms=<n>       Page/browser timeout in ms (default: 30000)");
    console.log("  --refresh=<bool>       Run `make dev-convex-refresh` between phases (default: true)");
    console.log("  --json                 Print machine-readable JSON");
    console.log("  --out[=<path>]         Write JSON artifact to path, or auto-generate under output/benchmarks");
    console.log("  --help                 Show this help");
}

function readCliValue(argv: string[], name: string): string | undefined {
    const fullFlag = `--${name}`;
    for (let index = 0; index < argv.length; index += 1) {
        const arg = argv[index];
        if (arg === fullFlag) {
            const next = argv[index + 1];
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

function parseBoolean(value: string | undefined, fallback: boolean): boolean {
    if (value === undefined) {
        return fallback;
    }
    const normalized = value.trim().toLowerCase();
    if (normalized === "1" || normalized === "true" || normalized === "yes") {
        return true;
    }
    if (normalized === "0" || normalized === "false" || normalized === "no") {
        return false;
    }
    return fallback;
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
        return path.join(projectRoot, "output", "benchmarks", `dev-resume-latency-${formatTimestampForFile(new Date())}.json`);
    }
    return path.resolve(process.cwd(), outOption);
}

function parseOutOption(argv: string[]): string | "auto" | null {
    const explicit = readCliValue(argv, "out");
    if (explicit !== undefined) {
        const trimmed = explicit.trim();
        if (!trimmed || parseBoolean(trimmed, true)) {
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
    if (!trimmed || parseBoolean(trimmed, true)) {
        return "auto";
    }
    return trimmed;
}

function parseCliArgs(argv: string[]): CliOptions {
    if (hasCliFlag(argv, "help") || hasCliFlag(argv, "h")) {
        printUsage();
        process.exit(0);
    }

    return {
        url: (readCliValue(argv, "url") ?? process.env.URL ?? DEFAULT_URL).trim() || DEFAULT_URL,
        runs: parsePositiveInt(readCliValue(argv, "runs") ?? process.env.RUNS, DEFAULT_RUNS),
        warmup: parsePositiveInt(readCliValue(argv, "warmup") ?? process.env.WARMUP, DEFAULT_WARMUP),
        timeoutMs: parsePositiveInt(readCliValue(argv, "timeout-ms") ?? process.env.TIMEOUT_MS, DEFAULT_TIMEOUT_MS),
        refresh: parseBoolean(readCliValue(argv, "refresh") ?? process.env.REFRESH, true),
        json: hasCliFlag(argv, "json") || parseBoolean(process.env.JSON, false),
        out: parseOutOption(argv),
    };
}

function runCommand(command: string, args: string[], cwd?: string): { stdout: string; stderr: string; status: number | null } {
    const result = spawnSync(command, args, {
        cwd,
        encoding: "utf8",
        stdio: "pipe",
    });

    return {
        stdout: result.stdout ?? "",
        stderr: result.stderr ?? "",
        status: result.status,
    };
}

function parseShellProbe(url: string): ShellProbe {
    const format = "code=%{http_code} connect=%{time_connect} ttfb=%{time_starttransfer} total=%{time_total}";
    const result = runCommand("curl", ["-I", "-s", "-o", "/dev/null", "-w", format, url]);
    if (result.status !== 0) {
        return {
            statusCode: null,
            connectMs: null,
            ttfbMs: null,
            totalMs: null,
        };
    }

    const codeMatch = result.stdout.match(/code=(\d+)/);
    const connectMatch = result.stdout.match(/connect=([0-9.]+)/);
    const ttfbMatch = result.stdout.match(/ttfb=([0-9.]+)/);
    const totalMatch = result.stdout.match(/total=([0-9.]+)/);

    return {
        statusCode: codeMatch ? Number.parseInt(codeMatch[1], 10) : null,
        connectMs: connectMatch ? Math.round(Number.parseFloat(connectMatch[1]) * 1000) : null,
        ttfbMs: ttfbMatch ? Math.round(Number.parseFloat(ttfbMatch[1]) * 1000) : null,
        totalMs: totalMatch ? Math.round(Number.parseFloat(totalMatch[1]) * 1000) : null,
    };
}

function parseMemInfo(): Record<string, number> {
    const contents = fs.readFileSync("/proc/meminfo", "utf8");
    const values: Record<string, number> = {};
    for (const line of contents.split(/\r?\n/)) {
        const match = line.match(/^([A-Za-z()_]+):\s+(\d+)\s+kB$/);
        if (!match) {
            continue;
        }
        values[match[1]] = Number.parseInt(match[2], 10);
    }
    return values;
}

function sumProcessRssMiB(patterns: RegExp[]): number | null {
    const result = runCommand("ps", ["-eo", "rss,args", "--no-headers"]);
    if (result.status !== 0) {
        return null;
    }

    let rssKiB = 0;
    for (const line of result.stdout.split(/\r?\n/)) {
        const match = line.match(/^\s*(\d+)\s+(.*)$/);
        if (!match) {
            continue;
        }
        const rss = Number.parseInt(match[1], 10);
        const args = match[2];
        if (patterns.some((pattern) => pattern.test(args))) {
            rssKiB += rss;
        }
    }

    return Math.round((rssKiB / 1024) * 10) / 10;
}

function readConvexStateSizeMiB(): number | null {
    const stateDir = path.join(os.homedir(), ".convex", "anonymous-convex-backend-state", "anonymous-agent");
    const result = runCommand("du", ["-sm", stateDir]);
    if (result.status !== 0) {
        return null;
    }
    const match = result.stdout.match(/^\s*(\d+)/);
    return match ? Number.parseInt(match[1], 10) : null;
}

function collectHostSnapshot(): HostSnapshot {
    const mem = parseMemInfo();
    const memTotalMiB = mem.MemTotal ? Math.round(mem.MemTotal / 1024) : null;
    const memAvailableMiB = mem.MemAvailable ? Math.round(mem.MemAvailable / 1024) : null;
    const swapTotalMiB = mem.SwapTotal ? Math.round(mem.SwapTotal / 1024) : null;
    const swapFreeMiB = mem.SwapFree ? Math.round(mem.SwapFree / 1024) : null;

    return {
        collectedAt: new Date().toISOString(),
        memAvailableMiB,
        memUsedMiB: memTotalMiB !== null && memAvailableMiB !== null ? memTotalMiB - memAvailableMiB : null,
        swapUsedMiB: swapTotalMiB !== null && swapFreeMiB !== null ? swapTotalMiB - swapFreeMiB : null,
        swapFreeMiB,
        swapTotalMiB,
        convexRssMiB: sumProcessRssMiB([/convex-local-backend/, /node .*\/convex dev --local --local-force-upgrade/]),
        chromeRssMiB: sumProcessRssMiB([/chrome/]),
        convexStateSizeMiB: readConvexStateSizeMiB(),
    };
}

async function launchBrowser(): Promise<Browser> {
    const attempts: Array<() => Promise<Browser>> = [
        () => chromium.launch({ headless: true }),
        () => chromium.launch({ channel: "chrome", headless: true }),
    ];

    const executableCandidates = [
        "/usr/bin/google-chrome-stable",
        "/usr/bin/google-chrome",
        "/opt/google/chrome/chrome",
    ];

    for (const candidate of executableCandidates) {
        if (!fs.existsSync(candidate)) {
            continue;
        }
        attempts.push(() => chromium.launch({ executablePath: candidate, headless: true }));
    }

    let lastError: unknown = null;
    for (const attempt of attempts) {
        try {
            return await attempt();
        } catch (error) {
            lastError = error;
        }
    }

    throw lastError instanceof Error ? lastError : new Error("Unable to launch a browser for benchmark probes");
}

async function runBrowserProbe(browser: Browser, url: string, timeoutMs: number, runIndex: number): Promise<BrowserProbe> {
    const context = await browser.newContext({ ignoreHTTPSErrors: true });
    const page = await context.newPage();
    const startedAt = Date.now();

    try {
        await page.goto(url, { waitUntil: "domcontentloaded", timeout: timeoutMs });
        const readyHandle = await page.waitForFunction(() => {
            const elements = Array.from(document.querySelectorAll("body *"));
            for (const element of elements) {
                const rawText = element.textContent ?? "";
                const text = rawText.replace(/\s+/g, " ").trim();
                const match = text.match(/^(\d+)\s*\/\s*(\d+)$/);
                if (!match) {
                    continue;
                }
                const selected = Number.parseInt(match[1], 10);
                const total = Number.parseInt(match[2], 10);
                if (total > 0) {
                    return { selected, total, text };
                }
            }
            return null;
        }, { timeout: timeoutMs });

        const readyInfo = await readyHandle.jsonValue() as { selected: number; total: number; text: string };

        return {
            runIndex,
            readyMs: Date.now() - startedAt,
            selectedCount: readyInfo.selected,
            totalCount: readyInfo.total,
            readyText: readyInfo.text,
            title: await page.title(),
        };
    } finally {
        await context.close();
    }
}

function median(values: number[]): number | null {
    if (values.length === 0) {
        return null;
    }
    const sorted = [...values].sort((left, right) => left - right);
    const middle = Math.floor(sorted.length / 2);
    if (sorted.length % 2 === 0) {
        return Math.round((sorted[middle - 1] + sorted[middle]) / 2);
    }
    return sorted[middle];
}

function buildPhaseSummary(probes: BrowserProbe[], shell: ShellProbe) {
    const readyValues = probes.map((probe) => probe.readyMs);
    return {
        medianReadyMs: median(readyValues),
        minReadyMs: readyValues.length > 0 ? Math.min(...readyValues) : null,
        maxReadyMs: readyValues.length > 0 ? Math.max(...readyValues) : null,
        medianTtfbMs: shell.ttfbMs,
        totalCount: probes.length > 0 ? probes[probes.length - 1].totalCount : null,
    };
}

async function runPhase(name: "before" | "after", browser: Browser, options: CliOptions): Promise<PhaseReport> {
    const shell = parseShellProbe(options.url);
    if (shell.statusCode === null || shell.statusCode === 0) {
        throw new Error(`Unable to reach ${options.url}. Start the local web app (for example \`make dev-web\`) or pass a reachable --url.`);
    }
    const host = collectHostSnapshot();
    const probes: BrowserProbe[] = [];

    for (let index = 0; index < options.warmup; index += 1) {
        await runBrowserProbe(browser, options.url, options.timeoutMs, -(index + 1));
    }

    for (let index = 0; index < options.runs; index += 1) {
        probes.push(await runBrowserProbe(browser, options.url, options.timeoutMs, index + 1));
    }

    return {
        name,
        host,
        shell,
        probes,
        summary: buildPhaseSummary(probes, shell),
    };
}

function runRefresh(projectRoot: string, enabled: boolean): RefreshReport {
    if (!enabled) {
        return {
            status: "skipped",
            durationMs: 0,
            stdout: "",
            stderr: "",
            exitCode: 0,
        };
    }

    const startedAt = Date.now();
    const result = spawnSync("make", ["dev-convex-refresh"], {
        cwd: projectRoot,
        encoding: "utf8",
        stdio: "pipe",
    });

    return {
        status: result.status === 0 ? "success" : "failed",
        durationMs: Date.now() - startedAt,
        stdout: result.stdout ?? "",
        stderr: result.stderr ?? "",
        exitCode: result.status,
    };
}

function buildDelta(before: PhaseReport, after: PhaseReport | null) {
    if (!after) {
        return null;
    }

    return {
        medianReadyMs:
            before.summary.medianReadyMs !== null && after.summary.medianReadyMs !== null
                ? after.summary.medianReadyMs - before.summary.medianReadyMs
                : null,
        shellTtfbMs:
            before.shell.ttfbMs !== null && after.shell.ttfbMs !== null
                ? after.shell.ttfbMs - before.shell.ttfbMs
                : null,
        swapUsedMiB:
            before.host.swapUsedMiB !== null && after.host.swapUsedMiB !== null
                ? after.host.swapUsedMiB - before.host.swapUsedMiB
                : null,
        memAvailableMiB:
            before.host.memAvailableMiB !== null && after.host.memAvailableMiB !== null
                ? after.host.memAvailableMiB - before.host.memAvailableMiB
                : null,
        convexRssMiB:
            before.host.convexRssMiB !== null && after.host.convexRssMiB !== null
                ? Math.round((after.host.convexRssMiB - before.host.convexRssMiB) * 10) / 10
                : null,
    };
}

function printHumanSummary(report: BenchmarkReport): void {
    const before = report.before;
    const after = report.after;
    const delta = report.delta;

    console.log(`Dev resume latency benchmark for ${report.url}`);
    console.log(`Started: ${report.startedAt}`);
    console.log(`Finished: ${report.finishedAt}`);
    console.log("");
    console.log(`Before refresh: median ready ${before.summary.medianReadyMs ?? "n/a"} ms, shell TTFB ${before.shell.ttfbMs ?? "n/a"} ms, swap used ${before.host.swapUsedMiB ?? "n/a"} MiB, convex RSS ${before.host.convexRssMiB ?? "n/a"} MiB`);
    if (after) {
        console.log(`After refresh:  median ready ${after.summary.medianReadyMs ?? "n/a"} ms, shell TTFB ${after.shell.ttfbMs ?? "n/a"} ms, swap used ${after.host.swapUsedMiB ?? "n/a"} MiB, convex RSS ${after.host.convexRssMiB ?? "n/a"} MiB`);
    }
    console.log(`Refresh: ${report.refresh.status} (${report.refresh.durationMs} ms)`);
    if (delta) {
        console.log(`Delta: median ready ${delta.medianReadyMs ?? "n/a"} ms, shell TTFB ${delta.shellTtfbMs ?? "n/a"} ms, swap used ${delta.swapUsedMiB ?? "n/a"} MiB, mem available ${delta.memAvailableMiB ?? "n/a"} MiB, convex RSS ${delta.convexRssMiB ?? "n/a"} MiB`);
    }
}

async function main(): Promise<void> {
    const options = parseCliArgs(process.argv.slice(2));
    const projectRoot = resolveProjectRoot();
    const outputPath = resolveOutputPath(projectRoot, options.out);
    const startedAt = new Date().toISOString();
    const browser = await launchBrowser();

    try {
        const before = await runPhase("before", browser, options);
        const refresh = runRefresh(projectRoot, options.refresh);
        let after: PhaseReport | null = null;

        if (refresh.status === "failed") {
            throw new Error(`make dev-convex-refresh failed with exit code ${refresh.exitCode}\n${refresh.stdout}\n${refresh.stderr}`);
        }

        if (refresh.status === "success") {
            after = await runPhase("after", browser, options);
        }

        const report: BenchmarkReport = {
            startedAt,
            finishedAt: new Date().toISOString(),
            url: options.url,
            runs: options.runs,
            warmup: options.warmup,
            timeoutMs: options.timeoutMs,
            refresh,
            before,
            after,
            delta: buildDelta(before, after),
        };

        if (outputPath) {
            fs.mkdirSync(path.dirname(outputPath), { recursive: true });
            fs.writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
        }

        if (options.json) {
            console.log(JSON.stringify(report, null, 2));
        } else {
            printHumanSummary(report);
            if (outputPath) {
                console.log(`Wrote benchmark artifact: ${outputPath}`);
            }
        }
    } finally {
        await browser.close();
    }
}

void main().catch((error: unknown) => {
    console.error("benchmark-dev-resume-latency failed:");
    if (error instanceof Error) {
        console.error(error.stack ?? error.message);
    } else {
        console.error(String(error));
    }
    process.exit(1);
});
