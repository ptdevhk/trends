/**
 * AI Configuration
 *
 * Reads from process environment variables.
 * Values may come from the system environment or an explicitly provided env file
 * by the process runner (for example, bun --env-file in development).
 *
 * Environment variables:
 * - AI_ANALYSIS_ENABLED: Enable AI features (default: false)
 * - AI_MODEL: Model identifier in format provider/model (default: openai/gpt-4o-mini)
 * - AI_API_KEY: API key for the AI provider
 * - AI_API_BASE: Custom API base URL (e.g., https://api.poe.com/v1)
 * - AI_TEMPERATURE: Sampling temperature (default: 0.7)
 * - AI_MAX_TOKENS: Max tokens for response (default: 4000)
 * - AI_TIMEOUT: Request timeout in ms (default: 120000)
 */

export interface AIConfig {
    enabled: boolean;
    model: string;
    apiKey: string;
    apiBase?: string;
    temperature: number;
    maxTokens: number;
    timeout: number;
    bonded: string[]; // List of variables explicitly set in process environment
}

export function loadAIConfig(): AIConfig {
    const bonded: string[] = [];
    if (process.env.AI_ANALYSIS_ENABLED !== undefined) bonded.push("AI_ANALYSIS_ENABLED");
    if (process.env.AI_MODEL !== undefined) bonded.push("AI_MODEL");
    if (process.env.AI_API_KEY !== undefined) bonded.push("AI_API_KEY");
    if (process.env.AI_API_BASE !== undefined) bonded.push("AI_API_BASE");

    const enabled = process.env.AI_ANALYSIS_ENABLED === "true";
    const model = process.env.AI_MODEL || "openai/gpt-4o-mini";
    const apiKey = process.env.AI_API_KEY || "";
    const apiBase = process.env.AI_API_BASE || undefined;
    const temperature = parseFloat(process.env.AI_TEMPERATURE || "0.7");
    const maxTokens = parseInt(process.env.AI_MAX_TOKENS || "4000", 10);
    const timeout = parseInt(process.env.AI_TIMEOUT || "120000", 10);

    return {
        enabled,
        model,
        apiKey,
        apiBase,
        temperature,
        maxTokens,
        timeout,
        bonded,
    };
}

export const aiConfig = loadAIConfig();

/**
 * Validate AI configuration
 */
export function validateAIConfig(): { valid: boolean; error?: string } {
    if (!aiConfig.enabled) {
        return { valid: false, error: "AI analysis is disabled (AI_ANALYSIS_ENABLED=false)" };
    }

    if (!aiConfig.apiKey) {
        return { valid: false, error: "Missing AI_API_KEY environment variable" };
    }

    if (!aiConfig.model.includes("/")) {
        return { valid: false, error: `Invalid model format: ${aiConfig.model}. Should be 'provider/model' (e.g., 'openai/gpt-4o-mini')` };
    }

    return { valid: true };
}

/**
 * Get masked API key for logging
 */
export function getMaskedApiKey(): string {
    if (!aiConfig.apiKey || aiConfig.apiKey.length < 8) {
        return "******";
    }
    return `${aiConfig.apiKey.slice(0, 5)}******`;
}
