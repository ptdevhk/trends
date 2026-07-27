import { describe, expect, it } from "vitest";

import { COLLECTION_TASK_DISPATCHED_TOAST_PATTERN } from "./e2e-utils";

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
