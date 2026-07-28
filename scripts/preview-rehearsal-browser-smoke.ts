#!/usr/bin/env -S npx tsx
import { renameSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { chromium, type Browser, type Page } from "playwright";

export const EVIDENCE_SCHEMA = "trends-preview-rehearsal-browser-evidence/v1";

export interface SmokeIdentity {
  username: string;
  workspace: string;
  route: string;
  passwordEnv: string;
}

export interface RouteResult {
  username: string;
  workspace: string;
  route: string;
  finalUrl: string;
  passed: boolean;
}

export interface BrowserEvidence {
  schema: typeof EVIDENCE_SCHEMA;
  runId: string;
  targetSha: string;
  baseUrl: string;
  startedAt: string;
  completedAt: string;
  result: "passed" | "failed";
  identities: RouteResult[];
}

interface CliOptions {
  baseUrl: string;
  runId: string;
  targetSha: string;
  output: string;
}

export function parseArgs(args: string[]): CliOptions {
  const values = new Map<string, string>();
  const allowed = new Set(["--base-url", "--run-id", "--target-sha", "--output"]);
  for (let index = 0; index < args.length; index += 1) {
    const key = args[index];
    if (!key?.startsWith("--")) throw new Error(`Unknown argument: ${key ?? ""}`);
    if (!allowed.has(key)) throw new Error(`Unknown argument: ${key}`);
    if (values.has(key)) throw new Error(`Duplicate argument: ${key}`);
    const value = args[index + 1];
    if (!value || value.startsWith("--")) throw new Error(`Missing value for ${key}`);
    values.set(key, value);
    index += 1;
  }
  const baseUrl = values.get("--base-url")?.replace(/\/$/u, "") ?? "";
  const runId = values.get("--run-id") ?? "";
  const targetSha = values.get("--target-sha") ?? "";
  const output = values.get("--output") ?? "";
  if (!/^https:\/\/preview\.[A-Za-z0-9.-]+$/u.test(baseUrl)) {
    throw new Error("--base-url must be an HTTPS preview hostname");
  }
  if (!/^[0-9]{8}T[0-9]{6}Z-[a-z0-9]{6,16}$/u.test(runId)) {
    throw new Error("--run-id is invalid");
  }
  if (!/^[0-9a-f]{40}$/u.test(targetSha)) {
    throw new Error("--target-sha must be an exact 40-character commit SHA");
  }
  if (!output) throw new Error("--output is required");
  return { baseUrl, runId, targetSha, output };
}

export function assertEvidenceRedacted(evidence: BrowserEvidence): void {
  const serialized = JSON.stringify(evidence).toLowerCase();
  for (const forbidden of [
    "password",
    "cookie",
    "csrf",
    "authorization",
    "set-cookie",
    "bearer ",
  ]) {
    if (serialized.includes(forbidden)) {
      throw new Error(`Evidence contains forbidden secret material: ${forbidden}`);
    }
  }
}

export function writeEvidenceAtomic(path: string, evidence: BrowserEvidence): void {
  assertEvidenceRedacted(evidence);
  const temporary = `${path}.tmp-${process.pid}`;
  writeFileSync(temporary, `${JSON.stringify(evidence, null, 2)}\n`, { mode: 0o600 });
  renameSync(temporary, path);
}

async function fillLogin(page: Page, username: string, password: string): Promise<void> {
  const usernameInput = page.locator(
    'input[name="username"], input[autocomplete="username"], input[type="text"]',
  ).first();
  const passwordInput = page.locator(
    'input[name="password"], input[autocomplete="current-password"], input[type="password"]',
  ).first();
  await usernameInput.waitFor({ state: "visible", timeout: 20_000 });
  await usernameInput.fill(username);
  await passwordInput.fill(password);
  await page.locator('button[type="submit"], button:has-text("Login"), button:has-text("Sign in")')
    .first()
    .click();
}

async function smokeIdentity(
  browser: Browser,
  baseUrl: string,
  identity: SmokeIdentity,
): Promise<RouteResult> {
  const password = process.env[identity.passwordEnv];
  if (!password) throw new Error(`${identity.passwordEnv} is required`);
  const context = await browser.newContext({ storageState: undefined });
  try {
    const page = await context.newPage();
    const loginUrl = `${baseUrl}/login?redirectTo=${encodeURIComponent(identity.route)}`;
    await page.goto(loginUrl, { waitUntil: "domcontentloaded" });
    await fillLogin(page, identity.username, password);
    await page.waitForURL((url) => url.pathname.startsWith(identity.route), { timeout: 30_000 });
    await page.goto(`${baseUrl}${identity.route}`, { waitUntil: "networkidle" });
    const parsed = new URL(page.url());
    const finalUrl = `${parsed.origin}${parsed.pathname}`;
    const passed =
      parsed.origin === baseUrl
      && parsed.pathname.startsWith(identity.route)
      && !parsed.pathname.includes("/login");
    if (!passed) throw new Error(`Protected route verification failed for ${identity.username}`);
    return {
      username: identity.username,
      workspace: identity.workspace,
      route: identity.route,
      finalUrl,
      passed: true,
    };
  } finally {
    await context.close();
  }
}

export async function runSmoke(options: CliOptions): Promise<BrowserEvidence> {
  const identities: SmokeIdentity[] = [
    {
      username: process.env.PREVIEW_REHEARSAL_ADMIN_USERNAME || "admin",
      workspace: "dev",
      route: "/dev/resumes",
      passwordEnv: "PREVIEW_REHEARSAL_ADMIN_PASSWORD",
    },
    {
      username: process.env.PREVIEW_REHEARSAL_HR_USERNAME || "hr-demo",
      workspace: "hr",
      route: "/hr/resumes",
      passwordEnv: "PREVIEW_REHEARSAL_HR_PASSWORD",
    },
  ];
  const startedAt = new Date().toISOString();
  const browser = await chromium.launch({ headless: true });
  const results: RouteResult[] = [];
  try {
    for (const identity of identities) {
      results.push(await smokeIdentity(browser, options.baseUrl, identity));
    }
  } finally {
    await browser.close();
  }
  const evidence: BrowserEvidence = {
    schema: EVIDENCE_SCHEMA,
    runId: options.runId,
    targetSha: options.targetSha,
    baseUrl: options.baseUrl,
    startedAt,
    completedAt: new Date().toISOString(),
    result: results.every((item) => item.passed) ? "passed" : "failed",
    identities: results,
  };
  assertEvidenceRedacted(evidence);
  return evidence;
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const evidence = await runSmoke(options);
  writeEvidenceAtomic(options.output, evidence);
  if (evidence.result !== "passed") process.exitCode = 1;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  await main();
}
