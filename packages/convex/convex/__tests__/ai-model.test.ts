import { describe, expect, it } from "vitest";

import { resolveChatCompletionModel } from "../lib/ai_model";

describe("resolveChatCompletionModel", () => {
    it("strips provider prefixes for Poe chat completions", () => {
        expect(resolveChatCompletionModel("https://api.poe.com/v1", "openai/gpt-5.3-instant")).toBe("gpt-5.3-instant");
        expect(resolveChatCompletionModel("https://api.poe.com/v1", "openai/gpt-5-mini")).toBe("gpt-5-mini");
    });

    it("leaves non-Poe model identifiers unchanged", () => {
        expect(resolveChatCompletionModel("https://api.openai.com/v1", "openai/gpt-5.3-instant")).toBe(
            "openai/gpt-5.3-instant"
        );
        expect(resolveChatCompletionModel("https://api.openai.com/v1", "gpt-5")).toBe("gpt-5");
    });
});
