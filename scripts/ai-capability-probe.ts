/**
 * One-shot runner for the shipped chat-completion capability probe.
 * Usage: bunx tsx scripts/ai-capability-probe.ts [model]
 */
import { probeChatCompletionCapability, resolveChatCompletionModel } from "../packages/convex/convex/lib/ai_model.ts";

const model = process.argv[2] || process.env.AI_MODEL || "openai/deepseek-v4-flash";
const apiBase = process.env.AI_API_BASE || process.env.OPENAI_API_BASE || "https://api.poe.com/v1";
const apiKey = process.env.AI_API_KEY || process.env.OPENAI_API_KEY || "";
const stripped = resolveChatCompletionModel(apiBase, model);

async function main() {
    if (!apiKey) {
        console.log(JSON.stringify({
            ok: false,
            model,
            stripped,
            error: "AI_API_KEY / OPENAI_API_KEY is not set; live probe skipped",
        }));
        process.exit(2);
    }

    const result = await probeChatCompletionCapability({
        apiBase,
        apiKey,
        model: stripped,
    });

    console.log(JSON.stringify({
        ok: result.status >= 200 && result.status < 300,
        model,
        stripped,
        status: result.status,
        capability: result.capability,
        bodyPreview: result.body.slice(0, 400),
    }, null, 2));

    process.exit(result.capability === "full" && result.status >= 200 && result.status < 300 ? 0 : 1);
}

void main();
