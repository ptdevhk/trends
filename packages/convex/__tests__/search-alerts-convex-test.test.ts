/**
 * Integration tests using convex-test for search_alerts.ts CRUD functions.
 *
 * Uses edge-runtime environment (configured via environmentMatchGlobs in root vitest.config.ts).
 */
import { createTest } from "./test-helpers.js";
import { describe, expect, it } from "vitest";
import { api } from "../convex/_generated/api.js";


function seedAlert(overrides: Record<string, unknown> = {}) {
  return {
    workspaceSlug: "ws1",
    searchProfileId: "profile-1",
    name: "Test Alert",
    minScore: 50,
    ...overrides,
  };
}

describe("search_alerts (convex-test)", () => {
  describe("create", () => {
    it("creates a new alert with enabled=true by default", async () => {
      const t = createTest();

      const id = await t.mutation(api.search_alerts.create, seedAlert());
      expect(id).toBeDefined();

      const alerts = await t.query(api.search_alerts.list, {
        workspaceSlug: "ws1",
      });
      expect(alerts).toHaveLength(1);
      expect(alerts[0].enabled).toBe(true);
      expect(alerts[0].name).toBe("Test Alert");
    });

    it("creates alert with keywords and createdBy", async () => {
      const t = createTest();

      await t.mutation(
        api.search_alerts.create,
        seedAlert({
          keywords: ["python", "react"],
          createdBy: "user-1",
        }),
      );

      const alerts = await t.query(api.search_alerts.list, {
        workspaceSlug: "ws1",
      });
      expect(alerts[0].keywords).toEqual(["python", "react"]);
      expect(alerts[0].createdBy).toBe("user-1");
    });
  });

  describe("toggle", () => {
    it("disables an enabled alert", async () => {
      const t = createTest();

      const id = await t.mutation(api.search_alerts.create, seedAlert());

      await t.mutation(api.search_alerts.toggle, {
        alertId: id,
        workspaceSlug: "ws1",
        enabled: false,
      });

      const enabled = await t.query(api.search_alerts.listEnabled, {
        workspaceSlug: "ws1",
      });
      expect(enabled).toHaveLength(0);
    });

    it("re-enables a disabled alert", async () => {
      const t = createTest();

      const id = await t.mutation(api.search_alerts.create, seedAlert());

      await t.mutation(api.search_alerts.toggle, {
        alertId: id,
        workspaceSlug: "ws1",
        enabled: false,
      });
      await t.mutation(api.search_alerts.toggle, {
        alertId: id,
        workspaceSlug: "ws1",
        enabled: true,
      });

      const enabled = await t.query(api.search_alerts.listEnabled, {
        workspaceSlug: "ws1",
      });
      expect(enabled).toHaveLength(1);
    });

    it("rejects toggling an alert from a different workspace", async () => {
      const t = createTest();

      const id = await t.mutation(api.search_alerts.create, seedAlert({ workspaceSlug: "ws2" }));

      await expect(
        t.mutation(api.search_alerts.toggle, {
          alertId: id,
          workspaceSlug: "ws1",
          enabled: false,
        }),
      ).rejects.toThrow("Search alert not found in workspace");
    });
  });

  describe("list", () => {
    it("returns empty array when no alerts exist", async () => {
      const t = createTest();
      const result = await t.query(api.search_alerts.list, {
        workspaceSlug: "ws1",
      });
      expect(result).toEqual([]);
    });

    it("returns alerts filtered by workspaceSlug", async () => {
      const t = createTest();

      await t.mutation(
        api.search_alerts.create,
        seedAlert({ workspaceSlug: "ws1", name: "Alert WS1" }),
      );
      await t.mutation(
        api.search_alerts.create,
        seedAlert({ workspaceSlug: "ws2", name: "Alert WS2" }),
      );

      const ws1Alerts = await t.query(api.search_alerts.list, {
        workspaceSlug: "ws1",
      });
      expect(ws1Alerts).toHaveLength(1);
      expect(ws1Alerts[0].name).toBe("Alert WS1");
    });
  });

  describe("listEnabled", () => {
    it("returns only enabled alerts", async () => {
      const t = createTest();

      const id1 = await t.mutation(
        api.search_alerts.create,
        seedAlert({ name: "Enabled" }),
      );
      const id2 = await t.mutation(
        api.search_alerts.create,
        seedAlert({ name: "Disabled" }),
      );

      await t.mutation(api.search_alerts.toggle, {
        alertId: id2,
        workspaceSlug: "ws1",
        enabled: false,
      });

      const enabled = await t.query(api.search_alerts.listEnabled, {
        workspaceSlug: "ws1",
      });
      expect(enabled).toHaveLength(1);
      expect(enabled[0].name).toBe("Enabled");
    });
  });

  describe("markNotified", () => {
    it("updates lastNotifiedAt on the alert", async () => {
      const t = createTest();

      const id = await t.mutation(api.search_alerts.create, seedAlert());

      const before = await t.query(api.search_alerts.list, {
        workspaceSlug: "ws1",
      });
      expect(before[0].lastNotifiedAt).toBeUndefined();

      await t.mutation(api.search_alerts.markNotified, { alertId: id });

      const after = await t.query(api.search_alerts.list, {
        workspaceSlug: "ws1",
      });
      expect(typeof after[0].lastNotifiedAt).toBe("number");
      expect(after[0].lastNotifiedAt).toBeGreaterThan(0);
    });
  });

  describe("remove", () => {
    it("deletes an alert", async () => {
      const t = createTest();

      const id = await t.mutation(api.search_alerts.create, seedAlert());

      await t.mutation(api.search_alerts.remove, { alertId: id, workspaceSlug: "ws1" });

      const alerts = await t.query(api.search_alerts.list, {
        workspaceSlug: "ws1",
      });
      expect(alerts).toHaveLength(0);
    });

    it("rejects deleting an alert from a different workspace", async () => {
      const t = createTest();

      const id = await t.mutation(api.search_alerts.create, seedAlert({ workspaceSlug: "ws2" }));

      await expect(
        t.mutation(api.search_alerts.remove, { alertId: id, workspaceSlug: "ws1" }),
      ).rejects.toThrow("Search alert not found in workspace");
    });
  });
});
