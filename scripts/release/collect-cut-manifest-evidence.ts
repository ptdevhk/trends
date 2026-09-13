#!/usr/bin/env npx tsx
/**
 * Read-only local release-evidence collector for the production cut manifest.
 *
 * Collects the evidence sections defined by
 * `wiki/projects/trends/work/2026-06-18-prod-unpin-auth-readiness/cut-manifest-and-stability-draft.md`:
 *
 *   - cut identity      clean tree, full HEAD SHA, HEAD == origin/main, ahead/behind,
 *                       canonical remote, local/remote tag SHA, immutable prod branch SHA
 *   - version surfaces  every declared app-version surface must equal the canonical `version` file
 *   - migrations        ordered migration declaration list + deterministic declaration hash
 *   - epochs            ingest-compute epoch, company-key projection epoch, industry-evidence
 *                       projection version (read from source, cross-checked against the
 *                       compiled `@trends/shared` constants)
 *   - datasets          per-file + aggregate SHA-256 for search-profile YAML, generated
 *                       templates, keyword source/tag datasets, research pulse keywords
 *   - CI                exact-SHA GitHub Actions metadata (only when `gh` auth exists)
 *   - secrets           env/file redaction inventory (names, lengths, hashes — never values)
 *
 * HARD RULES
 *   - READ-ONLY. Never writes a tracked file, never tags/pushes/deploys, never queries
 *     production. `gh api` and `git ls-remote` are read-only remote reads of the git host.
 *   - Deterministic JSON: recursively sorted keys, sorted lists, a single non-decision
 *     `meta.generatedAt`, and a `decisionHash` over the decision body (timestamp excluded).
 *   - Fail closed on: dirty tree, HEAD ahead/behind/diverged from origin/main, version
 *     surface disagreement, missing/mismatched cut tag or immutable branch, migration drift,
 *     or an explicit frozen-expectation mismatch.
 *
 * Exit codes:
 *   0 - clean: every fail-closed check passed
 *   1 - config or invocation error (bad args, unreadable repo, missing canonical version file)
 *   2 - evidence failure: one or more fail-closed checks failed
 *
 * Schema: trends-cut-manifest-evidence/v1
 */

import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { isAbsolute, join, resolve } from "node:path";
import {
  CURRENT_COMPANY_KEY_PROJECTION_EPOCH,
  CURRENT_INGEST_COMPUTE_EPOCH,
  CURRENT_INDUSTRY_EVIDENCE_PROJECTION_VERSION,
} from "@trends/shared";

export const EVIDENCE_SCHEMA = "trends-cut-manifest-evidence/v1";
export const EVIDENCE_SCHEMA_VERSION = "v1";

export const EXIT_OK = 0;
export const EXIT_CONFIG_OR_INVOCATION_ERROR = 1;
export const EXIT_EVIDENCE_FAILURE = 2;

// ---------------------------------------------------------------------------
// Ports (all I/O goes through these so tests can mock git/gh/filesystem)
// ---------------------------------------------------------------------------

export interface CommandResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

export type CommandRunner = (command: string, args: string[]) => CommandResult;

export interface FileSystemPort {
  exists(absolutePath: string): boolean;
  readText(absolutePath: string): string | null;
  readBytes(absolutePath: string): Uint8Array | null;
  /** Non-recursive listing of file names in a directory; empty when absent. */
  listDir(absoluteDir: string): string[];
}

export interface CollectorDeps {
  runCommand: CommandRunner;
  fs: FileSystemPort;
  env: Record<string, string | undefined>;
  now: () => string;
}

/**
 * Real process-backed ports. `env` is only ever read for the redaction
 * inventory — values are hashed, never emitted.
 */
export function createDefaultDeps(): CollectorDeps {
  return {
    runCommand: (command, args) => {
      const result = spawnSync(command, args, { encoding: "utf-8" });
      return {
        exitCode: result.status ?? 1,
        stdout: result.stdout ?? "",
        stderr: result.stderr ?? "",
      };
    },
    fs: {
      exists: (p) => existsSync(p),
      readText: (p) => {
        try {
          return readFileSync(p, "utf-8");
        } catch {
          return null;
        }
      },
      readBytes: (p) => {
        try {
          return new Uint8Array(readFileSync(p));
        } catch {
          return null;
        }
      },
      listDir: (dir) => {
        try {
          return readdirSync(dir, { withFileTypes: true })
            .filter((entry) => entry.isFile())
            .map((entry) => entry.name)
            .sort();
        } catch {
          return [];
        }
      },
    },
    env: process.env as Record<string, string | undefined>,
    now: () => new Date().toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Deterministic serialization + hashing + redaction
// ---------------------------------------------------------------------------

function sortValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortValue);
  }
  if (value !== null && typeof value === "object") {
    const source = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(source).sort()) {
      const val = source[key];
      if (val !== undefined) {
        out[key] = sortValue(val);
      }
    }
    return out;
  }
  return value;
}

/** Canonical JSON: recursively sorted object keys, undefined omitted. */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortValue(value));
}

export function sha256Hex(input: string | Uint8Array): string {
  const hash = createHash("sha256");
  hash.update(typeof input === "string" ? Buffer.from(input, "utf-8") : Buffer.from(input));
  return hash.digest("hex");
}

/** Aggregate hash over sorted `sha256  path` lines; empty set hashes the empty string. */
export function aggregateHash(entries: Array<{ path: string; sha256: string }>): string {
  const lines = [...entries]
    .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
    .map((entry) => `${entry.sha256}  ${entry.path}`);
  return sha256Hex(lines.join("\n"));
}

const SENSITIVE_KEY_PATTERN =
  /(secret|token|password|passwd|credential|authorization|cookie|bearer|api[_-]?key|_key$|^key$)/i;

export function isSensitiveKey(key: string): boolean {
  return SENSITIVE_KEY_PATTERN.test(key);
}

/**
 * Recursively replace values whose key looks sensitive, and scrub secret-looking
 * substrings from every string. Mirrors the precedent in
 * `scripts/verify-company-key-projection-full-scan.ts`.
 */
export function redactSecrets(input: unknown, extraSecrets: string[] = []): unknown {
  const sanitize = (text: string): string => {
    let out = text;
    for (const secret of extraSecrets) {
      if (secret && secret.length > 3) {
        out = out.split(secret).join("[REDACTED]");
      }
    }
    out = out.replace(
      /(?:CONVEX_WRITE_SECRET|writeSecret|AUTH_[A-Z_]*PASSWORD|password|apiKey|api_key|token)[=:\s]+["']?([^\s"',;]+)["']?/gi,
      (match, value: string) => match.replace(value, "[REDACTED]"),
    );
    out = out.replace(/bearer\s+[A-Za-z0-9._-]+/gi, "Bearer [REDACTED]");
    out = out.replace(/([a-z][a-z0-9+.-]*:\/\/)[^\s/@]+@/gi, "$1[REDACTED]@");
    return out;
  };

  if (typeof input === "string") {
    return sanitize(input);
  }
  if (Array.isArray(input)) {
    return input.map((item) => redactSecrets(item, extraSecrets));
  }
  if (input !== null && typeof input === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
      out[key] = isSensitiveKey(key) ? "[REDACTED]" : redactSecrets(value, extraSecrets);
    }
    return out;
  }
  return input;
}

