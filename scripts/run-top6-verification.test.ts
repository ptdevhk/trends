import type { SpawnOptions } from "node:child_process";
import { EventEmitter } from "node:events";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
    DEFAULT_OUTPUT_BASE,
    SERVICES,
    SPAWN_COMMAND,
    SUITES,
    computeExitCode,
    loadEnvFile,
    parseCliArgs,
    parseEnvFile,
    parseSuiteNumbers,
    readCwvArtifact,
    resolveCommand,
    runTop6,
    selectSuites,
    type KillFn,
    type ProbeFn,
    type RunDeps,
    type SpawnFn,
    type SpawnedProcess,
    type SuiteDef,
} from "./run-top6-verification";

// ---------------------------------------------------------------------------
// Fakes: injected I/O only — the units under test (parser, selection, command
// resolution, service lifecycle, suite runner, report) are the real code.
// ---------------------------------------------------------------------------

class FakeChild extends EventEmitter {
    pid: number | undefined = 4242;
    stdout: NodeJS.ReadableStream | null = null;
    stderr: NodeJS.ReadableStream | null = null;
    closed = false;
    command: string;

    constructor(command: string) {
        super();
        this.command = command;
    }

    kill(_signal?: NodeJS.Signals): boolean {
        return true;
    }

    close(code: number | null, signal: NodeJS.Signals | null = null): void {
        if (this.closed) {
            return;
        }
        this.closed = true;
        this.emit("close", code, signal);
    }

    fail(err: Error): void {
        if (this.closed) {
            return;
        }
        this.closed = true;
        this.emit("error", err);
    }
}

interface Stack {
    children: FakeChild[];
    spawnedCommands: string[];
    spawnOptions: SpawnOptions[];
    kills: Array<{ pid: number; signal: NodeJS.Signals }>;
    spawnFn: SpawnFn;
    killFn: KillFn;
}

/**
 * `closeCodes` auto-closes spawned children with the given exit codes in spawn
 * order; `skipAutoClose` skips that many leading children (e.g. the dev.sh
 * spawn, which is never awaited). Children beyond the closeCodes list stay
 * open (used to exercise the timeout path).
 */
function makeStack(opts: { closeCodes?: (number | null)[]; skipAutoClose?: number } = {}): Stack {
    const { closeCodes = [], skipAutoClose = 0 } = opts;
    const children: FakeChild[] = [];
    const spawnedCommands: string[] = [];
    const spawnOptions: SpawnOptions[] = [];
    const kills: Array<{ pid: number; signal: NodeJS.Signals }> = [];
    const spawnFn: SpawnFn = (command, options) => {
        spawnedCommands.push(command);
        spawnOptions.push(options);
        const child = new FakeChild(command);
        children.push(child);
        const idx = children.length - 1;
        if (idx >= skipAutoClose) {
            const code = closeCodes[idx - skipAutoClose];
            if (code !== undefined) {
                setImmediate(() => child.close(code, null));
            }
        }
        return child;
    };
    const killFn: KillFn = (pid, signal) => {
        kills.push({ pid, signal });
    };
    return { children, spawnedCommands, spawnOptions, kills, spawnFn, killFn };
}

function makeDeps(
    stack: Stack,
    cwd: string,
    opts: { probe?: ProbeFn; suites?: SuiteDef[] } = {},
): RunDeps {
    let t = 0;
    return {
        spawn: stack.spawnFn,
        kill: stack.killFn,
        probe: opts.probe ?? (async () => ({ up: true, statusCode: 200 })),
        cwd,
        now: () => (t += 1),
        log: () => {},
        stdout: () => {},
        sleep: async () => {},
        killGraceMs: 5,
        readyTimeoutMs: 1000,
        pollIntervalMs: 5,
        suites: opts.suites,
    };
}

function tmpDir(): string {
    return mkdtempSync(join(tmpdir(), "top6-test-"));
}

