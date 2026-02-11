import fs from "node:fs";
import path from "node:path";

import yaml from "js-yaml";

export const DEFAULT_TIMEZONE = "Asia/Hong_Kong";

type ResolveTimezoneOptions = {
  envTimezone?: string;
  projectRoot?: string;
  defaultTimezone?: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

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
  } catch {
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
    console.warn(`[timezone] Invalid timezone '${candidate}', trying fallback.`);
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
