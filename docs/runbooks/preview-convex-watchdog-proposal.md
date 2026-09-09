# Preview Convex Watchdog — systemd timer (INSTALLED 2026-09-09)

> **Status: INSTALLED on ptcloud 2026-09-09.** Source: `docs/runbooks/preview-convex-watchdog-proposal.md`.
> Auto-recovers `trends-preview-convex` within ~5 minutes if its local backend
> dies (child-process OOM, wedge, port 3210 not bound).

## Purpose
Closes the 14-hour outage gap from the 2026-09-08 incident (convex local backend
OOM-killed at 12.3 GiB / 12 GiB cap; docker `restart: unless-stopped` could not
recover a child-process OOM; Convex CLI wedged with no live WS client).

## Install verification
```bash
systemctl list-timers --no-pager | grep convex
# trends-preview-convex-watchdog.timer  ·  active · every 5 min
sudo journalctl -u trends-preview-convex-watchdog --since "2 minutes ago"
# [INFO] POST http://127.0.0.1:4210/api/query ok
```

## Unit files (installed at /etc/systemd/system/)

### `trends-preview-convex-watchdog.service`
```ini
[Unit]
Description=Preview Convex watchdog (restart if backend probe fails)
After=docker.service
Wants=docker.service

[Service]
Type=oneshot
User=root
WorkingDirectory=/home/ubuntu/trends-preview
ExecStart=/usr/bin/env bash deploy/preview-convex-restart.sh --recover
# 10 min hard stop; script itself waits up to 180s on recovery
TimeoutStartSec=600
```

### `trends-preview-convex-watchdog.timer`
```ini
[Unit]
Description=Run preview convex watchdog every 5 minutes

[Timer]
OnBootSec=2min
OnUnitActiveSec=5min
Persistent=true

[Install]
WantedBy=timers.target
```

## Safety
- Runs `deploy/preview-convex-restart.sh --recover` which refuses production
  Convex (`:3210`) and any container whose name lacks `preview`.
- Only restarts the container after a probe failure (`POST /api/query` on 4210),
  then waits up to 180s for `/version` = 200.
- Uses `sudo -n docker` (ubuntu has NOPASSWD) or root directly; never `pkill`.
