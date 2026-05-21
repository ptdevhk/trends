import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { resolveAIOutputLocale } from "../locale-utils.js";

describe("resolveAIOutputLocale", () => {
    const originalEnv = process.env.AI_OUTPUT_LOCALE;

    beforeEach(() => {
        delete process.env.AI_OUTPUT_LOCALE;
    });

    afterEach(() => {
        if (originalEnv !== undefined) {
            process.env.AI_OUTPUT_LOCALE = originalEnv;
        } else {
            delete process.env.AI_OUTPUT_LOCALE;
        }
    });

    it("returns default locale when no env var and no sourceKey", () => {
        const result = resolveAIOutputLocale();
        expect(result).toBe("zh-Hans");
    });

    it("returns 'en' for seek sourceKey regardless of env var", () => {
        process.env.AI_OUTPUT_LOCALE = "zh-Hans";
        expect(resolveAIOutputLocale({ sourceKey: "seek" })).toBe("en");
    });

    it("returns 'en' for seek sourceKey when no env var", () => {
        expect(resolveAIOutputLocale({ sourceKey: "seek" })).toBe("en");
    });

    it("returns env var locale for non-seek sources", () => {
        process.env.AI_OUTPUT_LOCALE = "zh-Hans";
        expect(resolveAIOutputLocale({ sourceKey: "51job" })).toBe("zh-Hans");
    });

    it("returns env var locale when no sourceKey provided", () => {
        process.env.AI_OUTPUT_LOCALE = "zh-Hans";
        expect(resolveAIOutputLocale()).toBe("zh-Hans");
    });

    it("seek sourceKey takes priority over env var", () => {
        process.env.AI_OUTPUT_LOCALE = "zh-Hans";
        const seekResult = resolveAIOutputLocale({ sourceKey: "seek" });
        const defaultResult = resolveAIOutputLocale();
        expect(seekResult).toBe("en");
        expect(defaultResult).toBe("zh-Hans");
    });
});
