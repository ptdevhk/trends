import type { MachineOrigin } from "../industry-evidence.js";

/**
 * Structured brand signals for Phase 2 of the CN HR scoring audit.
 *
 * brandOrigin and productClass are analysis/debug signals. They do not change
 * the final score formula: round(related_exp * 0.5) + industry_db.
 */

export type BrandOrigin = "international" | "domestic" | "unknown";

export type ProductClass =
  | "complete_machine"
  | "tool_accessory"
  | "industrial_component"
  | "other";

export type BrandOriginSource = "international" | "domestic" | "agent" | string | undefined;

const TOOL_ACCESSORY_RE = /刀具|刀柄|砂轮|量具|工具|consumable|cutting\s*tool|tooling/i;
const COMPLETE_MACHINE_RE =
  /加工中心|数控|车床|机床|火花|走心|磨床|machining\s*center|lathe|machine\s*tool|cnc/i;
const INDUSTRIAL_COMPONENT_RE =
  /传感器|空压|测量|扫描|机器人|减速|温控|仪表|sensor|robot|compressor|metrology|controller/i;

/**
 * Strict ingest/analysis parsers: keep only known enum values, else undefined.
 * Distinct from normalizeBrandOrigin which collapses unknowns to "unknown".
 */
export function parseBrandOrigin(value: unknown): BrandOrigin | undefined {
  return value === "international" || value === "domestic" || value === "unknown"
    ? value
    : undefined;
}

export function parseMachineOrigin(value: unknown): MachineOrigin | undefined {
  return value === "international" || value === "domestic" || value === "unknown"
    ? value
    : undefined;
}

export function parseProductClass(value: unknown): ProductClass | undefined {
  return value === "complete_machine"
    || value === "tool_accessory"
    || value === "industrial_component"
    || value === "other"
    ? value
    : undefined;
}

/**
 * Map brands.json `type` (or similar free text) onto a product-class code.
 */
export function classifyBrandProductClass(type: string | undefined | null): ProductClass {
  const text = typeof type === "string" ? type.trim() : "";
  if (!text) {
    return "other";
  }

  // Prefer complete_machine when machine terms are present (even alongside tools);
  // otherwise tool/accessory, then industrial component.
  const hasTool = TOOL_ACCESSORY_RE.test(text);
  const hasMachine = COMPLETE_MACHINE_RE.test(text);
  if (hasMachine) {
    return "complete_machine";
  }
  if (hasTool) {
    return "tool_accessory";
  }
  if (INDUSTRIAL_COMPONENT_RE.test(text)) {
    return "industrial_component";
  }
  return "other";
}

/**
 * Normalize brands.json origin onto the analysis contract.
 * `agent` and unknown values collapse to `unknown`.
 */
export function normalizeBrandOrigin(origin: BrandOriginSource): BrandOrigin {
  if (origin === "international" || origin === "domestic") {
    return origin;
  }
  return "unknown";
}

/**
 * Aggregate per-hit origins for a candidate-level signal.
 * International evidence wins; otherwise domestic if present; else unknown.
 * This makes "domestic-only" detectable as brandOrigin === "domestic".
 */
export function aggregateBrandOrigin(
  hits: ReadonlyArray<{ origin?: BrandOriginSource | null }>,
): BrandOrigin {
  let sawDomestic = false;
  for (const hit of hits) {
    const origin = normalizeBrandOrigin(hit?.origin ?? undefined);
    if (origin === "international") {
      return "international";
    }
    if (origin === "domestic") {
      sawDomestic = true;
    }
  }
  return sawDomestic ? "domestic" : "unknown";
}

/**
 * Aggregate per-hit product classes for a candidate-level signal.
 * Prefer complete_machine when present; else tool_accessory; else industrial; else other.
 */
export function aggregateProductClass(
  hits: ReadonlyArray<{ productClass?: ProductClass | string | null; type?: string | null }>,
): ProductClass {
  let sawTool = false;
  let sawIndustrial = false;
  for (const hit of hits) {
    const pc =
      typeof hit?.productClass === "string" && hit.productClass.trim().length > 0
        ? (hit.productClass as ProductClass)
        : classifyBrandProductClass(hit?.type);
    if (pc === "complete_machine") {
      return "complete_machine";
    }
    if (pc === "tool_accessory") {
      sawTool = true;
    } else if (pc === "industrial_component") {
      sawIndustrial = true;
    }
  }
  if (sawTool) {
    return "tool_accessory";
  }
  if (sawIndustrial) {
    return "industrial_component";
  }
  return "other";
}

