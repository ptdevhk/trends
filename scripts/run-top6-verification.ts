/**
 * Top 6 Verification & Orchestration Suite runner.
 *
 * Probes local services (Convex :3210, API :3000, Web :5173), optionally spawns
 * the fast-ui dev stack, then executes the six verification suites sequentially
 * with per-suite timeouts. Failures and timeouts are recorded and never stop
 * later suites, so a full diagnostic battery report is produced. Emits a JSON
 * report plus a Markdown report (default `output/verification/`), with `--json`
 * additionally dumping the raw JSON report to stdout.
 */
import { spawn, type SpawnOptions } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SuiteDef {
    number: number;
    name: string;
    /** Documented suite commands; run sequentially in order. */
    commands: string[];
    timeoutMs: number;
    /** Suites that accept a `--headless` flag (forwarded verbatim). */
    supportsHeadless?: boolean;
}

export interface ServiceDef {
    name: string;
    port: number;
    url: string;
}

export interface Top6CliOptions {
    headless: boolean;
    skipServices: boolean;
    /** null = run all suites. */
    only: number[] | null;
    json: boolean;
    /** null = default `output/verification/top6-verification-report`. */
    output: string | null;
}

export interface ProbeResult {
    up: boolean;
    statusCode: number | null;
    error?: string;
}

export type ProbeFn = (url: string, timeoutMs?: number) => Promise<ProbeResult>;

export interface SpawnedProcess {
    pid: number | undefined;
    stdout: NodeJS.ReadableStream | null;
    stderr: NodeJS.ReadableStream | null;
    on(event: 'close', listener: (code: number | null, signal: NodeJS.Signals | null) => void): this;
    on(event: 'error', listener: (error: Error) => void): this;
    kill(signal?: NodeJS.Signals): boolean;
}

export type SpawnFn = (command: string, options: SpawnOptions) => SpawnedProcess;
export type KillFn = (pid: number, signal: NodeJS.Signals) => void;

export interface ServiceEntry {
    name: string;
    port: number;
    url: string;
    up: boolean;
    statusCode: number | null;
    spawned: boolean;
    error?: string;
}

export interface ServicesSection {
    probeStartedAt: string;
    probeFinishedAt: string;
    readinessMs: number;
    allUp: boolean;
    spawned: boolean;
    spawnCommand: string | null;
    spawnLogTail: string[];
    spawnError?: string;
    teardown: {
        required: boolean;
        startedAt: string | null;
        finishedAt: string | null;
        killed: boolean;
    };
    entries: ServiceEntry[];
}

export type CommandStatus = 'passed' | 'failed' | 'timed-out' | 'error';

export interface CommandResult {
    command: string;
    resolvedCommand: string;
    status: CommandStatus;
    exitCode: number | null;
    signal: string | null;
    durationMs: number;
    outputTail: string[];
    errorLines: string[];
    error?: string;
}

export type SuiteStatus = 'passed' | 'failed' | 'timed-out' | 'skipped';

export interface SuiteResult {
    number: number;
    name: string;
    status: SuiteStatus;
    exitCode: number | null;
    durationMs: number | null;
    commands: CommandResult[];
}

export interface CoreWebVitalsSummary {
    source: string;
    roles: Array<{
        role: string;
        ttfb: number | null;
        lcp: number | null;
        cls: number | null;
        fcp: number | null;
    }>;
    averages: {
        ttfb: number | null;
        lcp: number | null;
        cls: number | null;
        fcp: number | null;
    };
}

export interface Top6Report {
    schema: string;
    version: number;
    timestamp: string;
    startedAt: string;
    finishedAt: string;
    durationMs: number;
    flags: Top6CliOptions;
    services: ServicesSection;
    suites: SuiteResult[];
    coreWebVitals: CoreWebVitalsSummary | null;
    overall: {
        executed: number;
        passed: number;
        failed: number;
        timedOut: number;
        skipped: number;
        success: boolean;
    };
}

