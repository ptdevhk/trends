/**
 * Integration tests using convex-test for workspace_config.ts CRUD functions.
 *
 * Uses edge-runtime environment (configured via environmentMatchGlobs in root vitest.config.ts).
 */
import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { api } from "../_generated/api.js";
import schema from "../schema.js";

const modules = (import.meta as any).glob("../**/*.ts", { eager: false });

describe("workspace_config (convex-test)", () => {
  describe("get", () => {
    it("returns null for non-existent config", async () => {
      const t = convexTest(schema, modules);
      const result = await t.query(api.workspace_config.get, {
        workspaceSlug: "ws1",
        configKey: "missing",
      });
      expect(result).toBeNull();
    });

    it("returns existing config", async () => {
      const t = convexTest(schema, modules);

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
      const t = convexTest(schema, modules);

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
      const t = convexTest(schema, modules);

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
      const t = convexTest(schema, modules);

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
      const t = convexTest(schema, modules);
      const result = await t.query(api.workspace_config.listForWorkspace, {
        workspaceSlug: "ws1",
      });
      expect(result).toEqual([]);
    });

    it("returns all configs for a workspace", async () => {
      const t = convexTest(schema, modules);

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
      const t = convexTest(schema, modules);

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
      const t = convexTest(schema, modules);
      const removed = await t.mutation(api.workspace_config.remove, {
        workspaceSlug: "ws1",
        configKey: "nonexistent",
      });
      expect(removed).toBe(false);
    });
  });
});