/**
 * String-scrub-only redaction: applies the same value sanitization as
 * `redactSecrets` but NEVER replaces values based on key names. Used for the
 * final document pass so a container key like `secrets` (which holds only
 * hashes/lengths by construction) is not destroyed, while any leaked secret
 * value or secret-shaped substring is still scrubbed from every string.
 */
export function scrubStrings(input: unknown, extraSecrets: string[] = []): unknown {
  const sanitize = (text: string): string => {
    let out = text;
    for (const secret of extraSecrets) {
      if (secret && secret.length > 3) {
        out = out.split(secret).join("[REDACTED]");
      }
    }
    out = out.replace(
      /(?:CONVEX_WRITE_SECRET|writeSecret|AUTH_[A-Z_]*PASSWORD|password|apiKey|api_key|token)[=:\s]+["']?([^\s"',;]+)["']?/gi,
      (match, value: string) => match.replace(value, "[REDACTED]"),
    );
    out = out.replace(/bearer\s+[A-Za-z0-9._-]+/gi, "Bearer [REDACTED]");
    out = out.replace(/([a-z][a-z0-9+.-]*:\/\/)[^\s/@]+@/gi, "$1[REDACTED]@");
    return out;
  };

  if (typeof input === "string") {
    return sanitize(input);
  }
  if (Array.isArray(input)) {
    return input.map((item) => scrubStrings(item, extraSecrets));
  }
  if (input !== null && typeof input === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
      out[key] = scrubStrings(value, extraSecrets);
    }
    return out;
  }
  return input;
}

