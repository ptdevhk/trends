/**
 * CPA / AI routing — curated model list + normalization helpers.
 *
 * Shared across Convex (settings validation + analyze read path), the BFF
 * (effective config + routes), and the web Runtime picker so the curated
 * defaults and provider/model form stay consistent everywhere.
 *
 * Canonical stored/display form is `provider/model` (BFF validation today).
 * When calling CPA chat completions the provider/ prefix is stripped by the
 * existing `resolveChatCompletionModel` path in Convex.
 */

/** Curated defaults available offline — at least the two known CPA DeepSeek models. */
export const CURATED_AI_ROUTING_MODELS: readonly string[] = [
  "openai/deepseek-v4-flash",
  "openai/deepseek-v4-flash-e",
  // Other aliases operators use against the CPA gateway (from ai-model-check.sh KNOWN_MODELS).
  "deepseek/deepseek-chat",
  "deepseek/deepseek-reasoner",
] as const;

/**
 * Normalize an API base URL for storage: trim whitespace and strip a single
 * trailing slash. The `/v1` suffix is preserved if present (the CPA gateway
 * and most OpenAI-compatible endpoints use `/v1`, but we do not force it).
 */
export function normalizeAiApiBase(url: string): string {
  const trimmed = url.trim();
  if (!trimmed) {
    return "";
  }
  return trimmed.replace(/\/+$/, "");
}

/**
 * True when a model string is `provider/model` — exactly one `/` with
 * non-empty sides. This is the form BFF validation requires.
 */
export function isProviderModelForm(model: string): boolean {
  if (!model) {
    return false;
  }
  const slash = model.indexOf("/");
  if (slash <= 0 || slash === model.length - 1) {
    return false;
  }
  // Reject additional slashes.
  if (model.indexOf("/", slash + 1) !== -1) {
    return false;
  }
  return true;
}

const CPA_DEFAULT_PROVIDER = "openai";

/**
 * Map a gateway `/models` id into a picker/save entry that still stores as
 * `provider/model`. Bare ids and `dd/`-prefixed Poe-lite aliases map to the
 * `openai` provider by default; already-provider-prefixed ids pass through.
 */
const GATEWAY_INTERNAL_PREFIXES = new Set(["dd"]);

export function mapGatewayModelIdToProviderModel(id: string): string {
  const trimmed = id.trim();
  if (!trimmed) {
    return trimmed;
  }
  // Gateway-internal prefixed Poe-lite aliases (e.g. `dd/<model>`) collapse to
  // the openai provider so they still save in `provider/model` form.
  const slash = trimmed.indexOf("/");
  if (slash !== -1 && GATEWAY_INTERNAL_PREFIXES.has(trimmed.slice(0, slash))) {
    return `${CPA_DEFAULT_PROVIDER}/${trimmed.slice(slash + 1)}`;
  }
  if (isProviderModelForm(trimmed)) {
    return trimmed;
  }
  if (slash === -1) {
    // Bare model id (e.g. `deepseek-v4-flash`) → openai prefix.
    return `${CPA_DEFAULT_PROVIDER}/${trimmed}`;
  }
  // A one-component prefix that is neither a provider form nor a known
  // gateway-internal alias — drop it and use the default provider.
  return `${CPA_DEFAULT_PROVIDER}/${trimmed.slice(slash + 1)}`;
}
