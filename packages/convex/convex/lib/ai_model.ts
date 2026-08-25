export const DEFAULT_PRIMARY_CHAT_MODEL = "openai/deepseek-v4-flash";
/** Fallback when the primary model is unavailable or returns incomplete output. */
export const DEFAULT_FALLBACK_CHAT_MODEL = "openai/deepseek-v4-flash-e";

export const POE_DEEPSEEK_V4_FLASH_KNOWN_BUG = {
    model: "openai/deepseek-v4-flash",
    issue: "Poe rejected response_format json_object with HTTP 400 Invalid input / invalid_request_error",
    status: "closed",
    observed: "2026-08-17",
    closed: "2026-08-25",
} as const;

export type ChatCompletionCapability = "full" | "incomplete";

export function resolveChatCompletionModel(_apiBase: string, model: string): string {
    const trimmedModel = model.trim();
    if (!trimmedModel) {
        return trimmedModel;
    }

    const slashIndex = trimmedModel.indexOf("/");
    return slashIndex >= 0 ? trimmedModel.slice(slashIndex + 1) : trimmedModel;
}

export function classifyChatCompletionCapability(observation: {
    status: number;
    body: string;
}): ChatCompletionCapability {
    const body = observation.body.toLowerCase();
    if (
        observation.status === 400 &&
        (body.includes("response_format")
            || body.includes("invalid_input")
            || body.includes("invalid input")
            || body.includes("invalid_request_error"))
    ) {
        return "incomplete";
    }
    return "full";
}

export function selectAnalyzeChatModel(input: {
    primary: string;
    fallback: string;
    capability: ChatCompletionCapability;
}): string {
    return input.capability === "incomplete" ? input.fallback : input.primary;
}

export function buildChatCompletionCapabilityProbeRequest(model: string) {
    return {
        model,
        messages: [{ role: "user" as const, content: 'Reply with JSON {"ok":true}' }],
        temperature: 0,
        response_format: { type: "json_object" as const },
    };
}

export async function probeChatCompletionCapability(args: {
    apiBase: string;
    apiKey: string;
    model: string;
    fetchImpl?: typeof fetch;
}): Promise<{ capability: ChatCompletionCapability; status: number; body: string }> {
    const fetchFn = args.fetchImpl ?? fetch;
    const url = `${args.apiBase.replace(/\/$/, "")}/chat/completions`;
    const response = await fetchFn(url, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${args.apiKey}`,
        },
        body: JSON.stringify(buildChatCompletionCapabilityProbeRequest(args.model)),
    });
    const body = await response.text();
    return {
        status: response.status,
        body,
        capability: classifyChatCompletionCapability({ status: response.status, body }),
    };
}

const KNOWN_MODELS = [
    "gpt-4o-mini", "gpt-4o", "gpt-4-turbo", "gpt-4-turbo-preview", "gpt-4", "gpt-3.5-turbo",
    "deepseek-chat", "deepseek-reasoner",
    "openai/gpt-4o-mini", "openai/gpt-4o", "openai/gpt-4-turbo-preview",
    "deepseek/deepseek-chat", "deepseek/deepseek-reasoner",
    "deepseek-v4-flash", "openai/deepseek-v4-flash",
    "deepseek-v4-flash-e", "openai/deepseek-v4-flash-e",
] as const;

/**
 * Warn (console.warn) if AI_MODEL is not in the known-good list.
 * Returns the model string unchanged — this is advisory only.
 */
export function warnUnknownModel(model: string): string {
    if (!model || KNOWN_MODELS.includes(model as any)) {
        return model;
    }
    const stripped = model.includes("/") ? model.slice(model.indexOf("/") + 1) : model;
    if (KNOWN_MODELS.some((m) => m === stripped)) {
        return model;
    }
    console.warn(
        `[ai-model] Warning: AI_MODEL='${model}' is not in the known-good list. ` +
        `Untested model — verify it works at your AI_API_BASE endpoint.`
    );
    return model;
}