const LEAK_PATTERNS: RegExp[] = [
  /(?:password|passwd|secret|token|api[_-]?key)["']?\s*[=:]\s*["']?(?!\[REDACTED\])[^\s"',;{}]{4,}/i,
  /bearer\s+["']?(?!\[REDACTED\])[A-Za-z0-9._-]{8,}/i,
];

/**
 * Post-emission guarantee: no known secret value and no secret-shaped substring
 * may appear anywhere in the emitted document. Returns the offending strings.
 */
export function findSecretLeaks(serialized: string, secretValues: string[] = []): string[] {
  const leaks: string[] = [];
  for (const secret of secretValues) {
    if (secret && secret.length > 3 && serialized.includes(secret)) {
      leaks.push(`known secret value present (length ${secret.length})`);
    }
  }
  for (const pattern of LEAK_PATTERNS) {
    const match = serialized.match(pattern);
    if (match) {
      leaks.push(`secret-shaped substring present: ${redactSecrets(match[0]) as string}`);
    }
  }
  return leaks;
}

// ---------------------------------------------------------------------------
// Evidence types
// ---------------------------------------------------------------------------

export type CheckStatus = "pass" | "fail" | "warn" | "skipped";

export interface EvidenceCheck {
  id: string;
  status: CheckStatus;
  detail: string;
  expected?: string | number;
  actual?: string | number;
}

export interface VersionSurfaceRecord {
  id: string;
  path: string;
  kind: string;
  required: boolean;
  value: string | null;
  matches: boolean;
}

export interface CutIdentityEvidence {
  branch: string | null;
  headSha: string | null;
  originMainSha: string | null;
  aheadCount: number | null;
  behindCount: number | null;
  clean: boolean;
  originUrl: string | null;
  remotes: Array<{ name: string; url: string }>;
  tag: string;
  localTagSha: string | null;
  localTagPeeledSha: string | null;
  remoteTagSha: string | null;
  prodBranch: string;
  prodBranchSha: string | null;
}

export interface MigrationEvidence {
  orderedNames: string[];
  missingExports: string[];
  declarationHash: string;
}

export interface EpochEvidence {
  ingestComputeEpoch: number | null;
  companyKeyProjectionEpoch: number | null;
  industryEvidenceProjectionVersion: number | null;
  sharedImport: {
    ingestComputeEpoch: number;
    companyKeyProjectionEpoch: number;
    industryEvidenceProjectionVersion: number;
  };
}

export interface DatasetGroupEvidence {
  id: string;
  files: Array<{ path: string; sha256: string; bytes: number }>;
  missing: string[];
  aggregateSha256: string;
}

export interface CiRunEvidence {
  name: string;
  workflowId: number | null;
  status: string | null;
  conclusion: string | null;
  event: string | null;
  url: string | null;
  runAttempt?: number | null;
  createdAt?: string | null;
}

export interface CiEvidence {
  availability: "unavailable" | "no_runs" | "available" | "skipped";
  reason: string | null;
  headSha: string;
  ownerRepo: string | null;
  runs: CiRunEvidence[];
}

export interface SecretInventoryEntry {
  name: string;
  present: boolean;
  length: number;
  sha256: string;
}

export interface EnvFileRecord {
  path: string;
  exists: boolean;
  bytes: number | null;
  sha256: string | null;
}

export interface CutManifestEvidence {
  schema: string;
  schemaVersion: string;
  status: "clean" | "failed" | "error";
  exitCode: number;
  meta: {
    generatedAt: string;
    repoRoot: string;
    expectedVersion: string | null;
    remoteChecksEnabled: boolean;
    ciChecksEnabled: boolean;
  };
  identity: CutIdentityEvidence;
  versions: {
    canonical: string | null;
    surfaces: VersionSurfaceRecord[];
    openapiHealthExample: string | null;
  };
  migrations: MigrationEvidence;
  epochs: EpochEvidence;
  datasets: {
    groups: DatasetGroupEvidence[];
    aggregateSha256: string;
  };
  ci: CiEvidence;
  secrets: {
    inventory: SecretInventoryEntry[];
    envFiles: EnvFileRecord[];
    leakGuard: "pass" | "fail";
    leaks: string[];
  };
  checks: EvidenceCheck[];
  errors: string[];
  warnings: string[];
  decisionHash: string;
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

export interface CliOptions {
  repoRoot: string;
  expectedVersion?: string;
  expectedCutSha?: string;
  expectedEpochIngest?: number;
  expectedEpochProjection?: number;
  expectedIndustryEvidenceProjectionVersion?: number;
  expectedOrigin?: string;
  checkRemote: boolean;
  checkCi: boolean;
  checkDriftGates: boolean;
  pretty: boolean;
}

function parseIntStrict(flag: string, raw: string | undefined): number {
  const parsed = Number.parseInt(raw ?? "", 10);
  if (raw === undefined || Number.isNaN(parsed)) {
    throw new Error(`Invalid ${flag} value: ${String(raw)}`);
  }
  return parsed;
}

export function parseCliArgs(argv: string[]): CliOptions {
  const options: CliOptions = {
    repoRoot: process.cwd(),
    checkRemote: true,
    checkCi: true,
    checkDriftGates: true,
    pretty: false,
  };

  const takeValue = (arg: string, i: number): string => {
    const inline = arg.includes("=") ? arg.slice(arg.indexOf("=") + 1) : undefined;
    if (inline !== undefined) {
      return inline;
    }
    const next = argv[i + 1];
    if (next === undefined) {
      throw new Error(`Missing value for ${arg}`);
    }
    return next;
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg === "--repo-root" || arg.startsWith("--repo-root=")) {
      options.repoRoot = resolve(takeValue(arg, i));
      if (!arg.includes("=")) i++;
    } else if (arg === "--expected-version" || arg.startsWith("--expected-version=")) {
      const value = takeValue(arg, i);
      if (!/^\d+\.\d+\.\d+/.test(value)) {
        throw new Error(`Invalid --expected-version: ${value}`);
      }
      options.expectedVersion = value;
      if (!arg.includes("=")) i++;
    } else if (arg === "--expected-cut-sha" || arg.startsWith("--expected-cut-sha=")) {
      const value = takeValue(arg, i);
      if (!/^[0-9a-f]{40}$/i.test(value)) {
        throw new Error(`Invalid --expected-cut-sha (needs 40 hex chars): ${value}`);
      }
      options.expectedCutSha = value.toLowerCase();
      if (!arg.includes("=")) i++;
    } else if (arg === "--expected-epoch-ingest" || arg.startsWith("--expected-epoch-ingest=")) {
      options.expectedEpochIngest = parseIntStrict("--expected-epoch-ingest", takeValue(arg, i));
      if (!arg.includes("=")) i++;
    } else if (arg === "--expected-epoch-projection" || arg.startsWith("--expected-epoch-projection=")) {
      options.expectedEpochProjection = parseIntStrict("--expected-epoch-projection", takeValue(arg, i));
      if (!arg.includes("=")) i++;
    } else if (
      arg === "--expected-industry-evidence-version" ||
      arg.startsWith("--expected-industry-evidence-version=")
    ) {
      options.expectedIndustryEvidenceProjectionVersion = parseIntStrict(
        "--expected-industry-evidence-version",
        takeValue(arg, i),
      );
      if (!arg.includes("=")) i++;
    } else if (arg === "--expected-origin" || arg.startsWith("--expected-origin=")) {
      options.expectedOrigin = takeValue(arg, i);
      if (!arg.includes("=")) i++;
    } else if (arg === "--skip-remote") {
      options.checkRemote = false;
    } else if (arg === "--skip-ci") {
      options.checkCi = false;
    } else if (arg === "--skip-drift-gates") {
      options.checkDriftGates = false;
    } else if (arg === "--pretty") {
      options.pretty = true;
    } else if (arg === "--help" || arg === "-h") {
      throw new Error("help requested");
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (!isAbsolute(options.repoRoot)) {
    options.repoRoot = resolve(options.repoRoot);
  }
  return options;
}

// ---------------------------------------------------------------------------
// Static surface definitions
// ---------------------------------------------------------------------------

export type VersionSurfaceKind =
  | "raw"
  | "packageJson"
  | "pyproject"
  | "dunderVersion"
  | "tsVersionProp"
  | "tsExampleProp"
  | "openapiInfoVersion"
  | "tsExampleComment";

export const VERSION_SURFACES: ReadonlyArray<{
  id: string;
  path: string;
  kind: VersionSurfaceKind;
  required: boolean;
}> = [
  { id: "version_file", path: "version", kind: "raw", required: true },
  { id: "package_root", path: "package.json", kind: "packageJson", required: true },
  { id: "package_api", path: "apps/api/package.json", kind: "packageJson", required: true },
  { id: "package_web", path: "apps/web/package.json", kind: "packageJson", required: true },
  { id: "package_shared", path: "packages/shared/package.json", kind: "packageJson", required: true },
  { id: "package_convex", path: "packages/convex/package.json", kind: "packageJson", required: true },
  {
    id: "package_browser_extension",
    path: "apps/browser-extension/package.json",
    kind: "packageJson",
    required: true,
  },
  { id: "pyproject_root", path: "pyproject.toml", kind: "pyproject", required: true },
  { id: "pyproject_worker", path: "apps/worker/pyproject.toml", kind: "pyproject", required: true },
  { id: "worker_init", path: "apps/worker/__init__.py", kind: "dunderVersion", required: true },
  { id: "trendradar_init", path: "trendradar/__init__.py", kind: "dunderVersion", required: true },
  {
    id: "api_config_version",
    path: "apps/api/src/services/config.ts",
    kind: "tsVersionProp",
    required: true,
  },
  {
    id: "api_health_example",
    path: "apps/api/src/schemas/health.ts",
    kind: "tsExampleProp",
    required: true,
  },
  {
    id: "openapi_info_version",
    path: "apps/api/openapi.yaml",
    kind: "openapiInfoVersion",
    required: true,
  },
  {
    id: "api_types_example",
    path: "apps/web/src/lib/api-types.ts",
    kind: "tsExampleComment",
    required: true,
  },
];

/**
 * Browser-extension manifest version is an independent artifact version and is
 * deliberately NOT part of app-version parity (see CLAUDE.md — ext version is
 * bumped separately, currently 1.3.x).
 */
export const EXCLUDED_VERSION_SURFACES: ReadonlyArray<{ path: string; reason: string }> = [
  {
    path: "apps/browser-extension/manifest.json",
    reason: "independent extension version, bumped separately from the app version",
  },
];

export interface DatasetGroupDefinition {
  id: string;
  /** Explicit tracked files. */
  files: string[];
  /** Directory whose files are included when the filename matches. */
  dir?: string;
  extensions?: string[];
}

export const DATASET_GROUPS: ReadonlyArray<DatasetGroupDefinition> = [
  {
    id: "search_profile_yaml",
    files: [],
    dir: "config/search-profiles",
    extensions: [".yaml", ".yml"],
  },
  {
    id: "generated_search_profile_templates",
    files: ["packages/shared/src/generated/search-profile-templates.ts"],
  },
  {
    id: "keyword_dataset",
    files: [
      "config/industry-data/keywords-structured.md",
      "config/industry-data/keyword-tags.json",
    ],
  },
  {
    id: "research_pulse_keywords",
    files: ["config/research_pulse_keywords.yaml"],
  },
];

/** Read-only drift gates the manifest records (and may execute: `--check` never writes). */
export const DRIFT_GATES: ReadonlyArray<{ id: string; makeTarget: string; checkCommand: string }> = [
  {
    id: "search_profile_templates",
    makeTarget: "make check-search-profile-templates",
    checkCommand: "scripts/resume/sync-search-profile-templates.ts --check",
  },
  {
    id: "keyword_tags",
    makeTarget: "make check-keyword-tags",
    checkCommand: "scripts/industry-data/build-keyword-tags.ts --check",
  },
];

/** Push-triggered workflows whose exact-SHA conclusion gates a cut. */
export const GATE_WORKFLOWS: readonly string[] = ["Checks", "Tests"];

/** Tag-triggered workflows expected to be absent on a push SHA. */
export const RELEASE_WORKFLOWS: readonly string[] = ["App Release", "CLI Release"];

export const EPOCH_SOURCE_FILES = {
  ingestAndProjection: "packages/shared/src/ingest-compute-epoch.ts",
  industryEvidence: "packages/shared/src/industry-evidence.ts",
} as const;

export const MIGRATIONS_SOURCE_FILE = "packages/convex/convex/migrations.ts";
export const RESUMES_SEARCH_SOURCE_FILE = "packages/convex/convex/resumes_search.ts";
export const MUTATION_REGISTRY_FILE = "packages/convex/convex/_mutations_registry.ts";

export const ENV_FILE_CANDIDATES: readonly string[] = [
  ".env",
  ".env.local",
  ".env.preview",
  ".env.production",
];

// ---------------------------------------------------------------------------
// Parsers
// ---------------------------------------------------------------------------

export function parseVersionSurface(kind: VersionSurfaceKind, text: string): string | null {
  switch (kind) {
    case "raw": {
      const trimmed = text.trim();
      return trimmed.length > 0 ? trimmed : null;
    }
    case "packageJson": {
      try {
        const parsed = JSON.parse(text) as { version?: unknown };
        return typeof parsed.version === "string" ? parsed.version : null;
      } catch {
        return null;
      }
    }
    case "pyproject": {
      const match = text.match(/^version\s*=\s*"([^"]+)"/m);
      return match ? match[1]! : null;
    }
    case "dunderVersion": {
      const match = text.match(/__version__\s*=\s*"([^"]+)"/);
      return match ? match[1]! : null;
    }
    case "tsVersionProp": {
      const match = text.match(/^\s*version:\s*"([^"]+)"/m);
      return match ? match[1]! : null;
    }
    case "tsExampleProp": {
      const match = text.match(/example:\s*"(\d+\.\d+\.\d+)"/);
      return match ? match[1]! : null;
    }
    case "openapiInfoVersion": {
      const match = text.match(/^\s{2}version:\s*([0-9][0-9.]*)\s*$/m);
      return match ? match[1]! : null;
    }
    case "tsExampleComment": {
      const match = text.match(/@example\s+(\d+\.\d+\.\d+)/);
      return match ? match[1]! : null;
    }
    default:
      return null;
  }
}

