# CPA (CLIProxyAPI) sample config — ptcloud deployment

Backup reference for the CPA installation on `ptcloud` (snapshot 2026-08-26;
**live layout updated 2026-08-28**).

## Live layout (2026-08-28)

Official installer path. Upgrade:

```bash
ssh ptcloud
cliproxyapi-installer upgrade
```

- Tree: `/home/ubuntu/cliproxyapi` (CPA 7.2.144), process user `ubuntu`
- Service: `systemctl --user cliproxyapi.service` + linger (not a system unit)
- Auth dir: `/home/ubuntu/.cli-proxy-api`
- Runbook: `{REPO_ROOT}/docs/runbooks/ptcloud-cpa.md` and host
  `/home/ubuntu/cliproxyapi/UPGRADE-RUNBOOK.md`

Do **not** recreate `/etc/systemd/system/cliproxyapi.service`.

## Files in this directory

- `config.yaml` — snapshot of the 2026-08-26 `/root/cliproxyapi/config.yaml`
  (CPA 7.2.142) with secrets redacted to `__FILL_ME__`. Live secrets live ONLY
  in `~/.secrets/com.trends.app.env` (`CPA_ADMIN_PASSWORD`, `CPA_API_KEY_1`,
  `POE_API_KEY`). Live config is now `/home/ubuntu/cliproxyapi/config.yaml`.
- `caddy-cpa-root.crt` — Caddy local root CA (`CN=Caddy Local Authority - 2026 ECC Root`) from `/var/lib/caddy/.local/share/caddy/pki/authorities/local/root.crt`. Needed to make browsers (e.g. orca) trust `https://cpa.pt-mes.com/` without a warning (install via `security add-trusted-cert`).

## Key config facts

- Listens on `:8317`. Caddy vhost: `cpa.pt-mes.com { tls internal; reverse_proxy 127.0.0.1:8317 }` — no public DNS; resolve via local hosts (`217.217.255.28 cpa.pt-mes.com`).
- `remote-management.allow-remote: true`; admin password = `remote-management.secret-key` (hashed by CPA on startup).
- `usage-statistics-enabled: true`.
- `plugins.enabled: true` (keeper plugin loaded from `plugins/linux/amd64/`).
- OpenAI-compatible provider `poe-lite-dd`: base `https://api.poe.com/v1`, `POE_API_KEY` as credential, models `python` / `deepseek-v4-flash` / `gemini-2.5-flash-lite` / `deepseek-v4-flash-e`, `prefix: dd`, `priority: 1`.

Original install record: `{WIKI_VAULT}/raw/transcripts/2026-08-26-cpa-deploy-trends-ptcloud-ai-routing.md`.
Official-layout migration: `{WIKI_VAULT}/projects/trends/work/2026-08-28-cpa-official-upgrade-helper/`.
