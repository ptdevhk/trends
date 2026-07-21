/**
 * Git-sidecar persistence for unresolved industry-data queue (R2).
 * Default path: <projectRoot>/output/industry-data/unresolved-queue.json
 */

import fs from "node:fs";
import path from "node:path";

import {
  aggregateUnresolvedEvents,
  buildQueueFile,
  type PriorityStubOptions,
  type UnresolvedEvent,
  type UnresolvedQueueFile,
} from "./industry-unresolved-queue.js";

export function defaultUnresolvedQueuePath(projectRoot: string): string {
  return path.join(projectRoot, "output", "industry-data", "unresolved-queue.json");
}

export function readUnresolvedQueue(filePath: string): UnresolvedQueueFile {
  if (!fs.existsSync(filePath)) {
    return buildQueueFile([]);
  }
  const raw = fs.readFileSync(filePath, "utf-8");
  const parsed = JSON.parse(raw) as Partial<UnresolvedQueueFile>;
  const events = Array.isArray(parsed.events) ? parsed.events : [];
  return {
    version: 1,
    updatedAt: typeof parsed.updatedAt === "string" ? parsed.updatedAt : new Date().toISOString(),
    events,
    aggregates: aggregateUnresolvedEvents(events),
  };
}

export function writeUnresolvedQueue(
  filePath: string,
  events: UnresolvedEvent[],
  options: PriorityStubOptions = {}
): UnresolvedQueueFile {
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true });
  const file = buildQueueFile(events, options);
  fs.writeFileSync(filePath, `${JSON.stringify(file, null, 2)}\n`, "utf-8");
  return file;
}

export function appendUnresolvedEvents(
  filePath: string,
  newEvents: UnresolvedEvent[],
  options: PriorityStubOptions = {}
): UnresolvedQueueFile {
  const existing = readUnresolvedQueue(filePath);
  return writeUnresolvedQueue(filePath, [...existing.events, ...newEvents], options);
}
