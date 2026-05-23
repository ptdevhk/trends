export function resolveChatCompletionModel(_apiBase: string, model: string): string {
    const trimmedModel = model.trim();
    if (!trimmedModel) {
        return trimmedModel;
    }

    const slashIndex = trimmedModel.indexOf("/");
    return slashIndex >= 0 ? trimmedModel.slice(slashIndex + 1) : trimmedModel;
}
