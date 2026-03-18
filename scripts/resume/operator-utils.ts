import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

export function resolveApiUrl(): string {
  return (
    process.env.API_URL?.trim()
    || process.env.TRENDS_API_URL?.trim()
    || "http://localhost:3000"
  );
}

export function resolveWorkspace(): string {
  return process.env.WORKSPACE?.trim() || "dev";
}

export function splitCsv(value: string | undefined): string[] {
  if (typeof value !== "string") {
    return [];
  }

  return value
    .split(/[,，、]/g)
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
}

export function parsePositiveInteger(value: string | undefined): number | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return undefined;
  }

  const parsed = Number.parseInt(trimmed, 10);
  if (!Number.isFinite(parsed) || parsed < 1) {
    return undefined;
  }

  return parsed;
}

export function parseTruthy(value: string | undefined): boolean {
  if (typeof value !== "string") {
    return false;
  }

  const normalized = value.trim().toLowerCase();
  return normalized === "1" || normalized === "true" || normalized === "yes" || normalized === "y";
}

export function extractFilename(contentDisposition: string | null | undefined): string | undefined {
  if (!contentDisposition) {
    return undefined;
  }

  const match = /filename="?([^";]+)"?/i.exec(contentDisposition);
  if (!match?.[1]) {
    return undefined;
  }

  return match[1].trim() || undefined;
}

async function ensureParentDirectory(filePath: string): Promise<void> {
  const dir = dirname(filePath);
  if (dir === ".") {
    return;
  }

  await mkdir(dir, { recursive: true });
}

export async function writePrettyJsonFile(filePath: string, value: unknown): Promise<void> {
  const content = `${JSON.stringify(value, null, 2)}\n`;
  await ensureParentDirectory(filePath);
  await writeFile(filePath, content, "utf8");
}
