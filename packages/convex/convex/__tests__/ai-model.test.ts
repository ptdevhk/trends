import { describe, expect, it } from "vitest";

import { resolveChatCompletionModel } from "../lib/ai_model";

describe("resolveChatCompletionModel", () => {
    it("strips provider prefixes for all API bases", () => {
        expect(resolveChatCompletionModel("https://api.openai.com/v1", "openai/gpt-5.3-instant")).toBe("gpt-5.3-instant");
        expect(resolveChatCompletionModel("https://new-api.example.com", "openai/kimi-k2.5")).toBe("kimi-k2.5");
    });

    it("leaves model identifiers without a prefix unchanged", () => {
        expect(resolveChatCompletionModel("https://api.openai.com/v1", "gpt-5")).toBe("gpt-5");
    });
});
