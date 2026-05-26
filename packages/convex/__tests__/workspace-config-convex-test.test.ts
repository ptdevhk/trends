/**
 * Integration tests using convex-test for workspace_config.ts CRUD functions.
 *
 * Uses edge-runtime environment (configured via environmentMatchGlobs in root vitest.config.ts).
 */
import { createTest } from "./test-helpers.js";
import { describe, expect, it } from "vitest";
import { api } from "../convex/_generated/api.js";


describe("workspace_config (convex-test)", () => {
  describe("get", () => {
    it("returns null for non-existent config", async () => {
      const t = createTest();
      const result = await t.query(api.workspace_config.get, {
        workspaceSlug: "ws1",
        configKey: "missing",
      });
      expect(result).toBeNull();
    });

    it("returns existing config", async () => {
      const t = createTest();

      await t.run(async (ctx) => {
        await ctx.db.insert("workspace_config", {
          workspaceSlug: "ws1",
          configKey: "theme",
          configValue: "dark",
          updatedAt: Date.now(),
        });
      });

      const result = await t.query(api.workspace_config.get, {
        workspaceSlug: "ws1",
        configKey: "theme",
      });
      expect(result).not.toBeNull();
      expect(result!.configValue).toBe("dark");
    });
  });

  describe("upsert", () => {
    it("inserts a new config", async () => {
      const t = createTest();

      const id = await t.mutation(api.workspace_config.upsert, {
        workspaceSlug: "ws1",
        configKey: "locale",
        configValue: "zh-CN",
      });
      expect(id).toBeDefined();

      const config = await t.query(api.workspace_config.get, {
        workspaceSlug: "ws1",
        configKey: "locale",
      });
      expect(config).not.toBeNull();
      expect(config!.configValue).toBe("zh-CN");
    });

    it("updates existing config on second upsert", async () => {
      const t = createTest();

      const id1 = await t.mutation(api.workspace_config.upsert, {
        workspaceSlug: "ws1",
        configKey: "locale",
        configValue: "en-US",
      });

      const id2 = await t.mutation(api.workspace_config.upsert, {
        workspaceSlug: "ws1",
        configKey: "locale",
        configValue: "zh-CN",
      });

      expect(id2).toBe(id1);

      const config = await t.query(api.workspace_config.get, {
        workspaceSlug: "ws1",
        configKey: "locale",
      });
      expect(config!.configValue).toBe("zh-CN");
    });

    it("handles complex configValue objects", async () => {
      const t = createTest();

      const complexValue = { filters: { age: [25, 40] }, mode: "strict" };
      await t.mutation(api.workspace_config.upsert, {
        workspaceSlug: "ws1",
        configKey: "searchSettings",
        configValue: complexValue,
      });

      const config = await t.query(api.workspace_config.get, {
        workspaceSlug: "ws1",
        configKey: "searchSettings",
      });
      expect(config!.configValue).toEqual(complexValue);
    });
  });

  describe("listForWorkspace", () => {
    it("returns empty array when no configs exist", async () => {
      const t = createTest();
      const result = await t.query(api.workspace_config.listForWorkspace, {
        workspaceSlug: "ws1",
      });
      expect(result).toEqual([]);
    });

    it("returns all configs for a workspace", async () => {
      const t = createTest();

      await t.mutation(api.workspace_config.upsert, {
        workspaceSlug: "ws1",
        configKey: "theme",
        configValue: "dark",
      });
      await t.mutation(api.workspace_config.upsert, {
        workspaceSlug: "ws1",
        configKey: "locale",
        configValue: "en-US",
      });
      await t.mutation(api.workspace_config.upsert, {
        workspaceSlug: "ws2",
        configKey: "theme",
        configValue: "light",
      });

      const result = await t.query(api.workspace_config.listForWorkspace, {
        workspaceSlug: "ws1",
      });
      expect(result).toHaveLength(2);
    });
  });

  describe("remove", () => {
    it("removes an existing config", async () => {
      const t = createTest();

      await t.mutation(api.workspace_config.upsert, {
        workspaceSlug: "ws1",
        configKey: "temp",
        configValue: "delete-me",
      });

      const removed = await t.mutation(api.workspace_config.remove, {
        workspaceSlug: "ws1",
        configKey: "temp",
      });
      expect(removed).toBe(true);

      const config = await t.query(api.workspace_config.get, {
        workspaceSlug: "ws1",
        configKey: "temp",
      });
      expect(config).toBeNull();
    });

    it("returns false for non-existent config", async () => {
      const t = createTest();
      const removed = await t.mutation(api.workspace_config.remove, {
        workspaceSlug: "ws1",
        configKey: "nonexistent",
      });
      expect(removed).toBe(false);
    });
  });

  describe("nested configValue shapes", () => {
    it("handles custom-keywords shape (record with array of records)", async () => {
      const t = createTest();

      const customKeywordsValue = {
        categories: [{ id: "brand", name: "Brand Priority", icon: "factory" }],
        tags: [
          { id: "tag-1", keyword: "STAR机床", english: "STAR Machine", category: "brand" },
        ],
      };
      await t.mutation(api.workspace_config.upsert, {
        workspaceSlug: "ws1",
        configKey: "custom-keywords",
        configValue: customKeywordsValue,
      });

      const config = await t.query(api.workspace_config.get, {
        workspaceSlug: "ws1",
        configKey: "custom-keywords",
      });
      expect(config!.configValue).toEqual(customKeywordsValue);
    });

    it("handles agent-overrides shape (deeply nested records)", async () => {
      const t = createTest();

      const agentOverridesValue = {
        agents: {
          defaults: {
            screener: { passThreshold: 58 },
            evaluator: { passThreshold: 74 },
          },
        },
      };
      await t.mutation(api.workspace_config.upsert, {
        workspaceSlug: "ws1",
        configKey: "agent-overrides",
        configValue: agentOverridesValue,
      });

      const config = await t.query(api.workspace_config.get, {
        workspaceSlug: "ws1",
        configKey: "agent-overrides",
      });
      expect(config!.configValue).toEqual(agentOverridesValue);
    });

    it("handles bias_audit_anomaly_alert shape (record with null values)", async () => {
      const t = createTest();

      const alertValue = {
        workspaceSlug: "ws1",
        flags: ["psi_drift"],
        psiValue: null,
        disparityRatio: null,
        alertedAt: Date.now(),
      };
      await t.mutation(api.workspace_config.upsert, {
        workspaceSlug: "ws1",
        configKey: "bias_audit_anomaly_alert",
        configValue: alertValue,
      });

      const config = await t.query(api.workspace_config.get, {
        workspaceSlug: "ws1",
        configKey: "bias_audit_anomaly_alert",
      });
      expect(config!.configValue).toEqual(alertValue);
    });

    it("handles filter-presets shape (nested arrays and records)", async () => {
      const t = createTest();

      const filterPresetsValue = {
        categories: [{ id: "dev", name: "Dev Presets", icon: "zap" }],
        presets: [
          {
            id: "fast-track",
            name: "Fast Track",
            category: "dev",
            filters: {
              minExperience: 4,
              education: ["本科", "硕士"],
              salaryRange: { min: 12000, max: 28000 },
            },
          },
        ],
      };
      await t.mutation(api.workspace_config.upsert, {
        workspaceSlug: "ws1",
        configKey: "filter-presets",
        configValue: filterPresetsValue,
      });

      const config = await t.query(api.workspace_config.get, {
        workspaceSlug: "ws1",
        configKey: "filter-presets",
      });
      expect(config!.configValue).toEqual(filterPresetsValue);
    });
  });
});
