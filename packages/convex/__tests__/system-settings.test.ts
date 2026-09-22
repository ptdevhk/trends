/**
 * Integration tests for AI routing settings in system_settings.ts.
 */
import { createTest } from "./test-helpers.js";
import { describe, expect, it } from "vitest";
import { api } from "../convex/_generated/api.js";

describe("system_settings: ai routing", () => {
  it("returns nulls when no aiRouting setting is present", async () => {
    const t = createTest();
    const result = await t.query(api.system_settings.getAiRoutingSettings);
    expect(result).toEqual({
      apiBase: null,
      model: null,
      fallbackModel: null,
    });
  });

  it("round-trips a set then get", async () => {
    const t = createTest();
    await t.mutation(api.system_settings.setAiRoutingSettings, {
      apiBase: "https://cpa.pt-mes.com/v1/",
      model: "openai/deepseek-v4-flash",
      fallbackModel: "openai/deepseek-v4-flash-e",
      updatedBy: "admin@example.com",
      reason: "switch router",
    });

    const result = await t.query(api.system_settings.getAiRoutingSettings);
    // Trailing slash normalized; provider/model form preserved.
    expect(result).toMatchObject({
      apiBase: "https://cpa.pt-mes.com/v1",
      model: "openai/deepseek-v4-flash",
      fallbackModel: "openai/deepseek-v4-flash-e",
    });
    expect(result.updatedBy).toBe("admin@example.com");
    expect(typeof result.updatedAt).toBe("number");
  });

  it("rejects a bare model without provider/form slash", async () => {
    const t = createTest();
    await expect(
      t.mutation(api.system_settings.setAiRoutingSettings, {
        model: "deepseek-v4-flash",
        updatedBy: "admin@example.com",
      }),
    ).rejects.toThrow(/provider\/model/);
  });

  it("clears fields with empty string to fall back to env", async () => {
    const t = createTest();
    await t.mutation(api.system_settings.setAiRoutingSettings, {
      apiBase: "https://cpa.pt-mes.com/v1",
      model: "openai/deepseek-v4-flash",
      updatedBy: "admin@example.com",
    });
    await t.mutation(api.system_settings.setAiRoutingSettings, {
      apiBase: "",
      model: "",
      updatedBy: "admin@example.com",
      reason: "reset to env",
    });

    const result = await t.query(api.system_settings.getAiRoutingSettings);
    expect(result.apiBase).toBeNull();
    expect(result.model).toBeNull();
    expect(result.fallbackModel).toBeNull();
  });
});
