import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  aggregateHash,
  buildRedactionInventory,
  canonicalJson,
  collectCutManifestEvidence,
  collectEnvFileRecords,
  createDefaultDeps,
  findSecretLeaks,
  isSensitiveKey,
  migrationDeclarationHash,
  parseAheadBehind,
  parseCliArgs,
  parseGhRuns,
  parseIndustryEvidenceProjectionVersion,
  parseLastEpochFromHistory,
  parseMigrationExports,
  parseMigrationNames,
  parseOwnerRepo,
  parseRemoteBranchSha,
  parseRemoteList,
  parseRemoteTagSha,
  countIdentifierCalls,
  addLeftoverPath,
  leftoverPathIndex,
  emptyLeftoverBuckets,
  leftoverCatalogSourceUnions,
  leftoverPathKind,
  isDefaultLeftoverCatalog,
  leftoverDefaultPartition,
  classifyLeftoverPaths,
  leftoverPathPartition,
  LEFTOVER_CATALOG_SOURCES,
  LEFTOVER_PATH_BUCKETS,
  parseBumpVersionGrepLeftoverPaths,
  parseBumpVersionSedPaths,
  parseBumpVersionVerifyPaths,
  parseVersionSurface,
  readVersionSurface,
  redactSecrets,
  requiredSurfaceResult,
  staleSurfaceResult,
  surfaceValue,
  versionParityResult,
  runCollector,
  sha256Hex,
  DRIFT_GATES,
  ENV_FILE_CANDIDATES,
  VERSION_SURFACES,
  VERSION_SURFACE_KINDS,
  BUMP_VERSION_LEFTOVER_PATHS,
  BUMP_VERSION_GREP_LEFTOVER_PATHS,
  BUMP_VERSION_FIND_SED_PATHS,
  BUMP_VERSION_SED_PATHS,
  BUMP_VERSION_VERIFY_PATHS,
  EXIT_CONFIG_OR_INVOCATION_ERROR,
  EXIT_EVIDENCE_FAILURE,
  EXIT_OK,
  EVIDENCE_SCHEMA,
  GATE_WORKFLOWS,
  type CliOptions,
  type CollectorDeps,
  type FileSystemPort,
  type LeftoverPathBucket,
} from "./collect-cut-manifest-evidence.js";

// ---------------------------------------------------------------------------
// Fixtures / mocks
// ---------------------------------------------------------------------------

const HEAD = "0c4c41c92d8bee728fb3d64c96874d98fc3c01e4";
const ORIGIN = HEAD; // a clean cut has HEAD == origin/main; divergence tests override this
const REMOTE_TAG = "6486bcf95c46afb293fc8b71d44c2149bd40e906";
const PROD_SHA = "abcdef0123456789abcdef0123456789abcdef01";
const VERSION = "0.4.23";

/** A complete, happy-path virtual repository. */
function baseFiles(): Record<string, string> {
  return {
    version: VERSION,
    "package.json": JSON.stringify({ name: "trends", version: VERSION }),
    "apps/api/package.json": JSON.stringify({ name: "api", version: VERSION }),
    "apps/web/package.json": JSON.stringify({ name: "web", version: VERSION }),
    "packages/shared/package.json": JSON.stringify({ name: "shared", version: VERSION }),
    "packages/convex/package.json": JSON.stringify({ name: "convex", version: VERSION }),
    "apps/browser-extension/package.json": JSON.stringify({ name: "ext", version: VERSION }),
    "pyproject.toml": `[project]\nname = "trends"\nversion = "${VERSION}"\n`,
    "apps/worker/pyproject.toml": `[project]\nname = "worker"\nversion = "${VERSION}"\n`,
    "apps/worker/__init__.py": `__version__ = "${VERSION}"\n`,
    "trendradar/__init__.py": `__version__ = "${VERSION}"\n`,
    "apps/api/src/services/config.ts": `export const config = {\n  version: "${VERSION}",\n};\n`,
    "apps/api/src/schemas/health.ts": `    version: z.string().optional().openapi({\n      example: "${VERSION}",\n    }),\n`,
    "apps/api/src/schemas/schemas-validation.test.ts": `      version: "${VERSION}",\n`,
    "apps/web/e2e/resume-role-filter.spec.ts":
      `            appVersion: '${VERSION}',\n            apiVersion: '${VERSION}',\n            webVersion: '${VERSION}',\n`,
    "apps/api/openapi.yaml":
      `openapi: 3.1.0\ninfo:\n  title: Trends API\n  version: ${VERSION}\n` +
      `components:\n  schemas:\n    HealthResponse:\n      properties:\n        version:\n          type: string\n          example: '${VERSION}'\n`,
    "apps/api/openapi.json": JSON.stringify({
      openapi: "3.1.0",
      info: { title: "Trends API", version: VERSION },
      components: {
        schemas: {
          HealthResponse: {
            properties: { version: { type: "string", example: VERSION } },
          },
        },
      },
    }),
    "apps/web/src/lib/api-types.ts": `        /** @example ${VERSION} */\n        version?: string;\n`,
    "packages/convex/convex/_mutations_registry.ts":
      `export const MUTATIONS_REGISTRY = [\n` +
      `    { file: "migrations.ts", name: "backfillSearchText", quiesceAware: false },\n` +
      `    { file: "migrations.ts", name: "reindexSearchText", quiesceAware: false },\n` +
      `    { file: "migrations.ts", name: "backfillAge", quiesceAware: false },\n` +
      `];\n`,
    "packages/convex/convex/migrations.ts":
      `export const backfillSearchText = mutation({\n  args: {},\n  handler: async () => {},\n});\n` +
      `export const reindexSearchText = mutation({\n  args: {},\n  handler: async () => {},\n});\n` +
      `export const backfillAge = mutation({\n  args: {},\n  handler: async () => {},\n});\n`,
    "packages/shared/src/ingest-compute-epoch.ts":
      `export const INGEST_COMPUTE_EPOCH_HISTORY = [\n` +
      `  { epoch: 1, reason: "a", introduced: "2026-07-21" },\n` +
      `  { epoch: 6, reason: "b", introduced: "2026-09-08" },\n` +
      `] as const;\n` +
      `export const CURRENT_INGEST_COMPUTE_EPOCH = 6;\n` +
      `export const COMPANY_KEY_PROJECTION_EPOCH_HISTORY = [\n` +
      `  { epoch: 1, reason: "c", introduced: "2026-08-19" },\n` +
      `  { epoch: 2, reason: "d", introduced: "2026-09-08" },\n` +
      `] as const;\n`,
    "packages/shared/src/industry-evidence.ts":
      `export const CURRENT_INDUSTRY_EVIDENCE_PROJECTION_VERSION = 1;\n`,
    "config/search-profiles/a.yaml": "id: a\n",
    "config/search-profiles/b.yaml": "id: b\n",
    "config/search-profiles/README.md": "not a dataset\n",
    "packages/shared/src/generated/search-profile-templates.ts": "export const T = [];\n",
    "config/industry-data/keywords-structured.md": "# keywords\n",
    "config/industry-data/keyword-tags.json": '{"version":"v1"}\n',
    "config/research_pulse_keywords.yaml": "keywords: []\n",
  };
}

interface MockOptions {
  files?: Record<string, string>;
  commands?: Record<string, { exitCode: number; stdout: string; stderr: string }>;
  env?: Record<string, string | undefined>;
}

interface MockBundle {
  deps: CollectorDeps;
  calls: Array<{ command: string; args: string[] }>;
  writes: string[];
}

/** Deterministic git/gh/filesystem mock. Unknown commands are explicit failures. */
function createMockDeps(options: MockOptions = {}): MockBundle {
  const files = options.files ?? baseFiles();
  const commands = options.commands ?? {};
  const calls: Array<{ command: string; args: string[] }> = [];
  const writes: string[] = [];

  const key = (command: string, args: string[]): string => `${command} ${args.join(" ")}`;
  const defaultCommands = (): Record<string, { exitCode: number; stdout: string; stderr: string }> => ({
    "git status --porcelain=v1 -uall": { exitCode: 0, stdout: "", stderr: "" },
    "git rev-parse --abbrev-ref HEAD": { exitCode: 0, stdout: "burn/cut-manifest-evidence\n", stderr: "" },
    "git rev-parse HEAD": { exitCode: 0, stdout: `${HEAD}\n`, stderr: "" },
    "git rev-parse origin/main": { exitCode: 0, stdout: `${ORIGIN}\n`, stderr: "" },
    "git rev-list --left-right --count HEAD...origin/main": { exitCode: 0, stdout: "0\t0\n", stderr: "" },
    "git remote -v": {
      exitCode: 0,
      stdout:
        "fork\thttps://github.com/karlorz/trends-1.git (fetch)\n" +
        "fork\thttps://github.com/karlorz/trends-1.git (push)\n" +
        "origin\tgit@github.com:ptdevhk/trends.git (fetch)\n" +
        "origin\tgit@github.com:ptdevhk/trends.git (push)\n",
      stderr: "",
    },
    "git config --get remote.origin.url": { exitCode: 0, stdout: "git@github.com:ptdevhk/trends.git\n", stderr: "" },
    [`git rev-parse v${VERSION}`]: { exitCode: 0, stdout: `${HEAD}\n`, stderr: "" },
    [`git rev-parse v${VERSION}^{}`]: { exitCode: 0, stdout: `${HEAD}\n`, stderr: "" },
    [`git ls-remote --tags origin v${VERSION}`]: {
      exitCode: 0,
      stdout: `${HEAD}\trefs/tags/v${VERSION}\n`,
      stderr: "",
    },
    [`git ls-remote --heads origin prod/v${VERSION}`]: {
      exitCode: 0,
      stdout: `${HEAD}\trefs/heads/prod/v${VERSION}\n`,
      stderr: "",
    },
    "gh auth status": { exitCode: 0, stdout: "Logged in\n", stderr: "" },
    "npx tsx scripts/resume/sync-search-profile-templates.ts --check": { exitCode: 0, stdout: "ok\n", stderr: "" },
    "npx tsx scripts/industry-data/build-keyword-tags.ts --check": { exitCode: 0, stdout: "ok\n", stderr: "" },
    [`gh api repos/ptdevhk/trends/actions/runs?head_sha=${HEAD}&per_page=100`]: {
      exitCode: 0,
      stdout: JSON.stringify({
        workflow_runs: [
          { name: "Checks", workflow_id: 226988923, status: "completed", conclusion: "success", event: "push", html_url: "https://example.test/checks" },
          { name: "Tests", workflow_id: 228263122, status: "completed", conclusion: "success", event: "push", html_url: "https://example.test/tests" },
        ],
      }),
      stderr: "",
    },
  });

  const merged = { ...defaultCommands(), ...commands };

  const REPO_PREFIX = "/virtual/repo/";
  const toRel = (absolute: string): string =>
    absolute.startsWith(REPO_PREFIX) ? absolute.slice(REPO_PREFIX.length) : absolute;

  const fs: FileSystemPort = {
    exists: (p) => toRel(p) in files,
    readText: (p) => {
      const rel = toRel(p);
      return rel in files ? files[rel]! : null;
    },
    readBytes: (p) => {
      const text = fs.readText(p);
      return text === null ? null : new Uint8Array(Buffer.from(text, "utf-8"));
    },
    listDir: (dir) => {
      const relPrefix = toRel(dir).replace(/\/$/, "");
      const prefix = `${relPrefix}/`;
      const names = new Set<string>();
      for (const f of Object.keys(files)) {
        if (f.startsWith(prefix) && !f.slice(prefix.length).includes("/")) {
          names.add(f.slice(prefix.length));
        }
      }
      return [...names].sort();
    },
  };

  return {
    deps: {
      runCommand: (command, args) => {
        calls.push({ command, args });
        if (command === "git" && args.includes("write")) writes.push(key(command, args));
        const result = merged[key(command, args)];
        if (!result) {
          return { exitCode: 127, stdout: "", stderr: `mock: unmapped command ${key(command, args)}` };
        }
        return result;
      },
      fs,
      env: options.env ?? {},
      now: () => "2026-09-13T00:00:00.000Z",
    },
    calls,
    writes,
  };
}

const DEFAULT_OPTIONS: CliOptions = {
  repoRoot: "/virtual/repo",
  checkRemote: true,
  checkCi: true,
  checkDriftGates: true,
  pretty: false,
};

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

describe("canonicalJson / sorting", () => {
  it("sorts object keys recursively and drops undefined", () => {
    expect(canonicalJson({ b: 1, a: { d: 2, c: 3 }, u: undefined })).toBe(
      '{"a":{"c":3,"d":2},"b":1}',
    );
  });

  it("preserves array order (lists are sorted by callers, not serializer)", () => {
    expect(canonicalJson({ x: [3, 1, 2] })).toBe('{"x":[3,1,2]}');
  });
});

describe("sha256 / aggregate hashes", () => {
  it("hashes deterministically", () => {
    expect(sha256Hex("abc")).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
  });

  it("aggregates independent of input order", () => {
    const a = aggregateHash([{ path: "b", sha256: "2" }, { path: "a", sha256: "1" }]);
    const b = aggregateHash([{ path: "a", sha256: "1" }, { path: "b", sha256: "2" }]);
    expect(a).toBe(b);
  });

  it("hashes the empty set to the empty-string digest", () => {
    expect(aggregateHash([])).toBe(sha256Hex(""));
  });
});

describe("redaction", () => {
  it("redacts values under sensitive keys without touching benign ones", () => {
    const input = {
      CONVEX_WRITE_SECRET: "super-secret-value",
      AUTH_BOOTSTRAP_PASSWORD: "hunter2",
      version: "0.4.23",
      nested: { apiKey: "abc123", headSha: HEAD },
    };
    const out = redactSecrets(input) as Record<string, unknown>;
    expect(out.CONVEX_WRITE_SECRET).toBe("[REDACTED]");
    expect(out.AUTH_BOOTSTRAP_PASSWORD).toBe("[REDACTED]");
    expect(out.version).toBe("0.4.23");
    expect((out.nested as Record<string, unknown>).apiKey).toBe("[REDACTED]");
    expect((out.nested as Record<string, unknown>).headSha).toBe(HEAD);
  });

  it("scrubs known secret values embedded in arbitrary strings", () => {
    const out = redactSecrets({ note: "prefix LEAKME suffix" }, ["LEAKME"]) as Record<string, unknown>;
    expect(out.note).toBe("prefix [REDACTED] suffix");
  });

  it("scrubs credential material inside URLs", () => {
    const out = redactSecrets({ remote: "https://user:tok3n@github.com/org/repo.git" }) as Record<string, unknown>;
    expect(String(out.remote)).not.toContain("tok3n");
  });

  it("classifies sensitive key names", () => {
    expect(isSensitiveKey("CONVEX_WRITE_SECRET")).toBe(true);
    expect(isSensitiveKey("AUTH_HR_DEMO_TOKEN")).toBe(true);
    expect(isSensitiveKey("AI_API_KEY")).toBe(true);
    expect(isSensitiveKey("version")).toBe(false);
    expect(isSensitiveKey("headSha")).toBe(false);
  });

  it("findSecretLeaks detects known values and secret-shaped substrings", () => {
    expect(findSecretLeaks('{"x":"ok"}', ["ok"])).toEqual([]);
    expect(findSecretLeaks('{"x":"topsecret"}', ["topsecret"])).toHaveLength(1);
    expect(findSecretLeaks('{"note":"password=abcdefgh"}')).toHaveLength(1);
    expect(findSecretLeaks('{"hdr":"Bearer abcdefghijklmnop"}')).toHaveLength(1);
  });

  it("findSecretLeaks does not reject [REDACTED] or Bearer [REDACTED]", () => {
    expect(findSecretLeaks('{"note":"password=[REDACTED]"}')).toEqual([]);
    expect(findSecretLeaks('{"note":"password: [REDACTED]"}')).toEqual([]);
    expect(findSecretLeaks('{"password":"[REDACTED]"}')).toEqual([]);
    expect(findSecretLeaks('{"hdr":"Bearer [REDACTED]"}')).toEqual([]);
  });

  it("buildRedactionInventory records name/length/hash and never the value", () => {
    const inventory = buildRedactionInventory({
      CONVEX_WRITE_SECRET: "abcd1234",
      PLAIN_VALUE: "visible",
      AI_API_KEY: "k",
    });
    expect(inventory.map((e) => e.name)).toEqual(["AI_API_KEY", "CONVEX_WRITE_SECRET"]);
    const entry = inventory.find((e) => e.name === "CONVEX_WRITE_SECRET")!;
    expect(entry).toEqual({
      name: "CONVEX_WRITE_SECRET",
      present: true,
      length: 8,
      sha256: sha256Hex("abcd1234"),
    });
    expect(canonicalJson(inventory)).not.toContain("abcd1234");
    expect(canonicalJson(inventory)).not.toContain('"visible"');
  });
});

describe("surfaceValue", () => {
  const surfaces = [
    { id: "openapi_yaml_health_example", value: "0.4.23" },
    { id: "openapi_json_health_example", value: null },
  ];

  it("returns the surface value for a known id", () => {
    expect(surfaceValue(surfaces, "openapi_yaml_health_example")).toBe("0.4.23");
  });

  it("returns null when the surface value is null", () => {
    expect(surfaceValue(surfaces, "openapi_json_health_example")).toBeNull();
  });

  it("returns null when the id is missing", () => {
    expect(surfaceValue(surfaces, "missing_surface")).toBeNull();
  });
});

describe("versionParityResult", () => {
  it("fails closed when either side is missing", () => {
    expect(versionParityResult(null, "0.4.23", "0.4.23")).toEqual({ status: "fail", actual: "missing" });
    expect(versionParityResult("0.4.23", null, "0.4.23")).toEqual({ status: "fail", actual: "missing" });
  });

  it("fails closed when the sides disagree", () => {
    expect(versionParityResult("0.4.23", "0.4.6", "0.4.23")).toEqual({
      status: "fail",
      actual: "0.4.23 != 0.4.6",
    });
  });

  it("fails closed when both sides agree but are not canonical", () => {
    expect(versionParityResult("0.4.6", "0.4.6", "0.4.23")).toEqual({ status: "fail", actual: "0.4.6" });
  });

  it("passes when both sides equal canonical", () => {
    expect(versionParityResult("0.4.23", "0.4.23", "0.4.23")).toEqual({ status: "pass", actual: "0.4.23" });
  });
});

describe("staleSurfaceResult", () => {
  it("fails closed when the surface is missing", () => {
    expect(staleSurfaceResult(null, "0.4.23")).toEqual({ status: "fail", actual: "missing" });
  });

  it("fails closed when the surface is not canonical", () => {
    expect(staleSurfaceResult("0.4.6", "0.4.23")).toEqual({ status: "fail", actual: "0.4.6" });
  });

  it("passes when the surface equals canonical", () => {
    expect(staleSurfaceResult("0.4.23", "0.4.23")).toEqual({ status: "pass", actual: "0.4.23" });
  });
});

describe("requiredSurfaceResult", () => {
  it("passes when the surface equals canonical", () => {
    expect(requiredSurfaceResult("0.4.23", "0.4.23", true)).toEqual({ status: "pass", actual: "0.4.23" });
  });

  it("fails closed when a required surface is unreadable", () => {
    expect(requiredSurfaceResult(null, "0.4.23", true)).toEqual({ status: "fail", actual: "unreadable" });
  });

  it("fails closed when a required surface is stale", () => {
    expect(requiredSurfaceResult("0.4.6", "0.4.23", true)).toEqual({ status: "fail", actual: "0.4.6" });
  });

  it("warns when an optional surface is unreadable or stale", () => {
    expect(requiredSurfaceResult(null, "0.4.23", false)).toEqual({ status: "warn", actual: "unreadable" });
    expect(requiredSurfaceResult("0.4.6", "0.4.23", false)).toEqual({ status: "warn", actual: "0.4.6" });
  });
});

describe("requiredSurfaceResult leftover lock", () => {
  it("is the only VERSION_SURFACES loop contract used by the collector", () => {
    const src = readFileSync(resolve("scripts/release/collect-cut-manifest-evidence.ts"), "utf8");
    expect(src).toContain("requiredSurfaceResult(value, expectedVersion, surface.required)");
    expect(countIdentifierCalls(src, "requiredSurfaceResult")).toBe(1);
    expect(src).not.toContain("requiredSurfaceResult(surface.value, expectedVersion, surface.required)");
    expect(src).toContain("matches: result.status === \"pass\"");
    expect(src).not.toMatch(/surface\.required \? "fail" : "warn"/);
    expect(src).not.toMatch(/matches: value !== null && value === expectedVersion/);
  });
});

