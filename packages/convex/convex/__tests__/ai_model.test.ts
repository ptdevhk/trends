/**
 * Unit tests for lib/ai_model.ts
 */
import { describe, expect, it, vi } from "vitest";
import { resolveChatCompletionModel, warnUnknownModel } from "../lib/ai_model.js";

describe("resolveChatCompletionModel", () => {
    it("strips provider prefix", () => {
        expect(resolveChatCompletionModel("https://api.example.com", "openai/gpt-4o")).toBe("gpt-4o");
        expect(resolveChatCompletionModel("https://api.example.com", "deepseek/deepseek-chat")).toBe("deepseek-chat");
    });

    it("returns model unchanged when no slash", () => {
        expect(resolveChatCompletionModel("https://api.example.com", "gpt-4o")).toBe("gpt-4o");
    });

    it("returns empty string unchanged", () => {
        expect(resolveChatCompletionModel("https://api.example.com", "")).toBe("");
    });

    it("returns trimmed whitespace-only string as empty", () => {
        expect(resolveChatCompletionModel("https://api.example.com", "  ")).toBe("");
    });
});

describe("warnUnknownModel", () => {
    it("returns known models unchanged without warning", () => {
        const spy = vi.spyOn(console, "warn").mockImplementation(() => {});
        expect(warnUnknownModel("gpt-4o")).toBe("gpt-4o");
        expect(warnUnknownModel("deepseek-chat")).toBe("deepseek-chat");
        expect(spy).not.toHaveBeenCalled();
        spy.mockRestore();
    });

    it("returns known prefixed models unchanged without warning", () => {
        const spy = vi.spyOn(console, "warn").mockImplementation(() => {});
        expect(warnUnknownModel("openai/gpt-4o")).toBe("openai/gpt-4o");
        expect(spy).not.toHaveBeenCalled();
        spy.mockRestore();
    });

    it("warns for unknown models but returns them unchanged", () => {
        const spy = vi.spyOn(console, "warn").mockImplementation(() => {});
        expect(warnUnknownModel("claude-3-opus")).toBe("claude-3-opus");
        expect(spy).toHaveBeenCalledTimes(1);
        spy.mockRestore();
    });

    it("does not warn for empty string", () => {
        const spy = vi.spyOn(console, "warn").mockImplementation(() => {});
        expect(warnUnknownModel("")).toBe("");
        expect(spy).not.toHaveBeenCalled();
        spy.mockRestore();
    });
});
