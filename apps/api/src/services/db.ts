import fs from "node:fs";
import path from "node:path";

import Database from "better-sqlite3";

export type DbType = "news" | "rss";

export function formatDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function formatChineseDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}年${month}月${day}日`;
}

export function parseIsoDate(dateStr: string): Date {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr);
  if (!match) throw new Error(`Invalid date: ${dateStr}`);
  const [, y, m, d] = match;
  return new Date(Number(y), Number(m) - 1, Number(d));
}

export function findProjectRoot(startDir = process.cwd()): string {
  let dir = path.resolve(startDir);
  // Stop at filesystem root.
  while (true) {
    const hasOutput = fs.existsSync(path.join(dir, "output"));
    const hasConfig = fs.existsSync(path.join(dir, "config"));
    const hasPyproject = fs.existsSync(path.join(dir, "pyproject.toml"));
    if (hasOutput && hasConfig && hasPyproject) return dir;

    const parent = path.dirname(dir);
    if (parent === dir) return path.resolve(startDir);
    dir = parent;
  }
}

export function getDbFilePath(projectRoot: string, date: Date, dbType: DbType): string | null {
  const outputDir = path.join(projectRoot, "output", dbType);
  const isoName = `${formatDate(date)}.db`;
  const isoPath = path.join(outputDir, isoName);
  if (fs.existsSync(isoPath)) return isoPath;

  const cnName = `${formatChineseDate(date)}.db`;
  const cnPath = path.join(outputDir, cnName);
  if (fs.existsSync(cnPath)) return cnPath;

  return null;
}

export function openDatabase(projectRoot: string, date: Date, dbType: DbType): Database.Database | null {
  const dbPath = getDbFilePath(projectRoot, date, dbType);
  if (!dbPath) return null;
  try {
    return new Database(dbPath, { readonly: true, fileMustExist: true });
  } catch {
    return null;
  }
}

export function getAvailableDates(projectRoot: string, dbType: DbType): string[] {
  const outputDir = path.join(projectRoot, "output", dbType);
  if (!fs.existsSync(outputDir)) return [];

  const dates: string[] = [];
  for (const filename of fs.readdirSync(outputDir)) {
    const isoMatch = /^(\d{4}-\d{2}-\d{2})\.db$/.exec(filename);
    if (isoMatch) {
      dates.push(isoMatch[1]);
      continue;
    }

    const cnMatch = /^(\d{4})年(\d{2})月(\d{2})日\.db$/.exec(filename);
    if (cnMatch) {
      const [, y, m, d] = cnMatch;
      dates.push(`${y}-${m}-${d}`);
    }
  }

  return dates.sort().reverse();
}

export function getLatestAvailableDate(projectRoot: string, dbType: DbType): Date | null {
  const available = getAvailableDates(projectRoot, dbType);
  if (available.length === 0) return null;
  return parseIsoDate(available[0]);
}