/** Ordered migration names as declared in the quiesce registry (from migrations.ts and resumes_search.ts). */
export function parseMigrationNames(registryText: string): string[] {
  const names: string[] = [];
  const pattern = /\{\s*file:\s*"(migrations\.ts|resumes_search\.ts)"\s*,\s*name:\s*"([^"]+)"/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(registryText)) !== null) {
    names.push(match[2]!);
  }
  return names;
}

/** Names exported from migrations.ts (mutation/action/internalMutation). */
export function parseMigrationExports(migrationsText: string): Set<string> {
  const names = new Set<string>();
  const pattern = /export\s+const\s+([A-Za-z0-9_]+)\s*=\s*(?:mutation|action|internalMutation)\s*\(/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(migrationsText)) !== null) {
    names.add(match[1]!);
  }
  return names;
}

export function migrationDeclarationHash(orderedNames: string[]): string {
  return sha256Hex(orderedNames.join("\n"));
}

/** Last `epoch: N` inside a named `_HISTORY` registry block. */
export function parseLastEpochFromHistory(sourceText: string, historyName: string): number | null {
  const startPattern = new RegExp(`export const ${historyName}[\\s\\S]*?=\\s*\\[`);
  const startMatch = startPattern.exec(sourceText);
  if (!startMatch) {
    return null;
  }
  const rest = sourceText.slice(startMatch.index + startMatch[0].length);
  const endIndex = rest.indexOf("] as const;");
  const block = endIndex === -1 ? rest : rest.slice(0, endIndex);
  const epochs: number[] = [];
  const epochPattern = /epoch:\s*(\d+)/g;
  let match: RegExpExecArray | null;
  while ((match = epochPattern.exec(block)) !== null) {
    epochs.push(Number.parseInt(match[1]!, 10));
  }
  return epochs.length > 0 ? epochs[epochs.length - 1]! : null;
}

export function parseIndustryEvidenceProjectionVersion(sourceText: string): number | null {
  const match = sourceText.match(
    /CURRENT_INDUSTRY_EVIDENCE_PROJECTION_VERSION\s*(?::\s*number)?\s*=\s*(\d+)/,
  );
  return match ? Number.parseInt(match[1]!, 10) : null;
}

/** Parse `owner/repo` from a git remote URL (ssh or https form). */
export function parseOwnerRepo(remoteUrl: string): string | null {
  const clean = remoteUrl.replace(/^git\+/, "");
  const ssh = clean.match(/^git@[^:]+:([^/]+)\/(.+?)(?:\.git)?$/);
  if (ssh) {
    return `${ssh[1]}/${ssh[2]}`;
  }
  const https = clean.match(/^(?:https?|ssh):\/\/[^/]+\/([^/]+)\/(.+?)(?:\.git)?$/);
  if (https) {
    return `${https[1]}/${https[2]}`;
  }
  return null;
}

export const CANONICAL_ORIGIN = "ptdevhk/trends";

export function isMatchingOrigin(originUrl: string, expectedOrigin: string): boolean {
  if (!originUrl || !expectedOrigin) return false;
  const o1 = parseOwnerRepo(originUrl);
  const o2 = parseOwnerRepo(expectedOrigin) || (expectedOrigin.includes("/") ? expectedOrigin.replace(/\.git$/, "").toLowerCase() : null);
  if (o1 && o2 && o1.toLowerCase() === o2.toLowerCase()) {
    return true;
  }
  return originUrl.trim().toLowerCase() === expectedOrigin.trim().toLowerCase();
}

/** `git ls-remote --tags` output → peeled commit SHA for the requested tag. */
export function parseRemoteTagSha(lsRemoteOutput: string, tag: string): string | null {
  let plain: string | null = null;
  let peeled: string | null = null;
  for (const line of lsRemoteOutput.split("\n")) {
    const [sha, ref] = line.trim().split(/\s+/);
    if (!sha || !ref) continue;
    if (ref === `refs/tags/${tag}`) plain = sha;
    if (ref === `refs/tags/${tag}^{}`) peeled = sha;
  }
  return peeled ?? plain;
}

export function parseRemoteBranchSha(lsRemoteOutput: string, branch: string): string | null {
  for (const line of lsRemoteOutput.split("\n")) {
    const [sha, ref] = line.trim().split(/\s+/);
    if (sha && ref === `refs/heads/${branch}`) {
      return sha;
    }
  }
  return null;
}

export function parseRemoteList(remoteOutput: string): Array<{ name: string; url: string }> {
  const remotes: Array<{ name: string; url: string }> = [];
  for (const line of remoteOutput.split("\n")) {
    const match = line.match(/^(\S+)\s+(\S+)\s+\((fetch|push)\)$/);
    if (match && match[3] === "fetch") {
      remotes.push({ name: match[1]!, url: match[2]! });
    }
  }
  return remotes.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
}

export function parseAheadBehind(stdout: string): { ahead: number | null; behind: number | null } {
  const match = stdout.trim().match(/^(\d+)\s+(\d+)$/);
  if (!match) {
    return { ahead: null, behind: null };
  }
  return { ahead: Number.parseInt(match[1]!, 10), behind: Number.parseInt(match[2]!, 10) };
}

export interface GhRunRecord {
  id?: number;
  name?: string;
  workflow_id?: number;
  status?: string;
  conclusion?: string;
  event?: string;
  html_url?: string;
  run_attempt?: number;
  created_at?: string;
  updated_at?: string;
}

export function parseGhRuns(stdout: string): CiRunEvidence[] {
  let parsed: { workflow_runs?: GhRunRecord[] };
  try {
    parsed = JSON.parse(stdout) as { workflow_runs?: GhRunRecord[] };
  } catch {
    return [];
  }
  const runs = Array.isArray(parsed.workflow_runs) ? parsed.workflow_runs : [];
  return runs
    .map((run) => ({
      name: typeof run.name === "string" ? run.name : "(unknown)",
      workflowId: typeof run.workflow_id === "number" ? run.workflow_id : null,
      status: typeof run.status === "string" ? run.status : null,
      conclusion: typeof run.conclusion === "string" ? run.conclusion : null,
      event: typeof run.event === "string" ? run.event : null,
      url: typeof run.html_url === "string" ? run.html_url : null,
      runAttempt: typeof run.run_attempt === "number" ? run.run_attempt : null,
      createdAt: typeof run.created_at === "string" ? run.created_at : null,
    }))
    .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
}

