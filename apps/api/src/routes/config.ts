import fs from "node:fs";
import path from "node:path";
import { OpenAPIHono, z } from "@hono/zod-openapi";
import JSON5 from "json5";
import { findProjectRoot } from "../services/db.js";
import { customKeywordService } from "../services/custom-keyword-service.js";
import { getMaskedApiKey, loadAIConfig, validateAIConfig } from "../services/ai-config.js";

const app = new OpenAPIHono();

const AgentsConfigSchema = z.record(z.unknown());
const CustomKeywordTagSchema = z.object({
  id: z.string(),
  keyword: z.string(),
  english: z.string().optional(),
  category: z.string(),
});
const CustomKeywordCategorySchema = z.object({
  id: z.string(),
  name: z.string(),
  icon: z.string().optional(),
});
const CustomKeywordsResponseSchema = z.object({
  success: z.literal(true),
  tags: z.array(CustomKeywordTagSchema),
  categories: z.array(CustomKeywordCategorySchema),
});
const CustomKeywordUpdateSchema = z.object({
  keyword: z.string().optional(),
  english: z.string().optional(),
  category: z.string().optional(),
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

app.get("/custom-keywords", (c) => {
  try {
    const tags = customKeywordService.listTags();
    const categories = customKeywordService.listCategories();
    const response = CustomKeywordsResponseSchema.parse({
      success: true as const,
      tags,
      categories,
    });
    return c.json(response, 200);
  } catch (error) {
    console.error("Failed to load custom keywords", error);
    return c.json({ success: false as const, error: "Failed to load custom keywords" }, 500);
  }
});

app.post("/custom-keywords", async (c) => {
  try {
    const body: unknown = await c.req.json();
    const parsedBody = CustomKeywordTagSchema.safeParse(body);

    if (!parsedBody.success) {
      return c.json({ success: false as const, error: "Invalid custom keyword payload" }, 400);
    }

    const existingTag = customKeywordService.getTag(parsedBody.data.id);
    if (existingTag) {
      return c.json({ success: false as const, error: `Tag already exists: ${parsedBody.data.id}` }, 409);
    }

    customKeywordService.addTag(parsedBody.data);
    return c.json({ success: true as const, tag: parsedBody.data }, 201);
  } catch (error) {
    console.error("Failed to add custom keyword", error);
    return c.json({ success: false as const, error: "Failed to add custom keyword" }, 500);
  }
});

app.put("/custom-keywords/:id", async (c) => {
  try {
    const id = c.req.param("id");
    const body: unknown = await c.req.json();
    const parsedBody = CustomKeywordUpdateSchema.safeParse(body);

    if (!parsedBody.success) {
      return c.json({ success: false as const, error: "Invalid custom keyword update payload" }, 400);
    }

    const updatedTag = customKeywordService.updateTag(id, parsedBody.data);
    if (!updatedTag) {
      return c.json({ success: false as const, error: `Tag not found: ${id}` }, 404);
    }

    return c.json({ success: true as const, tag: updatedTag }, 200);
  } catch (error) {
    console.error("Failed to update custom keyword", error);
    return c.json({ success: false as const, error: "Failed to update custom keyword" }, 500);
  }
});

app.delete("/custom-keywords/:id", (c) => {
  try {
    const id = c.req.param("id");
    const deleted = customKeywordService.deleteTag(id);

    if (!deleted) {
      return c.json({ success: false as const, error: `Tag not found: ${id}` }, 404);
    }

    return c.json({ success: true as const }, 200);
  } catch (error) {
    console.error("Failed to delete custom keyword", error);
    return c.json({ success: false as const, error: "Failed to delete custom keyword" }, 500);
  }
});

export default app;
