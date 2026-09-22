/**
 * AI routing settings — BFF read/write of the operator-editable Convex
 * `aiRouting` system setting with a short TTL cache.
 *
 * The Convex `system_settings.aiRouting` document holds `apiBase` / `model` /
 * `fallbackModel` (string or null). A null field means "use env". The API key
 * is never stored here — BFF callers keep reading it from `process.env.AI_API_KEY`.
 *
 * `loadEffectiveAIConfig()` merges the stored settings over the env-derived
 * AIConfig for model/fallbackModel/apiBase only; the key always comes from env.
 */
import { loadAIConfig, type AIConfig } from "./ai-config.js";
import { callConvexQuery, callConvexMutation } from "./convex-utils.js";

export interface AiRoutingSettings {
  apiBase: string | null;
  model: string | null;
  fallbackModel: string | null;
  updatedAt?: number;
  updatedBy?: string;
}

const QUERY_NAME = "system_settings:getAiRoutingSettings";
const MUTATION_NAME = "system_settings:setAiRoutingSettings";

// Short TTL so model/base hot-config applies without a BFF restart; correctness
// is prioritized over micro-latency. Invalidate on a successful write.
const CACHE_TTL_MS = 10_000;

let cachedSettings: AiRoutingSettings | null = null;
let cachedAt = 0;
let inflight: Promise<AiRoutingSettings | null> | null = null;

/** Force the next `getCachedAiRoutingSettings` call to re-read Convex. */
export function invalidateAiRoutingSettingsCache(): void {
  cachedSettings = null;
  cachedAt = 0;
}

/** Read settings directly from Convex (no cache). Returns null on error/missing. */
export async function fetchAiRoutingSettings(): Promise<AiRoutingSettings | null> {
  try {
    const value = (await callConvexQuery(QUERY_NAME, {})) as AiRoutingSettings | null;
    return value ?? null;
  } catch (error) {
    // Fail open to env when Convex is unreachable — never block AI calls on settings read.
    console.warn(`[ai-routing] Failed to read Convex AI routing settings, using env:`, error);
    return null;
  }
}

/**
 * Read settings with a short TTL cache, coalescing concurrent callers.
 */
export async function getCachedAiRoutingSettings(): Promise<AiRoutingSettings | null> {
  const now = Date.now();
  if (cachedSettings !== null && now - cachedAt < CACHE_TTL_MS) {
    return cachedSettings;
  }
  if (inflight) {
    return inflight;
  }
  inflight = fetchAiRoutingSettings().then((settings) => {
    cachedSettings = settings;
    cachedAt = Date.now();
    return settings;
  }).finally(() => {
    inflight = null;
  });
  return inflight;
}

/**
 * Write AI routing settings to Convex (admin gated upstream). Returns the
 * effective stored settings object. Empty strings clear a field → env fallback.
 */
export async function writeAiRoutingSettings(input: {
  apiBase?: string;
  model?: string;
  fallbackModel?: string;
  updatedBy: string;
  reason?: string;
}): Promise<AiRoutingSettings | null> {
  const value = (await callConvexMutation(MUTATION_NAME, {
    ...(input.apiBase !== undefined ? { apiBase: input.apiBase } : {}),
    ...(input.model !== undefined ? { model: input.model } : {}),
    ...(input.fallbackModel !== undefined ? { fallbackModel: input.fallbackModel } : {}),
    updatedBy: input.updatedBy,
    ...(input.reason !== undefined ? { reason: input.reason } : {}),
  })) as AiRoutingSettings | null;
  invalidateAiRoutingSettingsCache();
  return value ?? null;
}

/**
 * Effective AI config for a single BFF AI call — stored settings override env
 * for model/fallbackModel/apiBase; the API key always comes from env.
 */
export async function loadEffectiveAIConfig(): Promise<AIConfig> {
  const base = loadAIConfig();
  const settings = await getCachedAiRoutingSettings();
  if (!settings) {
    return base;
  }
  return {
    ...base,
    ...(settings.apiBase ? { apiBase: settings.apiBase } : {}),
    ...(settings.model ? { model: settings.model } : {}),
    ...(settings.fallbackModel ? { fallbackModel: settings.fallbackModel } : {}),
  };
}

/** For tests: reset the module-level TTL cache between cases. */
export function resetAiRoutingSettingsCacheForTest(): void {
  invalidateAiRoutingSettingsCache();
  inflight = null;
}