export interface RunDeps {
    spawn?: SpawnFn;
    probe?: ProbeFn;
    kill?: KillFn;
    cwd?: string;
    now?: () => number;
    log?: (line: string) => void;
    stdout?: (chunk: string) => void;
    sleep?: (ms: number) => Promise<void>;
    killGraceMs?: number;
    readyTimeoutMs?: number;
    pollIntervalMs?: number;
    suites?: SuiteDef[];
}

// ---------------------------------------------------------------------------
// Suite table (commands verbatim from the handoff; --headless only on suite 1)
// ---------------------------------------------------------------------------

export const SUITES: SuiteDef[] = [
    {
        number: 1,
        name: 'Automated Multi-Role Browser UAT',
        commands: ['scripts/run-multi-role-uat.ts'],
        timeoutMs: 30 * 60 * 1000,
        supportsHeadless: true,
    },
    {
        number: 2,
        name: 'Monorepo Local CI Parity Gate',
        commands: ['make ci-local'],
        timeoutMs: 60 * 60 * 1000,
    },
    {
        number: 3,
        name: 'MY Scoring Parity & IRR Cohort Gate',
        commands: ['npm run test:scoring:my', 'scripts/run-my-cohort-gate.ts'],
        timeoutMs: 30 * 60 * 1000,
    },
    {
        number: 4,
        name: 'Search-Data Freshness Doctor',
        commands: ['scripts/search-data-freshness-doctor.ts'],
        timeoutMs: 15 * 60 * 1000,
    },
    {
        number: 5,
        name: 'Critical Path & Workflow Dataset Verification',
        commands: [
            'scripts/verify-critical-path.ts',
            'scripts/resume/verify-workflow-dataset.ts --query "CNC Sales" --workspace dev --limit 200 --top 10',
        ],
        timeoutMs: 30 * 60 * 1000,
    },
    {
        number: 6,
        name: 'Industry Review & Scores Verification',
        commands: [
            'scripts/verify-industry-scores.ts --sample sample-job5156-detail-enriched --round-trip',
            'scripts/industry-review/browser-uat.ts',
        ],
        timeoutMs: 30 * 60 * 1000,
    },
];

export const SERVICES: ServiceDef[] = [
    { name: 'convex', port: 3210, url: 'http://127.0.0.1:3210/version' },
    { name: 'api', port: 3000, url: 'http://127.0.0.1:3000/' },
    { name: 'web', port: 5173, url: 'http://127.0.0.1:5173/' },
];

export const SPAWN_COMMAND = './scripts/dev.sh --profile fast-ui';

export const DEFAULT_OUTPUT_BASE = 'output/verification/top6-verification-report';

// ---------------------------------------------------------------------------
// CLI parsing
// ---------------------------------------------------------------------------

export function parseSuiteNumbers(value: string): number[] {
    const parts = value.split(',').map((s) => s.trim()).filter(Boolean);
    if (parts.length === 0) {
        throw new Error('--only requires at least one suite number (e.g. --only 1,3,4)');
    }
    const nums = parts.map((part) => {
        if (!/^\d+$/.test(part)) {
            throw new Error(`Invalid suite number "${part}" (expected integers 1-${SUITES.length})`);
        }
        return parseInt(part, 10);
    });
    for (const n of nums) {
        if (n < 1 || n > SUITES.length) {
            throw new Error(`Suite number out of range: ${n} (expected 1-${SUITES.length})`);
        }
    }
    return [...new Set(nums)];
}

export function parseCliArgs(argv: string[]): Top6CliOptions {
    const opts: Top6CliOptions = {
        headless: false,
        skipServices: false,
        only: null,
        json: false,
        output: null,
    };
    for (let i = 0; i < argv.length; i++) {
        const arg = argv[i];
        if (arg === '--headless') {
            opts.headless = true;
        } else if (arg === '--skip-services') {
            opts.skipServices = true;
        } else if (arg === '--json') {
            opts.json = true;
        } else if (arg === '--only') {
            const value = argv[i + 1];
            if (!value) {
                throw new Error('--only requires a value (e.g. --only 1,3,4)');
            }
            opts.only = parseSuiteNumbers(value);
            i++;
        } else if (arg === '--output') {
            const value = argv[i + 1];
            if (!value) {
                throw new Error('--output requires a path');
            }
            opts.output = value;
            i++;
        } else if (arg.startsWith('--')) {
            throw new Error(`Unknown flag: ${arg}`);
        }
    }
    return opts;
}

