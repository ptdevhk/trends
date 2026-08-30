# ptcloud CLIProxyAPI (CPA) — official layout

Trends LLM routing on `ptcloud` goes through CLIProxyAPI. The live install
follows the official installer
([router-for-me/cliproxyapi-installer](https://github.com/router-for-me/cliproxyapi-installer)).

## Upgrade (whole command)

```bash
ssh ptcloud
cliproxyapi-installer upgrade
```

That is ubuntu, no `sudo`, no `HOME=/root`. The installer stops the **user**
unit, swaps the binary, preserves `config.yaml`, and restarts the user unit.

## Layout (2026-08-28)

| Item | Value |
|------|--------|
| Version | `7.2.144` |
| SSH user | `ubuntu` |
| Install tree | `/home/ubuntu/cliproxyapi` |
| Auth dir | `/home/ubuntu/.cli-proxy-api` |
| Service | `systemctl --user cliproxyapi.service` (enabled) |
| Linger | `loginctl enable-linger ubuntu` (required for logout + boot) |
| Installer | `/home/ubuntu/cliproxyapi-installer` → `/usr/local/bin/cliproxyapi-installer` |
| Listen | `:8317` (Caddy `cpa.pt-mes.com` → `127.0.0.1:8317`, `tls internal`) |
| Host runbook | `/home/ubuntu/cliproxyapi/UPGRADE-RUNBOOK.md` |

Trends BFF:

| Target | `AI_API_BASE` |
|--------|----------------|
| local `.env` | `https://cpa.pt-mes.com/v1` |
| ptcloud prod `/etc/trends/env` | `http://127.0.0.1:8317/v1` |
| ptcloud preview `.env.preview` | `http://127.0.0.1:8317/v1` |

`AI_API_KEY` is the CPA client key. Poe credentials stay in CPA config / `POE_API_KEY`.
Secrets live in `~/.secrets/com.trends.app.env` (never in the repo).
`cpa.pt-mes.com` has no public DNS — resolve via `/etc/hosts`
(`217.217.255.28 cpa.pt-mes.com`).

## Status / logs

```bash
cliproxyapi-installer status
systemctl --user status cliproxyapi.service
journalctl --user -u cliproxyapi.service -f
```

## Forbidden

- Recreate `/etc/systemd/system/cliproxyapi.service` (dual-bind on `:8317`)
- Run the installer as root (that targets `/root/cliproxyapi`)
- Disable linger for `ubuntu` (service dies on SSH logout)

Rollback snapshots from the 2026-08-28 home migration:
`/root/cliproxyapi.bak-pre-official-home-20260828T073247Z`.

Original install record (historical; layout superseded):
`{WIKI_VAULT}/raw/transcripts/2026-08-26-cpa-deploy-trends-ptcloud-ai-routing.md`.
Work item: `{WIKI_VAULT}/projects/trends/work/2026-08-28-cpa-official-upgrade-helper/`.
