export function resolveChatCompletionModel(_apiBase: string, model: string): string {
    const trimmedModel = model.trim();
    if (!trimmedModel) {
        return trimmedModel;
    }

    const slashIndex = trimmedModel.indexOf("/");
    return slashIndex >= 0 ? trimmedModel.slice(slashIndex + 1) : trimmedModel;
}

const KNOWN_MODELS = [
    "gpt-4o-mini", "gpt-4o", "gpt-4-turbo", "gpt-4-turbo-preview", "gpt-4", "gpt-3.5-turbo",
    "deepseek-chat", "deepseek-reasoner",
    "openai/gpt-4o-mini", "openai/gpt-4o", "openai/gpt-4-turbo-preview",
    "deepseek/deepseek-chat", "deepseek/deepseek-reasoner",
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
