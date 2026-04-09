export const DEFAULT_APP_TIMEZONE = "Asia/Hong_Kong";

function isValidTimezone(value: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

function resolveAppTimezone(): string {
  const envTimezone = import.meta.env.VITE_APP_TIMEZONE || import.meta.env.VITE_TIMEZONE;
  if (typeof envTimezone === "string" && envTimezone.trim() && isValidTimezone(envTimezone.trim())) {
    return envTimezone.trim();
  }
  return DEFAULT_APP_TIMEZONE;
}

export const APP_TIMEZONE = resolveAppTimezone();

function toDate(value: Date | number | string): Date | null {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date;
}

function formatDateWithTimezone(
  date: Date,
  includeDate: boolean,
  includeSeconds: boolean,
): string {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: APP_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });

  const parts = formatter.formatToParts(date);
  const values = new Map<string, string>();
  for (const part of parts) {
    values.set(part.type, part.value);
  }

  const datePart = `${values.get("year") ?? "0000"}-${values.get("month") ?? "01"}-${values.get("day") ?? "01"}`;
  const timePart = includeSeconds
    ? `${values.get("hour") ?? "00"}:${values.get("minute") ?? "00"}:${values.get("second") ?? "00"}`
    : `${values.get("hour") ?? "00"}:${values.get("minute") ?? "00"}`;

  return includeDate ? `${datePart} ${timePart}` : timePart;
}

export function formatInAppTimezone(
  value: Date | number | string,
  options: { includeDate?: boolean; includeSeconds?: boolean } = {},
): string {
  const includeDate = options.includeDate ?? false;
  const includeSeconds = options.includeSeconds ?? false;

  const date = toDate(value);
  if (!date) return "";
  return formatDateWithTimezone(date, includeDate, includeSeconds);
}