// ---------------------------------------------------------------------------
// CLI parsing
// ---------------------------------------------------------------------------

describe("parseCliArgs", () => {
    it("parses default options with no flags", () => {
        expect(parseCliArgs([])).toEqual({
            headless: false,
            skipServices: false,
            only: null,
            json: false,
            output: null,
        });
    });

    it("parses each of the five flags", () => {
        const opts = parseCliArgs([
            "--headless",
            "--skip-services",
            "--json",
            "--only",
            "1,3",
            "--output",
            "custom",
        ]);
        expect(opts.headless).toBe(true);
        expect(opts.skipServices).toBe(true);
        expect(opts.json).toBe(true);
        expect(opts.only).toEqual([1, 3]);
        expect(opts.output).toBe("custom");
    });

    it("accepts whitespace inside --only values", () => {
        expect(parseCliArgs(["--only", "1, 3"]).only).toEqual([1, 3]);
    });

    it("throws on unknown flags", () => {
        expect(() => parseCliArgs(["--bogus"])).toThrow(/Unknown flag/);
    });

    it("throws when --only has no value", () => {
        expect(() => parseCliArgs(["--only"])).toThrow(/requires a value/);
    });

    it("throws when --output has no value", () => {
        expect(() => parseCliArgs(["--output"])).toThrow(/requires a path/);
    });

    it("throws on non-integer and out-of-range suite numbers", () => {
        expect(() => parseCliArgs(["--only", "abc"])).toThrow(/Invalid suite number/);
        expect(() => parseCliArgs(["--only", "0"])).toThrow(/out of range/);
        expect(() => parseCliArgs(["--only", "7"])).toThrow(/out of range/);
    });
});

describe("parseSuiteNumbers", () => {
    it("dedupes repeated numbers", () => {
        expect(parseSuiteNumbers("1,1,3")).toEqual([1, 3]);
    });

    it("throws on empty input", () => {
        expect(() => parseSuiteNumbers("")).toThrow(/at least one/);
    });

    it("throws on non-integer or out-of-range numbers", () => {
        expect(() => parseSuiteNumbers("1,x")).toThrow(/Invalid suite number/);
        expect(() => parseSuiteNumbers("6,9")).toThrow(/out of range/);
    });
});

// ---------------------------------------------------------------------------
// Suite selection / command resolution / table pins
// ---------------------------------------------------------------------------

describe("selectSuites", () => {
    it("selects all suites when --only is absent", () => {
        const { selected, skipped } = selectSuites(SUITES, null);
        expect(selected.map((s) => s.number)).toEqual([1, 2, 3, 4, 5, 6]);
        expect(skipped).toHaveLength(0);
    });

    it("preserves requested order and marks the rest skipped", () => {
        const { selected, skipped } = selectSuites(SUITES, [3, 1]);
        expect(selected.map((s) => s.number)).toEqual([3, 1]);
        expect(skipped.map((s) => s.number)).toEqual([2, 4, 5, 6]);
    });

    it("throws when a suite number is missing from the table", () => {
        expect(() => selectSuites(SUITES, [9])).toThrow(/not found/);
    });
});

describe("resolveCommand", () => {
    it("prefixes bare .ts scripts with npx tsx", () => {
        expect(resolveCommand("scripts/run-multi-role-uat.ts")).toBe(
            "npx tsx scripts/run-multi-role-uat.ts",
        );
    });

    it("prefixes .ts scripts with arguments (suite 6 form)", () => {
        expect(
            resolveCommand(
                "scripts/verify-industry-scores.ts --sample sample-job5156-detail-enriched --round-trip",
            ),
        ).toBe(
            "npx tsx scripts/verify-industry-scores.ts --sample sample-job5156-detail-enriched --round-trip",
        );
    });

    it("leaves make and npm commands verbatim", () => {
        expect(resolveCommand("make ci-local")).toBe("make ci-local");
        expect(resolveCommand("npm run test:scoring:my")).toBe("npm run test:scoring:my");
    });
});

