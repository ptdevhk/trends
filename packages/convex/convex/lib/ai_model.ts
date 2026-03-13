function isPoeApiBase(apiBase: string): boolean {
    try {
        return new URL(apiBase).hostname === "api.poe.com";
    } catch {
        return apiBase.includes("api.poe.com");
    }
}

export function resolveChatCompletionModel(apiBase: string, model: string): string {
    const trimmedModel = model.trim();
    if (!trimmedModel) {
        return trimmedModel;
    }

    if (!isPoeApiBase(apiBase)) {
        return trimmedModel;
    }

    const slashIndex = trimmedModel.indexOf("/");
    return slashIndex >= 0 ? trimmedModel.slice(slashIndex + 1) : trimmedModel;
}
