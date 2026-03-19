import { mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, dirname } from "node:path";
import { gzipSync, gunzipSync } from "node:zlib";

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

export function isTarGzPath(filePath: string): boolean {
  return filePath.trim().toLowerCase().endsWith(".tar.gz");
}

async function ensureParentDirectory(filePath: string): Promise<void> {
  const dir = dirname(filePath);
  if (dir === ".") {
    return;
  }

  await mkdir(dir, { recursive: true });
}

function stringifyJson(value: unknown): string {
  if (typeof value === "string") {
    return value.endsWith("\n") ? value : `${value}\n`;
  }

  return `${JSON.stringify(value, null, 2)}\n`;
}

function writeTarString(target: Buffer, offset: number, length: number, value: string): void {
  const encoded = Buffer.from(value, "utf8");
  encoded.copy(target, offset, 0, Math.min(encoded.length, length));
}

function writeTarOctal(target: Buffer, offset: number, length: number, value: number): void {
  const raw = Math.max(0, value).toString(8);
  const encoded = `${raw.padStart(length - 1, "0")}\0`;
  writeTarString(target, offset, length, encoded);
}

function createTarArchive(entryName: string, content: Buffer): Buffer {
  const header = Buffer.alloc(512, 0);
  const normalizedEntryName = entryName.trim() || "resume-backup.json";
  const paddedSize = Math.ceil(content.length / 512) * 512;

  writeTarString(header, 0, 100, normalizedEntryName.slice(0, 100));
  writeTarOctal(header, 100, 8, 0o644);
  writeTarOctal(header, 108, 8, 0);
  writeTarOctal(header, 116, 8, 0);
  writeTarOctal(header, 124, 12, content.length);
  writeTarOctal(header, 136, 12, Math.floor(Date.now() / 1000));
  writeTarString(header, 148, 8, "        ");
  writeTarString(header, 156, 1, "0");
  writeTarString(header, 257, 6, "ustar\0");
  writeTarString(header, 263, 2, "00");

  let checksum = 0;
  for (const byte of header) {
    checksum += byte;
  }
  writeTarString(header, 148, 8, `${checksum.toString(8).padStart(6, "0")}\0 `);

  const archive = Buffer.alloc(512 + paddedSize + 1024, 0);
  header.copy(archive, 0);
  content.copy(archive, 512);
  return archive;
}

function parseTarOctal(field: Uint8Array): number {
  const raw = Buffer.from(field)
    .toString("ascii")
    .replace(/\0.*$/u, "")
    .trim();

  if (!raw) {
    return 0;
  }

  return Number.parseInt(raw, 8);
}

function isGzipContent(content: Uint8Array): boolean {
  return content.length >= 2 && content[0] === 0x1f && content[1] === 0x8b;
}

function extractTarEntryContent(archive: Uint8Array): Buffer {
  const payload = Buffer.from(archive);
  let offset = 0;
  let jsonEntry: Buffer | undefined;
  let fallbackFile: Buffer | undefined;
  let fileEntryCount = 0;

  while (offset + 512 <= payload.length) {
    const header = payload.subarray(offset, offset + 512);
    if (header.every((byte) => byte === 0)) {
      break;
    }

    const name = Buffer.from(header.subarray(0, 100))
      .toString("utf8")
      .replace(/\0.*$/u, "")
      .trim();
    const fileName = basename(name);
    const size = parseTarOctal(header.subarray(124, 136));
    const typeFlag = header[156] === 0 ? "0" : String.fromCharCode(header[156]);
    const contentStart = offset + 512;
    const contentEnd = contentStart + size;

    if (!Number.isFinite(size) || size < 0 || contentEnd > payload.length) {
      throw new Error("invalid backup archive: malformed tar entry");
    }

    if (typeFlag === "0" && !fileName.startsWith("._")) {
      const entryContent = Buffer.from(payload.subarray(contentStart, contentEnd));
      fileEntryCount += 1;
      if (fileName.toLowerCase().endsWith(".json")) {
        if (jsonEntry) {
          throw new Error("invalid backup archive: multiple JSON entries found");
        }
        jsonEntry = entryContent;
      } else if (!fallbackFile) {
        fallbackFile = entryContent;
      }
    }

    offset = contentStart + Math.ceil(size / 512) * 512;
  }

  if (jsonEntry) {
    return jsonEntry;
  }

  if (fileEntryCount === 1 && fallbackFile) {
    return fallbackFile;
  }

  if (fileEntryCount > 1) {
    throw new Error("invalid backup archive: expected exactly one JSON payload");
  }

  throw new Error("invalid backup archive: no file entries found");
}

function resolveArchiveEntryName(filePath: string): string {
  const fileName = basename(filePath.trim()).replace(/\.tar\.gz$/iu, "");
  const normalized = fileName.endsWith(".json") ? fileName : `${fileName || "resume-backup"}.json`;
  return normalized.length <= 100 ? normalized : "resume-backup.json";
}

export async function writePortableBackupFile(filePath: string, value: unknown): Promise<number> {
  const resolvedPath = filePath.trim();
  if (!resolvedPath) {
    throw new Error("output file path is required");
  }

  await ensureParentDirectory(resolvedPath);

  if (!isTarGzPath(resolvedPath)) {
    const content = stringifyJson(value);
    await writeFile(resolvedPath, content, "utf8");
    return Buffer.byteLength(content, "utf8");
  }

  const content = Buffer.from(stringifyJson(value), "utf8");
  const archive = createTarArchive(resolveArchiveEntryName(resolvedPath), content);
  const compressed = gzipSync(archive);
  await writeFile(resolvedPath, compressed);
  return compressed.byteLength;
}

export async function readPortableBackupFile(filePath: string): Promise<string> {
  const resolvedPath = filePath.trim();
  if (!resolvedPath) {
    throw new Error("backup file path is required");
  }

  const content = await readFile(resolvedPath);
  if (!isGzipContent(content)) {
    return content.toString("utf8");
  }

  const archive = gunzipSync(content);
  return extractTarEntryContent(archive).toString("utf8");
}
