import fs from "node:fs";
import path from "node:path";
import { OpenAPIHono, z } from "@hono/zod-openapi";
import JSON5 from "json5";
import { findProjectRoot } from "../services/db.js";
import { filterPresetService } from "../services/filter-preset-service.js";
import { getMaskedApiKey, loadAIConfig, validateAIConfig } from "../services/ai-config.js";

const app = new OpenAPIHono();

const AgentsConfigSchema = z.record(z.unknown());
const SalaryRangeSchema = z.object({
  min: z.number().optional(),
  max: z.number().optional(),
});
const PresetFiltersSchema = z.object({
  minExperience: z.number().optional(),
  maxExperience: z.number().nullable().optional(),
  education: z.array(z.string()).optional(),
  salaryRange: SalaryRangeSchema.optional(),
});
const FilterPresetSchema = z.object({
  id: z.string(),
  name: z.string(),
  category: z.string(),
  filters: PresetFiltersSchema,
});
const PresetCategorySchema = z.object({
  id: z.string(),
  name: z.string(),
  icon: z.string().optional(),
});
const FilterPresetsConfigSchema = z.object({
  presets: z.array(FilterPresetSchema),
  categories: z.array(PresetCategorySchema),
});
const FilterPresetUpdateSchema = z.object({
  name: z.string().optional(),
  category: z.string().optional(),
  filters: PresetFiltersSchema.optional(),
});

function getAgentsConfigPath(): string {
  return path.join(findProjectRoot(), "config", "resume", "agents.json5");
}

app.get("/agents", (c) => {
  try {
    const configPath = getAgentsConfigPath();
    const content = fs.readFileSync(configPath, "utf8");
    const parsedContent: unknown = JSON5.parse(content);
    const parsedResult = AgentsConfigSchema.safeParse(parsedContent);

    if (!parsedResult.success) {
      return c.json({ success: false as const, error: "Invalid agents configuration format" }, 500);
    }

    const aiConfig = loadAIConfig();
    const isModelBonded = aiConfig.bonded.includes("AI_MODEL");

    // Apply AI_MODEL override if bonded
    if (isModelBonded && aiConfig.model) {
      const configData = parsedResult.data as any;
      if (configData.agents && Array.isArray(configData.agents.list)) {
        configData.agents.list = configData.agents.list.map((agent: any) => ({
          ...agent,
          model: aiConfig.model,
          isBonded: true
        }));
      }
      return c.json({ success: true as const, config: configData }, 200);
    }

    return c.json({ success: true as const, config: parsedResult.data }, 200);
  } catch (error) {
    console.error("Failed to load agents config", error);
    return c.json({ success: false as const, error: "Failed to load agents configuration" }, 500);
  }
});

app.put("/agents", async (c) => {
  try {
    const body: unknown = await c.req.json();
    const parsedBody = AgentsConfigSchema.safeParse(body);

    if (!parsedBody.success) {
      return c.json({ success: false as const, error: "Invalid agents configuration payload" }, 400);
    }

    const aiConfig = loadAIConfig();
    const isModelBonded = aiConfig.bonded.includes("AI_MODEL");

    // Prevent saving if model is bonded and changed? 
    // Actually the frontend will disable it, but for safety:
    if (isModelBonded) {
      // We don't want to save the bonded model into agents.json5
      // because the env var should remain the source of truth.
      // However, we should keep the JSON clean.
    }

    const configPath = getAgentsConfigPath();
    fs.writeFileSync(configPath, JSON.stringify(parsedBody.data, null, 2), "utf8");

    return c.json({ success: true as const, config: parsedBody.data }, 200);
  } catch (error) {
    console.error("Failed to save agents config", error);
    return c.json({ success: false as const, error: "Failed to save agents configuration" }, 500);
  }
});

app.get("/ai-status", (c) => {
  try {
    const aiConfig = loadAIConfig();
    const validation = validateAIConfig();

    return c.json(
      {
        success: true as const,
        enabled: aiConfig.enabled,
        model: aiConfig.model,
        apiBase: aiConfig.apiBase,
        temperature: aiConfig.temperature,
        maxTokens: aiConfig.maxTokens,
        timeout: aiConfig.timeout,
        apiKeyMasked: getMaskedApiKey(),
        valid: validation.valid,
        validationError: validation.error,
        bonded: aiConfig.bonded, // Expose bonded vars
      },
      200,
    );
  } catch (error) {
    console.error("Failed to load AI status", error);
    return c.json({ success: false as const, error: "Failed to load AI status" }, 500);
  }
});

app.get("/filter-presets", (c) => {
  try {
    const presets = filterPresetService.listPresets();
    const categories = filterPresetService.listCategories();
    return c.json({ success: true as const, presets, categories }, 200);
  } catch (error) {
    console.error("Failed to load filter presets", error);
    return c.json({ success: false as const, error: "Failed to load filter presets" }, 500);
  }
});

app.put("/filter-presets", async (c) => {
  try {
    const body: unknown = await c.req.json();
    const parsedBody = FilterPresetsConfigSchema.safeParse(body);

    if (!parsedBody.success) {
      return c.json({ success: false as const, error: "Invalid filter presets payload" }, 400);
    }

    filterPresetService.saveConfig(parsedBody.data);
    return c.json({ success: true as const, config: parsedBody.data }, 200);
  } catch (error) {
    console.error("Failed to save filter presets", error);
    return c.json({ success: false as const, error: "Failed to save filter presets" }, 500);
  }
});

app.put("/filter-presets/:id", async (c) => {
  try {
    const id = c.req.param("id");
    const body: unknown = await c.req.json();
    const parsedBody = FilterPresetUpdateSchema.safeParse(body);

    if (!parsedBody.success) {
      return c.json({ success: false as const, error: "Invalid filter preset update payload" }, 400);
    }

    const updatedPreset = filterPresetService.updatePreset(id, parsedBody.data);

    if (!updatedPreset) {
      return c.json({ success: false as const, error: `Preset not found: ${id}` }, 404);
    }

    return c.json({ success: true as const, preset: updatedPreset }, 200);
  } catch (error) {
    console.error("Failed to update filter preset", error);
    return c.json({ success: false as const, error: "Failed to update filter preset" }, 500);
  }
});

app.post("/filter-presets", async (c) => {
  try {
    const body: unknown = await c.req.json();
    const parsedBody = FilterPresetSchema.safeParse(body);

    if (!parsedBody.success) {
      return c.json({ success: false as const, error: "Invalid filter preset payload" }, 400);
    }

    const existingPreset = filterPresetService.getPreset(parsedBody.data.id);
    if (existingPreset) {
      return c.json({ success: false as const, error: `Preset already exists: ${parsedBody.data.id}` }, 409);
    }

    filterPresetService.addPreset(parsedBody.data);
    return c.json({ success: true as const, preset: parsedBody.data }, 201);
  } catch (error) {
    console.error("Failed to add filter preset", error);
    return c.json({ success: false as const, error: "Failed to add filter preset" }, 500);
  }
});

app.delete("/filter-presets/:id", (c) => {
  try {
    const id = c.req.param("id");
    const deleted = filterPresetService.deletePreset(id);

    if (!deleted) {
      return c.json({ success: false as const, error: `Preset not found: ${id}` }, 404);
    }

    return c.json({ success: true as const }, 200);
  } catch (error) {
    console.error("Failed to delete filter preset", error);
    return c.json({ success: false as const, error: "Failed to delete filter preset" }, 500);
  }
});

export default app;