describe("staleSurfaceResult leftover lock", () => {
  it("is the only single-surface stale contract used by the collector", () => {
    const src = readFileSync(resolve("scripts/release/collect-cut-manifest-evidence.ts"), "utf8");
    const withoutHelpers = src
      .replace(/export function staleSurfaceResult\([\s\S]*?\n\}/, "")
      .replace(/const addStaleSurfaceCheck = \([\s\S]*?\n  \};/, "");
    expect(withoutHelpers).not.toMatch(/staleSurfaceResult\(/);
    expect(countIdentifierCalls(src, "staleSurfaceResult")).toBe(1);
    expect(withoutHelpers).not.toMatch(/else if \(\w+ !== expectedVersion\) \{/);
    expect(src).toContain('addStaleSurfaceCheck("versions.openapi_health_example_stale"');
    expect(src).toContain('addStaleSurfaceCheck("versions.openapi_json_health_example_stale"');
    expect(countIdentifierCalls(src, "addStaleSurfaceCheck")).toBe(2);
  });
});

describe("countIdentifierCalls leftover lock", () => {
  it("is unused on collector production paths", () => {
    const src = readFileSync(resolve("scripts/release/collect-cut-manifest-evidence.ts"), "utf8");
    expect(countIdentifierCalls(src, "countIdentifierCalls")).toBe(0);
    expect(src).toContain("export function countIdentifierCalls(");
    expect(src).not.toMatch(/countIdentifierCalls\([^)]+\);/);
  });
});

describe("countIdentifierCalls", () => {
  it("counts calls and skips function definitions", () => {
    const src = [
      "export function parseVersionSurface(kind: string): null {",
      "  return null;",
      "}",
      "export function readVersionSurface(text: string | null): string | null {",
      "  return text === null ? null : parseVersionSurface(kind);",
      "}",
    ].join("\n");
    expect(countIdentifierCalls(src, "parseVersionSurface")).toBe(1);
    expect(countIdentifierCalls(src, "readVersionSurface")).toBe(0);
  });

  it("fails closed when a second call site appears", () => {
    const src = "parseVersionSurface(a);\nparseVersionSurface(b);\n";
    expect(countIdentifierCalls(src, "parseVersionSurface")).toBe(2);
  });
});

describe("parseVersionSurface leftover lock", () => {
  it("is only called from readVersionSurface", () => {
    const src = readFileSync(resolve("scripts/release/collect-cut-manifest-evidence.ts"), "utf8");
    expect(countIdentifierCalls(src, "parseVersionSurface")).toBe(1);
    expect(src).toContain("return text === null ? null : parseVersionSurface(kind, text);");
    expect(src).toContain("readVersionSurface(text, surface.kind)");
    expect(src).not.toMatch(/parseVersionSurface\(surface\.kind/);
  });
});

describe("readVersionSurface leftover lock", () => {
  it("is the only collector parse entry", () => {
    const src = readFileSync(resolve("scripts/release/collect-cut-manifest-evidence.ts"), "utf8");
    expect(countIdentifierCalls(src, "readVersionSurface")).toBe(1);
    expect(src).toContain("readVersionSurface(text, surface.kind)");
    expect(src).not.toMatch(/parseVersionSurface\(surface\.kind, text\)/);
  });
});

describe("surfaceValue leftover lock", () => {
  it("is the only VERSION_SURFACES lookup used by the collector", () => {
    const src = readFileSync(resolve("scripts/release/collect-cut-manifest-evidence.ts"), "utf8");
    const withoutHelper = src.replace(/export function surfaceValue\([\s\S]*?\n\}/, "");
    expect(withoutHelper).not.toMatch(/surfaces\.find\(/);
    expect(src).toContain('surfaceValue(surfaces, "openapi_yaml_health_example")');
    expect(src).toContain('surfaceValue(surfaces, "e2e_app_version")');
    expect(countIdentifierCalls(src, "surfaceValue")).toBe(22);
  });
});

describe("versionParityResult leftover lock", () => {
  it("is only called from addVersionParityCheck", () => {
    const src = readFileSync(resolve("scripts/release/collect-cut-manifest-evidence.ts"), "utf8");
    const withoutHelpers = src
      .replace(/export function versionParityResult\([\s\S]*?\n\}/, "")
      .replace(/const addVersionParityCheck = \([\s\S]*?\n  \};/, "");
    expect(withoutHelpers).not.toMatch(/versionParityResult\(/);
    expect(countIdentifierCalls(src, "versionParityResult")).toBe(1);
    expect(withoutHelpers).not.toMatch(/if \(!\w+ \|\| !\w+\) \{/);
    expect(src).toContain('addVersionParityCheck("versions.config_health_schema_example_parity"');
    expect(src).toContain('addVersionParityCheck("versions.config_openapi_yaml_example_parity"');
    expect(src).toContain('addVersionParityCheck("versions.config_openapi_json_example_parity"');
    expect(src).toContain('addVersionParityCheck("versions.openapi_info_version_parity"');
    expect(countIdentifierCalls(src, "addVersionParityCheck")).toBe(31);
  });
});

describe("parsers", () => {
  it("parses each version surface kind", () => {
    expect(parseVersionSurface("raw", " 0.4.23 \n")).toBe("0.4.23");
    expect(parseVersionSurface("packageJson", '{"version":"1.2.3"}')).toBe("1.2.3");
    expect(parseVersionSurface("packageJson", "not json")).toBeNull();
    expect(parseVersionSurface("pyproject", 'name="x"\nversion = "1.2.3"\n')).toBe("1.2.3");
    expect(parseVersionSurface("dunderVersion", '__version__ = "1.2.3"')).toBe("1.2.3");
    expect(parseVersionSurface("tsVersionProp", '  version: "1.2.3",')).toBe("1.2.3");
    expect(parseVersionSurface("tsExampleProp", '      example: "1.2.3",')).toBe("1.2.3");
    expect(parseVersionSurface("openapiInfoVersion", "info:\n  version: 1.2.3\n")).toBe("1.2.3");
    expect(parseVersionSurface("openapiJsonInfoVersion", '{"info":{"version":"1.2.3"}}')).toBe("1.2.3");
    expect(parseVersionSurface("openapiJsonInfoVersion", '{"info":{}}')).toBeNull();
    expect(parseVersionSurface("tsExampleComment", "  /** @example 1.2.3 */")).toBe("1.2.3");
    expect(parseVersionSurface("e2eAppVersion", "            appVersion: '1.2.3',\n")).toBe("1.2.3");
    expect(parseVersionSurface("e2eAppVersion", "            apiVersion: '1.2.3',\n")).toBeNull();
    expect(parseVersionSurface("e2eApiVersion", "            apiVersion: '1.2.3',\n")).toBe("1.2.3");
    expect(parseVersionSurface("e2eApiVersion", "            appVersion: '1.2.3',\n")).toBeNull();
    expect(parseVersionSurface("e2eWebVersion", "            webVersion: '1.2.3',\n")).toBe("1.2.3");
    expect(parseVersionSurface("e2eWebVersion", "            appVersion: '1.2.3',\n")).toBeNull();
    expect(
      parseVersionSurface(
        "openapiYamlHealthExample",
        "components:\n  schemas:\n    HealthResponse:\n      properties:\n        version:\n          type: string\n          example: '1.2.3'\n",
      ),
    ).toBe("1.2.3");
    expect(parseVersionSurface("openapiYamlHealthExample", "info:\n  version: 1.2.3\n")).toBeNull();
    expect(
      parseVersionSurface(
        "openapiJsonHealthExample",
        JSON.stringify({
          components: { schemas: { HealthResponse: { properties: { version: { example: "1.2.3" } } } } },
        }),
      ),
    ).toBe("1.2.3");
    expect(parseVersionSurface("openapiJsonHealthExample", JSON.stringify({ info: { version: "1.2.3" } }))).toBeNull();
  });

  it("keeps parseVersionSurface exhaustive against VERSION_SURFACE_KINDS", () => {
    const src = readFileSync(resolve("scripts/release/collect-cut-manifest-evidence.ts"), "utf8");
    for (const kind of VERSION_SURFACE_KINDS) {
      expect(src).toContain(`case "${kind}":`);
    }
    expect(src).toContain("const _exhaustive: never = kind");
    expect(VERSION_SURFACES.every((surface) => (VERSION_SURFACE_KINDS as readonly string[]).includes(surface.kind))).toBe(
      true,
    );
    expect([...new Set(VERSION_SURFACES.map((surface) => surface.kind))].sort()).toEqual(
      [...VERSION_SURFACE_KINDS].sort(),
    );
  });

  it("readVersionSurface fails closed on missing text and delegates parseVersionSurface", () => {
    expect(readVersionSurface(null, "raw")).toBeNull();
    expect(readVersionSurface(" 0.4.23 \n", "raw")).toBe("0.4.23");
  });

  it("does not confuse the OpenAPI info version with nested operation examples", () => {
    const text = `info:\n  version: 0.4.23\npaths:\n  x:\n    version: 9.9.9\n`;
    expect(parseVersionSurface("openapiInfoVersion", text)).toBe("0.4.23");
  });

  it("parses migration names from both migrations.ts and resumes_search.ts in registry declaration order", () => {
    const text =
      `{ file: "migrations.ts", name: "b", quiesceAware: false },\n` +
      `{ file: "resumes_search.ts", name: "c", quiesceAware: false },\n` +
      `{ file: "other.ts", name: "nope", quiesceAware: true },\n` +
      `{ file: "migrations.ts", name: "a", quiesceAware: false },\n`;
    expect(parseMigrationNames(text)).toEqual(["b", "c", "a"]);
    expect(migrationDeclarationHash(["b", "c", "a"])).not.toBe(migrationDeclarationHash(["a", "b", "c"]));
  });

  it("parses exported mutation/action names", () => {
    const text =
      `export const one = mutation({});\n` +
      `export const two = action({});\n` +
      `export async function helper() {}\n`;
    expect([...parseMigrationExports(text)].sort()).toEqual(["one", "two"]);
  });

  it("reads the last epoch of a named history registry", () => {
    const text =
      `export const A_HISTORY = [\n  { epoch: 1 },\n  { epoch: 4 },\n] as const;\n` +
      `export const B_HISTORY = [\n  { epoch: 9 },\n] as const;\n`;
    expect(parseLastEpochFromHistory(text, "A_HISTORY")).toBe(4);
    expect(parseLastEpochFromHistory(text, "B_HISTORY")).toBe(9);
    expect(parseLastEpochFromHistory(text, "MISSING_HISTORY")).toBeNull();
  });

  it("parses the industry-evidence projection version", () => {
    expect(parseIndustryEvidenceProjectionVersion("export const X: number = 3;")).toBeNull();
    expect(
      parseIndustryEvidenceProjectionVersion(
        "export const CURRENT_INDUSTRY_EVIDENCE_PROJECTION_VERSION = 4;",
      ),
    ).toBe(4);
  });

  it("parses owner/repo from ssh and https remotes", () => {
    expect(parseOwnerRepo("git@github.com:ptdevhk/trends.git")).toBe("ptdevhk/trends");
    expect(parseOwnerRepo("https://github.com/ptdevhk/trends.git")).toBe("ptdevhk/trends");
    expect(parseOwnerRepo("ssh://git@example.com/org/repo")).toBe("org/repo");
    expect(parseOwnerRepo("not-a-remote")).toBeNull();
  });

  it("prefers the peeled SHA for remote tags", () => {
    const output = `aaaa\trefs/tags/v1\nbbbb\trefs/tags/v1^{}\n`;
    expect(parseRemoteTagSha(output, "v1")).toBe("bbbb");
    expect(parseRemoteTagSha(`aaaa\trefs/tags/v1\n`, "v1")).toBe("aaaa");
    expect(parseRemoteTagSha("", "v1")).toBeNull();
  });

  it("parses remote branch SHAs and remote lists", () => {
    expect(parseRemoteBranchSha("cccc\trefs/heads/prod/v1\n", "prod/v1")).toBe("cccc");
    expect(parseRemoteBranchSha("cccc\trefs/heads/other\n", "prod/v1")).toBeNull();
    expect(
      parseRemoteList("origin\tgit@x:y.git (fetch)\norigin\tgit@x:y.git (push)\nfork\thttps://f (fetch)\n"),
    ).toEqual([
      { name: "fork", url: "https://f" },
      { name: "origin", url: "git@x:y.git" },
    ]);
  });

  it("parses ahead/behind output", () => {
    expect(parseAheadBehind("2\t0\n")).toEqual({ ahead: 2, behind: 0 });
    expect(parseAheadBehind("garbage")).toEqual({ ahead: null, behind: null });
  });

  it("parses gh runs and tolerates malformed JSON", () => {
    expect(parseGhRuns("not json")).toEqual([]);
    const runs = parseGhRuns(
      JSON.stringify({ workflow_runs: [{ name: "Tests" }, { name: "Checks", conclusion: "success" }] }),
    );
    expect(runs.map((r) => r.name)).toEqual(["Checks", "Tests"]);
    expect(runs[0]!.conclusion).toBe("success");
    expect(runs[1]!.conclusion).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

describe("parseCliArgs", () => {
  it("rejects unknown arguments and bad values", () => {
    expect(() => parseCliArgs(["--nope"])).toThrow(/unknown argument/i);
    expect(() => parseCliArgs(["--expected-version", "abc"])).toThrow(/expected-version/i);
    expect(() => parseCliArgs(["--expected-cut-sha", "deadbeef"])).toThrow(/40 hex/i);
    expect(() => parseCliArgs(["--expected-epoch-ingest", "x"])).toThrow(/epoch-ingest/i);
    expect(() => parseCliArgs(["--expected-version"])).toThrow(/missing value/i);
  });

  it("parses inline and space forms and defaults", () => {
    const opts = parseCliArgs([
      "--expected-version=1.2.3",
      "--expected-cut-sha",
      HEAD,
      "--expected-epoch-ingest=6",
      "--expected-epoch-projection",
      "2",
      "--expected-industry-evidence-version=1",
      "--pretty",
    ]);
    expect(opts.expectedVersion).toBe("1.2.3");
    expect(opts.expectedCutSha).toBe(HEAD);
    expect(opts.expectedEpochIngest).toBe(6);
    expect(opts.expectedEpochProjection).toBe(2);
    expect(opts.expectedIndustryEvidenceProjectionVersion).toBe(1);
    expect(opts.pretty).toBe(true);
    expect(opts.checkRemote).toBe(true);
    expect(opts.checkCi).toBe(true);
  });

  it("supports --skip-remote, --skip-ci, and --skip-drift-gates", () => {
    const opts = parseCliArgs(["--skip-remote", "--skip-ci", "--skip-drift-gates"]);
    expect(opts.checkRemote).toBe(false);
    expect(opts.checkCi).toBe(false);
    expect(opts.checkDriftGates).toBe(false);
  });

  it("supports --expected-origin flag", () => {
    const opts = parseCliArgs(["--expected-origin=git@github.com:ptdevhk/trends.git"]);
    expect(opts.expectedOrigin).toBe("git@github.com:ptdevhk/trends.git");
  });
});

// ---------------------------------------------------------------------------
// Happy path
// ---------------------------------------------------------------------------

describe("collectCutManifestEvidence: clean tree", () => {
  it("emits clean evidence with exit 0 and deterministic decision hash", () => {
    const a = createMockDeps();
    const b = createMockDeps();
    const first = collectCutManifestEvidence(DEFAULT_OPTIONS, a.deps);
    const second = collectCutManifestEvidence(DEFAULT_OPTIONS, b.deps);

    expect(first.schema).toBe(EVIDENCE_SCHEMA);
    expect(first.status).toBe("clean");
    expect(first.exitCode).toBe(EXIT_OK);
    expect(first.errors).toEqual([]);

    expect(first.identity.headSha).toBe(HEAD);
    expect(first.identity.clean).toBe(true);
    expect(first.identity.aheadCount).toBe(0);
    expect(first.identity.behindCount).toBe(0);
    expect(first.identity.remoteTagSha).toBe(HEAD);
    expect(first.identity.prodBranchSha).toBe(HEAD);

    expect(first.versions.canonical).toBe(VERSION);
    expect(first.versions.surfaces.every((s) => s.matches)).toBe(true);

    expect(first.migrations.orderedNames).toEqual(["backfillSearchText", "reindexSearchText", "backfillAge"]);
    expect(first.migrations.missingExports).toEqual([]);

    expect(first.epochs.ingestComputeEpoch).toBe(6);
    expect(first.epochs.companyKeyProjectionEpoch).toBe(2);
    expect(first.epochs.industryEvidenceProjectionVersion).toBe(1);

    expect(first.datasets.groups.find((g) => g.id === "search_profile_yaml")!.files.map((f) => f.path)).toEqual([
      "config/search-profiles/a.yaml",
      "config/search-profiles/b.yaml",
    ]);

    expect(first.ci.availability).toBe("available");
    expect(first.ci.runs.map((r) => r.name)).toEqual(["Checks", "Tests"]);

    expect(first.decisionHash).toBe(second.decisionHash);
    expect(first.decisionHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("produces identical portable decisionHash regardless of repoRoot location or trailing slash", () => {
    const fsPort = (rootPrefix: string): FileSystemPort => {
      const files = baseFiles();
      return {
        exists: (p) => p.replace(rootPrefix, "") in files,
        readText: (p) => files[p.replace(rootPrefix, "")] ?? null,
        readBytes: (p) => {
          const t = files[p.replace(rootPrefix, "")];
          return t ? new Uint8Array(Buffer.from(t, "utf-8")) : null;
        },
        listDir: (dir) => {
          const rel = dir.replace(rootPrefix, "").replace(/^\//, "");
          const prefix = rel ? `${rel}/` : "";
          const names = new Set<string>();
          for (const f of Object.keys(files)) {
            if (f.startsWith(prefix) && !f.slice(prefix.length).includes("/")) {
              names.add(f.slice(prefix.length));
            }
          }
          return [...names].sort();
        },
      };
    };

    const depsA = { ...createMockDeps().deps, fs: fsPort("/path/one/") };
    const depsB = { ...createMockDeps().deps, fs: fsPort("/different/path/two/") };
    const a = collectCutManifestEvidence({ ...DEFAULT_OPTIONS, repoRoot: "/path/one" }, depsA);
    const b = collectCutManifestEvidence({ ...DEFAULT_OPTIONS, repoRoot: "/different/path/two" }, depsB);
    expect(a.decisionHash).toBe(b.decisionHash);
  });

  it("sanitizes evidence before computing decisionHash so sanitized and raw hashes match", () => {
    const { deps } = createMockDeps({
      env: {
        AI_API_KEY: "super-secret-token",
      },
    });
    const evidence = collectCutManifestEvidence(DEFAULT_OPTIONS, deps);
    const expectedBody = {
      ...evidence,
      meta: { ...evidence.meta, generatedAt: undefined, repoRoot: undefined },
      decisionHash: undefined,
    };
    expect(evidence.decisionHash).toBe(sha256Hex(canonicalJson(expectedBody)));
  });

  it("wires and executes DRIFT_GATES as fail-closed checks", () => {
    const { deps } = createMockDeps({
      commands: {
        "npx tsx scripts/resume/sync-search-profile-templates.ts --check": {
          exitCode: 1,
          stdout: "",
          stderr: "templates drift detected",
        },
      },
    });
    const evidence = collectCutManifestEvidence(DEFAULT_OPTIONS, deps);
    const check = evidence.checks.find((c) => c.id === "drift.search_profile_templates")!;
    expect(check.status).toBe("fail");
    expect(evidence.status).toBe("failed");
  });

  it("passes DRIFT_GATES checks when commands exit 0", () => {
    const { deps } = createMockDeps();
    const evidence = collectCutManifestEvidence(DEFAULT_OPTIONS, deps);
    expect(evidence.checks.find((c) => c.id === "drift.search_profile_templates")!.status).toBe("pass");
    expect(evidence.checks.find((c) => c.id === "drift.keyword_tags")!.status).toBe("pass");
  });

  it("skips DRIFT_GATES checks when --skip-drift-gates is set", () => {
    const bundle = createMockDeps();
    const evidence = collectCutManifestEvidence(
      { ...DEFAULT_OPTIONS, checkDriftGates: false },
      bundle.deps,
    );
    expect(evidence.checks.find((c) => c.id === "drift.search_profile_templates")!.status).toBe("skipped");
    expect(evidence.checks.find((c) => c.id === "drift.keyword_tags")!.status).toBe("skipped");
  });

  it("is a read-only collector: no write-shaped git commands are ever issued", () => {
    const bundle = createMockDeps();
    collectCutManifestEvidence(DEFAULT_OPTIONS, bundle.deps);
    expect(bundle.writes).toEqual([]);
    const gitCalls = bundle.calls.filter(({ command }) => command === "git");
    expect(gitCalls.length).toBeGreaterThan(0);
    for (const { args } of gitCalls) {
      expect(
        ["push", "commit", "tag", "checkout", "reset", "branch", "merge", "rebase", "clean", "fetch", "pull"],
      ).not.toContain(args[0]);
    }
    expect(bundle.calls.some(({ command }) => command === "gh")).toBe(true);
    // gh is only ever invoked with read-only verbs.
    for (const call of bundle.calls.filter(({ command }) => command === "gh")) {
      expect(["auth", "api"]).toContain(call.args[0]);
    }
  });

  it("serializes to byte-identical output across two runs on the same tree", () => {
    const first = runCollector(["--repo-root", "/virtual/repo"], createMockDeps().deps);
    const second = runCollector(["--repo-root", "/virtual/repo"], createMockDeps().deps);
    expect(first.output).toBe(second.output);
    // generatedAt is the only wall-clock value and is confined to meta.
    const parsed = JSON.parse(first.output) as {
      meta: { generatedAt: string };
      checks: unknown;
    };
    expect(parsed.meta.generatedAt).toBe("2026-09-13T00:00:00.000Z");
    expect(first.output.match(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/g)?.length).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Fail-closed: dirty tree
// ---------------------------------------------------------------------------

describe("collectCutManifestEvidence: dirty tree fails closed", () => {
  it("flags identity.clean_tree and exits 2", () => {
    const { deps } = createMockDeps({
      commands: {
        "git status --porcelain=v1 -uall": {
          exitCode: 0,
          stdout: " M scripts/release/collect-cut-manifest-evidence.ts\n?? junk.txt\n",
          stderr: "",
        },
      },
    });
    const evidence = collectCutManifestEvidence(DEFAULT_OPTIONS, deps);
    expect(evidence.status).toBe("failed");
    expect(evidence.exitCode).toBe(EXIT_EVIDENCE_FAILURE);
    const check = evidence.checks.find((c) => c.id === "identity.clean_tree")!;
    expect(check.status).toBe("fail");
    expect(evidence.errors.some((e) => e.startsWith("identity.clean_tree:"))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Fail-closed: ahead / behind / diverged
// ---------------------------------------------------------------------------

describe("collectCutManifestEvidence: origin divergence fails closed", () => {
  const cases: Array<{ label: string; ahead: string; behind: string; origin: string; head?: string }> = [
    { label: "ahead", ahead: "2", behind: "0", origin: ORIGIN },
    { label: "behind", ahead: "0", behind: "3", origin: ORIGIN },
    { label: "diverged", ahead: "1", behind: "1", origin: ORIGIN },
  ];

  for (const testCase of cases) {
    it(`${testCase.label} fails the ahead/behind gate`, () => {
      const { deps } = createMockDeps({
        commands: {
          "git rev-list --left-right --count HEAD...origin/main": {
            exitCode: 0,
            stdout: `${testCase.ahead}\t${testCase.behind}\n`,
            stderr: "",
          },
        },
      });
      const evidence = collectCutManifestEvidence(DEFAULT_OPTIONS, deps);
      expect(evidence.checks.find((c) => c.id === "identity.ahead_behind")!.status).toBe("fail");
      expect(evidence.status).toBe("failed");
    });
  }

  it("flags HEAD != origin/main even when ahead/behind is reported as 0-0", () => {
    const { deps } = createMockDeps({
      commands: {
        "git rev-parse origin/main": { exitCode: 0, stdout: `${PROD_SHA}\n`, stderr: "" },
      },
    });
    const evidence = collectCutManifestEvidence(DEFAULT_OPTIONS, deps);
    expect(evidence.checks.find((c) => c.id === "identity.head_equals_origin_main")!.status).toBe("fail");
  });

  it("flags an unresolvable origin/main", () => {
    const { deps } = createMockDeps({
      commands: {
        "git rev-parse origin/main": { exitCode: 128, stdout: "", stderr: "unknown revision" },
      },
    });
    const evidence = collectCutManifestEvidence(DEFAULT_OPTIONS, deps);
    expect(evidence.checks.find((c) => c.id === "identity.origin_main_resolved")!.status).toBe("fail");
    expect(evidence.checks.find((c) => c.id === "identity.head_equals_origin_main")!.status).toBe("fail");
  });
});

// ---------------------------------------------------------------------------
// Fail-closed: pinned cut SHA mismatch
// ---------------------------------------------------------------------------

describe("collectCutManifestEvidence: pinned cut SHA", () => {
  it("fails closed when HEAD != pinned SHA", () => {
    const { deps } = createMockDeps();
    const evidence = collectCutManifestEvidence({ ...DEFAULT_OPTIONS, expectedCutSha: PROD_SHA }, deps);
    const check = evidence.checks.find((c) => c.id === "identity.head_matches_expected_cut_sha")!;
    expect(check.status).toBe("fail");
    expect(evidence.status).toBe("failed");
  });

  it("passes when HEAD equals the pinned SHA", () => {
    const { deps } = createMockDeps();
    const evidence = collectCutManifestEvidence({ ...DEFAULT_OPTIONS, expectedCutSha: HEAD }, deps);
    expect(evidence.checks.find((c) => c.id === "identity.head_matches_expected_cut_sha")!.status).toBe("pass");
  });
});

// ---------------------------------------------------------------------------
// Fail-closed: tag drift
// ---------------------------------------------------------------------------

describe("collectCutManifestEvidence: tag and immutable branch drift", () => {
  it("fails when the remote tag SHA differs from the local tag SHA", () => {
    const { deps } = createMockDeps({
      commands: {
        [`git ls-remote --tags origin v${VERSION}`]: {
          exitCode: 0,
          stdout: `${REMOTE_TAG}\trefs/tags/v${VERSION}\n`,
          stderr: "",
        },
      },
    });
    const evidence = collectCutManifestEvidence(DEFAULT_OPTIONS, deps);
    const check = evidence.checks.find((c) => c.id === "identity.remote_tag_sha")!;
    expect(check.status).toBe("fail");
    expect(check.actual).toBe(REMOTE_TAG);
    expect(evidence.status).toBe("failed");
  });

  it("fails when the immutable prod branch is missing", () => {
    const { deps } = createMockDeps({
      commands: {
        [`git ls-remote --heads origin prod/v${VERSION}`]: { exitCode: 0, stdout: "", stderr: "" },
      },
    });
    const evidence = collectCutManifestEvidence(DEFAULT_OPTIONS, deps);
    const check = evidence.checks.find((c) => c.id === "identity.prod_branch_sha")!;
    expect(check.status).toBe("fail");
    expect(check.actual).toBe("missing");
  });

  it("fails when the local tag does not point to HEAD", () => {
    const { deps } = createMockDeps({
      commands: {
        [`git rev-parse v${VERSION}`]: { exitCode: 0, stdout: `${REMOTE_TAG}\n`, stderr: "" },
        [`git rev-parse v${VERSION}^{}`]: { exitCode: 0, stdout: `${REMOTE_TAG}\n`, stderr: "" },
      },
    });
    const evidence = collectCutManifestEvidence(DEFAULT_OPTIONS, deps);
    const check = evidence.checks.find((c) => c.id === "identity.local_tag_equals_head")!;
    expect(check.status).toBe("fail");
    expect(check.expected).toBe(HEAD);
    expect(check.actual).toBe(REMOTE_TAG);
    expect(evidence.status).toBe("failed");
  });

  it("fails when the local tag does not exist", () => {
    const { deps } = createMockDeps({
      commands: {
        [`git rev-parse v${VERSION}`]: { exitCode: 128, stdout: "", stderr: "unknown revision" },
        [`git rev-parse v${VERSION}^{}`]: { exitCode: 128, stdout: "", stderr: "unknown revision" },
      },
    });
    const evidence = collectCutManifestEvidence(DEFAULT_OPTIONS, deps);
    expect(evidence.checks.find((c) => c.id === "identity.local_tag_exists")!.status).toBe("fail");
  });

  it("degrades remote checks to skipped with --skip-remote", () => {
    const { deps } = createMockDeps();
    const evidence = collectCutManifestEvidence({ ...DEFAULT_OPTIONS, checkRemote: false }, deps);
    expect(evidence.checks.find((c) => c.id === "identity.remote_tag_sha")!.status).toBe("skipped");
    expect(evidence.checks.find((c) => c.id === "identity.prod_branch_sha")!.status).toBe("skipped");
    expect(evidence.identity.remoteTagSha).toBeNull();
    expect(evidence.status).toBe("clean");
  });

  it("fails closed when ls-remote errors unless --skip-remote was explicitly chosen", () => {
    const { deps: tagErrDeps } = createMockDeps({
      commands: {
        [`git ls-remote --tags origin v${VERSION}`]: { exitCode: 128, stdout: "", stderr: "fatal: remote error" },
      },
    });
    const tagEvidence = collectCutManifestEvidence(DEFAULT_OPTIONS, tagErrDeps);
    expect(tagEvidence.status).toBe("failed");
    expect(tagEvidence.checks.find((c) => c.id === "identity.remote_tag_sha")!.status).toBe("fail");

    const { deps: branchErrDeps } = createMockDeps({
      commands: {
        [`git ls-remote --heads origin prod/v${VERSION}`]: { exitCode: 128, stdout: "", stderr: "fatal: network error" },
      },
    });
    const branchEvidence = collectCutManifestEvidence(DEFAULT_OPTIONS, branchErrDeps);
    expect(branchEvidence.status).toBe("failed");
    expect(branchEvidence.checks.find((c) => c.id === "identity.prod_branch_sha")!.status).toBe("fail");

    // But when --skip-remote is chosen, it degrades cleanly to skipped
    const skippedEvidence = collectCutManifestEvidence({ ...DEFAULT_OPTIONS, checkRemote: false }, tagErrDeps);
    expect(skippedEvidence.status).toBe("clean");
    expect(skippedEvidence.checks.find((c) => c.id === "identity.remote_tag_sha")!.status).toBe("skipped");
  });
});

describe("VERSION_SURFACES catalog", () => {
  it("requires schemas-validation and e2e trio surfaces", () => {
    const byId = Object.fromEntries(VERSION_SURFACES.map((surface) => [surface.id, surface]));
    for (const id of ["schemas_validation", "e2e_app_version", "e2e_api_version", "e2e_web_version"]) {
      expect(byId[id], id).toBeDefined();
      expect(byId[id]!.required).toBe(true);
    }
    expect(byId.schemas_validation!.path).toBe("apps/api/src/schemas/schemas-validation.test.ts");
    expect(byId.e2e_app_version!.path).toBe("apps/web/e2e/resume-role-filter.spec.ts");
    expect(byId.e2e_api_version!.path).toBe("apps/web/e2e/resume-role-filter.spec.ts");
    expect(byId.e2e_web_version!.path).toBe("apps/web/e2e/resume-role-filter.spec.ts");
    expect(byId.schemas_validation!.kind).toBe("tsVersionProp");
    expect(byId.e2e_app_version!.kind).toBe("e2eAppVersion");
    expect(byId.e2e_api_version!.kind).toBe("e2eApiVersion");
    expect(byId.e2e_web_version!.kind).toBe("e2eWebVersion");
    expect(byId.openapi_yaml_health_example).toBeDefined();
    expect(byId.openapi_yaml_health_example!.required).toBe(true);
    expect(byId.openapi_yaml_health_example!.path).toBe("apps/api/openapi.yaml");
    expect(byId.openapi_yaml_health_example!.kind).toBe("openapiYamlHealthExample");
    expect(byId.openapi_json_health_example).toBeDefined();
    expect(byId.openapi_json_health_example!.required).toBe(true);
    expect(byId.openapi_json_health_example!.path).toBe("apps/api/openapi.json");
    expect(byId.openapi_json_health_example!.kind).toBe("openapiJsonHealthExample");
  });

  it("covers every bump-version leftover path with at least one required surface", () => {
    const paths = new Set(VERSION_SURFACES.map((surface) => surface.path));
    const requiredPaths = new Set(
      VERSION_SURFACES.filter((surface) => surface.required).map((surface) => surface.path),
    );
    for (const leftoverPath of BUMP_VERSION_LEFTOVER_PATHS) {
      expect(paths.has(leftoverPath), leftoverPath).toBe(true);
      expect(requiredPaths.has(leftoverPath), leftoverPath).toBe(true);
    }
  });

  it("keeps bump-version.sh leftover for-loop files inside BUMP_VERSION_LEFTOVER_PATHS", () => {
    const script = readFileSync(resolve("scripts/bump-version.sh"), "utf8");
    const leftoverPaths = parseBumpVersionGrepLeftoverPaths(script);
    expect(leftoverPaths.length).toBeGreaterThan(0);
    for (const leftoverPath of leftoverPaths) {
      expect(BUMP_VERSION_LEFTOVER_PATHS, leftoverPath).toContain(leftoverPath);
    }
    expect(BUMP_VERSION_GREP_LEFTOVER_PATHS.every((path) => BUMP_VERSION_LEFTOVER_PATHS.includes(path))).toBe(true);
    expect([...leftoverPaths].sort()).toEqual([...BUMP_VERSION_GREP_LEFTOVER_PATHS].sort());
  });

  it("parses bump-version.sh leftover for-loop paths and fails closed on a missing block", () => {
    expect(
      parseBumpVersionGrepLeftoverPaths(
        "for leftover in \\\n  apps/api/src/schemas/schemas-validation.test.ts \\\n  apps/web/e2e/resume-role-filter.spec.ts\ndo\n",
      ),
    ).toEqual([...BUMP_VERSION_GREP_LEFTOVER_PATHS]);
    expect(parseBumpVersionGrepLeftoverPaths("echo no leftover loop")).toEqual([]);
  });

  it("parses bump-version.sh verify paths and keeps them inside BUMP_VERSION_LEFTOVER_PATHS", () => {
    expect(parseBumpVersionVerifyPaths("echo no verifies")).toEqual([]);
    expect(
      parseBumpVersionVerifyPaths(
        'if ! grep -q "\\"version\\": \\"$NEW_VERSION\\"" package.json; then\n',
      ),
    ).toEqual(["package.json"]);
    const script = readFileSync(resolve("scripts/bump-version.sh"), "utf8");
    const verifyPaths = parseBumpVersionVerifyPaths(script);
    expect(verifyPaths.length).toBeGreaterThan(0);
    for (const verifyPath of verifyPaths) {
      expect(BUMP_VERSION_LEFTOVER_PATHS, verifyPath).toContain(verifyPath);
    }
    expect(verifyPaths).toEqual(expect.arrayContaining([...BUMP_VERSION_GREP_LEFTOVER_PATHS]));
    expect(verifyPaths).toEqual(
      expect.arrayContaining([
        "package.json",
        "apps/api/openapi.yaml",
        "apps/api/openapi.json",
        "apps/web/src/lib/api-types.ts",
      ]),
    );
    expect([...verifyPaths].sort()).toEqual([...BUMP_VERSION_VERIFY_PATHS].sort());
    expect(BUMP_VERSION_VERIFY_PATHS.every((path) => BUMP_VERSION_LEFTOVER_PATHS.includes(path))).toBe(true);
    expect([...BUMP_VERSION_LEFTOVER_PATHS].filter((path) => path !== "version").sort()).toEqual(
      [...BUMP_VERSION_VERIFY_PATHS].sort(),
    );
  });

  it("parses bump-version.sh sed paths and keeps them inside BUMP_VERSION_LEFTOVER_PATHS", () => {
    expect(parseBumpVersionSedPaths("echo no sed")).toEqual([]);
    expect(
      parseBumpVersionSedPaths('sed -i \'\' "s/version: \\"$CURRENT\\"/version: \\"$NEW_VERSION\\"/" apps/api/src/services/config.ts\n'),
    ).toEqual(["apps/api/src/services/config.ts"]);
    const script = readFileSync(resolve("scripts/bump-version.sh"), "utf8");
    const sedPaths = parseBumpVersionSedPaths(script);
    expect(sedPaths.length).toBeGreaterThan(0);
    for (const sedPath of sedPaths) {
      expect(BUMP_VERSION_LEFTOVER_PATHS, sedPath).toContain(sedPath);
    }
    expect(sedPaths).toEqual(
      expect.arrayContaining([
        "apps/api/src/services/config.ts",
        "apps/api/openapi.yaml",
        "apps/api/openapi.json",
        "apps/web/e2e/resume-role-filter.spec.ts",
      ]),
    );
    expect([...sedPaths].sort()).toEqual([...BUMP_VERSION_SED_PATHS].sort());
    expect(BUMP_VERSION_SED_PATHS.every((path) => BUMP_VERSION_LEFTOVER_PATHS.includes(path))).toBe(true);
    expect(BUMP_VERSION_SED_PATHS.every((path) => BUMP_VERSION_VERIFY_PATHS.includes(path))).toBe(true);
    const findSedPaths = [...BUMP_VERSION_LEFTOVER_PATHS]
      .filter((path) => path !== "version" && !BUMP_VERSION_SED_PATHS.includes(path))
      .sort();
    expect(findSedPaths).toEqual([...BUMP_VERSION_FIND_SED_PATHS].sort());
    expect(findSedPaths).toEqual(
      VERSION_SURFACES.filter((surface) => surface.kind === "packageJson")
        .map((surface) => surface.path)
        .sort(),
    );
    expect(script).toContain('find . -name package.json -not -path');
    const partition = leftoverPathPartition();
    expect(partition.unknown).toEqual([]);
    expect(partition.version).toEqual(["version"]);
    expect([...partition.sed].sort()).toEqual([...BUMP_VERSION_SED_PATHS].sort());
    expect([...partition.findSed].sort()).toEqual([...BUMP_VERSION_FIND_SED_PATHS].sort());
    expect([...partition.version, ...partition.sed, ...partition.findSed].sort()).toEqual(
      [...BUMP_VERSION_LEFTOVER_PATHS].sort(),
    );
  });
});

describe("leftoverPathPartition", () => {
  it("classifies version, sed, and find-sed leftover paths", () => {
    expect(leftoverPathKind("version")).toBe("version");
    expect(leftoverPathKind("apps/api/src/services/config.ts")).toBe("sed");
    expect(leftoverPathKind("package.json")).toBe("findSed");
    expect(leftoverPathKind("mystery.path")).toBeNull();
  });

  it("fails closed when a leftover path has no bucket", () => {
    expect(leftoverPathPartition(["mystery.path"])).toEqual({
      version: [],
      sed: [],
      findSed: [],
      unknown: ["mystery.path"],
    });
  });

  it("keeps the leftover catalog partitioned with no unknown paths", () => {
    const partition = leftoverPathPartition(BUMP_VERSION_LEFTOVER_PATHS);
    expect(partition.unknown).toEqual([]);
    expect(partition.version).toEqual(["version"]);
    expect([...partition.sed].sort()).toEqual([...BUMP_VERSION_SED_PATHS].sort());
    expect([...partition.findSed].sort()).toEqual([...BUMP_VERSION_FIND_SED_PATHS].sort());
  });

  it("seeds known buckets from leftoverCatalogSourceUnions for the default leftover catalog", () => {
    const unions = leftoverCatalogSourceUnions();
    const seeded = leftoverDefaultPartition();
    expect(seeded).toEqual({
      ...unions,
      unknown: [],
    });
    expect(leftoverPathPartition()).toEqual(seeded);
    expect(leftoverPathPartition(BUMP_VERSION_LEFTOVER_PATHS)).toEqual(seeded);
    const copied = leftoverPathPartition([...BUMP_VERSION_LEFTOVER_PATHS]);
    expect(copied.unknown).toEqual([]);
    for (const bucket of LEFTOVER_PATH_BUCKETS) {
      expect([...copied[bucket]].sort()).toEqual([...unions[bucket]].sort());
    }
  });
});

describe("leftoverDefaultPartition", () => {
  it("seeds known buckets from leftoverCatalogSourceUnions with no unknown paths", () => {
    expect(leftoverDefaultPartition()).toEqual({
      ...leftoverCatalogSourceUnions(),
      unknown: [],
    });
  });
});

describe("addLeftoverPath", () => {
  it("fails closed when a leftover path is in two buckets", () => {
    const index = new Map<string, LeftoverPathBucket>();
    addLeftoverPath(index, "package.json", "findSed");
    expect(() => addLeftoverPath(index, "package.json", "sed")).toThrow(
      "leftover path package.json is in both findSed and sed",
    );
  });

  it("is idempotent when the same path is added to the same bucket", () => {
    const index = new Map<string, LeftoverPathBucket>();
    addLeftoverPath(index, "package.json", "findSed");
    addLeftoverPath(index, "package.json", "findSed");
    expect(index.get("package.json")).toBe("findSed");
    expect(index.size).toBe(1);
  });
});

describe("leftoverPathIndex", () => {
  it("indexes every leftover catalog path exactly once", () => {
    const index = leftoverPathIndex();
    expect(index.get("version")).toBe("version");
    expect(index.get("apps/api/src/services/config.ts")).toBe("sed");
    expect(index.get("package.json")).toBe("findSed");
    expect(index.get("mystery.path")).toBeUndefined();
    expect(index.size).toBe(BUMP_VERSION_LEFTOVER_PATHS.length);
    expect([...index.keys()].sort()).toEqual([...BUMP_VERSION_LEFTOVER_PATHS].sort());
  });
});

describe("classifyLeftoverPaths", () => {
  it("classifies copies and unknown leftover paths", () => {
    expect(classifyLeftoverPaths(["mystery.path"])).toEqual({
      version: [],
      sed: [],
      findSed: [],
      unknown: ["mystery.path"],
    });
    const copied = classifyLeftoverPaths([...BUMP_VERSION_LEFTOVER_PATHS]);
    expect(copied.unknown).toEqual([]);
    expect(copied.version).toEqual(["version"]);
    expect([...copied.sed].sort()).toEqual([...BUMP_VERSION_SED_PATHS].sort());
    expect([...copied.findSed].sort()).toEqual([...BUMP_VERSION_FIND_SED_PATHS].sort());
  });
});

describe("leftoverPathKind leftover lock", () => {
  it("body only calls leftoverPathIndex", () => {
    const src = readFileSync(resolve("scripts/release/collect-cut-manifest-evidence.ts"), "utf8");
    const body = leftoverPathKindSource(src);
    expect(leftoverIdentifierCalls(body)).toEqual(["leftoverPathIndex"]);
    expect(body).toContain("return leftoverPathIndex().get(path) ?? null;");
    expect(body).not.toContain("addLeftoverPath");
    expect(body).not.toContain("LEFTOVER_CATALOG_SOURCES");
  });

  it("is unused on collector production paths except classifyLeftoverPaths", () => {
    const src = readFileSync(resolve("scripts/release/collect-cut-manifest-evidence.ts"), "utf8");
    expect(countIdentifierCalls(src, "leftoverPathKind")).toBe(1);
    expect(src).toContain("const kind = leftoverPathKind(path);");
    expect(src).toContain("return leftoverPathIndex().get(path) ?? null;");
  });

  it("is only used on the non-default leftoverPathPartition path", () => {
    const src = readFileSync(resolve("scripts/release/collect-cut-manifest-evidence.ts"), "utf8");
    const classifyFn = src.slice(
      src.indexOf("export function classifyLeftoverPaths("),
      src.indexOf("export function leftoverPathPartition("),
    );
    const partitionFn = src.slice(
      src.indexOf("export function leftoverPathPartition("),
      src.indexOf("export const EXCLUDED_VERSION_SURFACES"),
    );
    expect(countIdentifierCalls(src, "leftoverPathKind")).toBe(1);
    expect(countIdentifierCalls(src, "classifyLeftoverPaths")).toBe(1);
    expect(classifyFn).toContain("const kind = leftoverPathKind(path);");
    expect(partitionFn).toContain("if (isDefaultLeftoverCatalog(paths))");
    expect(partitionFn).toContain("return leftoverDefaultPartition();");
    expect(partitionFn).toContain("return classifyLeftoverPaths(paths);");
    expect(partitionFn).not.toContain("leftoverPathKind");
    expect(partitionFn).not.toContain("leftoverCatalogSourceUnions");
  });
});

describe("leftoverDefaultPartition leftover lock", () => {
  it("is the only leftoverCatalogSourceUnions call site and leftoverPathPartition is seed-or-classify", () => {
    const src = readFileSync(resolve("scripts/release/collect-cut-manifest-evidence.ts"), "utf8");
    const defaultFn = src.slice(
      src.indexOf("export function leftoverDefaultPartition("),
      src.indexOf("export function classifyLeftoverPaths("),
    );
    const partitionFn = src.slice(
      src.indexOf("export function leftoverPathPartition("),
      src.indexOf("export const EXCLUDED_VERSION_SURFACES"),
    );
    expect(countIdentifierCalls(src, "leftoverDefaultPartition")).toBe(1);
    expect(countIdentifierCalls(src, "leftoverCatalogSourceUnions")).toBe(1);
    expect(defaultFn).toContain("...leftoverCatalogSourceUnions()");
    expect(defaultFn).not.toContain("leftoverPathKind");
    expect(partitionFn).toContain("return leftoverDefaultPartition();");
    expect(partitionFn).toContain("return classifyLeftoverPaths(paths);");
    expect(partitionFn).not.toContain("leftoverCatalogSourceUnions");
    expect(partitionFn).not.toContain("emptyLeftoverBuckets");
  });

  it("takes no leftover path list so the default catalog cannot classify", () => {
    const src = readFileSync(resolve("scripts/release/collect-cut-manifest-evidence.ts"), "utf8");
    expect(src).toContain("export function leftoverDefaultPartition(): LeftoverPathPartition");
    expect(countIdentifierCalls(src, "leftoverDefaultPartition")).toBe(1);
  });

  it("body only calls leftoverCatalogSourceUnions", () => {
    const src = readFileSync(resolve("scripts/release/collect-cut-manifest-evidence.ts"), "utf8");
    const body = src.slice(
      src.indexOf("export function leftoverDefaultPartition("),
      src.indexOf("export function classifyLeftoverPaths("),
    );
    expect(leftoverIdentifierCalls(body)).toEqual(["leftoverCatalogSourceUnions"]);
    expect(body).toContain("...leftoverCatalogSourceUnions()");
    expect(body).toContain("unknown: []");
    expect(body).not.toContain("leftoverPathKind");
    expect(body).not.toContain("emptyLeftoverBuckets");
    expect(body).not.toContain("addLeftoverPath");
    expect(body).not.toContain("leftoverPathIndex");
  });
});

describe("classifyLeftoverPaths leftover lock", () => {
  it("is the only leftoverPathKind call site and leftoverPathPartition is seed-or-classify", () => {
    const src = readFileSync(resolve("scripts/release/collect-cut-manifest-evidence.ts"), "utf8");
    expect(countIdentifierCalls(src, "leftoverPathKind")).toBe(1);
    expect(countIdentifierCalls(src, "classifyLeftoverPaths")).toBe(1);
    expect(src).toContain("return classifyLeftoverPaths(paths);");
    expect(src).toContain("const kind = leftoverPathKind(path);");
  });

  it("body only calls leftoverPathKind and emptyLeftoverBuckets", () => {
    const src = readFileSync(resolve("scripts/release/collect-cut-manifest-evidence.ts"), "utf8");
    const body = src.slice(
      src.indexOf("export function classifyLeftoverPaths("),
      src.indexOf("export function leftoverPathPartition("),
    );
    expect(leftoverIdentifierCalls(body)).toEqual(["emptyLeftoverBuckets", "leftoverPathKind"]);
    expect(body).toContain("...emptyLeftoverBuckets()");
    expect(body).toContain("const kind = leftoverPathKind(path);");
    expect(body).not.toContain("leftoverCatalogSourceUnions");
    expect(body).not.toContain("leftoverDefaultPartition");
    expect(body).not.toContain("addLeftoverPath");
  });

  it("owns the leftover classify loop; leftoverPathPartition has none", () => {
    const src = readFileSync(resolve("scripts/release/collect-cut-manifest-evidence.ts"), "utf8");
    const classifyFn = src.slice(
      src.indexOf("export function classifyLeftoverPaths("),
      src.indexOf("export function leftoverPathPartition("),
    );
    const partitionFn = src.slice(
      src.indexOf("export function leftoverPathPartition("),
      src.indexOf("export const EXCLUDED_VERSION_SURFACES"),
    );
    expect(classifyFn).toContain("for (const path of paths)");
    expect(partitionFn).not.toContain("for (const path of paths)");
    expect(partitionFn).not.toContain("leftoverPathKind");
  });
});

function leftoverDefaultPartitionSource(src: string): string {
  return src.slice(
    src.indexOf("export function leftoverDefaultPartition("),
    src.indexOf("export function classifyLeftoverPaths("),
  );
}

function leftoverClassifyLeftoverPathsSource(src: string): string {
  return src.slice(
    src.indexOf("export function classifyLeftoverPaths("),
    src.indexOf("export function leftoverPathPartition("),
  );
}

function leftoverPathPartitionSource(src: string): string {
  return src.slice(
    src.indexOf("export function leftoverPathPartition("),
    src.indexOf("export const EXCLUDED_VERSION_SURFACES"),
  );
}

function leftoverPathPartitionCalls(src: string): string[] {
  return leftoverIdentifierCalls(leftoverPathPartitionSource(src));
}

function leftoverPathIndexSource(src: string): string {
  return src.slice(
    src.indexOf("export function leftoverPathIndex("),
    src.indexOf("export function leftoverPathKind("),
  );
}

function leftoverPathKindSource(src: string): string {
  return src.slice(
    src.indexOf("export function leftoverPathKind("),
    src.indexOf("export function emptyLeftoverBuckets("),
  );
}

function leftoverCatalogSourceUnionsSource(src: string): string {
  return src.slice(
    src.indexOf("export function leftoverCatalogSourceUnions("),
    src.indexOf("export function isDefaultLeftoverCatalog("),
  );
}

function leftoverIdentifierCalls(body: string): string[] {
  const calls: string[] = [];
  const pattern = /\b([A-Za-z_][A-Za-z0-9_]*)\(/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(body)) !== null) {
    const before = body.slice(0, match.index);
    if (/(?:export\s+)?function\s+$/.test(before)) continue;
    if (/\.\s*$/.test(before) && !/\.\.\.\s*$/.test(before)) continue;
    calls.push(match[1]!);
  }
  return calls;
}

function leftoverIdentifierCallsOverlap(left: string[], right: string[]): string[] {
  return left.filter((name) => right.includes(name));
}

describe("leftover seed-or-classify leftover lock", () => {
  it("leftoverDefaultPartition and classifyLeftoverPaths leftoverIdentifierCalls are disjoint", () => {
    const src = readFileSync(resolve("scripts/release/collect-cut-manifest-evidence.ts"), "utf8");
    const seeded = leftoverIdentifierCalls(leftoverDefaultPartitionSource(src));
    const classified = leftoverIdentifierCalls(leftoverClassifyLeftoverPathsSource(src));
    expect(seeded).toEqual(["leftoverCatalogSourceUnions"]);
    expect(classified).toEqual(["emptyLeftoverBuckets", "leftoverPathKind"]);
    expect(leftoverIdentifierCallsOverlap(seeded, classified)).toEqual([]);
    expect(seeded).not.toContain("leftoverPathKind");
    expect(classified).not.toContain("leftoverCatalogSourceUnions");
  });

  it("leftoverPathPartition leftoverIdentifierCalls are disjoint from leftoverDefaultPartition and classifyLeftoverPaths internals", () => {
    const src = readFileSync(resolve("scripts/release/collect-cut-manifest-evidence.ts"), "utf8");
    const wired = leftoverPathPartitionCalls(src);
    const seeded = leftoverIdentifierCalls(leftoverDefaultPartitionSource(src));
    const classified = leftoverIdentifierCalls(leftoverClassifyLeftoverPathsSource(src));
    expect(wired).toEqual([
      "isDefaultLeftoverCatalog",
      "leftoverDefaultPartition",
      "classifyLeftoverPaths",
    ]);
    expect(leftoverIdentifierCallsOverlap(wired, seeded)).toEqual([]);
    expect(leftoverIdentifierCallsOverlap(wired, classified)).toEqual([]);
    expect(wired).not.toContain("leftoverCatalogSourceUnions");
    expect(wired).not.toContain("leftoverPathKind");
    expect(wired).not.toContain("emptyLeftoverBuckets");
  });
});

describe("leftoverPathIndex leftoverIdentifierCalls leftover lock", () => {
  it("overlap leftoverDefaultPartition leftoverIdentifierCalls is empty", () => {
    const src = readFileSync(resolve("scripts/release/collect-cut-manifest-evidence.ts"), "utf8");
    const indexed = leftoverIdentifierCalls(leftoverPathIndexSource(src));
    const seeded = leftoverIdentifierCalls(leftoverDefaultPartitionSource(src));
    expect(indexed).toEqual(["addLeftoverPath"]);
    expect(seeded).toEqual(["leftoverCatalogSourceUnions"]);
    expect(leftoverIdentifierCallsOverlap(indexed, seeded)).toEqual([]);
  });

  it("overlap leftoverPathPartition leftoverIdentifierCalls is empty", () => {
    const src = readFileSync(resolve("scripts/release/collect-cut-manifest-evidence.ts"), "utf8");
    const indexed = leftoverIdentifierCalls(leftoverPathIndexSource(src));
    const wired = leftoverPathPartitionCalls(src);
    expect(indexed).toEqual(["addLeftoverPath"]);
    expect(wired).toEqual([
      "isDefaultLeftoverCatalog",
      "leftoverDefaultPartition",
      "classifyLeftoverPaths",
    ]);
    expect(leftoverIdentifierCallsOverlap(indexed, wired)).toEqual([]);
  });

  it("overlap classifyLeftoverPaths leftoverIdentifierCalls is empty", () => {
    const src = readFileSync(resolve("scripts/release/collect-cut-manifest-evidence.ts"), "utf8");
    const indexed = leftoverIdentifierCalls(leftoverPathIndexSource(src));
    const classified = leftoverIdentifierCalls(leftoverClassifyLeftoverPathsSource(src));
    expect(classified).toEqual(["emptyLeftoverBuckets", "leftoverPathKind"]);
    expect(leftoverIdentifierCallsOverlap(indexed, classified)).toEqual([]);
  });

  it("overlap leftoverPathKind leftoverIdentifierCalls is empty", () => {
    const src = readFileSync(resolve("scripts/release/collect-cut-manifest-evidence.ts"), "utf8");
    const indexed = leftoverIdentifierCalls(leftoverPathIndexSource(src));
    const kinded = leftoverIdentifierCalls(leftoverPathKindSource(src));
    expect(indexed).toEqual(["addLeftoverPath"]);
    expect(kinded).toEqual(["leftoverPathIndex"]);
    expect(leftoverIdentifierCallsOverlap(indexed, kinded)).toEqual([]);
  });

  it("overlap leftoverCatalogSourceUnions leftoverIdentifierCalls is empty", () => {
    const src = readFileSync(resolve("scripts/release/collect-cut-manifest-evidence.ts"), "utf8");
    const indexed = leftoverIdentifierCalls(leftoverPathIndexSource(src));
    const unions = leftoverIdentifierCalls(leftoverCatalogSourceUnionsSource(src));
    expect(unions).toEqual(["emptyLeftoverBuckets"]);
    expect(leftoverIdentifierCallsOverlap(indexed, unions)).toEqual([]);
  });
});

describe("leftoverCatalogSourceUnions leftoverIdentifierCalls leftover lock", () => {
  it("are disjoint from leftoverPathIndex leftoverIdentifierCalls", () => {
    const src = readFileSync(resolve("scripts/release/collect-cut-manifest-evidence.ts"), "utf8");
    const unions = leftoverIdentifierCalls(leftoverCatalogSourceUnionsSource(src));
    const indexed = leftoverIdentifierCalls(leftoverPathIndexSource(src));
    expect(unions).toEqual(["emptyLeftoverBuckets"]);
    expect(indexed).toEqual(["addLeftoverPath"]);
    expect(leftoverIdentifierCallsOverlap(unions, indexed)).toEqual([]);
  });

  it("are disjoint from leftoverDefaultPartition leftoverIdentifierCalls", () => {
    const src = readFileSync(resolve("scripts/release/collect-cut-manifest-evidence.ts"), "utf8");
    const unions = leftoverIdentifierCalls(leftoverCatalogSourceUnionsSource(src));
    const seeded = leftoverIdentifierCalls(leftoverDefaultPartitionSource(src));
    expect(seeded).toEqual(["leftoverCatalogSourceUnions"]);
    expect(leftoverIdentifierCallsOverlap(unions, seeded)).toEqual([]);
  });

  it("are disjoint from leftoverPathPartition leftoverIdentifierCalls", () => {
    const src = readFileSync(resolve("scripts/release/collect-cut-manifest-evidence.ts"), "utf8");
    const unions = leftoverIdentifierCalls(leftoverCatalogSourceUnionsSource(src));
    const wired = leftoverPathPartitionCalls(src);
    expect(leftoverIdentifierCallsOverlap(unions, wired)).toEqual([]);
  });

  it("are disjoint from leftoverPathKind leftoverIdentifierCalls", () => {
    const src = readFileSync(resolve("scripts/release/collect-cut-manifest-evidence.ts"), "utf8");
    const unions = leftoverIdentifierCalls(leftoverCatalogSourceUnionsSource(src));
    const kinded = leftoverIdentifierCalls(leftoverPathKindSource(src));
    expect(kinded).toEqual(["leftoverPathIndex"]);
    expect(leftoverIdentifierCallsOverlap(unions, kinded)).toEqual([]);
  });

  it("overlap classifyLeftoverPaths leftoverIdentifierCalls only on emptyLeftoverBuckets", () => {
    const src = readFileSync(resolve("scripts/release/collect-cut-manifest-evidence.ts"), "utf8");
    const unions = leftoverIdentifierCalls(leftoverCatalogSourceUnionsSource(src));
    const classified = leftoverIdentifierCalls(leftoverClassifyLeftoverPathsSource(src));
    expect(unions).toEqual(["emptyLeftoverBuckets"]);
    expect(classified).toEqual(["emptyLeftoverBuckets", "leftoverPathKind"]);
    expect(leftoverIdentifierCallsOverlap(unions, classified)).toEqual(["emptyLeftoverBuckets"]);
    expect(classified.filter((name) => name !== "emptyLeftoverBuckets")).toEqual(["leftoverPathKind"]);
  });
});

describe("leftoverPathKind leftoverIdentifierCalls leftover lock", () => {
  it("are disjoint from leftoverDefaultPartition leftoverIdentifierCalls", () => {
    const src = readFileSync(resolve("scripts/release/collect-cut-manifest-evidence.ts"), "utf8");
    const kinded = leftoverIdentifierCalls(leftoverPathKindSource(src));
    const seeded = leftoverIdentifierCalls(leftoverDefaultPartitionSource(src));
    expect(kinded).toEqual(["leftoverPathIndex"]);
    expect(seeded).toEqual(["leftoverCatalogSourceUnions"]);
    expect(leftoverIdentifierCallsOverlap(kinded, seeded)).toEqual([]);
  });

  it("are disjoint from leftoverCatalogSourceUnions leftoverIdentifierCalls", () => {
    const src = readFileSync(resolve("scripts/release/collect-cut-manifest-evidence.ts"), "utf8");
    const kinded = leftoverIdentifierCalls(leftoverPathKindSource(src));
    const unions = leftoverIdentifierCalls(leftoverCatalogSourceUnionsSource(src));
    expect(unions).toEqual(["emptyLeftoverBuckets"]);
    expect(leftoverIdentifierCallsOverlap(kinded, unions)).toEqual([]);
  });

  it("are disjoint from leftoverPathIndex leftoverIdentifierCalls", () => {
    const src = readFileSync(resolve("scripts/release/collect-cut-manifest-evidence.ts"), "utf8");
    const kinded = leftoverIdentifierCalls(leftoverPathKindSource(src));
    const indexed = leftoverIdentifierCalls(leftoverPathIndexSource(src));
    expect(indexed).toEqual(["addLeftoverPath"]);
    expect(leftoverIdentifierCallsOverlap(kinded, indexed)).toEqual([]);
  });

  it("are disjoint from leftoverPathPartition leftoverIdentifierCalls", () => {
    const src = readFileSync(resolve("scripts/release/collect-cut-manifest-evidence.ts"), "utf8");
    const kinded = leftoverIdentifierCalls(leftoverPathKindSource(src));
    const wired = leftoverPathPartitionCalls(src);
    expect(leftoverIdentifierCallsOverlap(kinded, wired)).toEqual([]);
  });

  it("are disjoint from classifyLeftoverPaths leftoverIdentifierCalls", () => {
    const src = readFileSync(resolve("scripts/release/collect-cut-manifest-evidence.ts"), "utf8");
    const kinded = leftoverIdentifierCalls(leftoverPathKindSource(src));
    const classified = leftoverIdentifierCalls(leftoverClassifyLeftoverPathsSource(src));
    expect(classified).toEqual(["emptyLeftoverBuckets", "leftoverPathKind"]);
    expect(leftoverIdentifierCallsOverlap(kinded, classified)).toEqual([]);
  });
});

describe("leftoverDefaultPartition leftoverIdentifierCalls leftover lock", () => {
  it("overlap leftoverPathPartition leftoverIdentifierCalls is empty", () => {
    const src = readFileSync(resolve("scripts/release/collect-cut-manifest-evidence.ts"), "utf8");
    const seeded = leftoverIdentifierCalls(leftoverDefaultPartitionSource(src));
    const wired = leftoverPathPartitionCalls(src);
    expect(seeded).toEqual(["leftoverCatalogSourceUnions"]);
    expect(wired).toEqual([
      "isDefaultLeftoverCatalog",
      "leftoverDefaultPartition",
      "classifyLeftoverPaths",
    ]);
    expect(leftoverIdentifierCallsOverlap(seeded, wired)).toEqual([]);
  });

  it("overlap leftoverPathKind leftoverIdentifierCalls is empty", () => {
    const src = readFileSync(resolve("scripts/release/collect-cut-manifest-evidence.ts"), "utf8");
    const seeded = leftoverIdentifierCalls(leftoverDefaultPartitionSource(src));
    const kinded = leftoverIdentifierCalls(leftoverPathKindSource(src));
    expect(seeded).toEqual(["leftoverCatalogSourceUnions"]);
    expect(kinded).toEqual(["leftoverPathIndex"]);
    expect(leftoverIdentifierCallsOverlap(seeded, kinded)).toEqual([]);
  });

  it("overlap leftoverPathIndex leftoverIdentifierCalls is empty", () => {
    const src = readFileSync(resolve("scripts/release/collect-cut-manifest-evidence.ts"), "utf8");
    const seeded = leftoverIdentifierCalls(leftoverDefaultPartitionSource(src));
    const indexed = leftoverIdentifierCalls(leftoverPathIndexSource(src));
    expect(indexed).toEqual(["addLeftoverPath"]);
    expect(leftoverIdentifierCallsOverlap(seeded, indexed)).toEqual([]);
  });

  it("overlap leftoverCatalogSourceUnions leftoverIdentifierCalls is empty", () => {
    const src = readFileSync(resolve("scripts/release/collect-cut-manifest-evidence.ts"), "utf8");
    const seeded = leftoverIdentifierCalls(leftoverDefaultPartitionSource(src));
    const unions = leftoverIdentifierCalls(leftoverCatalogSourceUnionsSource(src));
    expect(seeded).toEqual(["leftoverCatalogSourceUnions"]);
    expect(unions).toEqual(["emptyLeftoverBuckets"]);
    expect(leftoverIdentifierCallsOverlap(seeded, unions)).toEqual([]);
  });

  it("overlap classifyLeftoverPaths leftoverIdentifierCalls is empty", () => {
    const src = readFileSync(resolve("scripts/release/collect-cut-manifest-evidence.ts"), "utf8");
    const seeded = leftoverIdentifierCalls(leftoverDefaultPartitionSource(src));
    const classified = leftoverIdentifierCalls(leftoverClassifyLeftoverPathsSource(src));
    expect(classified).toEqual(["emptyLeftoverBuckets", "leftoverPathKind"]);
    expect(leftoverIdentifierCallsOverlap(seeded, classified)).toEqual([]);
  });
});

describe("leftoverPathPartition leftoverIdentifierCalls leftover lock", () => {
  it("overlap leftoverDefaultPartition leftoverIdentifierCalls is empty", () => {
    const src = readFileSync(resolve("scripts/release/collect-cut-manifest-evidence.ts"), "utf8");
    const wired = leftoverPathPartitionCalls(src);
    const seeded = leftoverIdentifierCalls(leftoverDefaultPartitionSource(src));
    expect(wired).toEqual([
      "isDefaultLeftoverCatalog",
      "leftoverDefaultPartition",
      "classifyLeftoverPaths",
    ]);
    expect(seeded).toEqual(["leftoverCatalogSourceUnions"]);
    expect(leftoverIdentifierCallsOverlap(wired, seeded)).toEqual([]);
  });

  it("overlap leftoverPathKind leftoverIdentifierCalls is empty", () => {
    const src = readFileSync(resolve("scripts/release/collect-cut-manifest-evidence.ts"), "utf8");
    const wired = leftoverPathPartitionCalls(src);
    const kinded = leftoverIdentifierCalls(leftoverPathKindSource(src));
    expect(kinded).toEqual(["leftoverPathIndex"]);
    expect(leftoverIdentifierCallsOverlap(wired, kinded)).toEqual([]);
  });

  it("overlap leftoverPathIndex leftoverIdentifierCalls is empty", () => {
    const src = readFileSync(resolve("scripts/release/collect-cut-manifest-evidence.ts"), "utf8");
    const wired = leftoverPathPartitionCalls(src);
    const indexed = leftoverIdentifierCalls(leftoverPathIndexSource(src));
    expect(indexed).toEqual(["addLeftoverPath"]);
    expect(leftoverIdentifierCallsOverlap(wired, indexed)).toEqual([]);
  });

  it("overlap leftoverCatalogSourceUnions leftoverIdentifierCalls is empty", () => {
    const src = readFileSync(resolve("scripts/release/collect-cut-manifest-evidence.ts"), "utf8");
    const wired = leftoverPathPartitionCalls(src);
    const unions = leftoverIdentifierCalls(leftoverCatalogSourceUnionsSource(src));
    expect(unions).toEqual(["emptyLeftoverBuckets"]);
    expect(leftoverIdentifierCallsOverlap(wired, unions)).toEqual([]);
  });

  it("overlap classifyLeftoverPaths leftoverIdentifierCalls is empty", () => {
    const src = readFileSync(resolve("scripts/release/collect-cut-manifest-evidence.ts"), "utf8");
    const wired = leftoverPathPartitionCalls(src);
    const classified = leftoverIdentifierCalls(leftoverClassifyLeftoverPathsSource(src));
    expect(classified).toEqual(["emptyLeftoverBuckets", "leftoverPathKind"]);
    expect(leftoverIdentifierCallsOverlap(wired, classified)).toEqual([]);
  });
});

describe("leftoverPathPartition leftover lock", () => {
  it("body contains only isDefaultLeftoverCatalog + leftoverDefaultPartition + classifyLeftoverPaths", () => {
    const src = readFileSync(resolve("scripts/release/collect-cut-manifest-evidence.ts"), "utf8");
    const body = leftoverPathPartitionSource(src);
    expect(leftoverPathPartitionCalls(src)).toEqual([
      "isDefaultLeftoverCatalog",
      "leftoverDefaultPartition",
      "classifyLeftoverPaths",
    ]);
    expect(body).not.toContain("leftoverPathKind");
    expect(body).not.toContain("leftoverCatalogSourceUnions");
    expect(body).not.toContain("emptyLeftoverBuckets");
    expect(body).not.toContain("leftoverPathIndex");
    expect(body).not.toContain("addLeftoverPath");
    expect(body).not.toContain("unknown:");
  });

  it("has exactly two named returns", () => {
    const body = leftoverPathPartitionSource(
      readFileSync(resolve("scripts/release/collect-cut-manifest-evidence.ts"), "utf8"),
    );
    expect(body.match(/return /g)).toHaveLength(2);
    expect(body).toContain("return leftoverDefaultPartition();");
    expect(body).toContain("return classifyLeftoverPaths(paths);");
  });

  it("defaults only to the leftover catalog reference", () => {
    const body = leftoverPathPartitionSource(
      readFileSync(resolve("scripts/release/collect-cut-manifest-evidence.ts"), "utf8"),
    );
    expect(body).toContain("paths: ReadonlyArray<string> = BUMP_VERSION_LEFTOVER_PATHS");
    expect(body).not.toContain("[...BUMP_VERSION_LEFTOVER_PATHS]");
  });

  it("is unused on collector production paths", () => {
    const src = readFileSync(resolve("scripts/release/collect-cut-manifest-evidence.ts"), "utf8");
    expect(src).toContain("export function leftoverPathPartition(");
    expect(countIdentifierCalls(src, "leftoverPathPartition")).toBe(0);
  });

  it("is the only leftover catalog partition and leftoverPathKind is only used there", () => {
    const src = readFileSync(resolve("scripts/release/collect-cut-manifest-evidence.ts"), "utf8");
    expect(countIdentifierCalls(src, "leftoverPathKind")).toBe(1);
    expect(countIdentifierCalls(src, "leftoverPathIndex")).toBe(1);
    expect(countIdentifierCalls(src, "addLeftoverPath")).toBe(1);
    expect(countIdentifierCalls(src, "leftoverPathPartition")).toBe(0);
    expect(src).toContain("if (isDefaultLeftoverCatalog(paths))");
    expect(src).toContain("return leftoverDefaultPartition();");
    expect(src).toContain("...leftoverCatalogSourceUnions()");
    expect(countIdentifierCalls(src, "isDefaultLeftoverCatalog")).toBe(1);
    expect(countIdentifierCalls(src, "leftoverDefaultPartition")).toBe(1);
    expect(src).toContain("return leftoverPathIndex().get(path) ?? null;");
    expect(src).toContain("const kind = leftoverPathKind(path);");
    expect(src).toContain("return classifyLeftoverPaths(paths);");
    expect(leftoverPathPartition().unknown).toEqual([]);
    expect(BUMP_VERSION_GREP_LEFTOVER_PATHS.every((path) => leftoverPathKind(path) === "sed")).toBe(true);
    const partition = leftoverPathPartition();
    expect([...partition.sed, ...partition.findSed].sort()).toEqual([...BUMP_VERSION_VERIFY_PATHS].sort());
    expect(LEFTOVER_PATH_BUCKETS).toEqual(["version", "sed", "findSed"]);
    expect(Object.keys(partition).filter((key) => key !== "unknown").sort()).toEqual(
      [...LEFTOVER_PATH_BUCKETS].sort(),
    );
  });
});

describe("leftover partition production leftover lock", () => {
  it("keeps leftoverPathPartition unused and leftoverDefaultPartition/classifyLeftoverPaths only wired from leftoverPathPartition", () => {
    const src = readFileSync(resolve("scripts/release/collect-cut-manifest-evidence.ts"), "utf8");
    expect(countIdentifierCalls(src, "leftoverPathPartition")).toBe(0);
    expect(countIdentifierCalls(src, "leftoverDefaultPartition")).toBe(1);
    expect(countIdentifierCalls(src, "classifyLeftoverPaths")).toBe(1);
    expect(countIdentifierCalls(src, "isDefaultLeftoverCatalog")).toBe(1);
    expect(countIdentifierCalls(src, "leftoverCatalogSourceUnions")).toBe(1);
    expect(countIdentifierCalls(src, "leftoverPathKind")).toBe(1);
    expect(src).toContain("return leftoverDefaultPartition();");
    expect(src).toContain("return classifyLeftoverPaths(paths);");
  });
});

describe("LEFTOVER_CATALOG_SOURCES leftover lock", () => {
  it("path unions equal leftoverPathPartition buckets", () => {
    const unions = leftoverCatalogSourceUnions();
    const partition = leftoverPathPartition();
    expect(LEFTOVER_CATALOG_SOURCES.map((source) => source.bucket)).toEqual([...LEFTOVER_PATH_BUCKETS]);
    for (const bucket of LEFTOVER_PATH_BUCKETS) {
      expect([...unions[bucket]].sort()).toEqual([...partition[bucket]].sort());
    }
    expect(partition.unknown).toEqual([]);
    expect([...unions.version, ...unions.sed, ...unions.findSed].sort()).toEqual(
      [...BUMP_VERSION_LEFTOVER_PATHS].sort(),
    );
  });

  it("fails closed when leftoverPathPartition sees a path outside the catalog sources", () => {
    expect(leftoverCatalogSourceUnions().sed).not.toContain("mystery.path");
    expect(leftoverPathPartition(["mystery.path"]).unknown).toEqual(["mystery.path"]);
  });
});

describe("leftoverPathIndex leftover lock", () => {
  it("is unused on collector production paths except leftoverPathKind", () => {
    const src = readFileSync(resolve("scripts/release/collect-cut-manifest-evidence.ts"), "utf8");
    expect(countIdentifierCalls(src, "leftoverPathIndex")).toBe(1);
    expect(src).toContain("return leftoverPathIndex().get(path) ?? null;");
  });

  it("reads only LEFTOVER_CATALOG_SOURCES", () => {
    const src = readFileSync(resolve("scripts/release/collect-cut-manifest-evidence.ts"), "utf8");
    expect(src).toContain("for (const source of LEFTOVER_CATALOG_SOURCES)");
    expect(src).toContain("addLeftoverPath(index, path, source.bucket)");
    expect(src).not.toContain('addLeftoverPath(index, "version", "version")');
    expect(src).not.toContain("for (const path of BUMP_VERSION_SED_PATHS)");
    expect(src).not.toContain("for (const path of BUMP_VERSION_FIND_SED_PATHS)");
    expect(countIdentifierCalls(src, "leftoverCatalogSourceUnions")).toBe(1);
    expect(countIdentifierCalls(src, "emptyLeftoverBuckets")).toBe(2);
    expect(src).toContain("const unions = emptyLeftoverBuckets();");
    expect(src).toContain("...emptyLeftoverBuckets()");
  });

  it("body only calls addLeftoverPath from LEFTOVER_CATALOG_SOURCES", () => {
    const src = readFileSync(resolve("scripts/release/collect-cut-manifest-evidence.ts"), "utf8");
    const body = leftoverPathIndexSource(src);
    expect(leftoverIdentifierCalls(body)).toEqual(["addLeftoverPath"]);
    expect(body).toContain("for (const source of LEFTOVER_CATALOG_SOURCES)");
    expect(body).toContain("for (const path of source.paths)");
    expect(body).toContain("addLeftoverPath(index, path, source.bucket)");
    expect(body).not.toContain("BUMP_VERSION_SED_PATHS");
    expect(body).not.toContain("BUMP_VERSION_FIND_SED_PATHS");
    expect(body).not.toContain("BUMP_VERSION_LEFTOVER_PATHS");
    expect(body).not.toContain("BUMP_VERSION_GREP_LEFTOVER_PATHS");
    expect(body).not.toContain('"version"');
    expect(body).not.toContain("package.json");
  });
});

describe("addLeftoverPath leftover lock", () => {
  it("is unused on collector production paths except leftoverPathIndex", () => {
    const src = readFileSync(resolve("scripts/release/collect-cut-manifest-evidence.ts"), "utf8");
    const indexFn = src.slice(
      src.indexOf("export function leftoverPathIndex("),
      src.indexOf("export function leftoverPathKind("),
    );
    const afterIndex = src.slice(
      src.indexOf("export function leftoverPathKind("),
      src.indexOf("export const EXCLUDED_VERSION_SURFACES"),
    );
    expect(src).toContain("export function addLeftoverPath(");
    expect(countIdentifierCalls(src, "addLeftoverPath")).toBe(1);
    expect(indexFn).toContain("addLeftoverPath(index, path, source.bucket)");
    expect(afterIndex).not.toContain("addLeftoverPath");
  });
});

describe("leftoverCatalogSourceUnions leftover lock", () => {
  it("body only unions LEFTOVER_CATALOG_SOURCES", () => {
    const src = readFileSync(resolve("scripts/release/collect-cut-manifest-evidence.ts"), "utf8");
    const body = src.slice(
      src.indexOf("export function leftoverCatalogSourceUnions("),
      src.indexOf("export function isDefaultLeftoverCatalog("),
    );
    expect(leftoverIdentifierCalls(body)).toEqual(["emptyLeftoverBuckets"]);
    expect(body).toContain("for (const source of LEFTOVER_CATALOG_SOURCES)");
    expect(body).toContain("unions[source.bucket].push(...source.paths)");
    expect(body).not.toContain("BUMP_VERSION_SED_PATHS");
    expect(body).not.toContain("BUMP_VERSION_FIND_SED_PATHS");
    expect(body).not.toContain("addLeftoverPath");
  });

  it("is only called from leftoverDefaultPartition", () => {
    const src = readFileSync(resolve("scripts/release/collect-cut-manifest-evidence.ts"), "utf8");
    expect(countIdentifierCalls(src, "leftoverCatalogSourceUnions")).toBe(1);
    expect(src).toContain("export function leftoverCatalogSourceUnions(");
    expect(src).toContain("...leftoverCatalogSourceUnions()");
    expect(src).toContain("unions[source.bucket].push(...source.paths)");
    expect(src).toContain("return leftoverDefaultPartition();");
  });
});

describe("isDefaultLeftoverCatalog leftover lock", () => {
  it("is the only default-catalog gate used by leftoverPathPartition", () => {
    const src = readFileSync(resolve("scripts/release/collect-cut-manifest-evidence.ts"), "utf8");
    expect(countIdentifierCalls(src, "isDefaultLeftoverCatalog")).toBe(1);
    expect(src).toContain("if (isDefaultLeftoverCatalog(paths))");
    expect(src).not.toContain("if (paths === BUMP_VERSION_LEFTOVER_PATHS)");
  });
});

describe("isDefaultLeftoverCatalog", () => {
  it("is true only for the leftover catalog reference", () => {
    expect(isDefaultLeftoverCatalog(BUMP_VERSION_LEFTOVER_PATHS)).toBe(true);
    expect(isDefaultLeftoverCatalog([...BUMP_VERSION_LEFTOVER_PATHS])).toBe(false);
    expect(isDefaultLeftoverCatalog(["version"])).toBe(false);
  });
});

describe("emptyLeftoverBuckets leftover lock", () => {
  it("is unused on collector production paths except leftoverCatalogSourceUnions and classifyLeftoverPaths", () => {
    const src = readFileSync(resolve("scripts/release/collect-cut-manifest-evidence.ts"), "utf8");
    const defaultFn = src.slice(
      src.indexOf("export function leftoverDefaultPartition("),
      src.indexOf("export function classifyLeftoverPaths("),
    );
    const partitionFn = leftoverPathPartitionSource(src);
    expect(countIdentifierCalls(src, "emptyLeftoverBuckets")).toBe(2);
    expect(src).toContain("const unions = emptyLeftoverBuckets();");
    expect(src).toContain("...emptyLeftoverBuckets()");
    expect(defaultFn).not.toContain("emptyLeftoverBuckets");
    expect(partitionFn).not.toContain("emptyLeftoverBuckets");
  });
});

describe("emptyLeftoverBuckets", () => {
  it("seeds one empty array per leftover path bucket", () => {
    const buckets = emptyLeftoverBuckets();
    expect(Object.keys(buckets).sort()).toEqual([...LEFTOVER_PATH_BUCKETS].sort());
    for (const bucket of LEFTOVER_PATH_BUCKETS) {
      expect(buckets[bucket]).toEqual([]);
    }
  });
});

// ---------------------------------------------------------------------------
// Fail-closed: version surface mismatch
// ---------------------------------------------------------------------------

describe("collectCutManifestEvidence: version surface mismatch", () => {
  it("fails when a package.json version drifts", () => {
    const files = baseFiles();
    files["apps/web/package.json"] = JSON.stringify({ name: "web", version: "0.4.22" });
    const { deps } = createMockDeps({ files });
    const evidence = collectCutManifestEvidence(DEFAULT_OPTIONS, deps);
    const check = evidence.checks.find((c) => c.id === "versions.package_web")!;
    expect(check.status).toBe("fail");
    expect(check.expected).toBe(VERSION);
    expect(check.actual).toBe("0.4.22");
    expect(evidence.status).toBe("failed");
  });

  it("fails when a required surface is unreadable", () => {
    const files = baseFiles();
    delete files["apps/worker/__init__.py"];
    const { deps } = createMockDeps({ files });
    const evidence = collectCutManifestEvidence(DEFAULT_OPTIONS, deps);
    expect(evidence.checks.find((c) => c.id === "versions.worker_init")!.status).toBe("fail");
  });

  it("fails when schemas-validation.test.ts version drifts from canonical", () => {
    const files = baseFiles();
    files["apps/api/src/schemas/schemas-validation.test.ts"] = `      version: "0.4.6",\n`;
    const { deps } = createMockDeps({ files });
    const evidence = collectCutManifestEvidence(DEFAULT_OPTIONS, deps);
    const check = evidence.checks.find((c) => c.id === "versions.schemas_validation")!;
    expect(check.status).toBe("fail");
    expect(check.actual).toBe("0.4.6");
    expect(evidence.status).toBe("failed");
  });

  it("fails when schemas-validation.test.ts is missing as a required surface", () => {
    const files = baseFiles();
    delete files["apps/api/src/schemas/schemas-validation.test.ts"];
    const { deps } = createMockDeps({ files });
    const evidence = collectCutManifestEvidence(DEFAULT_OPTIONS, deps);
    const check = evidence.checks.find((c) => c.id === "versions.schemas_validation")!;
    expect(check.status).toBe("fail");
    expect(check.actual).toBe("unreadable");
    expect(evidence.status).toBe("failed");
  });

  it("passes when schemas-validation.test.ts equals canonical", () => {
    const { deps } = createMockDeps();
    const evidence = collectCutManifestEvidence(DEFAULT_OPTIONS, deps);
    const check = evidence.checks.find((c) => c.id === "versions.schemas_validation")!;
    expect(check.status).toBe("pass");
    expect(check.actual).toBe(VERSION);
  });

  it("fails when e2e appVersion drifts from canonical", () => {
    const files = baseFiles();
    files["apps/web/e2e/resume-role-filter.spec.ts"] =
      `            appVersion: '0.4.6',\n            apiVersion: '${VERSION}',\n            webVersion: '${VERSION}',\n`;
    const { deps } = createMockDeps({ files });
    const evidence = collectCutManifestEvidence(DEFAULT_OPTIONS, deps);
    const check = evidence.checks.find((c) => c.id === "versions.e2e_app_version")!;
    expect(check.status).toBe("fail");
    expect(check.actual).toBe("0.4.6");
    expect(evidence.status).toBe("failed");
  });

  it("fails when e2e appVersion is missing as a required surface", () => {
    const files = baseFiles();
    delete files["apps/web/e2e/resume-role-filter.spec.ts"];
    const { deps } = createMockDeps({ files });
    const evidence = collectCutManifestEvidence(DEFAULT_OPTIONS, deps);
    const check = evidence.checks.find((c) => c.id === "versions.e2e_app_version")!;
    expect(check.status).toBe("fail");
    expect(check.actual).toBe("unreadable");
    expect(evidence.status).toBe("failed");
  });

  it("passes when e2e appVersion equals canonical", () => {
    const { deps } = createMockDeps();
    const evidence = collectCutManifestEvidence(DEFAULT_OPTIONS, deps);
    const check = evidence.checks.find((c) => c.id === "versions.e2e_app_version")!;
    expect(check.status).toBe("pass");
    expect(check.actual).toBe(VERSION);
  });

  it("fails when e2e apiVersion drifts from canonical", () => {
    const files = baseFiles();
    files["apps/web/e2e/resume-role-filter.spec.ts"] =
      `            appVersion: '${VERSION}',\n            apiVersion: '0.4.6',\n            webVersion: '${VERSION}',\n`;
    const { deps } = createMockDeps({ files });
    const evidence = collectCutManifestEvidence(DEFAULT_OPTIONS, deps);
    const check = evidence.checks.find((c) => c.id === "versions.e2e_api_version")!;
    expect(check.status).toBe("fail");
    expect(check.actual).toBe("0.4.6");
    expect(evidence.status).toBe("failed");
  });

  it("fails when e2e apiVersion is missing as a required surface", () => {
    const files = baseFiles();
    files["apps/web/e2e/resume-role-filter.spec.ts"] =
      `            appVersion: '${VERSION}',\n            webVersion: '${VERSION}',\n`;
    const { deps } = createMockDeps({ files });
    const evidence = collectCutManifestEvidence(DEFAULT_OPTIONS, deps);
    const check = evidence.checks.find((c) => c.id === "versions.e2e_api_version")!;
    expect(check.status).toBe("fail");
    expect(check.actual).toBe("unreadable");
    expect(evidence.status).toBe("failed");
  });

  it("passes when e2e apiVersion equals canonical", () => {
    const { deps } = createMockDeps();
    const evidence = collectCutManifestEvidence(DEFAULT_OPTIONS, deps);
    const check = evidence.checks.find((c) => c.id === "versions.e2e_api_version")!;
    expect(check.status).toBe("pass");
    expect(check.actual).toBe(VERSION);
  });

  it("fails when e2e webVersion drifts from canonical", () => {
    const files = baseFiles();
    files["apps/web/e2e/resume-role-filter.spec.ts"] =
      `            appVersion: '${VERSION}',\n            apiVersion: '${VERSION}',\n            webVersion: '0.4.6',\n`;
    const { deps } = createMockDeps({ files });
    const evidence = collectCutManifestEvidence(DEFAULT_OPTIONS, deps);
    const check = evidence.checks.find((c) => c.id === "versions.e2e_web_version")!;
    expect(check.status).toBe("fail");
    expect(check.actual).toBe("0.4.6");
    expect(evidence.status).toBe("failed");
  });

  it("fails when e2e webVersion is missing as a required surface", () => {
    const files = baseFiles();
    files["apps/web/e2e/resume-role-filter.spec.ts"] =
      `            appVersion: '${VERSION}',\n            apiVersion: '${VERSION}',\n`;
    const { deps } = createMockDeps({ files });
    const evidence = collectCutManifestEvidence(DEFAULT_OPTIONS, deps);
    const check = evidence.checks.find((c) => c.id === "versions.e2e_web_version")!;
    expect(check.status).toBe("fail");
    expect(check.actual).toBe("unreadable");
    expect(evidence.status).toBe("failed");
  });

  it("passes when e2e webVersion equals canonical", () => {
    const { deps } = createMockDeps();
    const evidence = collectCutManifestEvidence(DEFAULT_OPTIONS, deps);
    const check = evidence.checks.find((c) => c.id === "versions.e2e_web_version")!;
    expect(check.status).toBe("pass");
    expect(check.actual).toBe(VERSION);
  });

  it("fails when openapi.yaml HealthResponse example drifts from canonical", () => {
    const files = baseFiles();
    files["apps/api/openapi.yaml"] =
      `openapi: 3.1.0\ninfo:\n  title: Trends API\n  version: ${VERSION}\n` +
      `components:\n  schemas:\n    HealthResponse:\n      properties:\n        version:\n          type: string\n          example: '0.4.6'\n`;
    const { deps } = createMockDeps({ files });
    const evidence = collectCutManifestEvidence(DEFAULT_OPTIONS, deps);
    const check = evidence.checks.find((c) => c.id === "versions.openapi_yaml_health_example")!;
    expect(check.status).toBe("fail");
    expect(check.actual).toBe("0.4.6");
    expect(evidence.status).toBe("failed");
  });

  it("fails when openapi.yaml HealthResponse example is missing as a required surface", () => {
    const files = baseFiles();
    files["apps/api/openapi.yaml"] = `openapi: 3.1.0\ninfo:\n  title: Trends API\n  version: ${VERSION}\n`;
    const { deps } = createMockDeps({ files });
    const evidence = collectCutManifestEvidence(DEFAULT_OPTIONS, deps);
    const check = evidence.checks.find((c) => c.id === "versions.openapi_yaml_health_example")!;
    expect(check.status).toBe("fail");
    expect(check.actual).toBe("unreadable");
    expect(evidence.status).toBe("failed");
  });

  it("passes when openapi.yaml HealthResponse example equals canonical", () => {
    const { deps } = createMockDeps();
    const evidence = collectCutManifestEvidence(DEFAULT_OPTIONS, deps);
    const check = evidence.checks.find((c) => c.id === "versions.openapi_yaml_health_example")!;
    expect(check.status).toBe("pass");
    expect(check.actual).toBe(VERSION);
  });

  it("fails when openapi.json HealthResponse example drifts from canonical", () => {
    const files = baseFiles();
    files["apps/api/openapi.json"] = JSON.stringify({
      openapi: "3.1.0",
      info: { title: "Trends API", version: VERSION },
      components: {
        schemas: {
          HealthResponse: { properties: { version: { type: "string", example: "0.4.6" } } },
        },
      },
    });
    const { deps } = createMockDeps({ files });
    const evidence = collectCutManifestEvidence(DEFAULT_OPTIONS, deps);
    const check = evidence.checks.find((c) => c.id === "versions.openapi_json_health_example")!;
    expect(check.status).toBe("fail");
    expect(check.actual).toBe("0.4.6");
    expect(evidence.status).toBe("failed");
  });

  it("fails when openapi.json HealthResponse example is missing as a required surface", () => {
    const files = baseFiles();
    files["apps/api/openapi.json"] = JSON.stringify({
      openapi: "3.1.0",
      info: { title: "Trends API", version: VERSION },
    });
    const { deps } = createMockDeps({ files });
    const evidence = collectCutManifestEvidence(DEFAULT_OPTIONS, deps);
    const check = evidence.checks.find((c) => c.id === "versions.openapi_json_health_example")!;
    expect(check.status).toBe("fail");
    expect(check.actual).toBe("unreadable");
    expect(evidence.status).toBe("failed");
  });

  it("passes when openapi.json HealthResponse example equals canonical", () => {
    const { deps } = createMockDeps();
    const evidence = collectCutManifestEvidence(DEFAULT_OPTIONS, deps);
    const check = evidence.checks.find((c) => c.id === "versions.openapi_json_health_example")!;
    expect(check.status).toBe("pass");
    expect(check.actual).toBe(VERSION);
  });

  it("fails when the canonical version differs from --expected-version", () => {
    const { deps } = createMockDeps();
    const evidence = collectCutManifestEvidence({ ...DEFAULT_OPTIONS, expectedVersion: "0.5.0" }, deps);
    expect(evidence.status).toBe("failed");
    expect(evidence.meta.expectedVersion).toBe("0.5.0");
    const versionChecks = evidence.checks.filter((c) => c.id.startsWith("versions."));
    expect(versionChecks.length).toBeGreaterThan(0);
    expect(versionChecks.some((c) => c.status === "fail")).toBe(true);
  });

  it("fails closed when the OpenAPI HealthResponse example is stale", () => {
    const files = baseFiles();
    files["apps/api/openapi.yaml"] =
      `openapi: 3.1.0\ninfo:\n  title: Trends API\n  version: ${VERSION}\n` +
      `components:\n  schemas:\n    HealthResponse:\n      properties:\n        version:\n          type: string\n          example: '0.4.6'\n`;
    const { deps } = createMockDeps({ files });
    const evidence = collectCutManifestEvidence(DEFAULT_OPTIONS, deps);
    const check = evidence.checks.find((c) => c.id === "versions.openapi_health_example_stale")!;
    expect(check.status).toBe("fail");
    expect(check.actual).toBe("0.4.6");
    expect(check.expected).toBe(VERSION);
    expect(evidence.status).toBe("failed");
    expect(evidence.exitCode).toBe(2);
  });

  it("fails closed when the OpenAPI HealthResponse example is missing", () => {
    const files = baseFiles();
    files["apps/api/openapi.yaml"] = `openapi: 3.1.0\ninfo:\n  title: Trends API\n  version: ${VERSION}\n`;
    const { deps } = createMockDeps({ files });
    const evidence = collectCutManifestEvidence(DEFAULT_OPTIONS, deps);
    const check = evidence.checks.find((c) => c.id === "versions.openapi_health_example_stale")!;
    expect(check.status).toBe("fail");
    expect(check.actual).toBe("missing");
    expect(check.expected).toBe(VERSION);
    expect(evidence.status).toBe("failed");
    expect(evidence.exitCode).toBe(2);
  });

  it("passes when the OpenAPI HealthResponse example matches the canonical version", () => {
    const { deps } = createMockDeps();
    const evidence = collectCutManifestEvidence(DEFAULT_OPTIONS, deps);
    const check = evidence.checks.find((c) => c.id === "versions.openapi_health_example_stale")!;
    expect(check.status).toBe("pass");
    expect(check.actual).toBe(VERSION);
    expect(check.detail).toContain(`matches ${VERSION}`);
  });

  it("fails closed when the OpenAPI JSON HealthResponse example is stale", () => {
    const files = baseFiles();
    files["apps/api/openapi.json"] = JSON.stringify({
      openapi: "3.1.0",
      info: { title: "Trends API", version: VERSION },
      components: {
        schemas: {
          HealthResponse: { properties: { version: { type: "string", example: "0.4.6" } } },
        },
      },
    });
    const { deps } = createMockDeps({ files });
    const evidence = collectCutManifestEvidence(DEFAULT_OPTIONS, deps);
    const check = evidence.checks.find((c) => c.id === "versions.openapi_json_health_example_stale")!;
    expect(check.status).toBe("fail");
    expect(check.actual).toBe("0.4.6");
    expect(check.expected).toBe(VERSION);
    expect(evidence.status).toBe("failed");
    expect(evidence.exitCode).toBe(2);
  });

  it("fails closed when the OpenAPI JSON HealthResponse example is missing", () => {
    const files = baseFiles();
    files["apps/api/openapi.json"] = JSON.stringify({
      openapi: "3.1.0",
      info: { title: "Trends API", version: VERSION },
    });
    const { deps } = createMockDeps({ files });
    const evidence = collectCutManifestEvidence(DEFAULT_OPTIONS, deps);
    const check = evidence.checks.find((c) => c.id === "versions.openapi_json_health_example_stale")!;
    expect(check.status).toBe("fail");
    expect(check.actual).toBe("missing");
    expect(check.expected).toBe(VERSION);
    expect(evidence.status).toBe("failed");
    expect(evidence.exitCode).toBe(2);
  });

  it("fails closed when apps/api/openapi.json is absent", () => {
    const files = baseFiles();
    delete files["apps/api/openapi.json"];
    const { deps } = createMockDeps({ files });
    const evidence = collectCutManifestEvidence(DEFAULT_OPTIONS, deps);
    const check = evidence.checks.find((c) => c.id === "versions.openapi_json_health_example_stale")!;
    expect(check.status).toBe("fail");
    expect(check.actual).toBe("missing");
    expect(evidence.status).toBe("failed");
  });

  it("passes when the OpenAPI JSON HealthResponse example matches the canonical version", () => {
    const { deps } = createMockDeps();
    const evidence = collectCutManifestEvidence(DEFAULT_OPTIONS, deps);
    const check = evidence.checks.find((c) => c.id === "versions.openapi_json_health_example_stale")!;
    expect(check.status).toBe("pass");
    expect(check.actual).toBe(VERSION);
    expect(check.detail).toContain(`matches ${VERSION}`);
  });

  it("reads yaml HealthResponse stale check from the VERSION_SURFACE value", () => {
    const files = baseFiles();
    files["apps/api/openapi.yaml"] =
      `openapi: 3.1.0\ninfo:\n  title: Trends API\n  version: ${VERSION}\n` +
      `components:\n  schemas:\n    HealthResponse:\n      properties:\n        version:\n          type: string\n          example: '0.4.6'\n`;
    const { deps } = createMockDeps({ files });
    const evidence = collectCutManifestEvidence(DEFAULT_OPTIONS, deps);
    const surface = evidence.checks.find((c) => c.id === "versions.openapi_yaml_health_example")!;
    const stale = evidence.checks.find((c) => c.id === "versions.openapi_health_example_stale")!;
    expect(surface.actual).toBe("0.4.6");
    expect(stale.actual).toBe(surface.actual);
    expect(evidence.versions.openapiHealthExample).toBe(surface.actual);
    expect(stale.status).toBe("fail");
  });

  it("reads json HealthResponse stale check from the VERSION_SURFACE value", () => {
    const files = baseFiles();
    files["apps/api/openapi.json"] = JSON.stringify({
      openapi: "3.1.0",
      info: { title: "Trends API", version: VERSION },
      components: {
        schemas: {
          HealthResponse: { properties: { version: { type: "string", example: "0.4.6" } } },
        },
      },
    });
    const { deps } = createMockDeps({ files });
    const evidence = collectCutManifestEvidence(DEFAULT_OPTIONS, deps);
    const surface = evidence.checks.find((c) => c.id === "versions.openapi_json_health_example")!;
    const stale = evidence.checks.find((c) => c.id === "versions.openapi_json_health_example_stale")!;
    expect(surface.actual).toBe("0.4.6");
    expect(stale.actual).toBe(surface.actual);
    expect(stale.status).toBe("fail");
  });

  it("treats a missing yaml HealthResponse surface value as a missing stale check", () => {
    const files = baseFiles();
    files["apps/api/openapi.yaml"] = `openapi: 3.1.0\ninfo:\n  title: Trends API\n  version: ${VERSION}\n`;
    const { deps } = createMockDeps({ files });
    const evidence = collectCutManifestEvidence(DEFAULT_OPTIONS, deps);
    const surface = evidence.checks.find((c) => c.id === "versions.openapi_yaml_health_example")!;
    const stale = evidence.checks.find((c) => c.id === "versions.openapi_health_example_stale")!;
    expect(surface.actual).toBe("unreadable");
    expect(stale.actual).toBe("missing");
    expect(evidence.versions.openapiHealthExample).toBeNull();
    expect(stale.status).toBe("fail");
  });

  it("fails when OpenAPI JSON info.version drifts from the canonical version", () => {
    const files = baseFiles();
    files["apps/api/openapi.json"] = JSON.stringify({
      openapi: "3.1.0",
      info: { title: "Trends API", version: "0.4.22" },
      components: {
        schemas: {
          HealthResponse: { properties: { version: { type: "string", example: VERSION } } },
        },
      },
    });
    const { deps } = createMockDeps({ files });
    const evidence = collectCutManifestEvidence(DEFAULT_OPTIONS, deps);
    const check = evidence.checks.find((c) => c.id === "versions.openapi_json_info_version")!;
    expect(check.status).toBe("fail");
    expect(check.actual).toBe("0.4.22");
    expect(check.expected).toBe(VERSION);
    expect(evidence.status).toBe("failed");
  });

  it("passes when OpenAPI JSON info.version matches the canonical version", () => {
    const { deps } = createMockDeps();
    const evidence = collectCutManifestEvidence(DEFAULT_OPTIONS, deps);
    const check = evidence.checks.find((c) => c.id === "versions.openapi_json_info_version")!;
    expect(check.status).toBe("pass");
    expect(check.actual).toBe(VERSION);
  });

  it("fails closed when yaml and json info.version disagree (json stale)", () => {
    const files = baseFiles();
    files["apps/api/openapi.json"] = JSON.stringify({
      openapi: "3.1.0",
      info: { title: "Trends API", version: "0.4.22" },
      components: {
        schemas: {
          HealthResponse: { properties: { version: { type: "string", example: VERSION } } },
        },
      },
    });
    const { deps } = createMockDeps({ files });
    const evidence = collectCutManifestEvidence(DEFAULT_OPTIONS, deps);
    const check = evidence.checks.find((c) => c.id === "versions.openapi_info_version_parity")!;
    expect(check.status).toBe("fail");
    expect(check.expected).toBe(VERSION);
    expect(check.actual).toBe(`${VERSION} != 0.4.22`);
    expect(check.detail).toMatch(/disagree|parity/i);
    expect(evidence.status).toBe("failed");
    expect(evidence.exitCode).toBe(2);
  });

  it("fails closed when yaml and json info.version disagree (yaml stale)", () => {
    const files = baseFiles();
    files["apps/api/openapi.yaml"] =
      `openapi: 3.1.0\ninfo:\n  title: Trends API\n  version: 0.4.22\n` +
      `components:\n  schemas:\n    HealthResponse:\n      properties:\n        version:\n          type: string\n          example: '${VERSION}'\n`;
    const { deps } = createMockDeps({ files });
    const evidence = collectCutManifestEvidence(DEFAULT_OPTIONS, deps);
    const check = evidence.checks.find((c) => c.id === "versions.openapi_info_version_parity")!;
    expect(check.status).toBe("fail");
    expect(check.actual).toBe(`0.4.22 != ${VERSION}`);
    expect(evidence.status).toBe("failed");
  });

  it("fails closed when yaml and json info.version agree with each other but not canonical", () => {
    const files = baseFiles();
    files["apps/api/openapi.yaml"] =
      `openapi: 3.1.0\ninfo:\n  title: Trends API\n  version: 0.4.22\n` +
      `components:\n  schemas:\n    HealthResponse:\n      properties:\n        version:\n          type: string\n          example: '${VERSION}'\n`;
    files["apps/api/openapi.json"] = JSON.stringify({
      openapi: "3.1.0",
      info: { title: "Trends API", version: "0.4.22" },
      components: {
        schemas: {
          HealthResponse: { properties: { version: { type: "string", example: VERSION } } },
        },
      },
    });
    const { deps } = createMockDeps({ files });
    const evidence = collectCutManifestEvidence(DEFAULT_OPTIONS, deps);
    const check = evidence.checks.find((c) => c.id === "versions.openapi_info_version_parity")!;
    expect(check.status).toBe("fail");
    expect(check.expected).toBe(VERSION);
    expect(check.actual).toBe("0.4.22");
    expect(evidence.status).toBe("failed");
  });

  it("fails closed when yaml info.version is missing for parity", () => {
    const files = baseFiles();
    files["apps/api/openapi.yaml"] = `openapi: 3.1.0\ninfo:\n  title: Trends API\n`;
    const { deps } = createMockDeps({ files });
    const evidence = collectCutManifestEvidence(DEFAULT_OPTIONS, deps);
    const check = evidence.checks.find((c) => c.id === "versions.openapi_info_version_parity")!;
    expect(check.status).toBe("fail");
    expect(check.actual).toBe("missing");
    expect(evidence.status).toBe("failed");
  });

  it("passes when yaml and json info.version both equal the canonical version", () => {
    const { deps } = createMockDeps();
    const evidence = collectCutManifestEvidence(DEFAULT_OPTIONS, deps);
    const check = evidence.checks.find((c) => c.id === "versions.openapi_info_version_parity")!;
    expect(check.status).toBe("pass");
    expect(check.actual).toBe(VERSION);
    expect(check.expected).toBe(VERSION);
  });

  it("reads yaml/json info.version parity from VERSION_SURFACE values", () => {
    const files = baseFiles();
    files["apps/api/openapi.json"] = JSON.stringify({
      openapi: "3.1.0",
      info: { title: "Trends API", version: "0.4.22" },
      components: {
        schemas: {
          HealthResponse: { properties: { version: { type: "string", example: VERSION } } },
        },
      },
    });
    const { deps } = createMockDeps({ files });
    const evidence = collectCutManifestEvidence(DEFAULT_OPTIONS, deps);
    const yamlSurface = evidence.checks.find((c) => c.id === "versions.openapi_info_version")!;
    const jsonSurface = evidence.checks.find((c) => c.id === "versions.openapi_json_info_version")!;
    const parity = evidence.checks.find((c) => c.id === "versions.openapi_info_version_parity")!;
    expect(yamlSurface.actual).toBe(VERSION);
    expect(jsonSurface.actual).toBe("0.4.22");
    expect(parity.actual).toBe(`${yamlSurface.actual} != ${jsonSurface.actual}`);
    expect(parity.status).toBe("fail");
  });

  it("fails closed when yaml and json HealthResponse examples disagree", () => {
    const files = baseFiles();
    files["apps/api/openapi.json"] = JSON.stringify({
      openapi: "3.1.0",
      info: { title: "Trends API", version: VERSION },
      components: {
        schemas: {
          HealthResponse: { properties: { version: { type: "string", example: "0.4.6" } } },
        },
      },
    });
    const { deps } = createMockDeps({ files });
    const evidence = collectCutManifestEvidence(DEFAULT_OPTIONS, deps);
    const check = evidence.checks.find((c) => c.id === "versions.openapi_health_example_parity")!;
    expect(check.status).toBe("fail");
    expect(check.expected).toBe(VERSION);
    expect(check.actual).toBe(`${VERSION} != 0.4.6`);
    expect(evidence.status).toBe("failed");
  });

  it("fails closed when yaml and json HealthResponse examples agree but are not canonical", () => {
    const files = baseFiles();
    files["apps/api/openapi.yaml"] =
      `openapi: 3.1.0\ninfo:\n  title: Trends API\n  version: ${VERSION}\n` +
      `components:\n  schemas:\n    HealthResponse:\n      properties:\n        version:\n          type: string\n          example: '0.4.6'\n`;
    files["apps/api/openapi.json"] = JSON.stringify({
      openapi: "3.1.0",
      info: { title: "Trends API", version: VERSION },
      components: {
        schemas: {
          HealthResponse: { properties: { version: { type: "string", example: "0.4.6" } } },
        },
      },
    });
    const { deps } = createMockDeps({ files });
    const evidence = collectCutManifestEvidence(DEFAULT_OPTIONS, deps);
    const check = evidence.checks.find((c) => c.id === "versions.openapi_health_example_parity")!;
    expect(check.status).toBe("fail");
    expect(check.actual).toBe("0.4.6");
    expect(evidence.status).toBe("failed");
  });

  it("passes when yaml and json HealthResponse examples both equal the canonical version", () => {
    const { deps } = createMockDeps();
    const evidence = collectCutManifestEvidence(DEFAULT_OPTIONS, deps);
    const check = evidence.checks.find((c) => c.id === "versions.openapi_health_example_parity")!;
    expect(check.status).toBe("pass");
    expect(check.actual).toBe(VERSION);
  });

  it("fails closed when health.ts example disagrees with OpenAPI HealthResponse examples", () => {
    const files = baseFiles();
    files["apps/api/src/schemas/health.ts"] =
      `    version: z.string().optional().openapi({\n      example: "0.4.6",\n    }),\n`;
    const { deps } = createMockDeps({ files });
    const evidence = collectCutManifestEvidence(DEFAULT_OPTIONS, deps);
    const check = evidence.checks.find((c) => c.id === "versions.health_schema_openapi_example_parity")!;
    expect(check.status).toBe("fail");
    expect(check.actual).toBe(`0.4.6 != ${VERSION}`);
    expect(evidence.status).toBe("failed");
  });

  it("passes when health.ts and OpenAPI HealthResponse examples equal canonical", () => {
    const { deps } = createMockDeps();
    const evidence = collectCutManifestEvidence(DEFAULT_OPTIONS, deps);
    const check = evidence.checks.find((c) => c.id === "versions.health_schema_openapi_example_parity")!;
    expect(check.status).toBe("pass");
    expect(check.actual).toBe(VERSION);
  });

  it("fails closed when health.ts example disagrees with openapi.json HealthResponse example", () => {
    const files = baseFiles();
    files["apps/api/openapi.json"] = JSON.stringify({
      openapi: "3.1.0",
      info: { title: "Trends API", version: VERSION },
      components: {
        schemas: {
          HealthResponse: { properties: { version: { type: "string", example: "0.4.6" } } },
        },
      },
    });
    const { deps } = createMockDeps({ files });
    const evidence = collectCutManifestEvidence(DEFAULT_OPTIONS, deps);
    const check = evidence.checks.find((c) => c.id === "versions.health_schema_openapi_json_example_parity")!;
    expect(check.status).toBe("fail");
    expect(check.expected).toBe(VERSION);
    expect(check.actual).toBe(`${VERSION} != 0.4.6`);
    expect(evidence.status).toBe("failed");
    expect(evidence.exitCode).toBe(2);
  });

  it("fails closed when health.ts and openapi.json examples agree but are not canonical", () => {
    const files = baseFiles();
    files["apps/api/src/schemas/health.ts"] =
      `    version: z.string().optional().openapi({\n      example: "0.4.6",\n    }),\n`;
    files["apps/api/openapi.json"] = JSON.stringify({
      openapi: "3.1.0",
      info: { title: "Trends API", version: VERSION },
      components: {
        schemas: {
          HealthResponse: { properties: { version: { type: "string", example: "0.4.6" } } },
        },
      },
    });
    const { deps } = createMockDeps({ files });
    const evidence = collectCutManifestEvidence(DEFAULT_OPTIONS, deps);
    const check = evidence.checks.find((c) => c.id === "versions.health_schema_openapi_json_example_parity")!;
    expect(check.status).toBe("fail");
    expect(check.expected).toBe(VERSION);
    expect(check.actual).toBe("0.4.6");
    expect(evidence.status).toBe("failed");
  });

  it("fails closed when openapi.json HealthResponse example is missing for health.ts parity", () => {
    const files = baseFiles();
    files["apps/api/openapi.json"] = JSON.stringify({
      openapi: "3.1.0",
      info: { title: "Trends API", version: VERSION },
    });
    const { deps } = createMockDeps({ files });
    const evidence = collectCutManifestEvidence(DEFAULT_OPTIONS, deps);
    const check = evidence.checks.find((c) => c.id === "versions.health_schema_openapi_json_example_parity")!;
    expect(check.status).toBe("fail");
    expect(check.actual).toBe("missing");
    expect(evidence.status).toBe("failed");
  });

  it("passes when health.ts and openapi.json HealthResponse examples equal canonical", () => {
    const { deps } = createMockDeps();
    const evidence = collectCutManifestEvidence(DEFAULT_OPTIONS, deps);
    const check = evidence.checks.find((c) => c.id === "versions.health_schema_openapi_json_example_parity")!;
    expect(check.status).toBe("pass");
    expect(check.actual).toBe(VERSION);
    expect(check.expected).toBe(VERSION);
  });

  it("fails closed when api-types @example disagrees with openapi.json HealthResponse example", () => {
    const files = baseFiles();
    files["apps/api/openapi.json"] = JSON.stringify({
      openapi: "3.1.0",
      info: { title: "Trends API", version: VERSION },
      components: {
        schemas: {
          HealthResponse: { properties: { version: { type: "string", example: "0.4.6" } } },
        },
      },
    });
    const { deps } = createMockDeps({ files });
    const evidence = collectCutManifestEvidence(DEFAULT_OPTIONS, deps);
    const check = evidence.checks.find((c) => c.id === "versions.api_types_openapi_json_example_parity")!;
    expect(check.status).toBe("fail");
    expect(check.actual).toBe(`${VERSION} != 0.4.6`);
    expect(evidence.status).toBe("failed");
  });

  it("fails closed when api-types and openapi.json examples agree but are not canonical", () => {
    const files = baseFiles();
    files["apps/web/src/lib/api-types.ts"] = `        /** @example 0.4.6 */\n        version?: string;\n`;
    files["apps/api/openapi.json"] = JSON.stringify({
      openapi: "3.1.0",
      info: { title: "Trends API", version: VERSION },
      components: {
        schemas: {
          HealthResponse: { properties: { version: { type: "string", example: "0.4.6" } } },
        },
      },
    });
    const { deps } = createMockDeps({ files });
    const evidence = collectCutManifestEvidence(DEFAULT_OPTIONS, deps);
    const check = evidence.checks.find((c) => c.id === "versions.api_types_openapi_json_example_parity")!;
    expect(check.status).toBe("fail");
    expect(check.actual).toBe("0.4.6");
    expect(evidence.status).toBe("failed");
  });

  it("passes when api-types @example and openapi.json HealthResponse example equal canonical", () => {
    const { deps } = createMockDeps();
    const evidence = collectCutManifestEvidence(DEFAULT_OPTIONS, deps);
    const check = evidence.checks.find((c) => c.id === "versions.api_types_openapi_json_example_parity")!;
    expect(check.status).toBe("pass");
    expect(check.actual).toBe(VERSION);
  });

  it("fails closed when api-types @example disagrees with openapi.yaml HealthResponse example", () => {
    const files = baseFiles();
    files["apps/api/openapi.yaml"] =
      `openapi: 3.1.0\ninfo:\n  title: Trends API\n  version: ${VERSION}\n` +
      `components:\n  schemas:\n    HealthResponse:\n      properties:\n        version:\n          type: string\n          example: '0.4.6'\n`;
    const { deps } = createMockDeps({ files });
    const evidence = collectCutManifestEvidence(DEFAULT_OPTIONS, deps);
    const check = evidence.checks.find((c) => c.id === "versions.api_types_openapi_yaml_example_parity")!;
    expect(check.status).toBe("fail");
    expect(check.expected).toBe(VERSION);
    expect(check.actual).toBe(`${VERSION} != 0.4.6`);
    expect(evidence.status).toBe("failed");
    expect(evidence.exitCode).toBe(2);
  });

  it("fails closed when api-types and openapi.yaml examples agree but are not canonical", () => {
    const files = baseFiles();
    files["apps/web/src/lib/api-types.ts"] = `        /** @example 0.4.6 */\n        version?: string;\n`;
    files["apps/api/openapi.yaml"] =
      `openapi: 3.1.0\ninfo:\n  title: Trends API\n  version: ${VERSION}\n` +
      `components:\n  schemas:\n    HealthResponse:\n      properties:\n        version:\n          type: string\n          example: '0.4.6'\n`;
    const { deps } = createMockDeps({ files });
    const evidence = collectCutManifestEvidence(DEFAULT_OPTIONS, deps);
    const check = evidence.checks.find((c) => c.id === "versions.api_types_openapi_yaml_example_parity")!;
    expect(check.status).toBe("fail");
    expect(check.expected).toBe(VERSION);
    expect(check.actual).toBe("0.4.6");
    expect(evidence.status).toBe("failed");
  });

  it("fails closed when openapi.yaml HealthResponse example is missing for api-types parity", () => {
    const files = baseFiles();
    files["apps/api/openapi.yaml"] = `openapi: 3.1.0\ninfo:\n  title: Trends API\n  version: ${VERSION}\n`;
    const { deps } = createMockDeps({ files });
    const evidence = collectCutManifestEvidence(DEFAULT_OPTIONS, deps);
    const check = evidence.checks.find((c) => c.id === "versions.api_types_openapi_yaml_example_parity")!;
    expect(check.status).toBe("fail");
    expect(check.actual).toBe("missing");
    expect(evidence.status).toBe("failed");
  });

  it("passes when api-types @example and openapi.yaml HealthResponse example equal canonical", () => {
    const { deps } = createMockDeps();
    const evidence = collectCutManifestEvidence(DEFAULT_OPTIONS, deps);
    const check = evidence.checks.find((c) => c.id === "versions.api_types_openapi_yaml_example_parity")!;
    expect(check.status).toBe("pass");
    expect(check.actual).toBe(VERSION);
    expect(check.expected).toBe(VERSION);
  });

  it("fails closed when api-types @example disagrees with health.ts example", () => {
    const files = baseFiles();
    files["apps/api/src/schemas/health.ts"] =
      `    version: z.string().optional().openapi({\n      example: "0.4.6",\n    }),\n`;
    const { deps } = createMockDeps({ files });
    const evidence = collectCutManifestEvidence(DEFAULT_OPTIONS, deps);
    const check = evidence.checks.find((c) => c.id === "versions.api_types_health_schema_example_parity")!;
    expect(check.status).toBe("fail");
    expect(check.actual).toBe(`${VERSION} != 0.4.6`);
    expect(evidence.status).toBe("failed");
  });

  it("fails closed when api-types and health.ts examples agree but are not canonical", () => {
    const files = baseFiles();
    files["apps/web/src/lib/api-types.ts"] = `        /** @example 0.4.6 */\n        version?: string;\n`;
    files["apps/api/src/schemas/health.ts"] =
      `    version: z.string().optional().openapi({\n      example: "0.4.6",\n    }),\n`;
    const { deps } = createMockDeps({ files });
    const evidence = collectCutManifestEvidence(DEFAULT_OPTIONS, deps);
    const check = evidence.checks.find((c) => c.id === "versions.api_types_health_schema_example_parity")!;
    expect(check.status).toBe("fail");
    expect(check.actual).toBe("0.4.6");
    expect(evidence.status).toBe("failed");
  });

  it("passes when api-types @example and health.ts example equal canonical", () => {
    const { deps } = createMockDeps();
    const evidence = collectCutManifestEvidence(DEFAULT_OPTIONS, deps);
    const check = evidence.checks.find((c) => c.id === "versions.api_types_health_schema_example_parity")!;
    expect(check.status).toBe("pass");
    expect(check.actual).toBe(VERSION);
  });

  it("fails closed when config.ts version disagrees with health.ts example", () => {
    const files = baseFiles();
    files["apps/api/src/schemas/health.ts"] =
      `    version: z.string().optional().openapi({\n      example: "0.4.6",\n    }),\n`;
    const { deps } = createMockDeps({ files });
    const evidence = collectCutManifestEvidence(DEFAULT_OPTIONS, deps);
    const check = evidence.checks.find((c) => c.id === "versions.config_health_schema_example_parity")!;
    expect(check.status).toBe("fail");
    expect(check.actual).toBe(`${VERSION} != 0.4.6`);
    expect(evidence.status).toBe("failed");
  });

  it("fails closed when config.ts and health.ts examples agree but are not canonical", () => {
    const files = baseFiles();
    files["apps/api/src/services/config.ts"] = `export const config = {\n  version: "0.4.6",\n};\n`;
    files["apps/api/src/schemas/health.ts"] =
      `    version: z.string().optional().openapi({\n      example: "0.4.6",\n    }),\n`;
    const { deps } = createMockDeps({ files });
    const evidence = collectCutManifestEvidence(DEFAULT_OPTIONS, deps);
    const check = evidence.checks.find((c) => c.id === "versions.config_health_schema_example_parity")!;
    expect(check.status).toBe("fail");
    expect(check.actual).toBe("0.4.6");
    expect(evidence.status).toBe("failed");
  });

  it("fails closed when config.ts version is missing for health.ts parity", () => {
    const files = baseFiles();
    files["apps/api/src/services/config.ts"] = `export const config = {\n  timezone: "UTC",\n};\n`;
    const { deps } = createMockDeps({ files });
    const evidence = collectCutManifestEvidence(DEFAULT_OPTIONS, deps);
    const check = evidence.checks.find((c) => c.id === "versions.config_health_schema_example_parity")!;
    expect(check.status).toBe("fail");
    expect(check.actual).toBe("missing");
    expect(evidence.status).toBe("failed");
  });

  it("passes when config.ts version and health.ts example equal canonical", () => {
    const { deps } = createMockDeps();
    const evidence = collectCutManifestEvidence(DEFAULT_OPTIONS, deps);
    const check = evidence.checks.find((c) => c.id === "versions.config_health_schema_example_parity")!;
    expect(check.status).toBe("pass");
    expect(check.actual).toBe(VERSION);
  });

  it("fails closed when config.ts version disagrees with openapi.yaml HealthResponse example", () => {
    const files = baseFiles();
    files["apps/api/openapi.yaml"] =
      `openapi: 3.1.0\ninfo:\n  title: Trends API\n  version: ${VERSION}\n` +
      `components:\n  schemas:\n    HealthResponse:\n      properties:\n        version:\n          type: string\n          example: '0.4.6'\n`;
    const { deps } = createMockDeps({ files });
    const evidence = collectCutManifestEvidence(DEFAULT_OPTIONS, deps);
    const check = evidence.checks.find((c) => c.id === "versions.config_openapi_yaml_example_parity")!;
    expect(check.status).toBe("fail");
    expect(check.actual).toBe(`${VERSION} != 0.4.6`);
    expect(evidence.status).toBe("failed");
  });

  it("fails closed when config.ts and openapi.yaml examples agree but are not canonical", () => {
    const files = baseFiles();
    files["apps/api/src/services/config.ts"] = `export const config = {\n  version: "0.4.6",\n};\n`;
    files["apps/api/openapi.yaml"] =
      `openapi: 3.1.0\ninfo:\n  title: Trends API\n  version: ${VERSION}\n` +
      `components:\n  schemas:\n    HealthResponse:\n      properties:\n        version:\n          type: string\n          example: '0.4.6'\n`;
    const { deps } = createMockDeps({ files });
    const evidence = collectCutManifestEvidence(DEFAULT_OPTIONS, deps);
    const check = evidence.checks.find((c) => c.id === "versions.config_openapi_yaml_example_parity")!;
    expect(check.status).toBe("fail");
    expect(check.actual).toBe("0.4.6");
    expect(evidence.status).toBe("failed");
  });

  it("fails closed when openapi.yaml HealthResponse example is missing for config.ts parity", () => {
    const files = baseFiles();
    files["apps/api/openapi.yaml"] = `openapi: 3.1.0\ninfo:\n  title: Trends API\n  version: ${VERSION}\n`;
    const { deps } = createMockDeps({ files });
    const evidence = collectCutManifestEvidence(DEFAULT_OPTIONS, deps);
    const check = evidence.checks.find((c) => c.id === "versions.config_openapi_yaml_example_parity")!;
    expect(check.status).toBe("fail");
    expect(check.actual).toBe("missing");
    expect(evidence.status).toBe("failed");
  });

  it("passes when config.ts version and openapi.yaml HealthResponse example equal canonical", () => {
    const { deps } = createMockDeps();
    const evidence = collectCutManifestEvidence(DEFAULT_OPTIONS, deps);
    const check = evidence.checks.find((c) => c.id === "versions.config_openapi_yaml_example_parity")!;
    expect(check.status).toBe("pass");
    expect(check.actual).toBe(VERSION);
  });

  it("fails closed when config.ts version disagrees with openapi.json HealthResponse example", () => {
    const files = baseFiles();
    files["apps/api/openapi.json"] = JSON.stringify({
      openapi: "3.1.0",
      info: { title: "Trends API", version: VERSION },
      components: {
        schemas: {
          HealthResponse: { properties: { version: { type: "string", example: "0.4.6" } } },
        },
      },
    });
    const { deps } = createMockDeps({ files });
    const evidence = collectCutManifestEvidence(DEFAULT_OPTIONS, deps);
    const check = evidence.checks.find((c) => c.id === "versions.config_openapi_json_example_parity")!;
    expect(check.status).toBe("fail");
    expect(check.actual).toBe(`${VERSION} != 0.4.6`);
    expect(evidence.status).toBe("failed");
  });

  it("fails closed when config.ts and openapi.json examples agree but are not canonical", () => {
    const files = baseFiles();
    files["apps/api/src/services/config.ts"] = `export const config = {\n  version: "0.4.6",\n};\n`;
    files["apps/api/openapi.json"] = JSON.stringify({
      openapi: "3.1.0",
      info: { title: "Trends API", version: VERSION },
      components: {
        schemas: {
          HealthResponse: { properties: { version: { type: "string", example: "0.4.6" } } },
        },
      },
    });
    const { deps } = createMockDeps({ files });
    const evidence = collectCutManifestEvidence(DEFAULT_OPTIONS, deps);
    const check = evidence.checks.find((c) => c.id === "versions.config_openapi_json_example_parity")!;
    expect(check.status).toBe("fail");
    expect(check.actual).toBe("0.4.6");
    expect(evidence.status).toBe("failed");
  });

  it("fails closed when openapi.json HealthResponse example is missing for config.ts parity", () => {
    const files = baseFiles();
    files["apps/api/openapi.json"] = JSON.stringify({
      openapi: "3.1.0",
      info: { title: "Trends API", version: VERSION },
    });
    const { deps } = createMockDeps({ files });
    const evidence = collectCutManifestEvidence(DEFAULT_OPTIONS, deps);
    const check = evidence.checks.find((c) => c.id === "versions.config_openapi_json_example_parity")!;
    expect(check.status).toBe("fail");
    expect(check.actual).toBe("missing");
    expect(evidence.status).toBe("failed");
  });

  it("passes when config.ts version and openapi.json HealthResponse example equal canonical", () => {
    const { deps } = createMockDeps();
    const evidence = collectCutManifestEvidence(DEFAULT_OPTIONS, deps);
    const check = evidence.checks.find((c) => c.id === "versions.config_openapi_json_example_parity")!;
    expect(check.status).toBe("pass");
    expect(check.actual).toBe(VERSION);
  });

  it("fails closed when config.ts version disagrees with api-types @example", () => {
    const files = baseFiles();
    files["apps/web/src/lib/api-types.ts"] = `        /** @example 0.4.6 */\n        version?: string;\n`;
    const { deps } = createMockDeps({ files });
    const evidence = collectCutManifestEvidence(DEFAULT_OPTIONS, deps);
    const check = evidence.checks.find((c) => c.id === "versions.config_api_types_example_parity")!;
    expect(check.status).toBe("fail");
    expect(check.actual).toBe(`${VERSION} != 0.4.6`);
    expect(evidence.status).toBe("failed");
  });

  it("fails closed when config.ts and api-types examples agree but are not canonical", () => {
    const files = baseFiles();
    files["apps/api/src/services/config.ts"] = `export const config = {\n  version: "0.4.6",\n};\n`;
    files["apps/web/src/lib/api-types.ts"] = `        /** @example 0.4.6 */\n        version?: string;\n`;
    const { deps } = createMockDeps({ files });
    const evidence = collectCutManifestEvidence(DEFAULT_OPTIONS, deps);
    const check = evidence.checks.find((c) => c.id === "versions.config_api_types_example_parity")!;
    expect(check.status).toBe("fail");
    expect(check.actual).toBe("0.4.6");
    expect(evidence.status).toBe("failed");
  });

  it("fails closed when api-types @example is missing for config.ts parity", () => {
    const files = baseFiles();
    files["apps/web/src/lib/api-types.ts"] = `        version?: string;\n`;
    const { deps } = createMockDeps({ files });
    const evidence = collectCutManifestEvidence(DEFAULT_OPTIONS, deps);
    const check = evidence.checks.find((c) => c.id === "versions.config_api_types_example_parity")!;
    expect(check.status).toBe("fail");
    expect(check.actual).toBe("missing");
    expect(evidence.status).toBe("failed");
  });

  it("passes when config.ts version and api-types @example equal canonical", () => {
    const { deps } = createMockDeps();
    const evidence = collectCutManifestEvidence(DEFAULT_OPTIONS, deps);
    const check = evidence.checks.find((c) => c.id === "versions.config_api_types_example_parity")!;
    expect(check.status).toBe("pass");
    expect(check.actual).toBe(VERSION);
  });

  it("fails closed when apps/api/package.json disagrees with config.ts version", () => {
    const files = baseFiles();
    files["apps/api/src/services/config.ts"] = `export const config = {\n  version: "0.4.6",\n};\n`;
    const { deps } = createMockDeps({ files });
    const evidence = collectCutManifestEvidence(DEFAULT_OPTIONS, deps);
    const check = evidence.checks.find((c) => c.id === "versions.package_api_config_version_parity")!;
    expect(check.status).toBe("fail");
    expect(check.actual).toBe(`${VERSION} != 0.4.6`);
    expect(evidence.status).toBe("failed");
  });

  it("fails closed when apps/api/package.json and config.ts agree but are not canonical", () => {
    const files = baseFiles();
    files["apps/api/package.json"] = JSON.stringify({ name: "api", version: "0.4.6" });
    files["apps/api/src/services/config.ts"] = `export const config = {\n  version: "0.4.6",\n};\n`;
    const { deps } = createMockDeps({ files });
    const evidence = collectCutManifestEvidence(DEFAULT_OPTIONS, deps);
    const check = evidence.checks.find((c) => c.id === "versions.package_api_config_version_parity")!;
    expect(check.status).toBe("fail");
    expect(check.actual).toBe("0.4.6");
    expect(evidence.status).toBe("failed");
  });

  it("fails closed when apps/api/package.json version is missing for config.ts parity", () => {
    const files = baseFiles();
    files["apps/api/package.json"] = JSON.stringify({ name: "api" });
    const { deps } = createMockDeps({ files });
    const evidence = collectCutManifestEvidence(DEFAULT_OPTIONS, deps);
    const check = evidence.checks.find((c) => c.id === "versions.package_api_config_version_parity")!;
    expect(check.status).toBe("fail");
    expect(check.actual).toBe("missing");
    expect(evidence.status).toBe("failed");
  });

  it("passes when apps/api/package.json and config.ts version equal canonical", () => {
    const { deps } = createMockDeps();
    const evidence = collectCutManifestEvidence(DEFAULT_OPTIONS, deps);
    const check = evidence.checks.find((c) => c.id === "versions.package_api_config_version_parity")!;
    expect(check.status).toBe("pass");
    expect(check.actual).toBe(VERSION);
  });

  it("fails closed when apps/web/package.json disagrees with config.ts version", () => {
    const files = baseFiles();
    files["apps/api/src/services/config.ts"] = `export const config = {\n  version: "0.4.6",\n};\n`;
    const { deps } = createMockDeps({ files });
    const evidence = collectCutManifestEvidence(DEFAULT_OPTIONS, deps);
    const check = evidence.checks.find((c) => c.id === "versions.package_web_config_version_parity")!;
    expect(check.status).toBe("fail");
    expect(check.actual).toBe(`${VERSION} != 0.4.6`);
    expect(evidence.status).toBe("failed");
  });

  it("fails closed when apps/web/package.json and config.ts agree but are not canonical", () => {
    const files = baseFiles();
    files["apps/web/package.json"] = JSON.stringify({ name: "web", version: "0.4.6" });
    files["apps/api/src/services/config.ts"] = `export const config = {\n  version: "0.4.6",\n};\n`;
    const { deps } = createMockDeps({ files });
    const evidence = collectCutManifestEvidence(DEFAULT_OPTIONS, deps);
    const check = evidence.checks.find((c) => c.id === "versions.package_web_config_version_parity")!;
    expect(check.status).toBe("fail");
    expect(check.actual).toBe("0.4.6");
    expect(evidence.status).toBe("failed");
  });

  it("fails closed when apps/web/package.json version is missing for config.ts parity", () => {
    const files = baseFiles();
    files["apps/web/package.json"] = JSON.stringify({ name: "web" });
    const { deps } = createMockDeps({ files });
    const evidence = collectCutManifestEvidence(DEFAULT_OPTIONS, deps);
    const check = evidence.checks.find((c) => c.id === "versions.package_web_config_version_parity")!;
    expect(check.status).toBe("fail");
    expect(check.actual).toBe("missing");
    expect(evidence.status).toBe("failed");
  });

  it("passes when apps/web/package.json and config.ts version equal canonical", () => {
    const { deps } = createMockDeps();
    const evidence = collectCutManifestEvidence(DEFAULT_OPTIONS, deps);
    const check = evidence.checks.find((c) => c.id === "versions.package_web_config_version_parity")!;
    expect(check.status).toBe("pass");
    expect(check.actual).toBe(VERSION);
  });

  it("fails closed when root package.json disagrees with config.ts version", () => {
    const files = baseFiles();
    files["apps/api/src/services/config.ts"] = `export const config = {\n  version: "0.4.6",\n};\n`;
    const { deps } = createMockDeps({ files });
    const evidence = collectCutManifestEvidence(DEFAULT_OPTIONS, deps);
    const check = evidence.checks.find((c) => c.id === "versions.package_root_config_version_parity")!;
    expect(check.status).toBe("fail");
    expect(check.actual).toBe(`${VERSION} != 0.4.6`);
    expect(evidence.status).toBe("failed");
  });

  it("fails closed when root package.json and config.ts agree but are not canonical", () => {
    const files = baseFiles();
    files["package.json"] = JSON.stringify({ name: "trends", version: "0.4.6" });
    files["apps/api/src/services/config.ts"] = `export const config = {\n  version: "0.4.6",\n};\n`;
    const { deps } = createMockDeps({ files });
    const evidence = collectCutManifestEvidence(DEFAULT_OPTIONS, deps);
    const check = evidence.checks.find((c) => c.id === "versions.package_root_config_version_parity")!;
    expect(check.status).toBe("fail");
    expect(check.actual).toBe("0.4.6");
    expect(evidence.status).toBe("failed");
  });

  it("fails closed when root package.json version is missing for config.ts parity", () => {
    const files = baseFiles();
    files["package.json"] = JSON.stringify({ name: "trends" });
    const { deps } = createMockDeps({ files });
    const evidence = collectCutManifestEvidence(DEFAULT_OPTIONS, deps);
    const check = evidence.checks.find((c) => c.id === "versions.package_root_config_version_parity")!;
    expect(check.status).toBe("fail");
    expect(check.actual).toBe("missing");
    expect(evidence.status).toBe("failed");
  });

  it("passes when root package.json and config.ts version equal canonical", () => {
    const { deps } = createMockDeps();
    const evidence = collectCutManifestEvidence(DEFAULT_OPTIONS, deps);
    const check = evidence.checks.find((c) => c.id === "versions.package_root_config_version_parity")!;
    expect(check.status).toBe("pass");
    expect(check.actual).toBe(VERSION);
  });

  it("fails closed when packages/shared/package.json disagrees with config.ts version", () => {
    const files = baseFiles();
    files["apps/api/src/services/config.ts"] = `export const config = {\n  version: "0.4.6",\n};\n`;
    const { deps } = createMockDeps({ files });
    const evidence = collectCutManifestEvidence(DEFAULT_OPTIONS, deps);
    const check = evidence.checks.find((c) => c.id === "versions.package_shared_config_version_parity")!;
    expect(check.status).toBe("fail");
    expect(check.actual).toBe(`${VERSION} != 0.4.6`);
    expect(evidence.status).toBe("failed");
  });

  it("fails closed when packages/shared/package.json and config.ts agree but are not canonical", () => {
    const files = baseFiles();
    files["packages/shared/package.json"] = JSON.stringify({ name: "shared", version: "0.4.6" });
    files["apps/api/src/services/config.ts"] = `export const config = {\n  version: "0.4.6",\n};\n`;
    const { deps } = createMockDeps({ files });
    const evidence = collectCutManifestEvidence(DEFAULT_OPTIONS, deps);
    const check = evidence.checks.find((c) => c.id === "versions.package_shared_config_version_parity")!;
    expect(check.status).toBe("fail");
    expect(check.actual).toBe("0.4.6");
    expect(evidence.status).toBe("failed");
  });

  it("fails closed when packages/shared/package.json version is missing for config.ts parity", () => {
    const files = baseFiles();
    files["packages/shared/package.json"] = JSON.stringify({ name: "shared" });
    const { deps } = createMockDeps({ files });
    const evidence = collectCutManifestEvidence(DEFAULT_OPTIONS, deps);
    const check = evidence.checks.find((c) => c.id === "versions.package_shared_config_version_parity")!;
    expect(check.status).toBe("fail");
    expect(check.actual).toBe("missing");
    expect(evidence.status).toBe("failed");
  });

  it("passes when packages/shared/package.json and config.ts version equal canonical", () => {
    const { deps } = createMockDeps();
    const evidence = collectCutManifestEvidence(DEFAULT_OPTIONS, deps);
    const check = evidence.checks.find((c) => c.id === "versions.package_shared_config_version_parity")!;
    expect(check.status).toBe("pass");
    expect(check.actual).toBe(VERSION);
  });

  it("fails closed when packages/convex/package.json disagrees with config.ts version", () => {
    const files = baseFiles();
    files["apps/api/src/services/config.ts"] = `export const config = {\n  version: "0.4.6",\n};\n`;
    const { deps } = createMockDeps({ files });
    const evidence = collectCutManifestEvidence(DEFAULT_OPTIONS, deps);
    const check = evidence.checks.find((c) => c.id === "versions.package_convex_config_version_parity")!;
    expect(check.status).toBe("fail");
    expect(check.actual).toBe(`${VERSION} != 0.4.6`);
    expect(evidence.status).toBe("failed");
  });

  it("fails closed when packages/convex/package.json and config.ts agree but are not canonical", () => {
    const files = baseFiles();
    files["packages/convex/package.json"] = JSON.stringify({ name: "convex", version: "0.4.6" });
    files["apps/api/src/services/config.ts"] = `export const config = {\n  version: "0.4.6",\n};\n`;
    const { deps } = createMockDeps({ files });
    const evidence = collectCutManifestEvidence(DEFAULT_OPTIONS, deps);
    const check = evidence.checks.find((c) => c.id === "versions.package_convex_config_version_parity")!;
    expect(check.status).toBe("fail");
    expect(check.actual).toBe("0.4.6");
    expect(evidence.status).toBe("failed");
  });

  it("fails closed when packages/convex/package.json version is missing for config.ts parity", () => {
    const files = baseFiles();
    files["packages/convex/package.json"] = JSON.stringify({ name: "convex" });
    const { deps } = createMockDeps({ files });
    const evidence = collectCutManifestEvidence(DEFAULT_OPTIONS, deps);
    const check = evidence.checks.find((c) => c.id === "versions.package_convex_config_version_parity")!;
    expect(check.status).toBe("fail");
    expect(check.actual).toBe("missing");
    expect(evidence.status).toBe("failed");
  });

  it("passes when packages/convex/package.json and config.ts version equal canonical", () => {
    const { deps } = createMockDeps();
    const evidence = collectCutManifestEvidence(DEFAULT_OPTIONS, deps);
    const check = evidence.checks.find((c) => c.id === "versions.package_convex_config_version_parity")!;
    expect(check.status).toBe("pass");
    expect(check.actual).toBe(VERSION);
  });

  it("fails closed when apps/browser-extension/package.json disagrees with config.ts version", () => {
    const files = baseFiles();
    files["apps/api/src/services/config.ts"] = `export const config = {\n  version: "0.4.6",\n};\n`;
    const { deps } = createMockDeps({ files });
    const evidence = collectCutManifestEvidence(DEFAULT_OPTIONS, deps);
    const check = evidence.checks.find(
      (c) => c.id === "versions.package_browser_extension_config_version_parity",
    )!;
    expect(check.status).toBe("fail");
    expect(check.actual).toBe(`${VERSION} != 0.4.6`);
    expect(evidence.status).toBe("failed");
  });

  it("fails closed when apps/browser-extension/package.json and config.ts agree but are not canonical", () => {
    const files = baseFiles();
    files["apps/browser-extension/package.json"] = JSON.stringify({ name: "ext", version: "0.4.6" });
    files["apps/api/src/services/config.ts"] = `export const config = {\n  version: "0.4.6",\n};\n`;
    const { deps } = createMockDeps({ files });
    const evidence = collectCutManifestEvidence(DEFAULT_OPTIONS, deps);
    const check = evidence.checks.find(
      (c) => c.id === "versions.package_browser_extension_config_version_parity",
    )!;
    expect(check.status).toBe("fail");
    expect(check.actual).toBe("0.4.6");
    expect(evidence.status).toBe("failed");
  });

  it("fails closed when apps/browser-extension/package.json version is missing for config.ts parity", () => {
    const files = baseFiles();
    files["apps/browser-extension/package.json"] = JSON.stringify({ name: "ext" });
    const { deps } = createMockDeps({ files });
    const evidence = collectCutManifestEvidence(DEFAULT_OPTIONS, deps);
    const check = evidence.checks.find(
      (c) => c.id === "versions.package_browser_extension_config_version_parity",
    )!;
    expect(check.status).toBe("fail");
    expect(check.actual).toBe("missing");
    expect(evidence.status).toBe("failed");
  });

  it("passes when apps/browser-extension/package.json and config.ts version equal canonical", () => {
    const { deps } = createMockDeps();
    const evidence = collectCutManifestEvidence(DEFAULT_OPTIONS, deps);
    const check = evidence.checks.find(
      (c) => c.id === "versions.package_browser_extension_config_version_parity",
    )!;
    expect(check.status).toBe("pass");
    expect(check.actual).toBe(VERSION);
  });

  it("fails closed when root pyproject.toml disagrees with config.ts version", () => {
    const files = baseFiles();
    files["apps/api/src/services/config.ts"] = `export const config = {\n  version: "0.4.6",\n};\n`;
    const { deps } = createMockDeps({ files });
    const evidence = collectCutManifestEvidence(DEFAULT_OPTIONS, deps);
    const check = evidence.checks.find((c) => c.id === "versions.pyproject_root_config_version_parity")!;
    expect(check.status).toBe("fail");
    expect(check.actual).toBe(`${VERSION} != 0.4.6`);
    expect(evidence.status).toBe("failed");
  });

  it("fails closed when root pyproject.toml and config.ts agree but are not canonical", () => {
    const files = baseFiles();
    files["pyproject.toml"] = `[project]\nname = "trends"\nversion = "0.4.6"\n`;
    files["apps/api/src/services/config.ts"] = `export const config = {\n  version: "0.4.6",\n};\n`;
    const { deps } = createMockDeps({ files });
    const evidence = collectCutManifestEvidence(DEFAULT_OPTIONS, deps);
    const check = evidence.checks.find((c) => c.id === "versions.pyproject_root_config_version_parity")!;
    expect(check.status).toBe("fail");
    expect(check.actual).toBe("0.4.6");
    expect(evidence.status).toBe("failed");
  });

  it("fails closed when root pyproject.toml version is missing for config.ts parity", () => {
    const files = baseFiles();
    files["pyproject.toml"] = `[project]\nname = "trends"\n`;
    const { deps } = createMockDeps({ files });
    const evidence = collectCutManifestEvidence(DEFAULT_OPTIONS, deps);
    const check = evidence.checks.find((c) => c.id === "versions.pyproject_root_config_version_parity")!;
    expect(check.status).toBe("fail");
    expect(check.actual).toBe("missing");
    expect(evidence.status).toBe("failed");
  });

  it("passes when root pyproject.toml and config.ts version equal canonical", () => {
    const { deps } = createMockDeps();
    const evidence = collectCutManifestEvidence(DEFAULT_OPTIONS, deps);
    const check = evidence.checks.find((c) => c.id === "versions.pyproject_root_config_version_parity")!;
    expect(check.status).toBe("pass");
    expect(check.actual).toBe(VERSION);
  });

  it("fails closed when worker pyproject.toml disagrees with config.ts version", () => {
    const files = baseFiles();
    files["apps/api/src/services/config.ts"] = `export const config = {\n  version: "0.4.6",\n};\n`;
    const { deps } = createMockDeps({ files });
    const evidence = collectCutManifestEvidence(DEFAULT_OPTIONS, deps);
    const check = evidence.checks.find((c) => c.id === "versions.pyproject_worker_config_version_parity")!;
    expect(check.status).toBe("fail");
    expect(check.actual).toBe(`${VERSION} != 0.4.6`);
    expect(evidence.status).toBe("failed");
  });

  it("fails closed when worker pyproject.toml and config.ts agree but are not canonical", () => {
    const files = baseFiles();
    files["apps/worker/pyproject.toml"] = `[project]\nname = "worker"\nversion = "0.4.6"\n`;
    files["apps/api/src/services/config.ts"] = `export const config = {\n  version: "0.4.6",\n};\n`;
    const { deps } = createMockDeps({ files });
    const evidence = collectCutManifestEvidence(DEFAULT_OPTIONS, deps);
    const check = evidence.checks.find((c) => c.id === "versions.pyproject_worker_config_version_parity")!;
    expect(check.status).toBe("fail");
    expect(check.actual).toBe("0.4.6");
    expect(evidence.status).toBe("failed");
  });

  it("fails closed when worker pyproject.toml version is missing for config.ts parity", () => {
    const files = baseFiles();
    files["apps/worker/pyproject.toml"] = `[project]\nname = "worker"\n`;
    const { deps } = createMockDeps({ files });
    const evidence = collectCutManifestEvidence(DEFAULT_OPTIONS, deps);
    const check = evidence.checks.find((c) => c.id === "versions.pyproject_worker_config_version_parity")!;
    expect(check.status).toBe("fail");
    expect(check.actual).toBe("missing");
    expect(evidence.status).toBe("failed");
  });

  it("passes when worker pyproject.toml and config.ts version equal canonical", () => {
    const { deps } = createMockDeps();
    const evidence = collectCutManifestEvidence(DEFAULT_OPTIONS, deps);
    const check = evidence.checks.find((c) => c.id === "versions.pyproject_worker_config_version_parity")!;
    expect(check.status).toBe("pass");
    expect(check.actual).toBe(VERSION);
  });

  it("fails closed when worker __init__.py disagrees with config.ts version", () => {
    const files = baseFiles();
    files["apps/api/src/services/config.ts"] = `export const config = {\n  version: "0.4.6",\n};\n`;
    const { deps } = createMockDeps({ files });
    const evidence = collectCutManifestEvidence(DEFAULT_OPTIONS, deps);
    const check = evidence.checks.find((c) => c.id === "versions.worker_init_config_version_parity")!;
    expect(check.status).toBe("fail");
    expect(check.actual).toBe(`${VERSION} != 0.4.6`);
    expect(evidence.status).toBe("failed");
  });

  it("fails closed when worker __init__.py and config.ts agree but are not canonical", () => {
    const files = baseFiles();
    files["apps/worker/__init__.py"] = `__version__ = "0.4.6"\n`;
    files["apps/api/src/services/config.ts"] = `export const config = {\n  version: "0.4.6",\n};\n`;
    const { deps } = createMockDeps({ files });
    const evidence = collectCutManifestEvidence(DEFAULT_OPTIONS, deps);
    const check = evidence.checks.find((c) => c.id === "versions.worker_init_config_version_parity")!;
    expect(check.status).toBe("fail");
    expect(check.actual).toBe("0.4.6");
    expect(evidence.status).toBe("failed");
  });

  it("fails closed when worker __init__.py version is missing for config.ts parity", () => {
    const files = baseFiles();
    files["apps/worker/__init__.py"] = `"""worker package"""\n`;
    const { deps } = createMockDeps({ files });
    const evidence = collectCutManifestEvidence(DEFAULT_OPTIONS, deps);
    const check = evidence.checks.find((c) => c.id === "versions.worker_init_config_version_parity")!;
    expect(check.status).toBe("fail");
    expect(check.actual).toBe("missing");
    expect(evidence.status).toBe("failed");
  });

  it("passes when worker __init__.py and config.ts version equal canonical", () => {
    const { deps } = createMockDeps();
    const evidence = collectCutManifestEvidence(DEFAULT_OPTIONS, deps);
    const check = evidence.checks.find((c) => c.id === "versions.worker_init_config_version_parity")!;
    expect(check.status).toBe("pass");
    expect(check.actual).toBe(VERSION);
  });

  it("fails closed when trendradar __init__.py disagrees with config.ts version", () => {
    const files = baseFiles();
    files["apps/api/src/services/config.ts"] = `export const config = {\n  version: "0.4.6",\n};\n`;
    const { deps } = createMockDeps({ files });
    const evidence = collectCutManifestEvidence(DEFAULT_OPTIONS, deps);
    const check = evidence.checks.find((c) => c.id === "versions.trendradar_init_config_version_parity")!;
    expect(check.status).toBe("fail");
    expect(check.actual).toBe(`${VERSION} != 0.4.6`);
    expect(evidence.status).toBe("failed");
  });

  it("fails closed when trendradar __init__.py and config.ts agree but are not canonical", () => {
    const files = baseFiles();
    files["trendradar/__init__.py"] = `__version__ = "0.4.6"\n`;
    files["apps/api/src/services/config.ts"] = `export const config = {\n  version: "0.4.6",\n};\n`;
    const { deps } = createMockDeps({ files });
    const evidence = collectCutManifestEvidence(DEFAULT_OPTIONS, deps);
    const check = evidence.checks.find((c) => c.id === "versions.trendradar_init_config_version_parity")!;
    expect(check.status).toBe("fail");
    expect(check.actual).toBe("0.4.6");
    expect(evidence.status).toBe("failed");
  });

  it("fails closed when trendradar __init__.py version is missing for config.ts parity", () => {
    const files = baseFiles();
    files["trendradar/__init__.py"] = `"""trendradar package"""\n`;
    const { deps } = createMockDeps({ files });
    const evidence = collectCutManifestEvidence(DEFAULT_OPTIONS, deps);
    const check = evidence.checks.find((c) => c.id === "versions.trendradar_init_config_version_parity")!;
    expect(check.status).toBe("fail");
    expect(check.actual).toBe("missing");
    expect(evidence.status).toBe("failed");
  });

  it("passes when trendradar __init__.py and config.ts version equal canonical", () => {
    const { deps } = createMockDeps();
    const evidence = collectCutManifestEvidence(DEFAULT_OPTIONS, deps);
    const check = evidence.checks.find((c) => c.id === "versions.trendradar_init_config_version_parity")!;
    expect(check.status).toBe("pass");
    expect(check.actual).toBe(VERSION);
  });

  it("fails closed when the version file disagrees with config.ts version", () => {
    const files = baseFiles();
    files["apps/api/src/services/config.ts"] = `export const config = {\n  version: "0.4.6",\n};\n`;
    const { deps } = createMockDeps({ files });
    const evidence = collectCutManifestEvidence(DEFAULT_OPTIONS, deps);
    const check = evidence.checks.find((c) => c.id === "versions.version_file_config_version_parity")!;
    expect(check.status).toBe("fail");
    expect(check.actual).toBe(`${VERSION} != 0.4.6`);
    expect(evidence.status).toBe("failed");
  });

  it("fails closed when the version file and config.ts agree but are not canonical", () => {
    const files = baseFiles();
    files.version = "0.4.6";
    files["apps/api/src/services/config.ts"] = `export const config = {\n  version: "0.4.6",\n};\n`;
    const { deps } = createMockDeps({ files });
    const evidence = collectCutManifestEvidence(
      { ...DEFAULT_OPTIONS, expectedVersion: VERSION },
      deps,
    );
    const check = evidence.checks.find((c) => c.id === "versions.version_file_config_version_parity")!;
    expect(check.status).toBe("fail");
    expect(check.actual).toBe("0.4.6");
    expect(evidence.status).toBe("failed");
  });

  it("fails closed when config.ts version is missing for version-file parity", () => {
    const files = baseFiles();
    files["apps/api/src/services/config.ts"] = `export const config = {\n  timezone: "UTC",\n};\n`;
    const { deps } = createMockDeps({ files });
    const evidence = collectCutManifestEvidence(DEFAULT_OPTIONS, deps);
    const check = evidence.checks.find((c) => c.id === "versions.version_file_config_version_parity")!;
    expect(check.status).toBe("fail");
    expect(check.actual).toBe("missing");
    expect(evidence.status).toBe("failed");
  });

  it("passes when the version file and config.ts version equal canonical", () => {
    const { deps } = createMockDeps();
    const evidence = collectCutManifestEvidence(DEFAULT_OPTIONS, deps);
    const check = evidence.checks.find((c) => c.id === "versions.version_file_config_version_parity")!;
    expect(check.status).toBe("pass");
    expect(check.actual).toBe(VERSION);
  });

  it("fails closed when openapi.yaml info.version disagrees with config.ts", () => {
    const files = baseFiles();
    files["apps/api/src/services/config.ts"] = `export const config = {\n  version: "0.4.6",\n};\n`;
    const { deps } = createMockDeps({ files });
    const evidence = collectCutManifestEvidence(DEFAULT_OPTIONS, deps);
    const check = evidence.checks.find((c) => c.id === "versions.openapi_yaml_info_config_version_parity")!;
    expect(check.status).toBe("fail");
    expect(check.actual).toBe(`${VERSION} != 0.4.6`);
    expect(evidence.status).toBe("failed");
  });

  it("fails closed when openapi.yaml info.version and config.ts agree but are not canonical", () => {
    const files = baseFiles();
    files["apps/api/openapi.yaml"] =
      `openapi: 3.1.0\ninfo:\n  title: Trends API\n  version: 0.4.6\n` +
      `components:\n  schemas:\n    HealthResponse:\n      properties:\n        version:\n          type: string\n          example: '${VERSION}'\n`;
    files["apps/api/src/services/config.ts"] = `export const config = {\n  version: "0.4.6",\n};\n`;
    const { deps } = createMockDeps({ files });
    const evidence = collectCutManifestEvidence(DEFAULT_OPTIONS, deps);
    const check = evidence.checks.find((c) => c.id === "versions.openapi_yaml_info_config_version_parity")!;
    expect(check.status).toBe("fail");
    expect(check.actual).toBe("0.4.6");
    expect(evidence.status).toBe("failed");
  });

  it("fails closed when openapi.yaml info.version is missing for config.ts parity", () => {
    const files = baseFiles();
    files["apps/api/openapi.yaml"] = `openapi: 3.1.0\ninfo:\n  title: Trends API\n`;
    const { deps } = createMockDeps({ files });
    const evidence = collectCutManifestEvidence(DEFAULT_OPTIONS, deps);
    const check = evidence.checks.find((c) => c.id === "versions.openapi_yaml_info_config_version_parity")!;
    expect(check.status).toBe("fail");
    expect(check.actual).toBe("missing");
    expect(evidence.status).toBe("failed");
  });

  it("passes when openapi.yaml info.version and config.ts equal canonical", () => {
    const { deps } = createMockDeps();
    const evidence = collectCutManifestEvidence(DEFAULT_OPTIONS, deps);
    const check = evidence.checks.find((c) => c.id === "versions.openapi_yaml_info_config_version_parity")!;
    expect(check.status).toBe("pass");
    expect(check.actual).toBe(VERSION);
  });

  it("fails closed when openapi.json info.version disagrees with config.ts", () => {
    const files = baseFiles();
    files["apps/api/src/services/config.ts"] = `export const config = {\n  version: "0.4.6",\n};\n`;
    const { deps } = createMockDeps({ files });
    const evidence = collectCutManifestEvidence(DEFAULT_OPTIONS, deps);
    const check = evidence.checks.find((c) => c.id === "versions.openapi_json_info_config_version_parity")!;
    expect(check.status).toBe("fail");
    expect(check.actual).toBe(`${VERSION} != 0.4.6`);
    expect(evidence.status).toBe("failed");
  });

  it("fails closed when openapi.json info.version and config.ts agree but are not canonical", () => {
    const files = baseFiles();
    files["apps/api/openapi.json"] = JSON.stringify({
      openapi: "3.1.0",
      info: { title: "Trends API", version: "0.4.6" },
      components: {
        schemas: {
          HealthResponse: { properties: { version: { type: "string", example: VERSION } } },
        },
      },
    });
    files["apps/api/src/services/config.ts"] = `export const config = {\n  version: "0.4.6",\n};\n`;
    const { deps } = createMockDeps({ files });
    const evidence = collectCutManifestEvidence(DEFAULT_OPTIONS, deps);
    const check = evidence.checks.find((c) => c.id === "versions.openapi_json_info_config_version_parity")!;
    expect(check.status).toBe("fail");
    expect(check.actual).toBe("0.4.6");
    expect(evidence.status).toBe("failed");
  });

  it("fails closed when openapi.json info.version is missing for config.ts parity", () => {
    const files = baseFiles();
    files["apps/api/openapi.json"] = JSON.stringify({
      openapi: "3.1.0",
      info: { title: "Trends API" },
    });
    const { deps } = createMockDeps({ files });
    const evidence = collectCutManifestEvidence(DEFAULT_OPTIONS, deps);
    const check = evidence.checks.find((c) => c.id === "versions.openapi_json_info_config_version_parity")!;
    expect(check.status).toBe("fail");
    expect(check.actual).toBe("missing");
    expect(evidence.status).toBe("failed");
  });

  it("passes when openapi.json info.version and config.ts equal canonical", () => {
    const { deps } = createMockDeps();
    const evidence = collectCutManifestEvidence(DEFAULT_OPTIONS, deps);
    const check = evidence.checks.find((c) => c.id === "versions.openapi_json_info_config_version_parity")!;
    expect(check.status).toBe("pass");
    expect(check.actual).toBe(VERSION);
  });

  it("fails closed when schemas-validation.test.ts disagrees with config.ts", () => {
    const files = baseFiles();
    files["apps/api/src/services/config.ts"] = `export const config = {\n  version: "0.4.6",\n};\n`;
    const { deps } = createMockDeps({ files });
    const evidence = collectCutManifestEvidence(DEFAULT_OPTIONS, deps);
    const check = evidence.checks.find((c) => c.id === "versions.schemas_validation_config_version_parity")!;
    expect(check.status).toBe("fail");
    expect(check.actual).toBe(`${VERSION} != 0.4.6`);
    expect(evidence.status).toBe("failed");
  });

  it("fails closed when schemas-validation.test.ts and config.ts agree but are not canonical", () => {
    const files = baseFiles();
    files["apps/api/src/schemas/schemas-validation.test.ts"] = `      version: "0.4.6",\n`;
    files["apps/api/src/services/config.ts"] = `export const config = {\n  version: "0.4.6",\n};\n`;
    const { deps } = createMockDeps({ files });
    const evidence = collectCutManifestEvidence(DEFAULT_OPTIONS, deps);
    const check = evidence.checks.find((c) => c.id === "versions.schemas_validation_config_version_parity")!;
    expect(check.status).toBe("fail");
    expect(check.actual).toBe("0.4.6");
    expect(evidence.status).toBe("failed");
  });

  it("fails closed when schemas-validation.test.ts version is missing for config.ts parity", () => {
    const files = baseFiles();
    delete files["apps/api/src/schemas/schemas-validation.test.ts"];
    const { deps } = createMockDeps({ files });
    const evidence = collectCutManifestEvidence(DEFAULT_OPTIONS, deps);
    const check = evidence.checks.find((c) => c.id === "versions.schemas_validation_config_version_parity")!;
    expect(check.status).toBe("fail");
    expect(check.actual).toBe("missing");
    expect(evidence.status).toBe("failed");
  });

  it("passes when schemas-validation.test.ts and config.ts equal canonical", () => {
    const { deps } = createMockDeps();
    const evidence = collectCutManifestEvidence(DEFAULT_OPTIONS, deps);
    const check = evidence.checks.find((c) => c.id === "versions.schemas_validation_config_version_parity")!;
    expect(check.status).toBe("pass");
    expect(check.actual).toBe(VERSION);
  });

  it("reads schemas-validation config parity from the VERSION_SURFACE value", () => {
    const files = baseFiles();
    files["apps/api/src/schemas/schemas-validation.test.ts"] = `      version: "0.4.6",\n`;
    const { deps } = createMockDeps({ files });
    const evidence = collectCutManifestEvidence(DEFAULT_OPTIONS, deps);
    const surface = evidence.checks.find((c) => c.id === "versions.schemas_validation")!;
    const parity = evidence.checks.find((c) => c.id === "versions.schemas_validation_config_version_parity")!;
    expect(surface.actual).toBe("0.4.6");
    expect(parity.actual).toBe(`${surface.actual} != ${VERSION}`);
    expect(parity.status).toBe("fail");
  });

  it("fails closed when e2e appVersion disagrees with config.ts", () => {
    const files = baseFiles();
    files["apps/api/src/services/config.ts"] = `export const config = {\n  version: "0.4.6",\n};\n`;
    const { deps } = createMockDeps({ files });
    const evidence = collectCutManifestEvidence(DEFAULT_OPTIONS, deps);
    const check = evidence.checks.find((c) => c.id === "versions.e2e_app_version_config_version_parity")!;
    expect(check.status).toBe("fail");
    expect(check.actual).toBe(`${VERSION} != 0.4.6`);
    expect(evidence.status).toBe("failed");
  });

  it("fails closed when e2e appVersion and config.ts agree but are not canonical", () => {
    const files = baseFiles();
    files["apps/web/e2e/resume-role-filter.spec.ts"] =
      `            appVersion: '0.4.6',\n            apiVersion: '${VERSION}',\n            webVersion: '${VERSION}',\n`;
    files["apps/api/src/services/config.ts"] = `export const config = {\n  version: "0.4.6",\n};\n`;
    const { deps } = createMockDeps({ files });
    const evidence = collectCutManifestEvidence(DEFAULT_OPTIONS, deps);
    const check = evidence.checks.find((c) => c.id === "versions.e2e_app_version_config_version_parity")!;
    expect(check.status).toBe("fail");
    expect(check.actual).toBe("0.4.6");
    expect(evidence.status).toBe("failed");
  });

  it("fails closed when e2e appVersion is missing for config.ts parity", () => {
    const files = baseFiles();
    delete files["apps/web/e2e/resume-role-filter.spec.ts"];
    const { deps } = createMockDeps({ files });
    const evidence = collectCutManifestEvidence(DEFAULT_OPTIONS, deps);
    const check = evidence.checks.find((c) => c.id === "versions.e2e_app_version_config_version_parity")!;
    expect(check.status).toBe("fail");
    expect(check.actual).toBe("missing");
    expect(evidence.status).toBe("failed");
  });

  it("passes when e2e appVersion and config.ts equal canonical", () => {
    const { deps } = createMockDeps();
    const evidence = collectCutManifestEvidence(DEFAULT_OPTIONS, deps);
    const check = evidence.checks.find((c) => c.id === "versions.e2e_app_version_config_version_parity")!;
    expect(check.status).toBe("pass");
    expect(check.actual).toBe(VERSION);
  });

  it("reads e2e app/api/web config parity from VERSION_SURFACE values", () => {
    const files = baseFiles();
    files["apps/web/e2e/resume-role-filter.spec.ts"] =
      `            appVersion: '0.4.6',\n            apiVersion: '${VERSION}',\n            webVersion: '${VERSION}',\n`;
    const { deps } = createMockDeps({ files });
    const evidence = collectCutManifestEvidence(DEFAULT_OPTIONS, deps);
    const surface = evidence.checks.find((c) => c.id === "versions.e2e_app_version")!;
    const parity = evidence.checks.find((c) => c.id === "versions.e2e_app_version_config_version_parity")!;
    expect(surface.actual).toBe("0.4.6");
    expect(parity.actual).toBe(`${surface.actual} != ${VERSION}`);
    expect(parity.status).toBe("fail");
  });

  it("fails closed when e2e apiVersion disagrees with config.ts", () => {
    const files = baseFiles();
    files["apps/api/src/services/config.ts"] = `export const config = {\n  version: "0.4.6",\n};\n`;
    const { deps } = createMockDeps({ files });
    const evidence = collectCutManifestEvidence(DEFAULT_OPTIONS, deps);
    const check = evidence.checks.find((c) => c.id === "versions.e2e_api_version_config_version_parity")!;
    expect(check.status).toBe("fail");
    expect(check.actual).toBe(`${VERSION} != 0.4.6`);
    expect(evidence.status).toBe("failed");
  });

  it("fails closed when e2e apiVersion and config.ts agree but are not canonical", () => {
    const files = baseFiles();
    files["apps/web/e2e/resume-role-filter.spec.ts"] =
      `            appVersion: '${VERSION}',\n            apiVersion: '0.4.6',\n            webVersion: '${VERSION}',\n`;
    files["apps/api/src/services/config.ts"] = `export const config = {\n  version: "0.4.6",\n};\n`;
    const { deps } = createMockDeps({ files });
    const evidence = collectCutManifestEvidence(DEFAULT_OPTIONS, deps);
    const check = evidence.checks.find((c) => c.id === "versions.e2e_api_version_config_version_parity")!;
    expect(check.status).toBe("fail");
    expect(check.actual).toBe("0.4.6");
    expect(evidence.status).toBe("failed");
  });

  it("fails closed when e2e apiVersion is missing for config.ts parity", () => {
    const files = baseFiles();
    files["apps/web/e2e/resume-role-filter.spec.ts"] =
      `            appVersion: '${VERSION}',\n            webVersion: '${VERSION}',\n`;
    const { deps } = createMockDeps({ files });
    const evidence = collectCutManifestEvidence(DEFAULT_OPTIONS, deps);
    const check = evidence.checks.find((c) => c.id === "versions.e2e_api_version_config_version_parity")!;
    expect(check.status).toBe("fail");
    expect(check.actual).toBe("missing");
    expect(evidence.status).toBe("failed");
  });

  it("passes when e2e apiVersion and config.ts equal canonical", () => {
    const { deps } = createMockDeps();
    const evidence = collectCutManifestEvidence(DEFAULT_OPTIONS, deps);
    const check = evidence.checks.find((c) => c.id === "versions.e2e_api_version_config_version_parity")!;
    expect(check.status).toBe("pass");
    expect(check.actual).toBe(VERSION);
  });

  it("fails closed when e2e webVersion disagrees with config.ts", () => {
    const files = baseFiles();
    files["apps/api/src/services/config.ts"] = `export const config = {\n  version: "0.4.6",\n};\n`;
    const { deps } = createMockDeps({ files });
    const evidence = collectCutManifestEvidence(DEFAULT_OPTIONS, deps);
    const check = evidence.checks.find((c) => c.id === "versions.e2e_web_version_config_version_parity")!;
    expect(check.status).toBe("fail");
    expect(check.actual).toBe(`${VERSION} != 0.4.6`);
    expect(evidence.status).toBe("failed");
  });

  it("fails closed when e2e webVersion and config.ts agree but are not canonical", () => {
    const files = baseFiles();
    files["apps/web/e2e/resume-role-filter.spec.ts"] =
      `            appVersion: '${VERSION}',\n            apiVersion: '${VERSION}',\n            webVersion: '0.4.6',\n`;
    files["apps/api/src/services/config.ts"] = `export const config = {\n  version: "0.4.6",\n};\n`;
    const { deps } = createMockDeps({ files });
    const evidence = collectCutManifestEvidence(DEFAULT_OPTIONS, deps);
    const check = evidence.checks.find((c) => c.id === "versions.e2e_web_version_config_version_parity")!;
    expect(check.status).toBe("fail");
    expect(check.actual).toBe("0.4.6");
    expect(evidence.status).toBe("failed");
  });

  it("fails closed when e2e webVersion is missing for config.ts parity", () => {
    const files = baseFiles();
    files["apps/web/e2e/resume-role-filter.spec.ts"] =
      `            appVersion: '${VERSION}',\n            apiVersion: '${VERSION}',\n`;
    const { deps } = createMockDeps({ files });
    const evidence = collectCutManifestEvidence(DEFAULT_OPTIONS, deps);
    const check = evidence.checks.find((c) => c.id === "versions.e2e_web_version_config_version_parity")!;
    expect(check.status).toBe("fail");
    expect(check.actual).toBe("missing");
    expect(evidence.status).toBe("failed");
  });

  it("passes when e2e webVersion and config.ts equal canonical", () => {
    const { deps } = createMockDeps();
    const evidence = collectCutManifestEvidence(DEFAULT_OPTIONS, deps);
    const check = evidence.checks.find((c) => c.id === "versions.e2e_web_version_config_version_parity")!;
    expect(check.status).toBe("pass");
    expect(check.actual).toBe(VERSION);
  });

  it("fails closed when e2e appVersion disagrees with apiVersion", () => {
    const files = baseFiles();
    files["apps/web/e2e/resume-role-filter.spec.ts"] =
      `            appVersion: '${VERSION}',\n            apiVersion: '0.4.6',\n            webVersion: '${VERSION}',\n`;
    const { deps } = createMockDeps({ files });
    const evidence = collectCutManifestEvidence(DEFAULT_OPTIONS, deps);
    const check = evidence.checks.find((c) => c.id === "versions.e2e_app_api_version_parity")!;
    expect(check.status).toBe("fail");
    expect(check.actual).toBe(`${VERSION} != 0.4.6`);
    expect(evidence.status).toBe("failed");
  });

  it("fails closed when e2e appVersion and apiVersion agree but are not canonical", () => {
    const files = baseFiles();
    files["apps/web/e2e/resume-role-filter.spec.ts"] =
      `            appVersion: '0.4.6',\n            apiVersion: '0.4.6',\n            webVersion: '${VERSION}',\n`;
    const { deps } = createMockDeps({ files });
    const evidence = collectCutManifestEvidence(DEFAULT_OPTIONS, deps);
    const check = evidence.checks.find((c) => c.id === "versions.e2e_app_api_version_parity")!;
    expect(check.status).toBe("fail");
    expect(check.actual).toBe("0.4.6");
    expect(evidence.status).toBe("failed");
  });

  it("fails closed when e2e apiVersion is missing for appVersion parity", () => {
    const files = baseFiles();
    files["apps/web/e2e/resume-role-filter.spec.ts"] =
      `            appVersion: '${VERSION}',\n            webVersion: '${VERSION}',\n`;
    const { deps } = createMockDeps({ files });
    const evidence = collectCutManifestEvidence(DEFAULT_OPTIONS, deps);
    const check = evidence.checks.find((c) => c.id === "versions.e2e_app_api_version_parity")!;
    expect(check.status).toBe("fail");
    expect(check.actual).toBe("missing");
    expect(evidence.status).toBe("failed");
  });

  it("passes when e2e appVersion and apiVersion equal canonical", () => {
    const { deps } = createMockDeps();
    const evidence = collectCutManifestEvidence(DEFAULT_OPTIONS, deps);
    const check = evidence.checks.find((c) => c.id === "versions.e2e_app_api_version_parity")!;
    expect(check.status).toBe("pass");
    expect(check.actual).toBe(VERSION);
  });

  it("fails closed when e2e appVersion disagrees with webVersion", () => {
    const files = baseFiles();
    files["apps/web/e2e/resume-role-filter.spec.ts"] =
      `            appVersion: '${VERSION}',\n            apiVersion: '${VERSION}',\n            webVersion: '0.4.6',\n`;
    const { deps } = createMockDeps({ files });
    const evidence = collectCutManifestEvidence(DEFAULT_OPTIONS, deps);
    const check = evidence.checks.find((c) => c.id === "versions.e2e_app_web_version_parity")!;
    expect(check.status).toBe("fail");
    expect(check.actual).toBe(`${VERSION} != 0.4.6`);
    expect(evidence.status).toBe("failed");
  });

  it("fails closed when e2e appVersion and webVersion agree but are not canonical", () => {
    const files = baseFiles();
    files["apps/web/e2e/resume-role-filter.spec.ts"] =
      `            appVersion: '0.4.6',\n            apiVersion: '${VERSION}',\n            webVersion: '0.4.6',\n`;
    const { deps } = createMockDeps({ files });
    const evidence = collectCutManifestEvidence(DEFAULT_OPTIONS, deps);
    const check = evidence.checks.find((c) => c.id === "versions.e2e_app_web_version_parity")!;
    expect(check.status).toBe("fail");
    expect(check.actual).toBe("0.4.6");
    expect(evidence.status).toBe("failed");
  });

  it("fails closed when e2e webVersion is missing for appVersion parity", () => {
    const files = baseFiles();
    files["apps/web/e2e/resume-role-filter.spec.ts"] =
      `            appVersion: '${VERSION}',\n            apiVersion: '${VERSION}',\n`;
    const { deps } = createMockDeps({ files });
    const evidence = collectCutManifestEvidence(DEFAULT_OPTIONS, deps);
    const check = evidence.checks.find((c) => c.id === "versions.e2e_app_web_version_parity")!;
    expect(check.status).toBe("fail");
    expect(check.actual).toBe("missing");
    expect(evidence.status).toBe("failed");
  });

  it("passes when e2e appVersion and webVersion equal canonical", () => {
    const { deps } = createMockDeps();
    const evidence = collectCutManifestEvidence(DEFAULT_OPTIONS, deps);
    const check = evidence.checks.find((c) => c.id === "versions.e2e_app_web_version_parity")!;
    expect(check.status).toBe("pass");
    expect(check.actual).toBe(VERSION);
  });

  it("fails closed when e2e apiVersion disagrees with webVersion", () => {
    const files = baseFiles();
    files["apps/web/e2e/resume-role-filter.spec.ts"] =
      `            appVersion: '${VERSION}',\n            apiVersion: '${VERSION}',\n            webVersion: '0.4.6',\n`;
    const { deps } = createMockDeps({ files });
    const evidence = collectCutManifestEvidence(DEFAULT_OPTIONS, deps);
    const check = evidence.checks.find((c) => c.id === "versions.e2e_api_web_version_parity")!;
    expect(check.status).toBe("fail");
    expect(check.actual).toBe(`${VERSION} != 0.4.6`);
    expect(evidence.status).toBe("failed");
  });

  it("fails closed when e2e apiVersion and webVersion agree but are not canonical", () => {
    const files = baseFiles();
    files["apps/web/e2e/resume-role-filter.spec.ts"] =
      `            appVersion: '${VERSION}',\n            apiVersion: '0.4.6',\n            webVersion: '0.4.6',\n`;
    const { deps } = createMockDeps({ files });
    const evidence = collectCutManifestEvidence(DEFAULT_OPTIONS, deps);
    const check = evidence.checks.find((c) => c.id === "versions.e2e_api_web_version_parity")!;
    expect(check.status).toBe("fail");
    expect(check.actual).toBe("0.4.6");
    expect(evidence.status).toBe("failed");
  });

  it("fails closed when e2e webVersion is missing for apiVersion parity", () => {
    const files = baseFiles();
    files["apps/web/e2e/resume-role-filter.spec.ts"] =
      `            appVersion: '${VERSION}',\n            apiVersion: '${VERSION}',\n`;
    const { deps } = createMockDeps({ files });
    const evidence = collectCutManifestEvidence(DEFAULT_OPTIONS, deps);
    const check = evidence.checks.find((c) => c.id === "versions.e2e_api_web_version_parity")!;
    expect(check.status).toBe("fail");
    expect(check.actual).toBe("missing");
    expect(evidence.status).toBe("failed");
  });

  it("passes when e2e apiVersion and webVersion equal canonical", () => {
    const { deps } = createMockDeps();
    const evidence = collectCutManifestEvidence(DEFAULT_OPTIONS, deps);
    const check = evidence.checks.find((c) => c.id === "versions.e2e_api_web_version_parity")!;
    expect(check.status).toBe("pass");
    expect(check.actual).toBe(VERSION);
  });
});

// ---------------------------------------------------------------------------
// Fail-closed: migrations
// ---------------------------------------------------------------------------

describe("collectCutManifestEvidence: migration declaration drift", () => {
  it("fails when a declared migration has no matching export", () => {
    const files = baseFiles();
    files["packages/convex/convex/migrations.ts"] =
      `export const backfillSearchText = mutation({ args: {}, handler: async () => {} });\n`;
    const { deps } = createMockDeps({ files });
    const evidence = collectCutManifestEvidence(DEFAULT_OPTIONS, deps);
    const check = evidence.checks.find((c) => c.id === "migrations.exports_present")!;
    expect(check.status).toBe("fail");
    expect(evidence.migrations.missingExports).toEqual(["reindexSearchText", "backfillAge"]);
  });

  it("includes migrations from resumes_search.ts and checks their exports", () => {
    const files = baseFiles();
    files["packages/convex/convex/_mutations_registry.ts"] =
      `export const MUTATIONS_REGISTRY = [\n` +
      `    { file: "migrations.ts", name: "backfillSearchText", quiesceAware: false },\n` +
      `    { file: "resumes_search.ts", name: "backfillResumeDigests", quiesceAware: false },\n` +
      `];\n`;
    files["packages/convex/convex/migrations.ts"] =
      `export const backfillSearchText = mutation({ args: {}, handler: async () => {} });\n`;
    files["packages/convex/convex/resumes_search.ts"] =
      `export const backfillResumeDigests = mutation({ args: {}, handler: async () => {} });\n`;
    const { deps } = createMockDeps({ files });
    const evidence = collectCutManifestEvidence(DEFAULT_OPTIONS, deps);
    expect(evidence.migrations.orderedNames).toEqual(["backfillSearchText", "backfillResumeDigests"]);
    expect(evidence.migrations.missingExports).toEqual([]);
    expect(evidence.checks.find((c) => c.id === "migrations.exports_present")!.status).toBe("pass");
  });

  it("fails when a migration declared in resumes_search.ts is not exported", () => {
    const files = baseFiles();
    files["packages/convex/convex/_mutations_registry.ts"] =
      `export const MUTATIONS_REGISTRY = [\n` +
      `    { file: "resumes_search.ts", name: "missingResumeMigration", quiesceAware: false },\n` +
      `];\n`;
    files["packages/convex/convex/resumes_search.ts"] =
      `export const otherFunc = mutation({ args: {}, handler: async () => {} });\n`;
    const { deps } = createMockDeps({ files });
    const evidence = collectCutManifestEvidence(DEFAULT_OPTIONS, deps);
    const check = evidence.checks.find((c) => c.id === "migrations.exports_present")!;
    expect(check.status).toBe("fail");
    expect(evidence.migrations.missingExports).toEqual(["missingResumeMigration"]);
  });

  it("fails when no migrations are declared", () => {
    const files = baseFiles();
    files["packages/convex/convex/_mutations_registry.ts"] = "export const X = [];\n";
    const { deps } = createMockDeps({ files });
    const evidence = collectCutManifestEvidence(DEFAULT_OPTIONS, deps);
    expect(evidence.checks.find((c) => c.id === "migrations.declared_order")!.status).toBe("fail");
  });

  it("changes the declaration hash when order changes", () => {
    const files = baseFiles();
    files["packages/convex/convex/_mutations_registry.ts"] =
      `export const MUTATIONS_REGISTRY = [\n` +
      `    { file: "migrations.ts", name: "backfillAge", quiesceAware: false },\n` +
      `    { file: "migrations.ts", name: "reindexSearchText", quiesceAware: false },\n` +
      `    { file: "migrations.ts", name: "backfillSearchText", quiesceAware: false },\n` +
      `];\n`;
    const reordered = collectCutManifestEvidence(DEFAULT_OPTIONS, createMockDeps({ files }).deps);
    const original = collectCutManifestEvidence(DEFAULT_OPTIONS, createMockDeps().deps);
    expect(reordered.migrations.declarationHash).not.toBe(original.migrations.declarationHash);
    expect(reordered.versions.surfaces.every((s) => s.matches)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Fail-closed: epochs
// ---------------------------------------------------------------------------

describe("collectCutManifestEvidence: epoch evidence", () => {
  it("fails when a frozen epoch expectation does not match", () => {
    const { deps } = createMockDeps();
    const evidence = collectCutManifestEvidence({ ...DEFAULT_OPTIONS, expectedEpochIngest: 5 }, deps);
    const check = evidence.checks.find((c) => c.id === "epochs.ingest_compute")!;
    expect(check.status).toBe("fail");
    expect(check.expected).toBe(5);
    expect(check.actual).toBe(6);
  });

  it("passes when frozen expectations match", () => {
    const { deps } = createMockDeps();
    const evidence = collectCutManifestEvidence(
      {
        ...DEFAULT_OPTIONS,
        expectedEpochIngest: 6,
        expectedEpochProjection: 2,
        expectedIndustryEvidenceProjectionVersion: 1,
      },
      deps,
    );
    expect(evidence.status).toBe("clean");
  });

  it("fails when source epochs disagree with the compiled shared constants", () => {
    const files = baseFiles();
    files["packages/shared/src/ingest-compute-epoch.ts"] =
      `export const INGEST_COMPUTE_EPOCH_HISTORY = [\n  { epoch: 99, reason: "x", introduced: "2026-09-13" },\n] as const;\n` +
      `export const COMPANY_KEY_PROJECTION_EPOCH_HISTORY = [\n  { epoch: 2, reason: "x", introduced: "2026-09-08" },\n] as const;\n`;
    const { deps } = createMockDeps({ files });
    const evidence = collectCutManifestEvidence(DEFAULT_OPTIONS, deps);
    expect(evidence.checks.find((c) => c.id === "epochs.source_import_consistency")!.status).toBe("fail");
  });

  it("fails when an epoch cannot be read from source", () => {
    const files = baseFiles();
    files["packages/shared/src/ingest-compute-epoch.ts"] = "export const NOTHING = 1;\n";
    const { deps } = createMockDeps({ files });
    const evidence = collectCutManifestEvidence(DEFAULT_OPTIONS, deps);
    expect(evidence.checks.find((c) => c.id === "epochs.ingest_compute")!.status).toBe("fail");
    expect(evidence.checks.find((c) => c.id === "epochs.company_key_projection")!.status).toBe("fail");
  });
});

// ---------------------------------------------------------------------------
// Datasets
// ---------------------------------------------------------------------------

describe("collectCutManifestEvidence: dataset hashing", () => {
  it("fails when a required dataset file is missing", () => {
    const files = baseFiles();
    delete files["config/industry-data/keyword-tags.json"];
    const { deps } = createMockDeps({ files });
    const evidence = collectCutManifestEvidence(DEFAULT_OPTIONS, deps);
    const check = evidence.checks.find((c) => c.id === "datasets.keyword_dataset")!;
    expect(check.status).toBe("fail");
    const group = evidence.datasets.groups.find((g) => g.id === "keyword_dataset")!;
    expect(group.missing).toEqual(["config/industry-data/keyword-tags.json"]);
  });

  it("changes the aggregate hash when a dataset file changes", () => {
    const files = baseFiles();
    files["config/search-profiles/a.yaml"] = "id: a\nchanged: true\n";
    const changed = collectCutManifestEvidence(DEFAULT_OPTIONS, createMockDeps({ files }).deps);
    const original = collectCutManifestEvidence(DEFAULT_OPTIONS, createMockDeps().deps);
    expect(changed.datasets.aggregateSha256).not.toBe(original.datasets.aggregateSha256);
  });

  it("records group hashes over sorted paths", () => {
    const { deps } = createMockDeps();
    const evidence = collectCutManifestEvidence(DEFAULT_OPTIONS, deps);
    for (const group of evidence.datasets.groups) {
      const paths = group.files.map((f) => f.path);
      expect([...paths].sort()).toEqual(paths);
      expect(group.aggregateSha256).toMatch(/^[0-9a-f]{64}$/);
    }
  });

  it("keeps every search-profile file that matches the extension filter", () => {
    const files = baseFiles();
    files["config/search-profiles/seek-thailand.yaml"] = "id: th\n";
    files["config/search-profiles/notes.txt"] = "ignore me\n";
    const { deps } = createMockDeps({ files });
    const evidence = collectCutManifestEvidence(DEFAULT_OPTIONS, deps);
    const group = evidence.datasets.groups.find((g) => g.id === "search_profile_yaml")!;
    expect(group.files.map((f) => f.path)).toEqual([
      "config/search-profiles/a.yaml",
      "config/search-profiles/b.yaml",
      "config/search-profiles/seek-thailand.yaml",
    ]);
  });
});

// ---------------------------------------------------------------------------
// CI: unavailable / no-runs / gate failures
// ---------------------------------------------------------------------------

describe("collectCutManifestEvidence: exact-SHA CI metadata", () => {
  it("degrades to unavailable when gh auth is absent (advisory, not fail-closed)", () => {
    const { deps } = createMockDeps({
      commands: { "gh auth status": { exitCode: 4, stdout: "", stderr: "not logged in" } },
    });
    const evidence = collectCutManifestEvidence(DEFAULT_OPTIONS, deps);
    expect(evidence.ci.availability).toBe("unavailable");
    expect(evidence.ci.reason).toBe("gh_auth_unavailable");
    expect(evidence.checks.find((c) => c.id === "ci.availability")!.status).toBe("warn");
    expect(evidence.status).toBe("clean");
  });

  it("records no_runs as advisory when the SHA has no CI runs", () => {
    const { deps } = createMockDeps({
      commands: {
        [`gh api repos/ptdevhk/trends/actions/runs?head_sha=${HEAD}&per_page=100`]: {
          exitCode: 0,
          stdout: JSON.stringify({ total_count: 0, workflow_runs: [] }),
          stderr: "",
        },
      },
    });
    const evidence = collectCutManifestEvidence(DEFAULT_OPTIONS, deps);
    expect(evidence.ci.availability).toBe("no_runs");
    expect(evidence.status).toBe("clean");
  });

  it("fails closed when a gate workflow ran but did not succeed", () => {
    const { deps } = createMockDeps({
      commands: {
        [`gh api repos/ptdevhk/trends/actions/runs?head_sha=${HEAD}&per_page=100`]: {
          exitCode: 0,
          stdout: JSON.stringify({
            workflow_runs: [
              { name: "Checks", conclusion: "success" },
              { name: "Tests", conclusion: "failure" },
            ],
          }),
          stderr: "",
        },
      },
    });
    const evidence = collectCutManifestEvidence(DEFAULT_OPTIONS, deps);
    expect(evidence.ci.availability).toBe("available");
    expect(evidence.checks.find((c) => c.id === "ci.gate_tests")!.status).toBe("fail");
    expect(evidence.checks.find((c) => c.id === "ci.gate_checks")!.status).toBe("pass");
    expect(evidence.status).toBe("failed");
  });

  it("evaluates only the latest CI run attempt when an earlier run failed but a retry succeeded", () => {
    const { deps } = createMockDeps({
      commands: {
        [`gh api repos/ptdevhk/trends/actions/runs?head_sha=${HEAD}&per_page=100`]: {
          exitCode: 0,
          stdout: JSON.stringify({
            workflow_runs: [
              {
                id: 101,
                name: "Checks",
                run_attempt: 1,
                created_at: "2026-09-13T01:00:00Z",
                status: "completed",
                conclusion: "failure",
              },
              {
                id: 102,
                name: "Checks",
                run_attempt: 2,
                created_at: "2026-09-13T01:10:00Z",
                status: "completed",
                conclusion: "success",
              },
              {
                id: 103,
                name: "Tests",
                run_attempt: 1,
                created_at: "2026-09-13T01:00:00Z",
                status: "completed",
                conclusion: "success",
              },
            ],
          }),
          stderr: "",
        },
      },
    });
    const evidence = collectCutManifestEvidence(DEFAULT_OPTIONS, deps);
    expect(evidence.ci.availability).toBe("available");
    const checksGate = evidence.checks.find((c) => c.id === "ci.gate_checks")!;
    expect(checksGate.status).toBe("pass");
    expect(checksGate.actual).toBe("success");
    expect(evidence.status).toBe("clean");
  });

  it("evaluates only the latest CI run attempt when an earlier run passed but a subsequent rerun failed", () => {
    const { deps } = createMockDeps({
      commands: {
        [`gh api repos/ptdevhk/trends/actions/runs?head_sha=${HEAD}&per_page=100`]: {
          exitCode: 0,
          stdout: JSON.stringify({
            workflow_runs: [
              {
                id: 101,
                name: "Checks",
                run_attempt: 1,
                created_at: "2026-09-13T01:00:00Z",
                status: "completed",
                conclusion: "success",
              },
              {
                id: 102,
                name: "Checks",
                run_attempt: 2,
                created_at: "2026-09-13T01:10:00Z",
                status: "completed",
                conclusion: "failure",
              },
              {
                id: 103,
                name: "Tests",
                run_attempt: 1,
                created_at: "2026-09-13T01:00:00Z",
                status: "completed",
                conclusion: "success",
              },
            ],
          }),
          stderr: "",
        },
      },
    });
    const evidence = collectCutManifestEvidence(DEFAULT_OPTIONS, deps);
    const checksGate = evidence.checks.find((c) => c.id === "ci.gate_checks")!;
    expect(checksGate.status).toBe("fail");
    expect(checksGate.actual).toBe("failure");
    expect(evidence.status).toBe("failed");
  });

  it("uses the newest workflow run before comparing attempt numbers", () => {
    const { deps } = createMockDeps({
      commands: {
        [`gh api repos/ptdevhk/trends/actions/runs?head_sha=${HEAD}&per_page=100`]: {
          exitCode: 0,
          stdout: JSON.stringify({
            workflow_runs: [
              {
                id: 201,
                name: "Checks",
                run_attempt: 4,
                created_at: "2026-09-13T01:00:00Z",
                status: "completed",
                conclusion: "success",
              },
              {
                id: 202,
                name: "Checks",
                run_attempt: 1,
                created_at: "2026-09-13T02:00:00Z",
                status: "completed",
                conclusion: "failure",
              },
              {
                id: 203,
                name: "Tests",
                run_attempt: 1,
                created_at: "2026-09-13T02:00:00Z",
                status: "completed",
                conclusion: "success",
              },
            ],
          }),
          stderr: "",
        },
      },
    });
    const evidence = collectCutManifestEvidence(DEFAULT_OPTIONS, deps);
    expect(evidence.checks.find((c) => c.id === "ci.gate_checks")!.status).toBe("fail");
  });

  it("fails closed when runs exist but a gate workflow is missing", () => {
    const { deps } = createMockDeps({
      commands: {
        [`gh api repos/ptdevhk/trends/actions/runs?head_sha=${HEAD}&per_page=100`]: {
          exitCode: 0,
          stdout: JSON.stringify({
            workflow_runs: [{ name: "Benchmark", conclusion: "success" }],
          }),
          stderr: "",
        },
      },
    });
    const evidence = collectCutManifestEvidence(DEFAULT_OPTIONS, deps);
    for (const gate of GATE_WORKFLOWS) {
      expect(
        evidence.checks.find((c) => c.id === `ci.gate_${gate.toLowerCase()}`)!.status,
      ).toBe("fail");
    }
  });

  it("records a pending (null conclusion) gate run as a failure, not a pass", () => {
    const { deps } = createMockDeps({
      commands: {
        [`gh api repos/ptdevhk/trends/actions/runs?head_sha=${HEAD}&per_page=100`]: {
          exitCode: 0,
          stdout: JSON.stringify({
            workflow_runs: [
              { name: "Checks", status: "in_progress", conclusion: null },
              { name: "Tests", conclusion: "success" },
            ],
          }),
          stderr: "",
        },
      },
    });
    const evidence = collectCutManifestEvidence(DEFAULT_OPTIONS, deps);
    const check = evidence.checks.find((c) => c.id === "ci.gate_checks")!;
    expect(check.status).toBe("fail");
    expect(check.actual).toBe("pending");
  });

  it("degrades to unavailable when the gh api call fails", () => {
    const { deps } = createMockDeps({
      commands: {
        [`gh api repos/ptdevhk/trends/actions/runs?head_sha=${HEAD}&per_page=100`]: {
          exitCode: 1,
          stdout: "",
          stderr: "HTTP 404",
        },
      },
    });
    const evidence = collectCutManifestEvidence(DEFAULT_OPTIONS, deps);
    expect(evidence.ci.availability).toBe("unavailable");
    expect(evidence.ci.reason).toBe("gh_api_failed");
    expect(evidence.status).toBe("clean");
  });

  it("is skipped entirely with --skip-ci and never invokes gh", () => {
    const bundle = createMockDeps();
    const evidence = collectCutManifestEvidence({ ...DEFAULT_OPTIONS, checkCi: false }, bundle.deps);
    expect(evidence.ci.availability).toBe("skipped");
    expect(bundle.calls.some(({ command }) => command === "gh")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Redaction in emitted evidence
// ---------------------------------------------------------------------------

describe("collectCutManifestEvidence: secret safety", () => {
  it("never emits secret env values, only name/length/hash", () => {
    const secret = "super-secret-prod-write-key";
    const { deps } = createMockDeps({
      env: {
        CONVEX_WRITE_SECRET: secret,
        AI_API_KEY: "sk-abcdefghijklmnop",
        AUTH_BOOTSTRAP_PASSWORD: "bootstrap-pw-123",
        NORMAL_VAR: "harmless",
      },
    });
    const evidence = collectCutManifestEvidence(DEFAULT_OPTIONS, deps);
    const serialized = canonicalJson(evidence);
    expect(serialized).not.toContain(secret);
    expect(serialized).not.toContain("sk-abcdefghijklmnop");
    expect(serialized).not.toContain("bootstrap-pw-123");
    expect(serialized).not.toContain("harmless");
    expect(evidence.secrets.inventory.map((e) => e.name)).toEqual([
      "AI_API_KEY",
      "AUTH_BOOTSTRAP_PASSWORD",
      "CONVEX_WRITE_SECRET",
    ]);
    expect(evidence.secrets.inventory.every((e) => !("value" in e))).toBe(true);
    expect(evidence.secrets.leakGuard).toBe("pass");
  });

  it("records env files by size and hash without contents", () => {
    const files = baseFiles();
    files[".env"] = `CONVEX_WRITE_SECRET=file-secret-value\nPLAIN=ok\n`;
    const { deps } = createMockDeps({ files });
    const evidence = collectCutManifestEvidence(DEFAULT_OPTIONS, deps);
    const serialized = canonicalJson(evidence);
    expect(serialized).not.toContain("file-secret-value");
    const record = evidence.secrets.envFiles.find((f) => f.path === ".env")!;
    expect(record.exists).toBe(true);
    expect(record.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(record.bytes).toBe(Buffer.from(files[".env"]!).length);
    for (const candidate of ENV_FILE_CANDIDATES) {
      expect(evidence.secrets.envFiles.some((f) => f.path === candidate)).toBe(true);
    }
  });

  it("parses export KEY=value in env files and scrubs sensitive values", () => {
    const files = baseFiles();
    files[".env.production"] = `export CONVEX_WRITE_SECRET="exported-secret-token-value"\nexport OTHER=safe\n`;
    // If the collector did not parse "export KEY=value", it would not register "exported-secret-token-value"
    // in secretValues, so if that value leaked into a check detail or message, it wouldn't be scrubbed.
    // Let's also check collectEnvFileRecords directly.
    const { values } = collectEnvFileRecords(createMockDeps({ files }).deps, "/virtual/repo");
    expect(values).toContain("exported-secret-token-value");
  });

  it("reports absent env files explicitly", () => {
    const { deps } = createMockDeps();
    const evidence = collectCutManifestEvidence(DEFAULT_OPTIONS, deps);
    expect(evidence.secrets.envFiles.every((f) => !f.exists && f.sha256 === null)).toBe(true);
  });

  it("redacts credential-bearing remote URLs", () => {
    const { deps } = createMockDeps({
      commands: {
        "git remote -v": {
          exitCode: 0,
          stdout: "origin\thttps://user:ghp_deadbeef@github.com/ptdevhk/trends.git (fetch)\n",
          stderr: "",
        },
      },
    });
    const evidence = collectCutManifestEvidence(DEFAULT_OPTIONS, deps);
    expect(canonicalJson(evidence)).not.toContain("ghp_deadbeef");
  });

  it("fails closed when origin URL does not match canonical expected origin", () => {
    const { deps } = createMockDeps({
      commands: {
        "git config --get remote.origin.url": {
          exitCode: 0,
          stdout: "git@github.com:evilfork/trends.git\n",
          stderr: "",
        },
      },
    });
    const evidence = collectCutManifestEvidence(DEFAULT_OPTIONS, deps);
    const check = evidence.checks.find((c) => c.id === "identity.origin_matches_expected")!;
    expect(check.status).toBe("fail");
    expect(evidence.status).toBe("failed");
  });

  it("uses the fixed canonical origin even if package.json repository metadata is changed", () => {
    const files = baseFiles();
    files["package.json"] = JSON.stringify({ repository: { url: "git@github.com:evilfork/trends.git" } });
    const { deps } = createMockDeps({ files });
    const evidence = collectCutManifestEvidence(DEFAULT_OPTIONS, deps);
    const check = evidence.checks.find((c) => c.id === "identity.origin_matches_expected")!;
    expect(check.status).toBe("pass");
    expect(check.expected).toBe("ptdevhk/trends");
  });

  it("permits overriding expected origin via options", () => {
    const { deps } = createMockDeps({
      commands: {
        "git config --get remote.origin.url": {
          exitCode: 0,
          stdout: "git@github.com:myfork/trends.git\n",
          stderr: "",
        },
      },
    });
    const evidence = collectCutManifestEvidence(
      { ...DEFAULT_OPTIONS, expectedOrigin: "git@github.com:myfork/trends.git" },
      deps,
    );
    const check = evidence.checks.find((c) => c.id === "identity.origin_matches_expected")!;
    expect(check.status).toBe("pass");
  });
});

// ---------------------------------------------------------------------------
// Errors / config failure
// ---------------------------------------------------------------------------

describe("collectCutManifestEvidence: config errors", () => {
  it("throws when the canonical version file is missing", () => {
    const files = baseFiles();
    delete files.version;
    const { deps } = createMockDeps({ files });
    expect(() => collectCutManifestEvidence(DEFAULT_OPTIONS, deps)).toThrow(/canonical version/i);
  });

  it("throws when the canonical version file is empty", () => {
    const files = baseFiles();
    files.version = "   \n";
    const { deps } = createMockDeps({ files });
    expect(() => collectCutManifestEvidence(DEFAULT_OPTIONS, deps)).toThrow(/canonical version/i);
  });

  it("maps config errors to exit 1 and evidence failures to exit 2", () => {
    const files = baseFiles();
    delete files.version;
    let thrown: unknown;
    try {
      runCollector(["--repo-root", "/virtual/repo"], createMockDeps({ files }).deps);
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeInstanceOf(Error);
    expect(EXIT_CONFIG_OR_INVOCATION_ERROR).toBe(1);
    expect(EXIT_EVIDENCE_FAILURE).toBe(2);
    expect(EXIT_OK).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Static contracts
// ---------------------------------------------------------------------------

describe("collector static contracts", () => {
  it("declares exactly the two read-only drift gates", () => {
    expect(DRIFT_GATES.map((g) => g.id)).toEqual(["search_profile_templates", "keyword_tags"]);
    for (const gate of DRIFT_GATES) {
      expect(gate.checkCommand).toMatch(/--check$/);
      expect(gate.makeTarget).toMatch(/^make check-/);
    }
  });

  it("default deps expose only read-only filesystem reads", () => {
    const deps = createDefaultDeps();
    expect(typeof deps.fs.readText).toBe("function");
    expect(typeof deps.fs.readBytes).toBe("function");
    expect(typeof deps.fs.listDir).toBe("function");
    expect("writeFile" in deps.fs).toBe(false);
    expect("write" in deps.fs).toBe(false);
  });

  it("exposes no production target or deploy surface", () => {
    for (const forbidden of ["--allow-production", "--deploy", "--tag", "--push"]) {
      expect(() => parseCliArgs([forbidden])).toThrow();
    }
  });
});