// ---------------------------------------------------------------------------
// Suite selection / command resolution
// ---------------------------------------------------------------------------

export function selectSuites(
    suites: SuiteDef[],
    only: number[] | null,
): { selected: SuiteDef[]; skipped: SuiteDef[] } {
    if (!only) {
        return { selected: [...suites], skipped: [] };
    }
    const byNumber = new Map(suites.map((s) => [s.number, s]));
    const selected = only.map((n) => {
        const suite = byNumber.get(n);
        if (!suite) {
            throw new Error(`Suite ${n} not found in the suite table`);
        }
        return suite;
    });
    const skipped = suites.filter((s) => !only.includes(s.number));
    return { selected, skipped };
}

/**
 * Repo `.ts` scripts are not executable (mode 100644), so they are invoked
 * through `npx tsx`; everything else runs verbatim through the shell.
 */
export function resolveCommand(command: string): string {
    const trimmed = command.trim();
    const first = trimmed.split(/\s+/, 1)[0] ?? '';
    if (first.endsWith('.ts')) {
        return `npx tsx ${trimmed}`;
    }
    return trimmed;
}

// ---------------------------------------------------------------------------
// Env loading (mirrors dev.sh sourcing .env so suite children get credentials)
// ---------------------------------------------------------------------------

export function parseEnvFile(content: string): Record<string, string> {
    const out: Record<string, string> = {};
    for (const raw of content.split('\n')) {
        let line = raw.trim();
        if (!line || line.startsWith('#')) {
            continue;
        }
        if (line.startsWith('export ')) {
            line = line.slice('export '.length).trim();
        }
        const eq = line.indexOf('=');
        if (eq <= 0) {
            continue;
        }
        const key = line.slice(0, eq).trim();
        let value = line.slice(eq + 1).trim();
        if (
            (value.startsWith('"') && value.endsWith('"')) ||
            (value.startsWith("'") && value.endsWith("'"))
        ) {
            value = value.slice(1, -1);
        }
        out[key] = value;
    }
    return out;
}

export function loadEnvFile(cwd: string): Record<string, string> {
    try {
        return parseEnvFile(readFileSync(resolve(cwd, '.env'), 'utf-8'));
    } catch {
        return {};
    }
}

// ---------------------------------------------------------------------------
// Service probe
// ---------------------------------------------------------------------------

export async function realProbe(url: string, timeoutMs = 3000): Promise<ProbeResult> {
    try {
        const res = await fetch(url, {
            method: 'GET',
            signal: AbortSignal.timeout(timeoutMs),
        });
        return { up: true, statusCode: res.status };
    } catch (err) {
        return { up: false, statusCode: null, error: err instanceof Error ? err.message : String(err) };
    }
}

async function probeServices(probe: ProbeFn, timeoutMs?: number): Promise<ServiceEntry[]> {
    const entries = await Promise.all(
        SERVICES.map(async (s) => {
            const result = await probe(s.url, timeoutMs);
            return {
                name: s.name,
                port: s.port,
                url: s.url,
                up: result.up,
                statusCode: result.statusCode,
                spawned: false,
                error: result.error,
            };
        }),
    );
    return entries;
}

// ---------------------------------------------------------------------------
// Output capture helper
// ---------------------------------------------------------------------------

function captureStream(
    stream: NodeJS.ReadableStream | null | undefined,
    tail: string[],
    errorLines: string[],
    tailCap = 200,
    errorCap = 100,
): void {
    stream?.on('data', (chunk: Buffer | string) => {
        const text = typeof chunk === 'string' ? chunk : chunk.toString('utf-8');
        for (const raw of text.split('\n')) {
            const line = raw.replace(/\r$/, '');
            if (!line) {
                continue;
            }
            tail.push(line);
            if (tail.length > tailCap) {
                tail.splice(0, tail.length - tailCap);
            }
            if (errorLines.length < errorCap && /error|warn|fail/i.test(line)) {
                errorLines.push(line);
            }
        }
    });
}