describe("SUITES table", () => {
    it("pins the documented commands, headless support, and timeouts", () => {
        expect(SUITES.map((s) => s.number)).toEqual([1, 2, 3, 4, 5, 6]);
        expect(SUITES[0].commands).toEqual(["scripts/run-multi-role-uat.ts"]);
        expect(SUITES[0].supportsHeadless).toBe(true);
        expect(SUITES[1].commands).toEqual(["make ci-local"]);
        expect(SUITES[2].commands).toEqual([
            "npm run test:scoring:my",
            "scripts/run-my-cohort-gate.ts",
        ]);
        expect(SUITES[3].commands).toEqual(["scripts/search-data-freshness-doctor.ts"]);
        expect(SUITES[4].commands).toEqual([
            "scripts/verify-critical-path.ts",
            "scripts/resume/verify-workflow-dataset.ts",
        ]);
        expect(SUITES[5].commands).toEqual([
            "scripts/verify-industry-scores.ts --sample sample-job5156-detail-enriched --round-trip",
            "scripts/industry-review/browser-uat.ts",
        ]);
        expect(SUITES[1].timeoutMs).toBe(60 * 60 * 1000);
        for (const suite of SUITES) {
            expect(suite.timeoutMs).toBeGreaterThan(0);
        }
    });

    it("pins the service probe table, spawn command, and default report base", () => {
        expect(SERVICES).toEqual([
            { name: "convex", port: 3210, url: "http://127.0.0.1:3210/version" },
            { name: "api", port: 3000, url: "http://127.0.0.1:3000/" },
            { name: "web", port: 5173, url: "http://127.0.0.1:5173/" },
        ]);
        expect(SPAWN_COMMAND).toBe("./scripts/dev.sh --profile fast-ui");
        expect(DEFAULT_OUTPUT_BASE).toBe("output/verification/top6-verification-report");
    });
});

// ---------------------------------------------------------------------------
// Service lifecycle (probe / spawn / teardown) via runTop6 with fakes
// ---------------------------------------------------------------------------

describe("service lifecycle", () => {
    it("probe-up: no spawn, no teardown, pre-existing services untouched", async () => {
        const cwd = tmpDir();
        const stack = makeStack({ closeCodes: [0, 0] }); // suite 3 runs two commands
        const report = await runTop6(
            ["--only", "3", "--output", "report"],
            makeDeps(stack, cwd),
        );

        expect(stack.spawnedCommands).toEqual([
            "npm run test:scoring:my",
            "npx tsx scripts/run-my-cohort-gate.ts",
        ]);
        expect(stack.kills).toEqual([]);
        expect(report.services.spawned).toBe(false);
        expect(report.services.spawnCommand).toBeNull();
        expect(report.services.allUp).toBe(true);
        expect(report.services.entries.every((e) => e.up && !e.spawned)).toBe(true);
        expect(report.services.teardown.required).toBe(false);
        expect(report.services.teardown.killed).toBe(false);
        expect(report.suites.find((s) => s.number === 3)?.status).toBe("passed");
        expect(computeExitCode(report)).toBe(0);
    });

    it("probe-down: spawns dev.sh, waits for readiness, tears down only the spawned stack", async () => {
        const cwd = tmpDir();
        let firstCall = true;
        const probe: ProbeFn = async () => {
            const up = !firstCall;
            firstCall = false;
            return { up, statusCode: up ? 200 : null };
        };
        const stack = makeStack({ closeCodes: [0, 0], skipAutoClose: 1 }); // child 0 = dev.sh
        const report = await runTop6(
            ["--only", "3", "--output", "report"],
            makeDeps(stack, cwd, { probe }),
        );

        expect(stack.spawnedCommands[0]).toBe(SPAWN_COMMAND);
        expect(stack.spawnOptions[0]).toMatchObject({ cwd, shell: true });
        expect(stack.kills).toEqual([
            { pid: -4242, signal: "SIGTERM" },
            { pid: -4242, signal: "SIGKILL" },
        ]);
        expect(report.services.spawned).toBe(true);
        expect(report.services.spawnCommand).toBe(SPAWN_COMMAND);
        expect(report.services.allUp).toBe(true);
        expect(report.services.entries.every((e) => e.up && e.spawned)).toBe(true);
        expect(report.services.teardown.required).toBe(true);
        expect(report.services.teardown.killed).toBe(true);
        expect(report.suites.find((s) => s.number === 3)?.status).toBe("passed");
    });

    it("probe-down + --skip-services: no spawn, suites still run", async () => {
        const cwd = tmpDir();
        const probe: ProbeFn = async () => ({ up: false, statusCode: null });
        const stack = makeStack({ closeCodes: [0, 0] });
        const report = await runTop6(
            ["--only", "3", "--skip-services", "--output", "report"],
            makeDeps(stack, cwd, { probe }),
        );

        expect(stack.spawnedCommands).toEqual([
            "npm run test:scoring:my",
            "npx tsx scripts/run-my-cohort-gate.ts",
        ]);
        expect(stack.kills).toEqual([]);
        expect(report.services.spawned).toBe(false);
        expect(report.services.allUp).toBe(false);
        expect(report.services.teardown.required).toBe(false);
        expect(report.suites.find((s) => s.number === 3)?.status).toBe("passed");
        expect(computeExitCode(report)).toBe(0);
    });
});

