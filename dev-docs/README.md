# Dev Documentation

Auto-fetched documentation from upstream sources (kept in-repo for quick reference and LLM context).

## Fetch latest docs
```bash
make fetch-docs
# or: ./dev-docs/fetch-docs.sh
```

## Included packages

- `trendradar` → `dev-docs/trendradar/llms.txt` (news crawler, config, report modes, MCP reference)
- `openclaw` → `dev-docs/openclaw/llms.txt` (Gateway control-plane architecture, Skills system, Plugin SDK)
- `openclaw_docs` → `dev-docs/openclaw_docs/llms.txt` (official docs site: install/onboarding, gateway ops, config examples)

## OpenClaw references (why they matter here)

For the Resume Screening system direction, we reuse several OpenClaw patterns:

- **Gateway (control plane)**: WebSocket orchestration, session state, and deterministic agent/binding routing
- **Skills**: workspace-local `SKILL.md` as “screening criteria” modules (scoring + tool usage)
- **Plugins**: channel/service plugin interfaces as inspiration for source plugins (job boards, email ingest, ATS webhooks)

### Quick grep helpers

```bash
# Skills + plugin patterns (inspiration for Resume Screening gateway design)
rg -n "## Skills System|## Plugin SDK" dev-docs/openclaw/llms.txt

# Ops/setup snippets (install/onboarding/config examples)
rg -n "onboard|gateway|\\$include|docker" dev-docs/openclaw_docs/llms.txt
```

## Add new packages

Edit `packages.yaml` and add entries.