// ---------------------------------------------------------------------------
// Command runner (one suite command with timeout kill)
// ---------------------------------------------------------------------------

export interface SuiteRunContext {
    spawnFn: SpawnFn;
    killFn: KillFn;
    now: () => number;
    sleep: (ms: number) => Promise<void>;
    cwd: string;
    env: NodeJS.ProcessEnv;
    killGraceMs: number;
}

export function runCommand(command: string, ctx: SuiteRunContext, timeoutMs: number): Promise<CommandResult> {
    const resolved = resolveCommand(command);
    const startedAt = ctx.now();
    const tail: string[] = [];
    const errorLines: string[] = [];
    return new Promise<CommandResult>((resolvePromise) => {
        let settled = false;
        let timedOut = false;
        const finish = (partial: Partial<CommandResult> & Pick<CommandResult, 'status'>): void => {
            if (settled) {
                return;
            }
            settled = true;
            resolvePromise({
                command,
                resolvedCommand: resolved,
                exitCode: null,
                signal: null,
                durationMs: ctx.now() - startedAt,
                outputTail: tail.slice(-100),
                errorLines: errorLines.slice(0, 100),
                ...partial,
            });
        };

        let child: SpawnedProcess;
        try {
            child = ctx.spawnFn(resolved, {
                cwd: ctx.cwd,
                env: ctx.env,
                shell: true,
                detached: true,
                stdio: ['ignore', 'pipe', 'pipe'],
            });
        } catch (err) {
            finish({
                status: 'error',
                error: err instanceof Error ? err.message : String(err),
            });
            return;
        }

        const killGroup = (signal: NodeJS.Signals): void => {
            if (child.pid == null) {
                return;
            }
            try {
                ctx.killFn(-child.pid, signal);
            } catch {
                // Process group already gone.
            }
        };

        let graceTimer: ReturnType<typeof setTimeout> | null = null;

        const timer = setTimeout(() => {
            timedOut = true;
            killGroup('SIGTERM');
            // Bound the wait: settle as timed-out when the kill grace elapses
            // even if the child never emits 'close', so later suites still run.
            graceTimer = setTimeout(() => {
                killGroup('SIGKILL');
                finish({ status: 'timed-out', exitCode: null, signal: null });
            }, ctx.killGraceMs);
            graceTimer.unref?.();
        }, timeoutMs);

        captureStream(child.stdout, tail, errorLines);
        captureStream(child.stderr, tail, errorLines);

        child.on('error', (err) => {
            clearTimeout(timer);
            if (graceTimer) {
                clearTimeout(graceTimer);
            }
            finish({ status: 'error', error: err.message });
        });
        child.on('close', (code, signal) => {
            clearTimeout(timer);
            if (graceTimer) {
                clearTimeout(graceTimer);
            }
            const sig = signal ?? null;
            if (timedOut) {
                finish({ status: 'timed-out', exitCode: null, signal: sig });
            } else if (code === 0) {
                finish({ status: 'passed', exitCode: 0, signal: sig });
            } else {
                finish({ status: 'failed', exitCode: code, signal: sig });
            }
        });
    });
}

// ---------------------------------------------------------------------------
// Suite runner (commands sequentially; suite status = worst of its commands)
// ---------------------------------------------------------------------------

export async function runSuite(
    suite: SuiteDef,
    headless: boolean,
    ctx: SuiteRunContext,
): Promise<SuiteResult> {
    const startedAt = ctx.now();
    const commands: CommandResult[] = [];
    for (const command of suite.commands) {
        const effective = suite.supportsHeadless && headless ? `${command} --headless` : command;
        commands.push(await runCommand(effective, ctx, suite.timeoutMs));
    }
    let status: SuiteResult['status'] = 'passed';
    if (commands.some((c) => c.status === 'timed-out')) {
        status = 'timed-out';
    } else if (commands.some((c) => c.status === 'failed' || c.status === 'error')) {
        status = 'failed';
    }
    const firstFailure = commands.find((c) => c.status === 'failed');
    const exitCode = commands.every((c) => c.status === 'passed') ? 0 : (firstFailure?.exitCode ?? null);
    return {
        number: suite.number,
        name: suite.name,
        status,
        exitCode,
        durationMs: ctx.now() - startedAt,
        commands,
    };
}

