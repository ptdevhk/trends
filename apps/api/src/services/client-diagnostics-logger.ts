import fs from "node:fs";
import path from "node:path";
import { isRecord } from "@trends/shared";

import { findProjectRoot } from "./db.js";

export const CLIENT_DIAGNOSTIC_KINDS = [
  "convex_ws_degraded",
  "convex_ws_retry",
  "bff_search_failed",
  "convex_query_timeout",
] as const;

export type ClientDiagnosticKind = (typeof CLIENT_DIAGNOSTIC_KINDS)[number];

export type ClientDiagnosticEvent = {
  kind: ClientDiagnosticKind;
  pathname: string;
  hasEverConnected: boolean;
  connectionRetries: number;
  visibility?: string;
  workspace: string;
  timestamp: number;
};

function readString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return normalized ? normalized : null;
}

function readNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  return null;
}

function isDiagnosticKind(value: string): value is ClientDiagnosticKind {
  return (CLIENT_DIAGNOSTIC_KINDS as readonly string[]).includes(value);
}

export function parseClientDiagnosticEvent(value: unknown): ClientDiagnosticEvent | null {
  if (!isRecord(value)) return null;

  const kindRaw = readString(value.kind);
  const pathname = readString(value.pathname);
  const workspace = readString(value.workspace);
  const timestamp = readNumber(value.timestamp);
  const connectionRetries = readNumber(value.connectionRetries);

  if (
    !kindRaw ||
    !isDiagnosticKind(kindRaw) ||
    !pathname ||
    !workspace ||
    timestamp === null ||
    connectionRetries === null ||
    typeof value.hasEverConnected !== "boolean"
  ) {
    return null;
  }

  const visibility = readString(value.visibility) ?? undefined;

  return {
    kind: kindRaw,
    pathname,
    hasEverConnected: value.hasEverConnected,
    connectionRetries,
    ...(visibility ? { visibility } : {}),
    workspace,
    timestamp,
  };
}

export class ClientDiagnosticsLogger {
  readonly projectRoot: string;

  constructor(projectRoot?: string) {
    this.projectRoot = projectRoot ? path.resolve(projectRoot) : findProjectRoot();
  }

  private getLogPath(): string {
    return path.join(this.projectRoot, "output", "client-diagnostics.jsonl");
  }

  logEvent(event: ClientDiagnosticEvent): void {
    const outputDir = path.join(this.projectRoot, "output");
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }
    fs.appendFileSync(this.getLogPath(), `${JSON.stringify(event)}\n`, "utf8");
  }
}
