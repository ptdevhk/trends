# SSH Server Inspector

Inspect a remote Ubuntu server over SSH to validate and troubleshoot deployments (especially Caddy reverse proxy). Use when you need OS/disk/memory info, listening ports, key folders, and Caddy service status/config/logs for a host alias like "ptcloud" or "root@ptcloud".

## How to run

Run the inspector script with the SSH target (host alias or `user@host`):

```bash
~/.codex/skills/ssh-server-inspector/scripts/inspect_host.sh <ssh_target> [options]
```

Options:
- `--ports <csv>` — Comma-separated ports to highlight (e.g. 80,443,3000)
- `--paths <csv>` — Comma-separated absolute paths to list (default: /etc/caddy,/var/www,/srv,/opt)
- `--out <file>` — Output file path (default: `logs/ssh-inspector/<target>-<timestamp>.txt`)
- `--interactive` — Allow interactive SSH auth (disables BatchMode)

Examples:
```bash
~/.codex/skills/ssh-server-inspector/scripts/inspect_host.sh ptcloud
~/.codex/skills/ssh-server-inspector/scripts/inspect_host.sh root@ptcloud --ports 80,443,3000 --paths /etc/caddy,/var/www
```

## How to use the report

After running the script, read the generated report file and analyze:

- **Ports**: Confirm `:80/:443` are owned by Caddy; upstream app ports should generally bind to `127.0.0.1` (not `0.0.0.0`) unless you explicitly want public access.
- **Caddy**: Look for route mismatches, upstream connection errors, and TLS issuance errors in `systemctl status caddy` and `journalctl -u caddy`.
- **Folders**: Verify the expected web root (e.g. `/var/www/...`) exists and permissions/ownership look correct.
- **Docker**: Check running containers, port mappings, and status.

## Safety rules

- Run only read-only inspection commands by default.
- Do not restart services, edit Caddy configs, change firewall rules, or install packages unless explicitly asked.
- If SSH fails (unknown host key / auth / network), ask the user to run the script locally and paste the report.