// ---------------------------------------------------------------------------
// Suite execution: order, tolerance, timeout kill, headless forwarding
// ---------------------------------------------------------------------------

describe("suite execution", () => {
    it("executes suites in requested --only order and marks the rest skipped", async () => {
        const cwd = tmpDir();
        const stack = makeStack({ closeCodes: [0, 0] });
        const report = await runTop6(
            ["--only", "2,1", "--output", "report"],
            makeDeps(stack, cwd),
        );

        expect(stack.spawnedCommands).toEqual([
            "make ci-local",
            "npx tsx scripts/run-multi-role-uat.ts",
        ]);
        expect(report.suites.map((s) => s.number)).toEqual([1, 2, 3, 4, 5, 6]);
        expect(report.suites.filter((s) => s.status === "passed").map((s) => s.number)).toEqual([
            1, 2,
        ]);
        expect(report.suites.filter((s) => s.status === "skipped").map((s) => s.number)).toEqual([
            3, 4, 5, 6,
        ]);
        expect(report.overall).toEqual({
            executed: 2,
            passed: 2,
            failed: 0,
            timedOut: 0,
            skipped: 4,
            success: true,
        });
        expect(computeExitCode(report)).toBe(0);
    });

    it("a failing suite does not stop later suites and fails the run", async () => {
        const cwd = tmpDir();
        const stack = makeStack({ closeCodes: [1, 0] });
        const report = await runTop6(
            ["--only", "1,2", "--output", "report"],
            makeDeps(stack, cwd),
        );

        expect(report.suites[0]).toMatchObject({ number: 1, status: "failed", exitCode: 1 });
        expect(report.suites[0].commands[0]).toMatchObject({
            status: "failed",
            exitCode: 1,
            resolvedCommand: "npx tsx scripts/run-multi-role-uat.ts",
        });
        expect(typeof report.suites[0].durationMs).toBe("number");
        expect(report.suites[1]).toMatchObject({ number: 2, status: "passed", exitCode: 0 });
        expect(report.overall).toEqual({
            executed: 2,
            passed: 1,
            failed: 1,
            timedOut: 0,
            skipped: 4,
            success: false,
        });
        expect(computeExitCode(report)).toBe(1);
    });

    it("a timed-out suite records the kill and later suites still run", async () => {
        const cwd = tmpDir();
        const suites: SuiteDef[] = [
            { number: 1, name: "Hangs", commands: ["sleep 999"], timeoutMs: 30 },
            { number: 2, name: "After", commands: ["true"], timeoutMs: 1000 },
        ];
        const stack = makeStack({ closeCodes: [0], skipAutoClose: 1 }); // child 0 never closes
        const report = await runTop6(["--output", "report"], makeDeps(stack, cwd, { suites }));
        await new Promise((resolvePromise) => setTimeout(resolvePromise, 25)); // let SIGKILL follow-up fire

        expect(stack.kills).toEqual([
            { pid: -4242, signal: "SIGTERM" },
            { pid: -4242, signal: "SIGKILL" },
        ]);
        expect(report.suites[0]).toMatchObject({ number: 1, status: "timed-out", exitCode: null });
        expect(report.suites[0].commands[0]).toMatchObject({ status: "timed-out", exitCode: null });
        expect(report.suites[1]).toMatchObject({ number: 2, status: "passed", exitCode: 0 });
        expect(report.overall).toEqual({
            executed: 2,
            passed: 1,
            failed: 0,
            timedOut: 1,
            skipped: 0,
            success: false,
        });
        expect(computeExitCode(report)).toBe(1);
    });

    it("--headless is forwarded only to suite 1", async () => {
        const cwd = tmpDir();
        const stack = makeStack({ closeCodes: [0, 0, 0] }); // suite 1 (1 cmd) + suite 3 (2 cmds)
        await runTop6(
            ["--only", "1,3", "--headless", "--output", "report"],
            makeDeps(stack, cwd),
        );

        expect(stack.spawnedCommands[0]).toBe("npx tsx scripts/run-multi-role-uat.ts --headless");
        expect(stack.spawnedCommands.slice(1)).toEqual([
            "npm run test:scoring:my",
            "npx tsx scripts/run-my-cohort-gate.ts",
        ]);
    });
});

