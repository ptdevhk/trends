import { describe, expect, it } from "vitest";
import {
  parseCliArgs,
  runFullScan,
  redactSecrets,
  extractJsonFromConvexOutput,
  buildConvexRunCommandArgs,
  validateProjectionResponsePage,
  resolveAppVersion,
  readTargetSelectorsFromEnvFile,
  validateRoleAndTarget,
  EXIT_OK,
  EXIT_CONFIG_OR_INVOCATION_ERROR,
  EXIT_STALE_ROWS_DETECTED,
  EXIT_INCOMPLETE_SCAN,
  EVIDENCE_SCHEMA,
  type CommandExecutor,
  type FullScanCliOptions,
  type TargetRole,
} from "./verify-company-key-projection-full-scan.js";
import { CURRENT_COMPANY_KEY_PROJECTION_EPOCH } from "@trends/shared";
import { writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

describe("resolveAppVersion", () => {
  it("fails closed when repository version metadata is unavailable", () => {
    expect(() => resolveAppVersion("/path/that/does/not/exist")).toThrow(/application version/i);
  });
});

describe("verify-company-key-projection-full-scan CLI parsing", () => {
  it("requires --target-role option", () => {
    expect(() => parseCliArgs([])).toThrow(/--target-role.*required/i);
    expect(() => parseCliArgs(["--target-role", "invalid"])).toThrow(/invalid.*target-role/i);
  });

  it("parses valid target roles and defaults", () => {
    const localOpts = parseCliArgs(["--target-role", "local"]);
    expect(localOpts.targetRole).toBe("local");
    expect(localOpts.limit).toBe(200);
    expect(localOpts.maxPages).toBe(100);
    expect(localOpts.pageSize).toBe(200);
    expect(localOpts.allowProduction).toBe(false);
    expect(localOpts.json).toBe(false);

    const previewOpts = parseCliArgs([
      "--target-role", "preview",
      "--convex-url", "http://127.0.0.1:4210",
    ]);
    expect(previewOpts.targetRole).toBe("preview");

    const prodOpts = parseCliArgs([
      "--target-role", "production",
      "--allow-production",
      "--convex-url", "http://127.0.0.1:3210",
    ]);
    expect(prodOpts.targetRole).toBe("production");
    expect(prodOpts.allowProduction).toBe(true);
  });

  it("parses CLI flags correctly", () => {
    const opts = parseCliArgs([
      "--target-role", "local",
      "--limit", "500",
      "--max-pages", "50",
      "--convex-url", "http://127.0.0.1:3210",
      "--deployment", "dev:test",
      "--env-file", ".env.local",
      "--repo-root", "/tmp/repo",
      "--json",
    ]);

    expect(opts.targetRole).toBe("local");
    expect(opts.limit).toBe(500);
    expect(opts.maxPages).toBe(50);
    expect(opts.convexUrl).toBe("http://127.0.0.1:3210");
    expect(opts.deployment).toBe("dev:test");
    expect(opts.envFile).toBe(".env.local");
    expect(opts.repoRoot).toBe("/tmp/repo");
    expect(opts.allowProduction).toBe(false);
    expect(opts.json).toBe(true);
  });

  it("rejects unknown flags and invalid numeric values", () => {
    expect(() => parseCliArgs(["--target-role", "local", "--unknown-flag"])).toThrow(/Unknown option/);
    expect(() => parseCliArgs(["--target-role", "local", "--limit", "invalid"])).toThrow(/Invalid --limit/);
    expect(() => parseCliArgs(["--target-role", "local", "--limit", "0"])).toThrow(/Invalid --limit/);
    expect(() => parseCliArgs(["--target-role", "local", "--max-pages", "-1"])).toThrow(/Invalid --max-pages/);
  });

  it("rejects remote roles without an explicit target selector", () => {
    expect(() => parseCliArgs(["--target-role", "preview"])).toThrow(/explicit.*target selector/i);
    expect(() => parseCliArgs(["--target-role", "production", "--allow-production"])).toThrow(/explicit.*target selector/i);
    expect(() => parseCliArgs(["--target-role", "preview", "--convex-url", "http://127.0.0.1:4210"])).not.toThrow();
    expect(() => parseCliArgs(["--target-role", "production", "--allow-production", "--convex-url", "http://127.0.0.1:3210"])).not.toThrow();
  });

  it("rejects --allow-production when target-role is not production", () => {
    expect(() => parseCliArgs(["--target-role", "local", "--allow-production"])).toThrow(/--allow-production can only be used with --target-role production/i);
    expect(() => parseCliArgs(["--target-role", "preview", "--allow-production"])).toThrow(/--allow-production can only be used with --target-role production/i);
  });
});

describe("Role and Target URL / Deployment reconciliation (Requirement 3)", () => {
  it("local role accepts loopback :3210 and rejects remote prod/preview endpoints", () => {
    expect(() => validateRoleAndTarget("local", "http://127.0.0.1:3210", undefined, false)).not.toThrow();
    expect(() => validateRoleAndTarget("local", "http://localhost:3210", undefined, false)).not.toThrow();

    expect(() => validateRoleAndTarget("local", "https://trends.pt-mes.com", undefined, false)).toThrow(/local role cannot target production URL/i);
    expect(() => validateRoleAndTarget("local", "https://preview.pt-mes.com", undefined, false)).toThrow(/local role cannot target preview URL/i);
    expect(() => validateRoleAndTarget("local", undefined, "prod", false)).toThrow(/local role cannot target production deployment/i);
    expect(() => validateRoleAndTarget("local", undefined, "preview", false)).toThrow(/local role cannot target preview deployment/i);
  });

  it("preview role rejects port 3210 and known prod hosts, but accepts port 4210 or preview host", () => {
    expect(() => validateRoleAndTarget("preview", "http://127.0.0.1:3210", undefined, false)).toThrow(/preview role cannot target port 3210/i);
    expect(() => validateRoleAndTarget("preview", "https://trends.pt-mes.com", undefined, false)).toThrow(/preview role cannot target production URL/i);
    expect(() => validateRoleAndTarget("preview", "https://prod.pt-mes.com", undefined, false)).toThrow(/preview role cannot target production URL/i);
    expect(() => validateRoleAndTarget("preview", undefined, "prod", false)).toThrow(/preview role cannot target production deployment/i);

    expect(() => validateRoleAndTarget("preview", "http://127.0.0.1:4210", undefined, false)).not.toThrow();
    expect(() => validateRoleAndTarget("preview", "https://preview.pt-mes.com", undefined, false)).not.toThrow();
    expect(() => validateRoleAndTarget("preview", undefined, "preview", false)).not.toThrow();
  });

  it("production role rejects preview URLs/port 4210, and requires both role=production and allowProduction=true", () => {
    expect(() => validateRoleAndTarget("production", "https://trends.pt-mes.com", undefined, false)).toThrow(/production role requires --allow-production/i);
    expect(() => validateRoleAndTarget("production", "https://preview.pt-mes.com", undefined, true)).toThrow(/production role cannot target preview URL/i);
    expect(() => validateRoleAndTarget("production", "http://127.0.0.1:4210", undefined, true)).toThrow(/production role cannot target port 4210/i);
    expect(() => validateRoleAndTarget("production", undefined, "preview", true)).toThrow(/production role cannot target preview deployment/i);

    expect(() => validateRoleAndTarget("production", "https://trends.pt-mes.com", undefined, true)).not.toThrow();
  });

  it("safely extracts only target-selector keys from env file without evaluating arbitrary env", () => {
    const tempDir = mkdtempSync(join(tmpdir(), "env-test-"));
    const envPath = join(tempDir, ".env.test");
    writeFileSync(
      envPath,
      [
        "# Comment line",
        "SOME_SECRET=super_secret_val",
        'CONVEX_URL="http://127.0.0.1:4210"',
        "CONVEX_DEPLOYMENT=anonymous:test-deploy",
        "OTHER_VAR=something_else",
      ].join("\n"),
    );

    try {
      const selectors = readTargetSelectorsFromEnvFile(envPath);
      expect(selectors.convexUrl).toBe("http://127.0.0.1:4210");
      expect(selectors.deployment).toBe("anonymous:test-deploy");
      expect((selectors as any).SOME_SECRET).toBeUndefined();
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });
});

describe("Command construction & argument isolation (Requirement 4)", () => {
  it("builds argv array without shell interpolation, calling resumes:fieldCoverage with batchSize", () => {
    const cmd = buildConvexRunCommandArgs({
      functionName: "resumes:fieldCoverage",
      args: { batchSize: 100, cursor: "curs_1" },
      options: {
        targetRole: "local",
        limit: 100,
        maxPages: 10,
        pageSize: 100,
        convexUrl: "http://127.0.0.1:3210",
        deployment: "local",
        envFile: ".env.local",
        allowProduction: false,
        json: false,
      },
    });

    expect(cmd.file).toBe("npx");
    expect(cmd.args).toContain("convex");
    expect(cmd.args).toContain("run");
    expect(cmd.args).toContain("resumes:fieldCoverage");

    // Check JSON payload argument
    const jsonArg = cmd.args[cmd.args.indexOf("resumes:fieldCoverage") + 1];
    const parsed = JSON.parse(jsonArg);
    expect(parsed.batchSize).toBe(100);
    expect(parsed.cursor).toBe("curs_1");

    expect(cmd.args).toContain("--url");
    expect(cmd.args[cmd.args.indexOf("--url") + 1]).toBe("http://127.0.0.1:3210");
    expect(cmd.args).toContain("--deployment");
    expect(cmd.args[cmd.args.indexOf("--deployment") + 1]).toBe("local");
    expect(cmd.args).toContain("--env-file");
    expect(cmd.args[cmd.args.indexOf("--env-file") + 1]).toBe(".env.local");
  });

  it("preserves malicious URL/env/deployment values as single argv tokens without shell splitting", () => {
    const maliciousUrl = "http://127.0.0.1:3210; rm -rf / && echo pwned";
    const maliciousDeployment = 'my-deploy" | cat /etc/shadow #';
    const maliciousEnv = ".env.test; touch /tmp/pwned";

    const cmd = buildConvexRunCommandArgs({
      functionName: "resumes:fieldCoverage",
      args: { batchSize: 10 },
      options: {
        targetRole: "local",
        limit: 10,
        maxPages: 5,
        pageSize: 10,
        convexUrl: maliciousUrl,
        deployment: maliciousDeployment,
        envFile: maliciousEnv,
        allowProduction: false,
        json: false,
      },
    });

    // Check that each malicious token is a single element in the argv array
    const urlIdx = cmd.args.indexOf("--url");
    expect(cmd.args[urlIdx + 1]).toBe(maliciousUrl);

    const depIdx = cmd.args.indexOf("--deployment");
    expect(cmd.args[depIdx + 1]).toBe(maliciousDeployment);

    const envIdx = cmd.args.indexOf("--env-file");
    expect(cmd.args[envIdx + 1]).toBe(maliciousEnv);
  });
});

describe("extractJsonFromConvexOutput (Requirement 5)", () => {
  it("extracts single JSON object with prelude and trailing text", () => {
    const output = `
Downloading Convex backend binary
[INFO] Compilation succeeded in 42ms
{
  "dryRun": true,
  "scheduled": 0,
  "batches": 0,
  "currentEpoch": 2,
  "hasMore": false,
  "cursor": null,
  "scannedRows": 10,
  "staleCount": 0
}
Execution completed with status OK.
`;
    const parsed = extractJsonFromConvexOutput(output);
    expect(parsed).toEqual({
      dryRun: true,
      scheduled: 0,
      batches: 0,
      currentEpoch: 2,
      hasMore: false,
      cursor: null,
      scannedRows: 10,
      staleCount: 0,
    });
  });

  it("handles nested multiline JSON correctly", () => {
    const output = `
{
  "dryRun": true,
  "scheduled": 0,
  "batches": 0,
  "currentEpoch": 2,
  "hasMore": false,
  "cursor": null,
  "scannedRows": 10,
  "staleCount": 0,
  "nested": {
    "key": "value",
    "array": [1, 2, { "sub": true }]
  }
}
`;
    const parsed = extractJsonFromConvexOutput(output);
    expect(parsed.nested.array[2].sub).toBe(true);
  });

  it("handles string containing braces and escaped quotes", () => {
    const output = `
{
  "dryRun": true,
  "scheduled": 0,
  "batches": 0,
  "currentEpoch": 2,
  "hasMore": false,
  "cursor": null,
  "scannedRows": 10,
  "staleCount": 0,
  "message": "Curly braces { inside a string } and \\"quotes\\""
}
`;
    const parsed = extractJsonFromConvexOutput(output);
    expect(parsed.message).toBe('Curly braces { inside a string } and "quotes"');
  });

  it("rejects output with no JSON", () => {
    expect(() => extractJsonFromConvexOutput("Only plain text logs here")).toThrow(/Could not find valid JSON/i);
  });

  it("rejects malformed/incomplete JSON", () => {
    expect(() => extractJsonFromConvexOutput('{ "dryRun": true, "unclosed": ')).toThrow(/Could not find valid JSON/i);
  });

  it("rejects ambiguous output with multiple top-level JSON objects", () => {
    const output = `
{ "dryRun": true, "first": 1 }
Some intermediate logs
{ "dryRun": true, "second": 2 }
`;
    expect(() => extractJsonFromConvexOutput(output)).toThrow(/ambiguous output: multiple top-level JSON values detected/i);
  });
});

describe("Response schema strict validation (Requirement 1)", () => {
  const validPage = {
    scanned: 10,
    currentCompanyKeyProjectionEpoch: 2,
    missingCompanyKeyProjection: 0,
    laggingCompanyKeyProjection: 0,
    hasMore: false,
    cursor: null,
  };

  it("accepts a strictly valid response page", () => {
    expect(() => validateProjectionResponsePage(validPage, null)).not.toThrow();
  });

  it("rejects non-integer, negative, or missing scanned, missingCompanyKeyProjection, or laggingCompanyKeyProjection", () => {
    expect(() => validateProjectionResponsePage({ ...validPage, scanned: -1 }, null)).toThrow(/scanned must be a non-negative integer/i);
    expect(() => validateProjectionResponsePage({ ...validPage, scanned: 1.5 }, null)).toThrow(/scanned must be a non-negative integer/i);
    expect(() => validateProjectionResponsePage({ ...validPage, scanned: undefined }, null)).toThrow(/scanned must be a non-negative integer/i);

    expect(() => validateProjectionResponsePage({ ...validPage, missingCompanyKeyProjection: -1 }, null)).toThrow(/missingCompanyKeyProjection must be a non-negative integer/i);
    expect(() => validateProjectionResponsePage({ ...validPage, missingCompanyKeyProjection: "0" }, null)).toThrow(/missingCompanyKeyProjection must be a non-negative integer/i);
    expect(() => validateProjectionResponsePage({ ...validPage, missingCompanyKeyProjection: undefined }, null)).toThrow(/missingCompanyKeyProjection must be a non-negative integer/i);

    expect(() => validateProjectionResponsePage({ ...validPage, laggingCompanyKeyProjection: -1 }, null)).toThrow(/laggingCompanyKeyProjection must be a non-negative integer/i);
    expect(() => validateProjectionResponsePage({ ...validPage, laggingCompanyKeyProjection: undefined }, null)).toThrow(/laggingCompanyKeyProjection must be a non-negative integer/i);
  });

  it("requires finite currentCompanyKeyProjectionEpoch and enforces consistency across pages", () => {
    expect(() => validateProjectionResponsePage({ ...validPage, currentCompanyKeyProjectionEpoch: undefined }, null)).toThrow(/currentCompanyKeyProjectionEpoch must be a finite integer/i);
    expect(() => validateProjectionResponsePage({ ...validPage, currentCompanyKeyProjectionEpoch: 2 }, 2)).not.toThrow();
    expect(() => validateProjectionResponsePage({ ...validPage, currentCompanyKeyProjectionEpoch: 3 }, 2)).toThrow(/inconsistent currentCompanyKeyProjectionEpoch across pages/i);
  });

  it("enforces cursor semantics for hasMore=true vs hasMore=false", () => {
    // hasMore=true requires non-empty string cursor
    expect(() => validateProjectionResponsePage({ ...validPage, hasMore: true, cursor: null }, null)).toThrow(/cursor must be a non-empty string when hasMore is true/i);
    expect(() => validateProjectionResponsePage({ ...validPage, hasMore: true, cursor: "" }, null)).toThrow(/cursor must be a non-empty string when hasMore is true/i);
    expect(() => validateProjectionResponsePage({ ...validPage, hasMore: true, cursor: "cursor_1" }, null)).not.toThrow();

    // hasMore=false requires null or undefined cursor
    expect(() => validateProjectionResponsePage({ ...validPage, hasMore: false, cursor: "stray_cursor" }, null)).toThrow(/cursor must be null or absent when hasMore is false/i);
    expect(() => validateProjectionResponsePage({ ...validPage, hasMore: false, cursor: null }, null)).not.toThrow();
  });
});

describe("Cursor safety & progression (Requirement 2)", () => {
  it("proves null cursor cannot restart page 1 when hasMore=true", async () => {
    const mockExecutor: CommandExecutor = async () => ({
      exitCode: 0,
      stdout: JSON.stringify({
        scanned: 10,
        currentCompanyKeyProjectionEpoch: CURRENT_COMPANY_KEY_PROJECTION_EPOCH,
        missingCompanyKeyProjection: 0,
        laggingCompanyKeyProjection: 0,
        hasMore: true,
        cursor: null, // invalid: hasMore=true with null cursor
      }),
      stderr: "",
    });

    const result = await runFullScan({
      options: { targetRole: "local", limit: 100, maxPages: 10, pageSize: 100, allowProduction: false, json: false },
      executor: mockExecutor,
    });

    expect(result.exitCode).toBe(EXIT_CONFIG_OR_INVOCATION_ERROR);
    expect(result.evidence.status).toBe("error");
    expect(result.evidence.summary.pages).toBe(1);
    expect(result.evidence.summary.scanComplete).toBe(false);
    expect(result.evidence.errors?.[0]).toMatch(/cursor must be a non-empty string when hasMore is true/i);
  });

  it("detects cursor cycles and exits with EXIT_INCOMPLETE_SCAN (exit 3)", async () => {
    const mockExecutor: CommandExecutor = async () => ({
      exitCode: 0,
      stdout: JSON.stringify({
        scanned: 10,
        currentCompanyKeyProjectionEpoch: CURRENT_COMPANY_KEY_PROJECTION_EPOCH,
        missingCompanyKeyProjection: 0,
        laggingCompanyKeyProjection: 0,
        hasMore: true,
        cursor: "cycle_cursor_A",
      }),
      stderr: "",
    });

    const result = await runFullScan({
      options: { targetRole: "local", limit: 100, maxPages: 10, pageSize: 10, allowProduction: false, json: false },
      executor: mockExecutor,
    });

    expect(result.exitCode).toBe(EXIT_INCOMPLETE_SCAN);
    expect(result.evidence.summary.scanComplete).toBe(false);
    expect(result.evidence.status).toBe("incomplete_scan");
    expect(result.evidence.errors?.[0]).toMatch(/cycle|repeating/i);
  });

  it("detects no progress (zero scanned rows with hasMore=true) and exits with EXIT_INCOMPLETE_SCAN", async () => {
    const mockExecutor: CommandExecutor = async () => ({
      exitCode: 0,
      stdout: JSON.stringify({
        scanned: 0,
        currentCompanyKeyProjectionEpoch: CURRENT_COMPANY_KEY_PROJECTION_EPOCH,
        missingCompanyKeyProjection: 0,
        laggingCompanyKeyProjection: 0,
        hasMore: true,
        cursor: "cursor_stuck",
      }),
      stderr: "",
    });

    const result = await runFullScan({
      options: { targetRole: "local", limit: 100, maxPages: 10, pageSize: 10, allowProduction: false, json: false },
      executor: mockExecutor,
    });

    expect(result.exitCode).toBe(EXIT_INCOMPLETE_SCAN);
    expect(result.evidence.summary.scanComplete).toBe(false);
    expect(result.evidence.status).toBe("incomplete_scan");
    expect(result.evidence.errors?.[0]).toMatch(/no progress/i);
  });

  it("detects page cap reached when hasMore=true and exits with EXIT_INCOMPLETE_SCAN", async () => {
    let callIndex = 0;
    const mockExecutor: CommandExecutor = async () => {
      callIndex++;
      return {
        exitCode: 0,
        stdout: JSON.stringify({
          scanned: 10,
          currentCompanyKeyProjectionEpoch: CURRENT_COMPANY_KEY_PROJECTION_EPOCH,
          missingCompanyKeyProjection: 0,
          laggingCompanyKeyProjection: 0,
          hasMore: true,
          cursor: `cursor_page_${callIndex}`,
        }),
        stderr: "",
      };
    };

    const result = await runFullScan({
      options: { targetRole: "local", limit: 10, maxPages: 2, pageSize: 10, allowProduction: false, json: false },
      executor: mockExecutor,
    });

    expect(result.exitCode).toBe(EXIT_INCOMPLETE_SCAN);
    expect(result.evidence.summary.pages).toBe(2);
    expect(result.evidence.summary.scanComplete).toBe(false);
    expect(result.evidence.errors?.[0]).toMatch(/page cap/i);
  });
});

describe("runFullScan execution & evidence contracts (Requirements 1, 6, 7)", () => {
  it("fails closed when inherited and env-file selectors conflict", async () => {
    const dir = mkdtempSync(join(tmpdir(), "projection-env-conflict-"));
    const envFile = join(dir, "preview.env");
    writeFileSync(envFile, "CONVEX_URL=http://127.0.0.1:3210\n", { mode: 0o600 });
    const originalUrl = process.env.CONVEX_URL;
    process.env.CONVEX_URL = "http://127.0.0.1:4210";
    try {
      const result = await runFullScan({
        options: {
          targetRole: "preview",
          limit: 100,
          maxPages: 10,
          pageSize: 100,
          envFile,
          allowProduction: false,
          json: true,
        },
        executor: async () => {
          throw new Error("executor must not run when target selectors conflict");
        },
      });
      expect(result.exitCode).toBe(EXIT_CONFIG_OR_INVOCATION_ERROR);
      expect(result.evidence.errors?.join(" ")).toMatch(/conflicting.*CONVEX_URL/i);
    } finally {
      if (originalUrl === undefined) delete process.env.CONVEX_URL;
      else process.env.CONVEX_URL = originalUrl;
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("invokes query resumes:fieldCoverage with read-only arguments", async () => {
    const executedCalls: any[] = [];
    const mockExecutor: CommandExecutor = async (cmd) => {
      executedCalls.push(cmd);
      return {
        exitCode: 0,
        stdout: JSON.stringify({
          scanned: 10,
          currentCompanyKeyProjectionEpoch: CURRENT_COMPANY_KEY_PROJECTION_EPOCH,
          missingCompanyKeyProjection: 0,
          laggingCompanyKeyProjection: 0,
          hasMore: false,
          cursor: null,
        }),
        stderr: "",
      };
    };

    const result = await runFullScan({
      options: { targetRole: "local", limit: 100, maxPages: 10, pageSize: 100, allowProduction: false, json: false },
      executor: mockExecutor,
    });

    expect(result.exitCode).toBe(EXIT_OK);
    expect(executedCalls.length).toBe(1);
    expect(executedCalls[0].functionName).toBe("resumes:fieldCoverage");
    expect(executedCalls[0].args.batchSize).toBe(100);
  });

  it("chains cursors across multiple pages and aggregates scannedRows, staleCount, pages", async () => {
    const pages = [
      {
        scanned: 100,
        currentCompanyKeyProjectionEpoch: CURRENT_COMPANY_KEY_PROJECTION_EPOCH,
        missingCompanyKeyProjection: 0,
        laggingCompanyKeyProjection: 0,
        hasMore: true,
        cursor: "cursor_page_1",
      },
      {
        scanned: 100,
        currentCompanyKeyProjectionEpoch: CURRENT_COMPANY_KEY_PROJECTION_EPOCH,
        missingCompanyKeyProjection: 0,
        laggingCompanyKeyProjection: 0,
        hasMore: true,
        cursor: "cursor_page_2",
      },
      {
        scanned: 42,
        currentCompanyKeyProjectionEpoch: CURRENT_COMPANY_KEY_PROJECTION_EPOCH,
        missingCompanyKeyProjection: 0,
        laggingCompanyKeyProjection: 0,
        hasMore: false,
        cursor: null,
      },
    ];

    let callIndex = 0;
    const mockExecutor: CommandExecutor = async () => {
      const page = pages[callIndex++];
      return {
        exitCode: 0,
        stdout: JSON.stringify(page),
        stderr: "",
      };
    };

    const result = await runFullScan({
      options: { targetRole: "local", limit: 100, maxPages: 10, pageSize: 100, allowProduction: false, json: false },
      executor: mockExecutor,
    });

    expect(result.exitCode).toBe(EXIT_OK);
    expect(result.evidence.summary.pages).toBe(3);
    expect(result.evidence.summary.scannedRows).toBe(242);
    expect(result.evidence.summary.staleCount).toBe(0);
    expect(result.evidence.summary.missingCount).toBe(0);
    expect(result.evidence.summary.laggingCount).toBe(0);
    expect(result.evidence.summary.scanComplete).toBe(true);
    expect(result.evidence.status).toBe("clean");
    expect(result.evidence.targetEpoch).toBe(CURRENT_COMPANY_KEY_PROJECTION_EPOCH);
    expect(result.evidence.currentEpoch).toBe(CURRENT_COMPANY_KEY_PROJECTION_EPOCH);
    expect(result.evidence.targetRole).toBe("local");
    expect(result.evidence.schema).toBe(EVIDENCE_SCHEMA);
    expect(result.evidence.schemaVersion).toBe("v1");
    expect(result.evidence.appVersion).toBe(resolveAppVersion());
  });

  it("exits with EXIT_STALE_ROWS_DETECTED (exit 2) when scan finishes with missing or lagging projections", async () => {
    const mockExecutor: CommandExecutor = async () => ({
      exitCode: 0,
      stdout: JSON.stringify({
        scanned: 50,
        currentCompanyKeyProjectionEpoch: CURRENT_COMPANY_KEY_PROJECTION_EPOCH,
        missingCompanyKeyProjection: 2,
        laggingCompanyKeyProjection: 1,
        hasMore: false,
        cursor: null,
      }),
      stderr: "",
    });

    const result = await runFullScan({
      options: { targetRole: "local", limit: 100, maxPages: 10, pageSize: 100, allowProduction: false, json: false },
      executor: mockExecutor,
    });

    expect(result.exitCode).toBe(EXIT_STALE_ROWS_DETECTED);
    expect(result.evidence.summary.staleCount).toBe(3);
    expect(result.evidence.summary.missingCount).toBe(2);
    expect(result.evidence.summary.laggingCount).toBe(1);
    expect(result.evidence.summary.scanComplete).toBe(true);
    expect(result.evidence.status).toBe("stale_detected");
  });

  it("fails with EXIT_STALE_ROWS_DETECTED if currentEpoch returned by backend is mismatched with targetEpoch even if staleCount is 0", async () => {
    const mockExecutor: CommandExecutor = async () => ({
      exitCode: 0,
      stdout: JSON.stringify({
        scanned: 10,
        currentCompanyKeyProjectionEpoch: CURRENT_COMPANY_KEY_PROJECTION_EPOCH - 1,
        missingCompanyKeyProjection: 0,
        laggingCompanyKeyProjection: 0,
        hasMore: false,
        cursor: null,
      }),
      stderr: "",
    });

    const result = await runFullScan({
      options: { targetRole: "local", limit: 100, maxPages: 10, pageSize: 100, allowProduction: false, json: false },
      executor: mockExecutor,
    });

    expect(result.exitCode).toBe(EXIT_STALE_ROWS_DETECTED);
    expect(result.evidence.status).toBe("stale_detected");
    expect(result.evidence.currentEpoch).toBe(CURRENT_COMPANY_KEY_PROJECTION_EPOCH - 1);
    expect(result.evidence.errors?.[0]).toMatch(/epoch mismatch/i);
  });

  it("does not mutate caller secretValues array (Requirement 7)", async () => {
    const callerSecrets = ["caller-secret-token"];
    const originalLength = callerSecrets.length;

    const mockExecutor: CommandExecutor = async () => ({
      exitCode: 0,
      stdout: JSON.stringify({
        scanned: 5,
        currentCompanyKeyProjectionEpoch: CURRENT_COMPANY_KEY_PROJECTION_EPOCH,
        missingCompanyKeyProjection: 0,
        laggingCompanyKeyProjection: 0,
        hasMore: false,
        cursor: null,
      }),
      stderr: "",
    });

    await runFullScan({
      options: { targetRole: "local", limit: 10, maxPages: 5, pageSize: 10, allowProduction: false, json: false },
      executor: mockExecutor,
      secretValues: callerSecrets,
    });

    expect(callerSecrets.length).toBe(originalLength);
    expect(callerSecrets).toEqual(["caller-secret-token"]);
  });

  it("redacts known keys and secret tokens from errors and evidence (Requirement 4, 7)", async () => {
    const secret = "top-secret-val-98765";
    const mockExecutor: CommandExecutor = async () => ({
      exitCode: 1,
      stdout: "",
      stderr: `Fatal: connection rejected for CONVEX_WRITE_SECRET=${secret}`,
    });

    const result = await runFullScan({
      options: { targetRole: "local", limit: 100, maxPages: 10, pageSize: 100, allowProduction: false, json: false },
      executor: mockExecutor,
      secretValues: [secret],
    });

    expect(result.exitCode).toBe(EXIT_CONFIG_OR_INVOCATION_ERROR);
    const jsonOut = JSON.stringify(result.evidence);
    expect(jsonOut).not.toContain(secret);
    expect(jsonOut).toContain("[REDACTED]");
  });
});
