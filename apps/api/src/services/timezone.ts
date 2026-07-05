import fs from "node:fs";
import path from "node:path";
import { isRecord } from "@trends/shared";


import yaml from "js-yaml";
import { logger } from "./logger";


export const DEFAULT_TIMEZONE = "Asia/Hong_Kong";

export type LocalDateParts = {
  year: number;
  month: number;
  day: number;
};

type ResolveTimezoneOptions = {
  envTimezone?: string;
  projectRoot?: string;
  defaultTimezone?: string;
};


export function isValidTimezone(value: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

function readTimezoneFromConfig(projectRoot?: string): string | undefined {
  if (!projectRoot) return undefined;
  const configPath = path.join(projectRoot, "config", "config.yaml");
  if (!fs.existsSync(configPath)) return undefined;

  try {
    const raw = fs.readFileSync(configPath, "utf8");
    const parsed = yaml.load(raw);
    if (!isRecord(parsed)) return undefined;
    const app = parsed.app;
    if (!isRecord(app)) return undefined;
    const timezone = app.timezone;
    if (typeof timezone !== "string") return undefined;
    return timezone.trim() || undefined;
  } catch (error) {
    console.error("[timezone] Failed to read timezone from config", error);
    return undefined;
  }
}

export function resolveTimezone(options: ResolveTimezoneOptions = {}): string {
  const defaultTimezone = options.defaultTimezone ?? DEFAULT_TIMEZONE;
  const fallbackTimezone = isValidTimezone(defaultTimezone)
    ? defaultTimezone
    : DEFAULT_TIMEZONE;
  const candidates = [
    options.envTimezone?.trim(),
    readTimezoneFromConfig(options.projectRoot),
    fallbackTimezone,
  ];

  for (const candidate of candidates) {
    if (!candidate) continue;
    if (isValidTimezone(candidate)) return candidate;
    logger.warn(`Invalid timezone '${candidate}', trying fallback.`, { service: "timezone" });
  }
  return fallbackTimezone;
}

export function ensureProcessTimezone(timezone: string): void {
  process.env.TZ = timezone;
}

function normalizeOffset(offsetPart: string): string {
  const trimmed = offsetPart.trim();
  const stripped = trimmed.replace("GMT", "").replace("UTC", "");

  if (!stripped) return "+00:00";

  const match = /^([+-])(\d{1,2})(?::?(\d{2}))?$/.exec(stripped);
  if (!match) return "+00:00";

  const sign = match[1];
  const hours = match[2].padStart(2, "0");
  const minutes = (match[3] ?? "00").padStart(2, "0");
  return `${sign}${hours}:${minutes}`;
}

function getDateParts(date: Date, timezone: string): {
  year: string;
  month: string;
  day: string;
  hour: string;
  minute: string;
  second: string;
  offset: string;
} {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
    timeZoneName: "longOffset",
  });

  const parts = formatter.formatToParts(date);
  const values = new Map<string, string>();
  for (const part of parts) {
    values.set(part.type, part.value);
  }

  return {
    year: values.get("year") ?? "0000",
    month: values.get("month") ?? "01",
    day: values.get("day") ?? "01",
    hour: values.get("hour") ?? "00",
    minute: values.get("minute") ?? "00",
    second: values.get("second") ?? "00",
    offset: normalizeOffset(values.get("timeZoneName") ?? "GMT+00:00"),
  };
}

function parseOffsetMinutes(offset: string): number {
  const match = /^([+-])(\d{2}):(\d{2})$/.exec(offset);
  if (!match) {
    return 0;
  }

  const sign = match[1] === "-" ? -1 : 1;
  return sign * (Number.parseInt(match[2], 10) * 60 + Number.parseInt(match[3], 10));
}

function isLocalMidnight(parts: LocalDateParts, rendered: ReturnType<typeof getDateParts>): boolean {
  return Number.parseInt(rendered.year, 10) === parts.year
    && Number.parseInt(rendered.month, 10) === parts.month
    && Number.parseInt(rendered.day, 10) === parts.day
    && rendered.hour === "00"
    && rendered.minute === "00"
    && rendered.second === "00";
}

export function getLocalDatePartsInTimezone(
  value: Date | number | string,
  timezone: string,
): LocalDateParts {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new Error("Invalid date value");
  }

  const parts = getDateParts(date, timezone);
  return {
    year: Number.parseInt(parts.year, 10),
    month: Number.parseInt(parts.month, 10),
    day: Number.parseInt(parts.day, 10),
  };
}

export function resolveLocalMidnightUtc(parts: LocalDateParts, timezone: string): Date {
  const baseUtcMidnight = Date.UTC(parts.year, parts.month - 1, parts.day, 0, 0, 0);
  let candidateMs = baseUtcMidnight;

  for (let attempt = 0; attempt < 6; attempt += 1) {
    const candidate = new Date(candidateMs);
    const rendered = getDateParts(candidate, timezone);
    if (isLocalMidnight(parts, rendered)) {
      return candidate;
    }

    const offsetMinutes = parseOffsetMinutes(rendered.offset);
    candidateMs = baseUtcMidnight - offsetMinutes * 60 * 1000;
  }

  const resolved = new Date(candidateMs);
  const rendered = getDateParts(resolved, timezone);
  if (!isLocalMidnight(parts, rendered)) {
    throw new Error(
      `Unable to resolve local midnight for ${parts.year}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")} in ${timezone}`,
    );
  }

  return resolved;
}

export function formatIsoOffsetInTimezone(
  value: Date | number | string,
  timezone: string,
): string {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "";

  const parts = getDateParts(date, timezone);
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}${parts.offset}`;
}

export function formatDateInTimezone(
  value: Date | number | string,
  timezone: string,
): string {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const parts = getDateParts(date, timezone);
  return `${parts.year}-${parts.month}-${parts.day}`;
}
