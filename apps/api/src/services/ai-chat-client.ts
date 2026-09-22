import { aiConfig, loadAIConfig } from "./ai-config.js";
import { getCachedAiRoutingSettings } from "./ai-routing-settings.js";

export type AIChatMessage = {
  role: string;
  content: string;
};

export function extractModelName(model: string): string {
  const parts = model.split("/");
  return parts.length > 1 ? parts.slice(1).join("/") : model;
}

/** Models that default to a reasoning/thinking pass and accept `enable_thinking:false`. */
const THINKING_DISABLED_MODELS = new Set(["deepseek-v4-flash", "deepseek-v4-flash-e"]);

export function shouldDisableThinking(model: string): boolean {
  return THINKING_DISABLED_MODELS.has(extractModelName(model).trim());
}

export async function callChatCompletion(args: {
  config?: ReturnType<typeof loadAIConfig>;
  maxTokens: number;
  messages: AIChatMessage[];
  model: string;
  temperature?: number;
}): Promise<string> {
  let config = args.config ?? loadAIConfig();
  // When no explicit config is passed, hot-merge operator-editable AI routing
  // settings (model/base) over the env snapshot so BFF AI paths pick up changes
  // without a restart. The key always stays from env.
  if (!args.config) {
    const settings = await getCachedAiRoutingSettings();
    if (settings) {
      config = {
        ...config,
        ...(settings.apiBase ? { apiBase: settings.apiBase } : {}),
        ...(settings.model ? { model: settings.model } : {}),
        ...(settings.fallbackModel ? { fallbackModel: settings.fallbackModel } : {}),
      };
    }
  }
  const baseUrl = config.apiBase || aiConfig.apiBase || "https://api.openai.com/v1";
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), config.timeout);
  const resolvedModel = extractModelName(args.model);

  try {
    const requestBody: Record<string, unknown> = {
      model: resolvedModel,
      messages: args.messages,
      temperature: args.temperature ?? 0,
      max_tokens: Math.min(config.maxTokens, args.maxTokens),
    };
    if (shouldDisableThinking(resolvedModel)) {
      requestBody.enable_thinking = false;
    }
    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify(requestBody),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      throw new Error(`AI request failed with status ${response.status}: ${await response.text()}`);
    }

    const payload = await response.json() as {
      choices?: Array<{ message?: { content?: string }; text?: string }>;
    };
    const content = payload.choices?.[0]?.message?.content ?? payload.choices?.[0]?.text;
    if (!content) {
      throw new Error("No content returned from AI provider");
    }

    return content;
  } catch (error) {
    clearTimeout(timeoutId);
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error(`AI request timed out after ${config.timeout}ms`);
    }
    throw error;
  }
}
