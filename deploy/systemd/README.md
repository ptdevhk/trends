# Trends Systemd Services

Native Linux deployment for the full Trends stack on Ubuntu 24.04.

## Services

| Service | Type | Port | Description |
|---------|------|------|-------------|
| `trends-api.service` | simple | 3000 | Hono BFF API |
| `trends-worker.service` | simple | - | FastAPI scheduler worker |
| `trends-worker-api.service` | simple | 8000 | FastAPI REST API for worker triggers/status |
| `trends-mcp.service` | simple | 3333 | MCP HTTP server |
| `trends-crawler.service` | oneshot | - | News crawler run |
| `trends-crawler.timer` | timer | - | Runs crawler every 30 minutes |

## Install / Upgrade / Uninstall

```bash
# Initial install
sudo ./scripts/install.sh install

# Pull latest code + rebuild + restart services
sudo ./scripts/install.sh upgrade

# Remove installed systemd units
sudo ./scripts/install.sh uninstall
```

Equivalent Make targets:

```bash
make install
make deploy
make uninstall
```

## Runtime Paths

```text
/opt/trends                 # Git checkout and runtime working directory
/etc/trends/env             # Environment file loaded by all services
/etc/systemd/system/        # Installed unit files
```

## Caddy Recommendation

Add this block to `/etc/caddy/Caddyfile`:

```caddyfile
trends.pt-mes.com {
    tls leotse@datadigitalisation.com
    encode gzip

    root * /opt/trends/apps/web/dist
    try_files {path} /index.html
    file_server

    handle /api/* {
        reverse_proxy 127.0.0.1:3000
    }

    handle /mcp/* {
        reverse_proxy 127.0.0.1:3333
    }
}
```

Then reload Caddy:

```bash
sudo systemctl reload caddy
```

## Management Commands

```bash
# Start all production services
sudo systemctl start trends-api trends-worker trends-worker-api trends-mcp trends-crawler.timer

# Check status
systemctl status trends-api trends-worker trends-worker-api trends-mcp trends-crawler.timer

# Run crawler immediately
sudo systemctl start trends-crawler.service

# Logs
journalctl -u trends-api -f
journalctl -u trends-worker -f
journalctl -u trends-worker-api -f
journalctl -u trends-mcp -f
journalctl -u trends-crawler -f
```