// ---------------------------------------------------------------------------
// Core Web Vitals fold-in (suite 1's artifact when present)
// ---------------------------------------------------------------------------

interface CwvArtifactShape {
    details?: Array<{
        role?: string;
        cwv?: {
            ttfb?: number | null;
            lcp?: number | null;
            cls?: number | null;
            fcp?: number | null;
        };
    }>;
}

export function readCwvArtifact(cwd: string): CoreWebVitalsSummary | null {
    const artifactPath = resolve(cwd, 'output/uat/multi-role-uat-report.json');
    if (!existsSync(artifactPath)) {
        return null;
    }
    try {
        const raw = JSON.parse(readFileSync(artifactPath, 'utf-8')) as CwvArtifactShape;
        if (!Array.isArray(raw.details)) {
            return null;
        }
        const roles = raw.details
            .filter((d) => d && typeof d === 'object')
            .map((d) => ({
                role: d.role ?? 'unknown',
                ttfb: d.cwv?.ttfb ?? null,
                lcp: d.cwv?.lcp ?? null,
                cls: d.cwv?.cls ?? null,
                fcp: d.cwv?.fcp ?? null,
            }));
        const average = (key: 'ttfb' | 'lcp' | 'cls' | 'fcp'): number | null => {
            const values = roles
                .map((r) => r[key])
                .filter((v): v is number => typeof v === 'number');
            if (values.length === 0) {
                return null;
            }
            return Math.round((values.reduce((a, b) => a + b, 0) / values.length) * 10) / 10;
        };
        return {
            source: artifactPath,
            roles,
            averages: {
                ttfb: average('ttfb'),
                lcp: average('lcp'),
                cls: average('cls'),
                fcp: average('fcp'),
            },
        };
    } catch {
        return null;
    }
}

// ---------------------------------------------------------------------------
// Report building
// ---------------------------------------------------------------------------

export function computeOverall(results: SuiteResult[]): Top6Report['overall'] {
    const executed = results.filter((r) => r.status !== 'skipped');
    return {
        executed: executed.length,
        passed: executed.filter((r) => r.status === 'passed').length,
        failed: executed.filter((r) => r.status === 'failed').length,
        timedOut: executed.filter((r) => r.status === 'timed-out').length,
        skipped: results.length - executed.length,
        success: executed.length > 0 && executed.every((r) => r.status === 'passed'),
    };
}

export function computeExitCode(report: Top6Report): number {
    return report.overall.success ? 0 : 1;
}

// ---------------------------------------------------------------------------
// Report emission
// ---------------------------------------------------------------------------

