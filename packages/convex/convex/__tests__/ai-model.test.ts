import { describe, expect, it, vi } from "vitest";

import { resolveChatCompletionModel, warnUnknownModel } from "../lib/ai_model";

describe("resolveChatCompletionModel", () => {
    it("strips provider prefixes for all API bases", () => {
        expect(resolveChatCompletionModel("https://api.openai.com/v1", "openai/gpt-5.3-instant")).toBe("gpt-5.3-instant");
        expect(resolveChatCompletionModel("https://new-api.example.com", "openai/kimi-k2.5")).toBe("kimi-k2.5");
    });

    it("leaves model identifiers without a prefix unchanged", () => {
        expect(resolveChatCompletionModel("https://api.openai.com/v1", "gpt-5")).toBe("gpt-5");
    });
});

describe("warnUnknownModel", () => {
    it("returns known models without warning", () => {
        const spy = vi.spyOn(console, "warn").mockImplementation(() => {});
        expect(warnUnknownModel("gpt-4o-mini")).toBe("gpt-4o-mini");
        expect(warnUnknownModel("openai/gpt-4o")).toBe("openai/gpt-4o");
        expect(warnUnknownModel("deepseek/deepseek-chat")).toBe("deepseek/deepseek-chat");
        expect(spy).not.toHaveBeenCalled();
        spy.mockRestore();
    });

    it("returns unknown models with a warning", () => {
        const spy = vi.spyOn(console, "warn").mockImplementation(() => {});
        expect(warnUnknownModel("openai/some-future-model")).toBe("openai/some-future-model");
        expect(spy).toHaveBeenCalledTimes(1);
        expect(spy.mock.calls[0][0]).toContain("not in the known-good list");
        spy.mockRestore();
    });

    it("recognizes stripped name of known models", () => {
        const spy = vi.spyOn(console, "warn").mockImplementation(() => {});
        expect(warnUnknownModel("openai/gpt-4o-mini")).toBe("openai/gpt-4o-mini");
        expect(spy).not.toHaveBeenCalled();
        spy.mockRestore();
    });

    it("returns empty string without warning", () => {
        const spy = vi.spyOn(console, "warn").mockImplementation(() => {});
        expect(warnUnknownModel("")).toBe("");
        expect(spy).not.toHaveBeenCalled();
        spy.mockRestore();
    });
});
