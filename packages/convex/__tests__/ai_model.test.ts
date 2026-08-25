/**
 * Unit tests for lib/ai_model.ts
 */
import { describe, expect, it, vi } from "vitest";
import {
    resolveChatCompletionModel,
    warnUnknownModel,
    DEFAULT_PRIMARY_CHAT_MODEL,
    DEFAULT_FALLBACK_CHAT_MODEL,
    POE_DEEPSEEK_V4_FLASH_KNOWN_BUG,
    classifyChatCompletionCapability,
    selectAnalyzeChatModel,
    buildChatCompletionCapabilityProbeRequest,
    probeChatCompletionCapability,
} from "../convex/lib/ai_model.js";

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

    it("treats deepseek-v4-flash and deepseek-v4-flash-e as known-good", () => {
        const spy = vi.spyOn(console, "warn").mockImplementation(() => {});
        expect(warnUnknownModel("openai/deepseek-v4-flash")).toBe("openai/deepseek-v4-flash");
        expect(warnUnknownModel("openai/deepseek-v4-flash-e")).toBe("openai/deepseek-v4-flash-e");
        expect(warnUnknownModel("deepseek-v4-flash")).toBe("deepseek-v4-flash");
        expect(warnUnknownModel("deepseek-v4-flash-e")).toBe("deepseek-v4-flash-e");
        expect(spy).not.toHaveBeenCalled();
        spy.mockRestore();
    });
});

describe("chat-completion capability + analyze model select", () => {
    it("names first-class primary deepseek-v4-flash and keeps deepseek-v4-flash-e as fallback", () => {
        expect(DEFAULT_PRIMARY_CHAT_MODEL).toBe("openai/deepseek-v4-flash");
        expect(DEFAULT_FALLBACK_CHAT_MODEL).toBe("openai/deepseek-v4-flash-e");
        expect(POE_DEEPSEEK_V4_FLASH_KNOWN_BUG.model).toBe("openai/deepseek-v4-flash");
        expect(POE_DEEPSEEK_V4_FLASH_KNOWN_BUG.status).toBe("closed");
        expect(DEFAULT_FALLBACK_CHAT_MODEL).toBe("openai/deepseek-v4-flash-e");
    });

    it("classifies a Poe 400 response_format invalid_input as incomplete", () => {
        const capability = classifyChatCompletionCapability({
            status: 400,
            body: JSON.stringify({
                error: {
                    type: "invalid_input",
                    message: "response_format json_object is not supported",
                },
            }),
        });
        expect(capability).toBe("incomplete");
    });

    it("classifies the live Poe 400 invalid_request_error / Invalid input as incomplete", () => {
        const capability = classifyChatCompletionCapability({
            status: 400,
            body: '{"error": {"message": "Invalid input", "type": "invalid_request_error"}}',
        });
        expect(capability).toBe("incomplete");
    });

    it("classifies HTTP 200 chat completion as full-function", () => {
        const capability = classifyChatCompletionCapability({
            status: 200,
            body: JSON.stringify({
                choices: [{ message: { content: '{"ok":true}' } }],
            }),
        });
        expect(capability).toBe("full");
    });

    it("selects primary when capable and fallback when incomplete", () => {
        expect(selectAnalyzeChatModel({
            primary: DEFAULT_PRIMARY_CHAT_MODEL,
            fallback: DEFAULT_FALLBACK_CHAT_MODEL,
            capability: "full",
        })).toBe("openai/deepseek-v4-flash");
        expect(selectAnalyzeChatModel({
            primary: DEFAULT_PRIMARY_CHAT_MODEL,
            fallback: DEFAULT_FALLBACK_CHAT_MODEL,
            capability: "incomplete",
        })).toBe("openai/deepseek-v4-flash-e");
    });

    it("builds a probe request that includes response_format json_object", () => {
        const request = buildChatCompletionCapabilityProbeRequest("deepseek-v4-flash");
        expect(request.model).toBe("deepseek-v4-flash");
        expect(request.response_format).toEqual({ type: "json_object" });
        expect(request.messages.length).toBeGreaterThan(0);
    });

    it("probeChatCompletionCapability classifies a recorded 400 through the real probe", async () => {
        const fetchImpl = async () =>
            new Response(
                JSON.stringify({ error: { type: "invalid_input", message: "response_format" } }),
                { status: 400, statusText: "Bad Request" },
            );
        const result = await probeChatCompletionCapability({
            apiBase: "https://api.poe.com/v1",
            apiKey: "sk-test",
            model: "deepseek-v4-flash",
            fetchImpl,
        });
        expect(result.status).toBe(400);
        expect(result.capability).toBe("incomplete");
        expect(result.body).toContain("response_format");
    });
});