export function generateMarkdownReport(report: Top6Report): string {
    const lines: string[] = [];
    const push = (line = ''): void => {
        lines.push(line);
    };

    push('# Top 6 Verification & Orchestration Report');
    push();
    push(`- **Schema**: ${report.schema} (version ${report.version})`);
    push(`- **Started**: ${report.startedAt}`);
    push(`- **Finished**: ${report.finishedAt}`);
    push(`- **Duration**: ${report.durationMs} ms`);
    push();
    push('## Flags');
    push();
    push('| flag | value |');
    push('| --- | --- |');
    push(`| \`--headless\` | ${report.flags.headless} |`);
    push(`| \`--skip-services\` | ${report.flags.skipServices} |`);
    push(`| \`--only\` | ${report.flags.only ? report.flags.only.join(',') : 'all'} |`);
    push(`| \`--json\` | ${report.flags.json} |`);
    push(`| \`--output\` | ${report.flags.output ?? 'default'} |`);
    push();
    push('## Services');
    push();
    push('| name | port | up | statusCode | spawned |');
    push('| --- | --- | --- | --- | --- |');
    for (const entry of report.services.entries) {
        push(`| ${entry.name} | ${entry.port} | ${entry.up} | ${entry.statusCode ?? 'n/a'} | ${entry.spawned} |`);
    }
    push();
    push(
        `Spawn: ${report.services.spawnCommand ?? 'none'} (spawned=${report.services.spawned}, allUp=${report.services.allUp})`,
    );
    push(
        `Teardown: required=${report.services.teardown.required}, killed=${report.services.teardown.killed}, ` +
            `startedAt=${report.services.teardown.startedAt ?? 'n/a'}, finishedAt=${report.services.teardown.finishedAt ?? 'n/a'}`,
    );
    if (report.services.spawnError) {
        push();
        push(`Spawn error: \`${report.services.spawnError}\``);
    }
    push();
    push('## Suites');
    push();
    push('| # | suite | status | exitCode | durationMs |');
    push('| --- | --- | --- | --- | --- |');
    for (const suite of report.suites) {
        push(
            `| ${suite.number} | ${suite.name} | ${suite.status} | ${suite.exitCode ?? 'n/a'} | ${suite.durationMs ?? 'n/a'} |`,
        );
    }
    push();
    for (const suite of report.suites) {
        if (suite.status === 'skipped') {
            continue;
        }
        push(`### Suite ${suite.number}: ${suite.name} (${suite.status})`);
        push();
        for (const cmd of suite.commands) {
            push(`**Command**: \`${cmd.command}\``);
            push();
            push(`- Resolved: \`${cmd.resolvedCommand}\``);
            push(`- Status: ${cmd.status} | exitCode: ${cmd.exitCode ?? 'n/a'} | signal: ${cmd.signal ?? 'n/a'} | duration: ${cmd.durationMs} ms`);
            if (cmd.error) {
                push(`- Error: \`${cmd.error}\``);
            }
            if (cmd.errorLines.length > 0) {
                push();
                push('Error/warning lines:');
                push();
                push('```');
                for (const line of cmd.errorLines.slice(0, 8)) {
                    push(line);
                }
                push('```');
            }
            if (cmd.outputTail.length > 0) {
                push();
                push('Output tail:');
                push();
                push('```');
                for (const line of cmd.outputTail.slice(-10)) {
                    push(line);
                }
                push('```');
            }
            push();
        }
    }
    push('## Core Web Vitals');
    push();
    if (report.coreWebVitals) {
        push(`Source: \`${report.coreWebVitals.source}\``);
        push();
        push('| role | ttfb (ms) | lcp (ms) | cls | fcp (ms) |');
        push('| --- | --- | --- | --- | --- |');
        for (const role of report.coreWebVitals.roles) {
            push(
                `| ${role.role} | ${role.ttfb ?? 'n/a'} | ${role.lcp ?? 'n/a'} | ${role.cls ?? 'n/a'} | ${role.fcp ?? 'n/a'} |`,
            );
        }
        const a = report.coreWebVitals.averages;
        push(
            `| **average** | ${a.ttfb ?? 'n/a'} | ${a.lcp ?? 'n/a'} | ${a.cls ?? 'n/a'} | ${a.fcp ?? 'n/a'} |`,
        );
    } else {
        push('Not available (suite 1 not executed or its report artifact is missing).');
    }
    push();
    push('## Overall');
    push();
    push(
        `executed=${report.overall.executed} passed=${report.overall.passed} failed=${report.overall.failed} ` +
            `timedOut=${report.overall.timedOut} skipped=${report.overall.skipped}`,
    );
    push();
    push(`**Result: ${report.overall.success ? 'SUCCESS' : 'FAILURE'}**`);
    push();
    return lines.join('\n') + '\n';
}

export function writeReport(report: Top6Report, outputBase: string): { jsonPath: string; mdPath: string } {
    const jsonPath = `${outputBase}.json`;
    const mdPath = `${outputBase}.md`;
    mkdirSync(dirname(jsonPath), { recursive: true });
    writeFileSync(jsonPath, JSON.stringify(report, null, 2) + '\n', 'utf-8');
    writeFileSync(mdPath, generateMarkdownReport(report), 'utf-8');
    return { jsonPath, mdPath };
}

