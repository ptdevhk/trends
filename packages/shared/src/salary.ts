/**
 * Parse expected salary range string into structured min/max values.
 *
 * Handles multiple Chinese and international formats:
 *   - "15K-25K", "10k-20k" → unit-specific: K-mode {15,25}, raw {15000,25000}
 *   - "1万-2万"           → unit-specific: K-mode {10,20}, raw {10000,20000}
 *   - "5千-8千"            → unit-specific: K-mode {5,8}, raw {5000,8000}
 *   - "8千-1.1万/月"       → unit-specific: K-mode {8,11}, raw {8000,11000}
 *   - "面议", ""           → null (negotiable/empty)
 *   - "8000-12000"         → {8000, 12000} (bare numbers, same in both modes)
 *   - "12000-18000元/月"   → {12000, 18000} (bare numbers, same in both modes)
 *
 * Default output is in K-units for legacy callers.
 * Pass { unit: "raw" } for raw CNY values (API filters and ingest/index storage).
 *
 * Bare numbers are returned as-is, except compact ranges such as "15-25万"
 * infer the missing bound unit from the annotated counterpart.
 */
export function parseSalaryRange(
  value: string | undefined,
  opts?: { unit?: "raw" | "K" },
): { min?: number; max?: number } | null {
  if (!value) return null;

  const normalized = value.replace(/\s+/g, "").toLowerCase();
  if (!normalized || /面议/.test(normalized)) return null;

  // Match: number [unit?] [separator] [number] [unit?]
  // Separators: hyphen, tilde, Chinese range chars.
  // Units are captured per bound so mixed ranges like 8千-1.1万/月 do not
  // multiply both numbers by every unit present in the full string.
  const match = normalized.match(
    /(\d+(?:\.\d+)?)([k千万]?)(?:[-~到至](\d+(?:\.\d+)?)([k千万]?))?/,
  );
  if (!match) return null;

  const minValue = Number(match[1]);
  const maxValue = match[3] ? Number(match[3]) : undefined;
  if (Number.isNaN(minValue)) return null;

  const minUnit = resolveSalaryUnit(minValue, match[2] ?? "", maxValue, match[4] ?? "");
  const maxUnit = maxValue === undefined
    ? ""
    : resolveSalaryUnit(maxValue, match[4] ?? "", minValue, match[2] ?? "");
  const isRaw = opts?.unit === "raw";

  const min = convertSalaryValue(minValue, minUnit, isRaw);
  const max = maxValue === undefined ? undefined : convertSalaryValue(maxValue, maxUnit, isRaw);
  return { min, max };
}

type SalaryUnit = "" | "k" | "千" | "万";

function resolveSalaryUnit(
  value: number,
  unit: string,
  counterpartValue: number | undefined,
  counterpartUnit: string,
): SalaryUnit {
  if (unit === "k" || unit === "千" || unit === "万") {
    return unit;
  }

  if (
    counterpartValue !== undefined
    && (counterpartUnit === "k" || counterpartUnit === "千" || counterpartUnit === "万")
    && value < 1000
  ) {
    return counterpartUnit;
  }

  return "";
}

function convertSalaryValue(value: number, unit: SalaryUnit, isRaw: boolean): number {
  let converted = value;
  if (unit === "万") {
    converted *= isRaw ? 10000 : 10;
  } else if (unit === "k" || unit === "千") {
    converted *= isRaw ? 1000 : 1;
  }

  return converted;
}

export function parseRawSalaryRange(value: string | undefined): { min?: number; max?: number } | null {
  return parseSalaryRange(value, { unit: "raw" });
}
