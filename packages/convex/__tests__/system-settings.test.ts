import { describe, expect, it } from "vitest";
import { createTest } from "./test-helpers.js";
import { api } from "../convex/_generated/api.js";

describe("system_settings", () => {
    it("isMaintenanceMode returns false when no row exists", async () => {
        const t = createTest();
        const result = await t.query(api.system_settings.isMaintenanceMode, {});
        expect(result).toBe(false);
    });

    it("isMaintenanceMode returns true after set", async () => {
        const t = createTest();
        await t.mutation(api.system_settings.set, {
            key: "maintenanceMode",
            value: true,
            updatedBy: "test",
            reason: "testing",
        });
        const result = await t.query(api.system_settings.isMaintenanceMode, {});
        expect(result).toBe(true);
    });

    it("get returns null for missing key", async () => {
        const t = createTest();
        const result = await t.query(api.system_settings.get, { key: "nonexistent" });
        expect(result).toBeNull();
    });

    it("set then get round-trips the value", async () => {
        const t = createTest();
        await t.mutation(api.system_settings.set, {
            key: "maintenanceMode",
            value: true,
            updatedBy: "restore-script",
        });
        const result = await t.query(api.system_settings.get, { key: "maintenanceMode" });
        expect(result).toBe(true);
    });
});