// ---------------------------------------------------------------------------
// Orchestration
// ---------------------------------------------------------------------------

async function ensureServices(
    opts: Top6CliOptions,
    deps: Required<Pick<RunDeps, 'probe' | 'spawn' | 'kill' | 'now' | 'sleep' | 'log'>>,
    cwd: string,
    readyTimeoutMs: number,
    pollIntervalMs: number,
): Promise<{ section: ServicesSection; spawnedChild: SpawnedProcess | null }> {
    const probeStart = deps.now();
    const probeStartedAt = new Date(probeStart).toISOString();
    let entries = await probeServices(deps.probe);
    let allUp = entries.every((e) => e.up);

    let spawned = false;
    let spawnCommand: string | null = null;
    let spawnLogTail: string[] = [];
    let spawnError: string | undefined;
    let spawnedChild: SpawnedProcess | null = null;
    const teardown = {
        required: false,
        startedAt: null as string | null,
        finishedAt: null as string | null,
        killed: false,
    };

    if (!allUp && !opts.skipServices) {
        const down = entries.filter((e) => !e.up).map((e) => e.name).join(', ');
        spawnCommand = SPAWN_COMMAND;
        deps.log(`services down (${down}); spawning ${spawnCommand}`);
        try {
            spawnedChild = deps.spawn(spawnCommand, {
                cwd,
                env: { ...process.env, ...loadEnvFile(cwd) },
                shell: true,
                detached: true,
                stdio: ['ignore', 'pipe', 'pipe'],
            });
            spawned = true;
            teardown.required = true;
        } catch (err) {
            spawnError = err instanceof Error ? err.message : String(err);
            deps.log(`spawn failed: ${spawnError}`);
        }
        if (spawnedChild) {
            let exited = false;
            spawnedChild.on('close', (code) => {
                exited = true;
                spawnLogTail.push(`[dev.sh exited code=${code}]`);
            });
            spawnedChild.on('error', (err) => {
                exited = true;
                spawnLogTail.push(`[dev.sh error: ${err.message}]`);
            });
            captureStream(spawnedChild.stdout, spawnLogTail, spawnLogTail, 200, 100);
            captureStream(spawnedChild.stderr, spawnLogTail, spawnLogTail, 200, 100);

            const deadline = deps.now() + readyTimeoutMs;
            while (deps.now() < deadline) {
                await deps.sleep(pollIntervalMs);
                if (exited) {
                    spawnError = 'dev stack exited before services became ready';
                    break;
                }
                entries = await probeServices(deps.probe);
                if (entries.every((e) => e.up)) {
                    break;
                }
            }
            allUp = entries.every((e) => e.up);
            if (!allUp && !spawnError) {
                spawnError = `services not ready within ${readyTimeoutMs} ms`;
            }
            if (spawned) {
                entries = entries.map((e) => ({ ...e, spawned: true }));
            }
        }
    }

    const probeFinishedAt = new Date(deps.now()).toISOString();
    const section: ServicesSection = {
        probeStartedAt,
        probeFinishedAt,
        readinessMs: deps.now() - probeStart,
        allUp,
        spawned,
        spawnCommand,
        spawnLogTail,
        spawnError,
        teardown,
        entries,
    };
    return { section, spawnedChild };
}