// ---------------------------------------------------------------------------
// Report emission: shape, --json stdout dump, --output redirect
// ---------------------------------------------------------------------------

describe("report emission", () => {
    it("writes JSON + Markdown artifacts and --json dumps the raw report to stdout", async () => {
        const cwd = tmpDir();
        const stack = makeStack({ closeCodes: [0] });
        const chunks: string[] = [];
        const deps = makeDeps(stack, cwd);
        deps.stdout = (chunk) => {
            chunks.push(chunk);
        };
        const report = await runTop6(["--only", "1", "--json", "--output", "report"], deps);

        expect(chunks.length).toBeGreaterThan(0);
        expect(JSON.parse(chunks.join(""))).toEqual(report);

        const jsonPath = join(cwd, "report.json");
        const mdPath = join(cwd, "report.md");
        expect(existsSync(jsonPath)).toBe(true);
        expect(existsSync(mdPath)).toBe(true);
        expect(JSON.parse(readFileSync(jsonPath, "utf-8"))).toEqual(report);

        const md = readFileSync(mdPath, "utf-8");
        expect(md).toContain("# Top 6 Verification & Orchestration Report");
        expect(md).toContain("Suite 1");
        expect(md).toContain("**Result: SUCCESS**");

        // Report shape: per-suite status/exitCode/durationMs + services + overall.
        expect(report.schema).toBe("top6-verification-report");
        expect(typeof report.timestamp).toBe("string");
        expect(typeof report.startedAt).toBe("string");
        expect(typeof report.finishedAt).toBe("string");
        expect(typeof report.durationMs).toBe("number");
        expect(report.suites).toHaveLength(6);
        expect(report.suites[0]).toMatchObject({
            number: 1,
            status: "passed",
            exitCode: 0,
        });
        expect(typeof report.suites[0].durationMs).toBe("number");
        expect(report.suites[0].commands).toHaveLength(1);
        expect(report.services.entries).toHaveLength(3);
        expect(report.overall).toHaveProperty("success");
        // Suite 1 ran, but the tmp cwd has no suite-1 artifact.
        expect(report.coreWebVitals).toBeNull();
    });

    it("honors --output for both artifacts, including nested directories", async () => {
        const cwd = tmpDir();
        const stack = makeStack({ closeCodes: [0] });
        const report = await runTop6(
            ["--only", "1", "--output", join(cwd, "nested", "custom")],
            makeDeps(stack, cwd),
        );

        const jsonPath = join(cwd, "nested", "custom.json");
        const mdPath = join(cwd, "nested", "custom.md");
        expect(existsSync(jsonPath)).toBe(true);
        expect(existsSync(mdPath)).toBe(true);
        expect(JSON.parse(readFileSync(jsonPath, "utf-8"))).toEqual(report);
    });
});

