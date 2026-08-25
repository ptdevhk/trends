# LLM API provider: Poe defaults + capability probe + fallback (former known bug closed 2026-08-25)

Live resume scoring does **not** go through the BFF `aiConfig` snapshot.
Gate A / Analyze All runs in **Convex**: `analysis_tasks.dispatch` →
`packages/convex/convex/analyze.ts` `callLLM`.

## Result (2026-08-25, bug confirmed fixed and model re-promoted)

| Item | Value |
|------|--------|
| Provider | Poe OpenAI-compatible chat completions (`AI_API_BASE=https://api.poe.com/v1`) |
| **Default / basic model (all basic services)** | `openai/deepseek-v4-flash` |
| Fallback | `openai/deepseek-v4-flash-e` |
| **Former known bug (closed)** | Poe `deepseek-v4-flash` rejected `response_format: { type: "json_object" }` with HTTP 400 `Invalid input` / `invalid_request_error` (observed 2026-08-17; caused Gate A `analyzed=0 / failed=10`). Fixed upstream: 2026-08-25 live probe returned 200 for `response_format`, `tools`, and `response_format`+`tools` combined. |
| Live probe (2026-08-25) | `deepseek-v4-flash`: 200, capability `full` (JSON + tool calls). `deepseek-v4-flash-e`: 200, capability `full`. |

Code tracker: `POE_DEEPSEEK_V4_FLASH_KNOWN_BUG` in
`packages/convex/convex/lib/ai_model.ts` (`status: closed`, `closed: "2026-08-25"`).

## Runtime change (no rebuild)

Convex `callLLM` reads provider + models **on every call** via
`resolveAnalyzeLlmRuntimeConfig()` (`process.env`). Changing only the API
process `.env` does **not** move Convex. Push keys with:

```bash
./scripts/sync-convex-env.sh
# or
npx convex env set AI_MODEL openai/deepseek-v4-flash
npx convex env set AI_FALLBACK_MODEL openai/deepseek-v4-flash-e
npx convex env set AI_API_BASE https://api.poe.com/v1
```

`scripts/sync-convex-env.sh` and `scripts/dev.sh` include `AI_FALLBACK_MODEL`.

The BFF `export const aiConfig = loadAIConfig()` is an **import-time snapshot**.
That path is not the Convex analyze caller.

## Env keys

| Key | Role | Default |
|-----|------|---------|
| `AI_API_BASE` | Provider base | Poe in local `.env`; Convex accessor falls back to `https://api.openai.com/v1` if unset |
| `AI_MODEL` | Primary `provider/model` | `openai/deepseek-v4-flash` |
| `AI_FALLBACK_MODEL` | Fallback when the primary model is unavailable | `openai/deepseek-v4-flash-e` |
| `AI_API_KEY` | Bearer token | required when AI enabled |

## Implementation map

- Classify + select + probe + (formerly known-bug) constant: `packages/convex/convex/lib/ai_model.ts`
- Call-time resolver: `packages/convex/convex/lib/analysis_config.ts` `resolveAnalyzeLlmRuntimeConfig`
- Analyze caller: `packages/convex/convex/analyze.ts` `callLLM` — try primary with `response_format`; on incomplete 400, retry fallback
- BFF names: `apps/api/src/services/ai-config.ts`
- Probe: `bunx tsx scripts/ai-capability-probe.ts [model]`

## Probe

```bash
set -a && source .env && set +a
bunx tsx scripts/ai-capability-probe.ts openai/deepseek-v4-flash
bunx tsx scripts/ai-capability-probe.ts openai/deepseek-v4-flash-e
```