export async function runTop6(argv: string[], deps: RunDeps = {}): Promise<Top6Report> {
    const opts = parseCliArgs(argv);
    const cwd = deps.cwd ?? process.cwd();
    const now = deps.now ?? Date.now;
    const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
    const log = deps.log ?? ((line: string) => (opts.json ? console.error(line) : console.log(line)));
    const stdout = deps.stdout ?? ((chunk: string) => process.stdout.write(chunk));
    const spawnFn = deps.spawn ?? (spawn as unknown as SpawnFn);
    const probe = deps.probe ?? realProbe;
    const killFn = deps.kill ?? ((pid: number, signal: NodeJS.Signals) => process.kill(pid, signal));
    const killGraceMs = deps.killGraceMs ?? 3000;
    const readyTimeoutMs = deps.readyTimeoutMs ?? 180000;
    const pollIntervalMs = deps.pollIntervalMs ?? 2000;
    const suites = deps.suites ?? SUITES;

    const startedAt = now();
    log(`top6-verification starting at ${new Date(startedAt).toISOString()}`);
    log(
        `flags: headless=${opts.headless} skipServices=${opts.skipServices} ` +
            `only=${opts.only ? opts.only.join(',') : 'all'} json=${opts.json} output=${opts.output ?? 'default'}`,
    );

    // Service lifecycle: probe, optional spawn + readiness polling.
    const { section, spawnedChild } = await ensureServices(
        opts,
        { probe, spawn: spawnFn, kill: killFn, now, sleep, log },
        cwd,
        readyTimeoutMs,
        pollIntervalMs,
    );
    log(`services: allUp=${section.allUp} spawned=${section.spawned}`);

    // Sequential suite execution; failures never stop later suites.
    const { selected, skipped } = selectSuites(suites, opts.only);
    const results: SuiteResult[] = [];
    for (const suite of skipped) {
        results.push({
            number: suite.number,
            name: suite.name,
            status: 'skipped',
            exitCode: null,
            durationMs: null,
            commands: [],
        });
    }
    const env = { ...process.env, ...loadEnvFile(cwd) };
    for (const suite of selected) {
        log(`suite ${suite.number}/${suite.name} starting`);
        const result = await runSuite(suite, opts.headless, {
            spawnFn,
            killFn,
            now,
            sleep,
            cwd,
            env,
            killGraceMs,
        });
        log(
            `suite ${suite.number}/${suite.name}: ${result.status} (exitCode=${result.exitCode ?? 'n/a'}, ${result.durationMs} ms)`,
        );
        results.push(result);
    }
    results.sort((a, b) => a.number - b.number);

    // Core Web Vitals fold-in from suite 1's artifact.
    const suite1 = results.find((r) => r.number === 1);
    const coreWebVitals = suite1 && suite1.status !== 'skipped' ? readCwvArtifact(cwd) : null;

    // Tear down ONLY the stack we spawned; pre-existing services are preserved.
    if (section.teardown.required && spawnedChild && spawnedChild.pid != null) {
        section.teardown.startedAt = new Date(now()).toISOString();
        log('tearing down spawned dev stack (SIGTERM -> grace -> SIGKILL)');
        try {
            killFn(-spawnedChild.pid, 'SIGTERM');
        } catch {
            // Process group already gone.
        }
        await sleep(killGraceMs);
        try {
            killFn(-spawnedChild.pid, 'SIGKILL');
        } catch {
            // Process group already gone.
        }
        section.teardown.killed = true;
        section.teardown.finishedAt = new Date(now()).toISOString();
    }

    const finishedAt = now();
    const report: Top6Report = {
        schema: 'top6-verification-report',
        version: 1,
        timestamp: new Date(finishedAt).toISOString(),
        startedAt: new Date(startedAt).toISOString(),
        finishedAt: new Date(finishedAt).toISOString(),
        durationMs: finishedAt - startedAt,
        flags: opts,
        services: section,
        suites: results,
        coreWebVitals,
        overall: computeOverall(results),
    };

    const outputBase = resolve(cwd, opts.output ?? DEFAULT_OUTPUT_BASE);
    const paths = writeReport(report, outputBase);
    log(`report written: ${paths.jsonPath} / ${paths.mdPath}`);
    if (opts.json) {
        stdout(JSON.stringify(report, null, 2) + '\n');
    }
    return report;
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
    const report = await runTop6(process.argv.slice(2));
    process.exitCode = computeExitCode(report);
}

if (process.argv[1] && process.argv[1].endsWith('run-top6-verification.ts')) {
    main().catch((err) => {
        console.error('Fatal error in top6 verification runner:', err);
        process.exit(1);
    });
}
