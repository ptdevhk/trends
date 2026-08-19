/**
 * Admin resolution sidecar for the unresolved industry-data queue (T4).
 * Default path: <projectRoot>/output/industry-data/unresolved-resolutions.json
 *
 * Resolutions live in a separate sidecar (not inside unresolved-queue.json)
 * because readUnresolvedQueue drops unknown fields and the worker's append
 * path would silently discard embedded resolutions.
 */

import fs from "node:fs";
import path from "node:path";

import type { UnresolvedAggregate } from "./industry-unresolved-queue.js";

export type ResolutionAction = "link" | "ignore";

export interface UnresolvedResolution {
  normalizedKey: string;
  action: ResolutionAction;
  /** Required when action === "link". */
  targetCompanyKey?: string;
  resolvedAt: string;
  resolvedBy: string;
}

export interface UnresolvedResolutionsFile {
  version: 1;
  updatedAt: string;
  resolutions: UnresolvedResolution[];
}

export interface ResolveUnresolvedInput {
  keys: string[];
  action: ResolutionAction;
  targetCompanyKey?: string;
  resolvedBy: string;
  /** Injectable clock for tests; defaults to now. */
  at?: string;
}

export interface ResolveUnresolvedResult {
  resolved: UnresolvedResolution[];
  updatedAt: string;
}

/** Aggregate enriched with its admin resolution (when one exists). */
export interface UnresolvedQueueItem extends UnresolvedAggregate {
  resolution?: UnresolvedResolution;
}

export function defaultUnresolvedResolutionsPath(projectRoot: string): string {
  return path.join(
    projectRoot,
    "output",
    "industry-data",
    "unresolved-resolutions.json"
  );
}

function isValidResolution(value: unknown): value is UnresolvedResolution {
  if (!value || typeof value !== "object") return false;
  const r = value as Record<string, unknown>;
  return (
    typeof r.normalizedKey === "string" &&
    r.normalizedKey.length > 0 &&
    (r.action === "link" || r.action === "ignore") &&
    typeof r.resolvedAt === "string" &&
    typeof r.resolvedBy === "string"
  );
}

export function readUnresolvedResolutions(
  filePath: string
): UnresolvedResolutionsFile {
  if (!fs.existsSync(filePath)) {
    return { version: 1, updatedAt: new Date().toISOString(), resolutions: [] };
  }
  const raw = fs.readFileSync(filePath, "utf-8");
  const parsed = JSON.parse(raw) as Partial<UnresolvedResolutionsFile>;
  const resolutions = Array.isArray(parsed.resolutions)
    ? parsed.resolutions.filter(isValidResolution)
    : [];
  return {
    version: 1,
    updatedAt:
      typeof parsed.updatedAt === "string"
        ? parsed.updatedAt
        : new Date().toISOString(),
    resolutions,
  };
}

export function writeUnresolvedResolutions(
  filePath: string,
  resolutions: UnresolvedResolution[]
): UnresolvedResolutionsFile {
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true });
  const file: UnresolvedResolutionsFile = {
    version: 1,
    updatedAt: new Date().toISOString(),
    resolutions,
  };
  fs.writeFileSync(filePath, `${JSON.stringify(file, null, 2)}\n`, "utf-8");
  return file;
}

/**
 * Apply link/ignore resolutions for keys, latest-wins per key, persisted to
 * the sidecar file. Unknown keys are accepted (the queue is regenerated
 * independently, so a key can be resolved before its next emission).
 */
export function resolveUnresolvedKeys(
  filePath: string,
  input: ResolveUnresolvedInput
): ResolveUnresolvedResult {
  if (input.action !== "link" && input.action !== "ignore") {
    throw new Error("action must be 'link' or 'ignore'");
  }
  if (input.action === "link" && !(input.targetCompanyKey ?? "").trim()) {
    throw new Error("link requires a targetCompanyKey");
  }
  const keys = Array.from(
    new Set(input.keys.map((k) => (k ?? "").trim()).filter(Boolean))
  );
  if (keys.length === 0) {
    throw new Error("keys must be a non-empty array");
  }
  const existing = readUnresolvedResolutions(filePath);
  const byKey = new Map(existing.resolutions.map((r) => [r.normalizedKey, r]));
  const at = input.at ?? new Date().toISOString();
  const resolved: UnresolvedResolution[] = [];
  for (const key of keys) {
    const entry: UnresolvedResolution = {
      normalizedKey: key,
      action: input.action,
      resolvedAt: at,
      resolvedBy: input.resolvedBy.trim() || "admin",
      ...(input.action === "link"
        ? { targetCompanyKey: input.targetCompanyKey!.trim() }
        : {}),
    };
    byKey.set(key, entry);
    resolved.push(entry);
  }
  const updatedAt = writeUnresolvedResolutions(
    filePath,
    Array.from(byKey.values())
  ).updatedAt;
  return { resolved, updatedAt };
}

/** Pure enrichment: attach each aggregate's resolution record, if any. */
export function applyResolutionsToAggregates(
  aggregates: UnresolvedAggregate[],
  resolutions: UnresolvedResolution[]
): UnresolvedQueueItem[] {
  const byKey = new Map(resolutions.map((r) => [r.normalizedKey, r]));
  return aggregates.map((agg) => {
    const resolution = byKey.get(agg.normalizedKey);
    return resolution ? { ...agg, resolution } : { ...agg };
  });
}