// ---------------------------------------------------------------------------
// Collection
// ---------------------------------------------------------------------------

interface RunOutcome {
  ok: boolean;
  stdout: string;
  stderr: string;
  exitCode: number;
}

function run(deps: CollectorDeps, command: string, args: string[]): RunOutcome {
  const result = deps.runCommand(command, args);
  return {
    ok: result.exitCode === 0,
    stdout: result.stdout,
    stderr: result.stderr,
    exitCode: result.exitCode,
  };
}

function git(deps: CollectorDeps, args: string[]): RunOutcome {
  return run(deps, "git", args);
}

export function buildRedactionInventory(
  env: Record<string, string | undefined>,
): SecretInventoryEntry[] {
  const entries: SecretInventoryEntry[] = [];
  for (const [name, value] of Object.entries(env)) {
    if (!isSensitiveKey(name) || typeof value !== "string") {
      continue;
    }
    entries.push({
      name,
      present: true,
      length: value.length,
      sha256: sha256Hex(value),
    });
  }
  return entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
}

export function collectEnvFileRecords(
  deps: CollectorDeps,
  repoRoot: string,
): { records: EnvFileRecord[]; values: string[] } {
  const records: EnvFileRecord[] = [];
  const values: string[] = [];
  for (const relPath of ENV_FILE_CANDIDATES) {
    const absolute = join(repoRoot, relPath);
    const bytes = deps.fs.readBytes(absolute);
    if (bytes === null) {
      records.push({ path: relPath, exists: false, bytes: null, sha256: null });
      continue;
    }
    const text = Buffer.from(bytes).toString("utf-8");
    for (const line of text.split("\n")) {
      const match = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=(.*)$/);
      if (match && isSensitiveKey(match[1]!)) {
        const value = match[2]!.trim().replace(/^["']|["']$/g, "");
        if (value.length > 3) {
          values.push(value);
        }
      }
    }
    records.push({
      path: relPath,
      exists: true,
      bytes: bytes.length,
      sha256: sha256Hex(bytes),
    });
  }
  return {
    records: records.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0)),
    values,
  };
}

export interface CollectResult {
  evidence: CutManifestEvidence;
}

