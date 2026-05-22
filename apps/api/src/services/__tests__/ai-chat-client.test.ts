import { describe, expect, it } from "vitest";

import { extractModelName } from "../ai-chat-client.js";

describe("extractModelName", () => {
  it("strips provider prefix from slash-delimited model IDs", () => {
    expect(extractModelName("openai/gpt-4o")).toBe("gpt-4o");
    expect(extractModelName("anthropic/claude-sonnet-4-6")).toBe("claude-sonnet-4-6");
    expect(extractModelName("deepseek/deepseek-r1")).toBe("deepseek-r1");
  });

  it("returns the full string when no slash is present", () => {
    expect(extractModelName("gpt-4o")).toBe("gpt-4o");
    expect(extractModelName("claude-3-opus")).toBe("claude-3-opus");
  });

  it("handles multi-segment paths after the first slash", () => {
    expect(extractModelName("provider/v1/model-name")).toBe("v1/model-name");
    expect(extractModelName("a/b/c")).toBe("b/c");
  });

  it("returns empty string for empty input", () => {
    expect(extractModelName("")).toBe("");
  });
});
