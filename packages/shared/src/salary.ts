/**
 * Parse expected salary range string into structured min/max values.
 *
 * Handles multiple Chinese and international formats:
 *   - "15K-25K", "10k-20k" → unit-specific: K-mode {15,25}, raw {15000,25000}
 *   - "1万-2万"           → unit-specific: K-mode {10,20}, raw {10000,20000}
 *   - "5千-8千"            → unit-specific: K-mode {5,8}, raw {5000,8000}
 *   - "面议", ""           → null (negotiable/empty)
 *   - "8000-12000"         → {8000, 12000} (bare numbers, same in both modes)
 *   - "12000-18000元/月"   → {12000, 18000} (bare numbers, same in both modes)
 *
 * Default output is in K-units for legacy callers.
 * Pass { unit: "raw" } for raw CNY values (API filters and ingest/index storage).
 *
 * Bare numbers (no K/千/万 annotation) are returned as-is in both modes.
 * Only explicitly annotated values are unit-converted.
 */
export function parseSalaryRange(
  value: string | undefined,
  opts?: { unit?: "raw" | "K" },
): { min?: number; max?: number } | null {
  if (!value) return null;

  const normalized = value.replace(/\s+/g, "").toLowerCase();
  if (!normalized || /面议/.test(normalized)) return null;

  // Match: number [unit?] [separator] [number] [unit?]
  // Separators: hyphen, tilde, Chinese range chars
  // Units (K/千/万) may appear after either or both numbers
  const match = normalized.match(
    /(\d+(?:\.\d+)?)[k千万]?(?:[-~到至](\d+(?:\.\d+)?))?/,
  );
  if (!match) return null;

  let min = Number(match[1]);
  let max = match[2] ? Number(match[2]) : undefined;
  if (Number.isNaN(min)) return null;

  const hasWan = /万/.test(normalized);
  const hasK = /[k千]/.test(normalized);
  const isRaw = opts?.unit === "raw";

  if (hasWan) {
    // 万: 1万 = 10K = 10000 CNY
    min *= isRaw ? 10000 : 10;
    if (max !== undefined) max *= isRaw ? 10000 : 10;
  }
  if (hasK) {
    // K/千: 1K = 1000 CNY
    min *= isRaw ? 1000 : 1;
    if (max !== undefined) max *= isRaw ? 1000 : 1;
  }
  // Bare numbers: returned as-is (unit-agnostic)

  return { min, max };
}

export function parseRawSalaryRange(value: string | undefined): { min?: number; max?: number } | null {
  return parseSalaryRange(value, { unit: "raw" });
}
