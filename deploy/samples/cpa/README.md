# CPA (CLIProxyAPI) sample config — ptcloud deployment

Backup reference for the CPA installation on `ptcloud` (2026-08-26).

## Files

- `config.yaml` — snapshot of `/root/cliproxyapi/config.yaml` (CPA 7.2.142) with secrets redacted to `__FILL_ME__`. Live secrets live ONLY in `~/.secrets/com.trends.app.env` (`CPA_ADMIN_PASSWORD`, `CPA_API_KEY_1`, `POE_API_KEY`).
- `caddy-cpa-root.crt` — Caddy local root CA (`CN=Caddy Local Authority - 2026 ECC Root`) from `/var/lib/caddy/.local/share/caddy/pki/authorities/local/root.crt`. Needed to make browsers (e.g. orca) trust `https://cpa.pt-mes.com/` without a warning (install via `security add-trusted-cert`).

## Key config facts

- Listens on `:8317`, managed by system-level systemd `cliproxyapi.service` (WorkingDirectory `/root/cliproxyapi`).
- `remote-management.allow-remote: true`; admin password = `remote-management.secret-key` (hashed by CPA on startup).
- `usage-statistics-enabled: true`.
- `plugins.enabled: true` (official plugin store reachable; `example` plugin config left as installer default).
- OpenAI-compatible provider `poe-lite-dd`: base `https://api.poe.com/v1`, `POE_API_KEY` as credential, models `python` / `deepseek-v4-flash` / `gemini-2.5-flash-lite` / `deepseek-v4-flash-e`, `prefix: dd`, `priority: 1`.
- Caddy vhost on ptcloud: `cpa.pt-mes.com { tls internal; reverse_proxy 127.0.0.1:8317 }` — no public DNS; resolve via local hosts (`217.217.255.28 cpa.pt-mes.com`).

See `{WIKI_VAULT}/raw/transcripts/2026-08-26-cpa-deploy-trends-ptcloud-ai-routing.md` for the full deployment record.