/**
 * Format a brand hit for LLM prompt material, including origin/class when known.
 * Example: "TOYODA (international/complete_machine)"
 */
export function formatBrandHitLabel(hit: {
  brand?: string | null;
  origin?: BrandOriginSource | null;
  productClass?: ProductClass | string | null;
  type?: string | null;
}): string {
  const brand = typeof hit.brand === "string" ? hit.brand.trim() : "";
  if (!brand) {
    return "";
  }
  const origin = normalizeBrandOrigin(hit.origin ?? undefined);
  const productClass =
    typeof hit.productClass === "string" && hit.productClass.trim().length > 0
      ? hit.productClass
      : classifyBrandProductClass(hit.type);
  if (origin === "unknown" && productClass === "other") {
    return brand;
  }
  return `${brand} (${origin}/${productClass})`;
}

/**
 * Non-employer brand labels for analysis prompts, with optional origin/class tags.
 */
export function summarizeNonEmployerBrandHitLabels(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const labels = new Set<string>();
  for (const item of value) {
    if (typeof item !== "object" || item === null) {
      continue;
    }
    const record = item as Record<string, unknown>;
    const context = typeof record.context === "string" ? record.context.trim().toLowerCase() : "";
    if (context === "employer") {
      continue;
    }
    const label = formatBrandHitLabel({
      brand: typeof record.brand === "string" ? record.brand : "",
      origin: typeof record.origin === "string" ? record.origin : undefined,
      productClass: typeof record.productClass === "string" ? record.productClass : undefined,
      type: typeof record.type === "string" ? record.type : undefined,
    });
    if (label) {
      labels.add(label);
    }
  }
  return [...labels];
}

/**
 * Prompt segments for brandHits: labeled non-employer hits plus optional
 * candidate-level brandOrigin/productClass summary as a final segment.
 */
export function buildBrandHitsPromptSegments(input: {
  brandHits?: unknown;
  brandOrigin?: string | null;
  productClass?: string | null;
}): string[] {
  const labels = summarizeNonEmployerBrandHitLabels(input.brandHits);
  const signalParts: string[] = [];
  if (typeof input.brandOrigin === "string" && input.brandOrigin.trim().length > 0) {
    signalParts.push(`brandOrigin=${input.brandOrigin.trim()}`);
  }
  if (typeof input.productClass === "string" && input.productClass.trim().length > 0) {
    signalParts.push(`productClass=${input.productClass.trim()}`);
  }
  if (signalParts.length === 0) {
    return labels;
  }
  return [...labels, signalParts.join(", ")];
}

/**
 * Deterministic concern strings for HR-visible failure classes (CN + EN).
 * Used as prompt contract guidance and optional runtime concern enrichment.
 */
export function structuredBrandConcerns(input: {
  brandOrigin?: BrandOrigin | null;
  productClass?: ProductClass | null;
  locale?: string | null;
}): string[] {
  const locale = (input.locale ?? "zh").toLowerCase();
  const en = locale.startsWith("en");
  const concerns: string[] = [];

  if (input.brandOrigin === "domestic") {
    concerns.push(
      en
        ? "Experience appears concentrated on domestic-brand machine tools rather than premium imported brands."
        : "经历以国产机床品牌为主，缺少高端进口品牌整机销售证据。",
    );
  }
  if (input.productClass === "tool_accessory") {
    concerns.push(
      en
        ? "Evidence points to cutting tools / accessories sales, not complete machine-tool sales."
        : "证据偏向刀具/配件销售，而非机床整机销售。",
    );
  } else if (input.productClass === "industrial_component") {
    concerns.push(
      en
        ? "Evidence points to industrial components / non-machine product sales rather than complete machine tools."
        : "证据偏向工业零部件/非整机产品销售，而非机床整机销售。",
    );
  }
  return concerns;
}

/**
 * Strong-match prose tokens that must not appear when the score band is low.
 */
export const LOW_BAND_FORBIDDEN_STRONG_MATCH_RE =
  /较强匹配|高度匹配|重点推进|强烈推荐|strong\s*match|highly\s*matched|strong\s*fit|priority\s*hire/gi;

export function stripForbiddenStrongMatchProse(summary: string, score: number): string {
  if (summary.trim().length === 0 || score >= 70) {
    return summary;
  }
  const next = summary.replace(LOW_BAND_FORBIDDEN_STRONG_MATCH_RE, (match) => {
    // Preserve length-ish readability with a neutral phrase.
    if (/[A-Za-z]/.test(match)) {
      return "limited match";
    }
    return "匹配有限";
  });
  return next.replace(/\s{2,}/g, " ").trim();
}