// ---------------------------------------------------------------------------
// Env loading
// ---------------------------------------------------------------------------

describe("env file handling", () => {
    it("parses comments, export prefixes, quotes, and skips junk lines", () => {
        const env = parseEnvFile(
            [
                "# comment",
                "export FOO=bar",
                'BAZ="quoted value"',
                "QUX='single'",
                "EMPTY=",
                "NOEQUALS",
                "export SPACED = x",
            ].join("\n"),
        );
        expect(env).toEqual({
            FOO: "bar",
            BAZ: "quoted value",
            QUX: "single",
            EMPTY: "",
            SPACED: "x",
        });
    });

    it("loadEnvFile returns {} when .env is missing", () => {
        expect(loadEnvFile(tmpDir())).toEqual({});
    });

    it("loadEnvFile reads an existing .env", () => {
        const cwd = tmpDir();
        writeFileSync(join(cwd, ".env"), 'export A=1\nB="two"\n', "utf-8");
        expect(loadEnvFile(cwd)).toEqual({ A: "1", B: "two" });
    });
});

// ---------------------------------------------------------------------------
// Core Web Vitals fold-in from suite 1's artifact
// ---------------------------------------------------------------------------

describe("readCwvArtifact", () => {
    it("extracts per-role CWV and rounded averages from the suite-1 artifact", () => {
        const cwd = tmpDir();
        const artifact = join(cwd, "output", "uat");
        mkdirSync(artifact, { recursive: true });
        writeFileSync(
            join(artifact, "multi-role-uat-report.json"),
            JSON.stringify({
                details: [
                    { role: "hr-demo", cwv: { ttfb: 100, lcp: 500, cls: 0.05, fcp: 300 } },
                    { role: "uat-reviewer", cwv: { ttfb: 200, lcp: 700, cls: 0.15, fcp: 400 } },
                    { role: "no-cwv" },
                ],
            }),
            "utf-8",
        );

        const summary = readCwvArtifact(cwd);
        expect(summary).not.toBeNull();
        expect(summary!.roles).toEqual([
            { role: "hr-demo", ttfb: 100, lcp: 500, cls: 0.05, fcp: 300 },
            { role: "uat-reviewer", ttfb: 200, lcp: 700, cls: 0.15, fcp: 400 },
            { role: "no-cwv", ttfb: null, lcp: null, cls: null, fcp: null },
        ]);
        expect(summary!.averages).toEqual({ ttfb: 150, lcp: 600, cls: 0.1, fcp: 350 });
        expect(summary!.source).toBe(join(cwd, "output/uat/multi-role-uat-report.json"));
    });

    it("returns null when the artifact is missing, malformed, or not an array", () => {
        expect(readCwvArtifact(tmpDir())).toBeNull();

        const cwd = tmpDir();
        const artifact = join(cwd, "output", "uat");
        mkdirSync(artifact, { recursive: true });
        writeFileSync(join(artifact, "multi-role-uat-report.json"), "not json", "utf-8");
        expect(readCwvArtifact(cwd)).toBeNull();

        writeFileSync(
            join(artifact, "multi-role-uat-report.json"),
            JSON.stringify({ details: "nope" }),
            "utf-8",
        );
        expect(readCwvArtifact(cwd)).toBeNull();
    });
});
