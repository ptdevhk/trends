#!/usr/bin/env npx tsx
/**
 * Verify every BFF convex call path resolves to a public convex export.
 *
 * Convex function references are plain strings ("module:name"), so a
 * refactor that moves a function out of the companies.ts barrel without a
 * re-export, or a typo'd path, compiles and tests green — and 500s at
 * runtime on the live backend (incident 2026-08-10: review queue broke
 * with "Could not find public function for 'companies:getIndustryResume
 * ImpactByCompanyKey'").
 *
 * This check registers every public query/mutation/action export per
 * module, plus barrel re-export aliases (`export { a, b } from "./x.js"`),
 * then validates all `callConvex(Query|Mutation|Action)("module:name")`
 * string literals under apps/api/src (tests excluded). BFF code must never
 * call `internal:` functions (not reachable through the public HTTP API).
 *
 * Usage:
 *   npx tsx scripts/check-convex-function-paths.ts          # check
 *   npx tsx scripts/check-convex-function-paths.ts --fix    # (unused; kept for CLI symmetry)
 * Wired into `make check` as `check-convex-function-paths`.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

export const DEFAULT_CONVEX_DIR = "packages/convex/convex";
export const DEFAULT_API_DIR = "apps/api/src";

const PUBLIC_FN_RE = /export\s+const\s+([A-Za-z0-9_]+)\s*=\s*(query|mutation|action)\s*\(/g;
const RE_EXPORT_RE = /export\s*\{([^}]+)\}\s*from\s*["']\.\/([A-Za-z0-9_]+)\.js["']/g;
const BFF_CALL_RE = /callConvex(?:Query|Mutation|Action)\(\s*"([^"]+)"/g;

/** List *.ts files under a directory (non-recursive; skips _generated). */
export function convexModuleFiles(convexDir: string): string[] {
  return readdirSync(convexDir)
    .filter((name) => name.endsWith(".ts") && !name.startsWith("_"))
    .sort();
}

/**
 * Register public convex function paths: "module:name" for every defining
 * export, plus "module:name" aliases for barrel re-exports
 * (`export { name as alias } from "./other.js"` keeps the original path and
 * adds the alias under the re-exporting module).
 */
export function collectConvexFunctions(convexDir: string): Map<string, string> {
  const publicPaths = new Map<string, string>();
  for (const fname of convexModuleFiles(convexDir)) {
    const module = fname.replace(/\.ts$/, "");
    const text = readFileSync(join(convexDir, fname), "utf-8");
    for (const match of text.matchAll(PUBLIC_FN_RE)) {
      publicPaths.set(`${module}:${match[1]}`, fname);
    }
    for (const match of text.matchAll(RE_EXPORT_RE)) {
      const names = match[1]
        .split(",")
        .map((part) => part.trim())
        .filter(Boolean);
      for (const part of names) {
        const alias = part.includes(" as ") ? part.split(" as ")[1].trim() : part;
        publicPaths.set(`${module}:${alias}`, `${fname} (re-export of ./${match[2]}.js)`);
      }
    }
  }
  return publicPaths;
}

/** All callConvex* string-literal paths in apps/api/src, excluding tests. */
export function collectBffPaths(apiDir: string): Map<string, string> {
  const paths = new Map<string, string>();
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) {
        walk(full);
        continue;
      }
      if (!entry.endsWith(".ts") || entry.endsWith(".test.ts")) continue;
      const text = readFileSync(full, "utf-8");
      for (const match of text.matchAll(BFF_CALL_RE)) {
        paths.set(match[1], full);
      }
    }
  };
  walk(apiDir);
  return paths;
}

export interface ConvexPathViolation {
  path: string;
  file: string;
  reason: "unresolved" | "internal";
}

/**
 * Verify BFF call paths against the public convex function set.
 * Returns violations; empty array means the contract holds.
 */
export function verifyConvexCallPaths(
  convexDir: string,
  apiDir: string,
): ConvexPathViolation[] {
  const publicPaths = collectConvexFunctions(convexDir);
  const bffPaths = collectBffPaths(apiDir);
  const violations: ConvexPathViolation[] = [];
  for (const [path, file] of bffPaths) {
    if (path.startsWith("internal")) {
      violations.push({ path, file, reason: "internal" });
      continue;
    }
    if (!publicPaths.has(path)) {
      violations.push({ path, file, reason: "unresolved" });
    }
  }
  return violations.sort((a, b) => a.path.localeCompare(b.path));
}

function main(): void {
  const violations = verifyConvexCallPaths(DEFAULT_CONVEX_DIR, DEFAULT_API_DIR);
  if (violations.length === 0) {
    console.log(`OK: all BFF convex call paths resolve to public exports (${collectBffPaths(DEFAULT_API_DIR).size} paths).`);
    return;
  }
  console.error(`FAIL: ${violations.length} BFF convex call path(s) do not resolve:`);
  for (const v of violations) {
    if (v.reason === "internal") {
      console.error(`  internal: ${v.path} (${v.file}) — BFF must not call internal functions`);
    } else {
      console.error(`  unresolved: ${v.path} (${v.file}) — no public query/mutation/action export; check the module barrel re-export`);
    }
  }
  process.exit(1);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
