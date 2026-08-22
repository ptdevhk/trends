import { describe, expect, it, vi } from "vitest";
import type { Page } from "playwright";

import { COLLECTION_TASK_DISPATCHED_TOAST_PATTERN, pinLocale } from "./e2e-utils";

describe("e2e-utils collection toast matching", () => {
    it("matches success toasts across supported locales", () => {
        expect(COLLECTION_TASK_DISPATCHED_TOAST_PATTERN.test("Collection task dispatched")).toBe(true);
        expect(COLLECTION_TASK_DISPATCHED_TOAST_PATTERN.test("采集任务已派发")).toBe(true);
        expect(COLLECTION_TASK_DISPATCHED_TOAST_PATTERN.test("採集任務已派發")).toBe(true);
    });

    it("does not match unrelated toast text", () => {
        expect(COLLECTION_TASK_DISPATCHED_TOAST_PATTERN.test("Failed to start collection")).toBe(false);
    });
});

describe("pinLocale", () => {
    it("registers an init script that persists the pin on future navigations", async () => {
        const setItem = vi.fn();
        vi.stubGlobal("localStorage", { setItem });
        try {
            const initScripts: Array<{ fn: (...args: unknown[]) => void; arg: unknown }> = [];
            const page = {
                addInitScript: vi.fn(async (fn: (...args: unknown[]) => void, arg?: unknown) => {
                    initScripts.push({ fn, arg });
                }),
                evaluate: vi.fn(async (fn: (...args: unknown[]) => void, arg?: unknown) => {
                    fn(arg);
                }),
            } as unknown as Page;

            await pinLocale(page, "zh-Hant");

            expect(page.addInitScript).toHaveBeenCalledWith(expect.any(Function), "zh-Hant");
            expect(page.evaluate).toHaveBeenCalledWith(expect.any(Function), "zh-Hant");
            initScripts[0].fn(initScripts[0].arg);
            expect(setItem).toHaveBeenCalledWith("i18nextLng", "zh-Hant");
        } finally {
            vi.unstubAllGlobals();
        }
    });

    it("tolerates opaque origins that throw on localStorage", async () => {
        const page = {
            addInitScript: vi.fn(async () => {}),
            evaluate: vi.fn(async () => {
                throw new Error("SecurityError: The operation is insecure.");
            }),
        } as unknown as Page;

        await expect(pinLocale(page, "en")).resolves.toBeUndefined();
    });
});