export function collectCutManifestEvidence(
  options: CliOptions,
  deps: CollectorDeps,
): CutManifestEvidence {
  const repoRoot = options.repoRoot;
  const checks: EvidenceCheck[] = [];
  const errors: string[] = [];
  const warnings: string[] = [];

  const addCheck = (check: EvidenceCheck): void => {
    checks.push(check);
    if (check.status === "fail") {
      errors.push(`${check.id}: ${check.detail}`);
    } else if (check.status === "warn") {
      warnings.push(`${check.id}: ${check.detail}`);
    }
  };

  const readText = (relPath: string): string | null => deps.fs.readText(join(repoRoot, relPath));

  // ---- canonical version -------------------------------------------------
  const canonicalVersion = readText("version")?.trim() ?? null;
  if (!canonicalVersion) {
    throw new Error(
      `Canonical version file missing or empty: ${join(repoRoot, "version")} (config error)`,
    );
  }
  const expectedVersion = options.expectedVersion ?? canonicalVersion;

  // ---- identity ----------------------------------------------------------
  const statusOutcome = git(deps, ["status", "--porcelain=v1", "-uall"]);
  const clean = statusOutcome.ok && statusOutcome.stdout.trim().length === 0;
  addCheck({
    id: "identity.clean_tree",
    status: clean ? "pass" : "fail",
    detail: clean
      ? "git status --porcelain is empty"
      : `working tree is not clean: ${statusOutcome.stdout.trim().split("\n").slice(0, 5).join(" | ")}`,
    expected: "clean",
    actual: clean ? "clean" : "dirty",
  });

  const branchOutcome = git(deps, ["rev-parse", "--abbrev-ref", "HEAD"]);
  const branch = branchOutcome.ok ? branchOutcome.stdout.trim() : null;

  const headOutcome = git(deps, ["rev-parse", "HEAD"]);
  const headSha = headOutcome.ok && /^[0-9a-f]{40}$/i.test(headOutcome.stdout.trim())
    ? headOutcome.stdout.trim().toLowerCase()
    : null;
  addCheck({
    id: "identity.head_sha",
    status: headSha ? "pass" : "fail",
    detail: headSha ? `HEAD = ${headSha}` : `git rev-parse HEAD failed: ${headOutcome.stderr.trim()}`,
    actual: headSha ?? "unresolved",
  });

  if (options.expectedCutSha) {
    const matches = headSha === options.expectedCutSha;
    addCheck({
      id: "identity.head_matches_expected_cut_sha",
      status: matches ? "pass" : "fail",
      detail: matches
        ? `HEAD equals pinned cut SHA ${options.expectedCutSha}`
        : `HEAD ${headSha ?? "unresolved"} != pinned cut SHA ${options.expectedCutSha}`,
      expected: options.expectedCutSha,
      actual: headSha ?? "unresolved",
    });
  }

  const originMainOutcome = git(deps, ["rev-parse", "origin/main"]);
  const originMainSha = originMainOutcome.ok ? originMainOutcome.stdout.trim().toLowerCase() : null;
  if (!originMainSha) {
    addCheck({
      id: "identity.origin_main_resolved",
      status: "fail",
      detail: `origin/main could not be resolved: ${originMainOutcome.stderr.trim()}`,
    });
  }

  const equalToOrigin = Boolean(headSha && originMainSha && headSha === originMainSha);
  addCheck({
    id: "identity.head_equals_origin_main",
    status: equalToOrigin ? "pass" : "fail",
    detail: equalToOrigin
      ? `HEAD == origin/main (${headSha})`
      : `HEAD ${headSha ?? "unresolved"} != origin/main ${originMainSha ?? "unresolved"}`,
    expected: originMainSha ?? "origin/main",
    actual: headSha ?? "unresolved",
  });

  const aheadBehindOutcome = git(deps, ["rev-list", "--left-right", "--count", "HEAD...origin/main"]);
  const { ahead, behind } = parseAheadBehind(aheadBehindOutcome.stdout);
  const inSync = ahead === 0 && behind === 0;
  addCheck({
    id: "identity.ahead_behind",
    status: inSync ? "pass" : "fail",
    detail:
      ahead === null || behind === null
        ? `git rev-list --left-right --count failed: ${aheadBehindOutcome.stderr.trim()}`
        : `ahead=${ahead}, behind=${behind}`,
    expected: "ahead=0, behind=0",
    actual: `${ahead ?? "?"} / ${behind ?? "?"}`,
  });

  const remoteOutcome = git(deps, ["remote", "-v"]);
  const remotes = parseRemoteList(remoteOutcome.stdout);
  const originUrlOutcome = git(deps, ["config", "--get", "remote.origin.url"]);
  const originUrl = originUrlOutcome.ok ? originUrlOutcome.stdout.trim() : null;
  addCheck({
    id: "identity.origin_remote",
    status: originUrl ? "pass" : "fail",
    detail: originUrl ? `origin = ${originUrl}` : "origin remote is not configured",
    actual: originUrl ?? "unresolved",
  });

  const expectedOrigin = options.expectedOrigin ?? CANONICAL_ORIGIN;
  const originMatches = Boolean(originUrl && isMatchingOrigin(originUrl, expectedOrigin));
  addCheck({
    id: "identity.origin_matches_expected",
    status: originMatches ? "pass" : "fail",
    detail: originMatches
      ? `origin remote matches expected canonical authority (${expectedOrigin})`
      : `origin remote (${originUrl ?? "unresolved"}) does not match expected canonical authority (${expectedOrigin})`,
    expected: expectedOrigin,
    actual: originUrl ?? "unresolved",
  });

  const tag = `v${expectedVersion}`;
  const prodBranch = `prod/v${expectedVersion}`;
  const localTagOutcome = git(deps, ["rev-parse", tag]);
  const localTagSha = localTagOutcome.ok ? localTagOutcome.stdout.trim().toLowerCase() : null;
  const localTagPeeledOutcome = git(deps, ["rev-parse", `${tag}^{}`]);
  const localTagPeeledSha = localTagPeeledOutcome.ok
    ? localTagPeeledOutcome.stdout.trim().toLowerCase()
    : null;
  const expectedTagSha = localTagPeeledSha ?? localTagSha;
  addCheck({
    id: "identity.local_tag_exists",
    status: expectedTagSha ? "pass" : "fail",
    detail: expectedTagSha ? `${tag} -> ${expectedTagSha}` : `tag ${tag} does not exist locally`,
    expected: headSha ?? "HEAD",
    actual: expectedTagSha ?? "missing",
  });

  const localTagEqualsHead = Boolean(expectedTagSha && headSha && expectedTagSha === headSha);
  addCheck({
    id: "identity.local_tag_equals_head",
    status: localTagEqualsHead ? "pass" : "fail",
    detail: localTagEqualsHead
      ? `local tag ${tag} == HEAD (${expectedTagSha})`
      : `local tag ${tag} (${expectedTagSha ?? "missing"}) != HEAD (${headSha ?? "unresolved"})`,
    expected: headSha ?? "HEAD",
    actual: expectedTagSha ?? "missing",
  });

  let remoteTagSha: string | null = null;
  let prodBranchSha: string | null = null;

  if (!options.checkRemote) {
    addCheck({
      id: "identity.remote_tag_sha",
      status: "skipped",
      detail: "remote checks disabled (--skip-remote)",
    });
    addCheck({
      id: "identity.prod_branch_sha",
      status: "skipped",
      detail: "remote checks disabled (--skip-remote)",
    });
  } else {
    const remoteTagOutcome = git(deps, ["ls-remote", "--tags", "origin", tag]);
    const remoteTagResolved =
      remoteTagOutcome.ok && remoteTagOutcome.stdout.trim().length > 0
        ? parseRemoteTagSha(remoteTagOutcome.stdout, tag)
        : null;
    remoteTagSha = remoteTagResolved;
    if (!remoteTagOutcome.ok) {
      addCheck({
        id: "identity.remote_tag_sha",
        status: "fail",
        detail: `git ls-remote failed: ${remoteTagOutcome.stderr.trim()}`,
      });
    } else {
      const tagMatches = Boolean(remoteTagSha && expectedTagSha && remoteTagSha === expectedTagSha);
      addCheck({
        id: "identity.remote_tag_sha",
        status: tagMatches ? "pass" : "fail",
        detail: tagMatches
          ? `remote ${tag} == local (${remoteTagSha})`
          : `remote ${tag} ${remoteTagSha ?? "missing"} != local ${expectedTagSha ?? "missing"}`,
        expected: expectedTagSha ?? "local tag",
        actual: remoteTagSha ?? "missing",
      });
    }

    const remoteBranchOutcome = git(deps, ["ls-remote", "--heads", "origin", prodBranch]);
    prodBranchSha =
      remoteBranchOutcome.ok && remoteBranchOutcome.stdout.trim().length > 0
        ? parseRemoteBranchSha(remoteBranchOutcome.stdout, prodBranch)
        : null;
    if (!remoteBranchOutcome.ok) {
      addCheck({
        id: "identity.prod_branch_sha",
        status: "fail",
        detail: `git ls-remote failed: ${remoteBranchOutcome.stderr.trim()}`,
      });
    } else {
      const branchMatches = Boolean(prodBranchSha && headSha && prodBranchSha === headSha);
      addCheck({
        id: "identity.prod_branch_sha",
        status: branchMatches ? "pass" : "fail",
        detail: branchMatches
          ? `remote ${prodBranch} == HEAD (${prodBranchSha})`
          : `remote ${prodBranch} ${prodBranchSha ?? "missing"} != HEAD ${headSha ?? "unresolved"}`,
        expected: headSha ?? "HEAD",
        actual: prodBranchSha ?? "missing",
      });
    }
  }

  // ---- version surfaces --------------------------------------------------
  const surfaces: VersionSurfaceRecord[] = VERSION_SURFACES.map((surface) => {
    const text = readText(surface.path);
    const value = text === null ? null : parseVersionSurface(surface.kind, text);
    return {
      id: surface.id,
      path: surface.path,
      kind: surface.kind,
      required: surface.required,
      value,
      matches: value !== null && value === expectedVersion,
    };
  });

  for (const surface of surfaces) {
    const ok = surface.matches;
    addCheck({
      id: `versions.${surface.id}`,
      status: ok ? "pass" : surface.required ? "fail" : "warn",
      detail: ok
        ? `${surface.path} = ${surface.value}`
        : `${surface.path} value ${surface.value ?? "unreadable"} != expected ${expectedVersion}`,
      expected: expectedVersion,
      actual: surface.value ?? "unreadable",
    });
  }

  const openapiText = readText("apps/api/openapi.yaml");
  const openapiHealthExample = openapiText
    ? (openapiText.match(/version:\s*\n\s*type:\s*string\s*\n\s*example:\s*'(\d+\.\d+\.\d+)'/) ?? [])[1] ??
      null
    : null;
  if (openapiHealthExample && openapiHealthExample !== expectedVersion) {
    addCheck({
      id: "versions.openapi_health_example_stale",
      status: "warn",
      detail: `OpenAPI health example is ${openapiHealthExample} != ${expectedVersion}; resolve or explicitly waive before signing`,
      expected: expectedVersion,
      actual: openapiHealthExample,
    });
  } else {
    addCheck({
      id: "versions.openapi_health_example_stale",
      status: "pass",
      detail: openapiHealthExample
        ? `OpenAPI health example matches ${expectedVersion}`
        : "no OpenAPI health example version found",
    });
  }

  // ---- migrations --------------------------------------------------------
  const registryText = readText(MUTATION_REGISTRY_FILE) ?? "";
  const migrationsText = readText(MIGRATIONS_SOURCE_FILE) ?? "";
  const resumesSearchText = readText(RESUMES_SEARCH_SOURCE_FILE) ?? "";
  const orderedNames = parseMigrationNames(registryText);
  const exported = new Set([
    ...parseMigrationExports(migrationsText),
    ...parseMigrationExports(resumesSearchText),
  ]);
  const missingExports = orderedNames.filter((name) => !exported.has(name));
  const declarationHash = migrationDeclarationHash(orderedNames);

  addCheck({
    id: "migrations.declared_order",
    status: orderedNames.length > 0 ? "pass" : "fail",
    detail:
      orderedNames.length > 0
        ? `${orderedNames.length} migrations declared in registry order`
        : `no migration entries found in ${MUTATION_REGISTRY_FILE}`,
    actual: orderedNames.length,
  });
  addCheck({
    id: "migrations.exports_present",
    status: missingExports.length === 0 ? "pass" : "fail",
    detail:
      missingExports.length === 0
        ? `all ${orderedNames.length} declared migrations are exported`
        : `migrations declared but not exported: ${missingExports.join(", ")}`,
    actual: missingExports.length,
  });

  // ---- epochs ------------------------------------------------------------
  const epochText = readText(EPOCH_SOURCE_FILES.ingestAndProjection) ?? "";
  const industryEvidenceText = readText(EPOCH_SOURCE_FILES.industryEvidence) ?? "";
  const ingestEpoch = parseLastEpochFromHistory(epochText, "INGEST_COMPUTE_EPOCH_HISTORY");
  const projectionEpoch = parseLastEpochFromHistory(epochText, "COMPANY_KEY_PROJECTION_EPOCH_HISTORY");
  const industryEvidenceVersion = parseIndustryEvidenceProjectionVersion(industryEvidenceText);

  const epochSourceConsistent =
    ingestEpoch === CURRENT_INGEST_COMPUTE_EPOCH &&
    projectionEpoch === CURRENT_COMPANY_KEY_PROJECTION_EPOCH &&
    industryEvidenceVersion === CURRENT_INDUSTRY_EVIDENCE_PROJECTION_VERSION;
  addCheck({
    id: "epochs.source_import_consistency",
    status: epochSourceConsistent ? "pass" : "fail",
    detail: epochSourceConsistent
      ? "source-file epochs match compiled @trends/shared constants"
      : `source epochs (ingest=${ingestEpoch}, projection=${projectionEpoch}, industryEvidence=${industryEvidenceVersion}) != compiled (@trends/shared ingest=${CURRENT_INGEST_COMPUTE_EPOCH}, projection=${CURRENT_COMPANY_KEY_PROJECTION_EPOCH}, industryEvidence=${CURRENT_INDUSTRY_EVIDENCE_PROJECTION_VERSION})`,
  });

  const epochExpectations: Array<{ id: string; expected: number | undefined; actual: number | null }> = [
    { id: "epochs.ingest_compute", expected: options.expectedEpochIngest, actual: ingestEpoch },
    { id: "epochs.company_key_projection", expected: options.expectedEpochProjection, actual: projectionEpoch },
    {
      id: "epochs.industry_evidence_projection",
      expected: options.expectedIndustryEvidenceProjectionVersion,
      actual: industryEvidenceVersion,
    },
  ];
  for (const expectation of epochExpectations) {
    if (expectation.expected === undefined) {
      addCheck({
        id: expectation.id,
        status: expectation.actual === null ? "fail" : "pass",
        detail:
          expectation.actual === null
            ? "epoch value could not be read from source"
            : `current value ${expectation.actual} (no frozen expectation supplied)`,
        actual: expectation.actual ?? "unreadable",
      });
      continue;
    }
    const matches = expectation.actual === expectation.expected;
    addCheck({
      id: expectation.id,
      status: matches ? "pass" : "fail",
      detail: matches
        ? `epoch ${expectation.actual} matches frozen expectation`
        : `epoch ${expectation.actual ?? "unreadable"} != frozen expectation ${expectation.expected}`,
      expected: expectation.expected,
      actual: expectation.actual ?? "unreadable",
    });
  }

  // ---- datasets ----------------------------------------------------------
  const groups: DatasetGroupEvidence[] = DATASET_GROUPS.map((group) => {
    const relPaths: string[] = [...group.files];
    if (group.dir) {
      const names = deps.fs.listDir(join(repoRoot, group.dir));
      for (const name of names) {
        if (group.extensions?.some((ext) => name.endsWith(ext))) {
          relPaths.push(`${group.dir}/${name}`);
        }
      }
    }
    const files: Array<{ path: string; sha256: string; bytes: number }> = [];
    const missing: string[] = [];
    for (const relPath of [...relPaths].sort()) {
      const bytes = deps.fs.readBytes(join(repoRoot, relPath));
      if (bytes === null) {
        missing.push(relPath);
        continue;
      }
      files.push({ path: relPath, sha256: sha256Hex(bytes), bytes: bytes.length });
    }
    addCheck({
      id: `datasets.${group.id}`,
      status: missing.length === 0 && files.length > 0 ? "pass" : "fail",
      detail:
        missing.length === 0 && files.length > 0
          ? `${files.length} files hashed`
          : `missing=${missing.join(", ") || "none"} resolved=${files.length}`,
      actual: files.length,
    });
    return { id: group.id, files, missing, aggregateSha256: aggregateHash(files) };
  });

  const datasetAggregate = aggregateHash(
    groups.flatMap((group) =>
      group.files.map((file) => ({ path: `${group.id}:${file.path}`, sha256: file.sha256 })),
    ),
  );

  // ---- drift gates ------------------------------------------------------
  for (const gate of DRIFT_GATES) {
    if (options.checkDriftGates === false) {
      addCheck({
        id: `drift.${gate.id}`,
        status: "skipped",
        detail: `drift gate skipped (--skip-drift-gates): ${gate.makeTarget}`,
      });
      continue;
    }
    const [runnerCmd, ...runnerArgs] = ["npx", "tsx", ...gate.checkCommand.split(" ")];
    const outcome = run(deps, runnerCmd!, runnerArgs);
    const passed = outcome.ok;
    addCheck({
      id: `drift.${gate.id}`,
      status: passed ? "pass" : "fail",
      detail: passed
        ? `drift gate passed: ${gate.makeTarget}`
        : `drift gate failed: ${gate.makeTarget} (${outcome.stderr.trim() || outcome.stdout.trim() || "exit non-zero"})`,
    });
  }

  // ---- CI ----------------------------------------------------------------
  let ci: CiEvidence = {
    availability: "skipped",
    reason: null,
    headSha: headSha ?? "",
    ownerRepo: originUrl ? parseOwnerRepo(originUrl) : null,
    runs: [],
  };

  if (!options.checkCi) {
    addCheck({ id: "ci.availability", status: "skipped", detail: "CI checks disabled (--skip-ci)" });
  } else if (!headSha) {
    ci = { ...ci, availability: "unavailable", reason: "head_sha_unresolved" };
    addCheck({
      id: "ci.availability",
      status: "warn",
      detail: "HEAD SHA unresolved; exact-SHA CI metadata unavailable",
    });
  } else {
    const authOutcome = run(deps, "gh", ["auth", "status"]);
    if (!authOutcome.ok) {
      ci = { ...ci, availability: "unavailable", reason: "gh_auth_unavailable" };
      addCheck({
        id: "ci.availability",
        status: "warn",
        detail: "gh auth unavailable; exact-SHA CI metadata not collected (advisory)",
      });
    } else if (!ci.ownerRepo) {
      ci = { ...ci, availability: "unavailable", reason: "owner_repo_unresolved" };
      addCheck({
        id: "ci.availability",
        status: "warn",
        detail: "could not resolve owner/repo from origin URL; CI metadata not collected",
      });
    } else {
      const runsOutcome = run(deps, "gh", [
        "api",
        `repos/${ci.ownerRepo}/actions/runs?head_sha=${headSha}&per_page=100`,
      ]);
      if (!runsOutcome.ok) {
        ci = { ...ci, availability: "unavailable", reason: "gh_api_failed" };
        addCheck({
          id: "ci.availability",
          status: "warn",
          detail: `gh api failed: ${runsOutcome.stderr.trim()}`,
        });
      } else {
        const runs = parseGhRuns(runsOutcome.stdout);
        ci = { ...ci, runs };
        if (runs.length === 0) {
          ci.availability = "no_runs";
          ci.reason = "no_runs_for_sha";
          addCheck({
            id: "ci.availability",
            status: "warn",
            detail: `no CI runs recorded for exact SHA ${headSha} (advisory; a freshly cut SHA has none yet)`,
          });
        } else {
          ci.availability = "available";
          addCheck({
            id: "ci.availability",
            status: "pass",
            detail: `${runs.length} CI run(s) recorded for exact SHA ${headSha}`,
          });
          for (const gate of GATE_WORKFLOWS) {
            const gateRuns = runs.filter((item) => item.name === gate);
            if (gateRuns.length === 0) {
              addCheck({
                id: `ci.gate_${gate.toLowerCase().replace(/\s+/g, "_")}`,
                status: "fail",
                detail: `runs exist for ${headSha} but gate workflow "${gate}" has no run (partially-run cut)`,
              });
              continue;
            }
            // Evaluate only the latest CI run attempt for each gate workflow
            const latestRun = [...gateRuns].sort((a, b) => {
              const timeA = a.createdAt ? new Date(a.createdAt).getTime() : 0;
              const timeB = b.createdAt ? new Date(b.createdAt).getTime() : 0;
              if (timeB !== timeA) return timeB - timeA;
              return (b.runAttempt ?? 1) - (a.runAttempt ?? 1);
            })[0]!;

            const bad = latestRun.conclusion !== "success";
            addCheck({
              id: `ci.gate_${gate.toLowerCase().replace(/\s+/g, "_")}`,
              status: bad ? "fail" : "pass",
              detail: bad
                ? `gate workflow "${gate}" conclusion=${latestRun.conclusion ?? "pending"} for exact SHA`
                : `gate workflow "${gate}" succeeded for exact SHA`,
              actual: bad ? (latestRun.conclusion ?? "pending") : "success",
            });
          }
        }
      }
    }
  }

  // ---- secrets -----------------------------------------------------------
  const inventory = buildRedactionInventory(deps.env);
  const { records: envFiles, values: envSecretValues } = collectEnvFileRecords(deps, repoRoot);
  const secretValues = [
    ...inventory
      .map((entry) => deps.env[entry.name])
      .filter((value): value is string => typeof value === "string" && value.length > 3),
    ...envSecretValues,
  ];

  const decisionStatus: "clean" | "failed" = errors.length === 0 ? "clean" : "failed";

  const evidenceBase: Omit<CutManifestEvidence, "decisionHash" | "secrets" | "checks"> & {
    checks: EvidenceCheck[];
    secrets: CutManifestEvidence["secrets"];
  } = {
    schema: EVIDENCE_SCHEMA,
    schemaVersion: EVIDENCE_SCHEMA_VERSION,
    status: decisionStatus,
    exitCode: decisionStatus === "clean" ? EXIT_OK : EXIT_EVIDENCE_FAILURE,
    meta: {
      generatedAt: deps.now(),
      repoRoot,
      expectedVersion,
      remoteChecksEnabled: options.checkRemote,
      ciChecksEnabled: options.checkCi,
    },
    identity: {
      branch,
      headSha,
      originMainSha,
      aheadCount: ahead,
      behindCount: behind,
      clean,
      originUrl,
      remotes,
      tag,
      localTagSha,
      localTagPeeledSha,
      remoteTagSha,
      prodBranch,
      prodBranchSha,
    },
    versions: {
      canonical: canonicalVersion,
      surfaces,
      openapiHealthExample,
    },
    migrations: {
      orderedNames,
      missingExports,
      declarationHash,
    },
    epochs: {
      ingestComputeEpoch: ingestEpoch,
      companyKeyProjectionEpoch: projectionEpoch,
      industryEvidenceProjectionVersion: industryEvidenceVersion,
      sharedImport: {
        ingestComputeEpoch: CURRENT_INGEST_COMPUTE_EPOCH,
        companyKeyProjectionEpoch: CURRENT_COMPANY_KEY_PROJECTION_EPOCH,
        industryEvidenceProjectionVersion: CURRENT_INDUSTRY_EVIDENCE_PROJECTION_VERSION,
      },
    },
    datasets: {
      groups,
      aggregateSha256: datasetAggregate,
    },
    ci,
    secrets: {
      inventory,
      envFiles,
      leakGuard: "pass",
      leaks: [],
    },
    checks: [...checks].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)),
    errors: [...errors].sort(),
    warnings: [...warnings].sort(),
  };

  // ---- sanitize before decisionHash & leak guard ------------------------
  // String-scrub only: the `secrets` container holds hashes/lengths by
  // construction, so we must not null it out via key-name redaction. Any
  // leaked secret value or secret-shaped substring is scrubbed from every
  // string, then the document is scanned for residual leaks and fails closed.
  const sanitized = scrubStrings(evidenceBase, secretValues) as typeof evidenceBase;

  // decisionHash covers everything except non-portable/wall-clock fields
  // (meta.generatedAt is excluded, meta.repoRoot is excluded/normalized).
  const decisionBody = {
    ...sanitized,
    meta: {
      ...sanitized.meta,
      generatedAt: undefined,
      repoRoot: undefined,
    },
  };
  const decisionHash = sha256Hex(canonicalJson(decisionBody));

  const completeEvidence: CutManifestEvidence = { ...sanitized, decisionHash };

  // ---- leak guard (fail closed before emitting) --------------------------
  const serialized = canonicalJson(completeEvidence);
  const leaks = findSecretLeaks(serialized, secretValues);
  if (leaks.length > 0) {
    throw new Error(`secret leak guard failed: ${leaks.join("; ")}`);
  }

  return completeEvidence;
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

export function runCollector(
  argv: string[],
  deps: CollectorDeps = createDefaultDeps(),
): { exitCode: number; output: string } {
  const options = parseCliArgs(argv);
  const evidence = collectCutManifestEvidence(options, deps);
  const output = options.pretty ? JSON.stringify(evidence, null, 2) : canonicalJson(evidence);
  return { exitCode: evidence.exitCode, output };
}

async function main(): Promise<void> {
  const { exitCode, output } = runCollector(process.argv.slice(2));
  console.log(output);
  process.exit(exitCode);
}

const invokedDirectly =
  typeof process.argv[1] === "string" &&
  import.meta.url === `file://${resolve(process.argv[1])}`;

if (invokedDirectly) {
  main().catch((err: unknown) => {
    console.error(`Cut manifest evidence collector failed: ${(err as Error).message}`);
    process.exit(EXIT_CONFIG_OR_INVOCATION_ERROR);
  });
}
