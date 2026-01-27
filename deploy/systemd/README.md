# TrendRadar Systemd Services

Native Linux deployment using systemd for production servers.

## Services

| Service | Type | Description |
|---------|------|-------------|
| `trendradar.service` | oneshot | News crawler (runs via timer) |
| `trendradar.timer` | timer | Triggers crawler every 30 minutes |
| `trendradar-mcp.service` | simple | MCP HTTP server (port 3333) |

## Quick Install

```bash
# From project root
sudo ./scripts/install.sh
```

## Manual Installation

### 1. Create system user

```bash
sudo useradd -r -s /sbin/nologin -d /opt/trendradar trendradar
```

### 2. Install application

```bash
sudo mkdir -p /opt/trendradar
sudo cp -r . /opt/trendradar/
sudo chown -R trendradar:trendradar /opt/trendradar

# Create virtual environment
cd /opt/trendradar
sudo -u trendradar python3 -m venv .venv
sudo -u trendradar .venv/bin/pip install -r requirements.txt
```

### 3. Configure environment

```bash
sudo mkdir -p /etc/trendradar
sudo cp .env.example /etc/trendradar/env
sudo chmod 600 /etc/trendradar/env
sudo chown trendradar:trendradar /etc/trendradar/env

# Edit configuration
sudo nano /etc/trendradar/env
```

### 4. Install systemd units

```bash
sudo cp deploy/systemd/*.service deploy/systemd/*.timer /etc/systemd/system/
sudo systemctl daemon-reload
```

### 5. Enable and start services

```bash
# Start crawler timer
sudo systemctl enable --now trendradar.timer

# Start MCP server (optional)
sudo systemctl enable --now trendradar-mcp.service
```

## Management Commands

```bash
# Check crawler timer status
systemctl status trendradar.timer
systemctl list-timers trendradar.timer

# Run crawler manually
sudo systemctl start trendradar.service

# View logs
journalctl -u trendradar -f
journalctl -u trendradar-mcp -f

# Restart MCP server
sudo systemctl restart trendradar-mcp

# Stop all services
sudo systemctl stop trendradar.timer trendradar-mcp
```

## Directory Structure

```
/opt/trendradar/           # Application root
├── .venv/                 # Python virtual environment
├── config/                # Configuration files
│   ├── config.yaml
│   └── frequency_words.txt
├── output/                # Generated output
│   ├── news/              # SQLite databases
│   ├── html/              # HTML reports
│   └── txt/               # Text snapshots
├── trendradar/            # Main application
└── mcp_server/            # MCP server

/etc/trendradar/           # System configuration
└── env                    # Environment variables
```

## Customizing Schedule

Edit the timer to change the crawl frequency:

```bash
sudo systemctl edit trendradar.timer
```

Add override:

```ini
[Timer]
OnCalendar=
OnCalendar=*:0/15
```

Common schedules:
- `*:0/15` - Every 15 minutes
- `*:0/30` - Every 30 minutes (default)
- `*-*-* *:00:00` - Every hour
- `*-*-* 9,12,18:00:00` - At 9am, 12pm, 6pm

## Troubleshooting

### Service fails to start

```bash
# Check logs
journalctl -u trendradar -n 50 --no-pager

# Test manually
sudo -u trendradar /opt/trendradar/.venv/bin/python -m trendradar
```

### Permission denied

```bash
# Fix ownership
sudo chown -R trendradar:trendradar /opt/trendradar
sudo chmod 755 /opt/trendradar
```

### MCP server port in use

```bash
# Check what's using port 3333
sudo ss -tlnp | grep 3333

# Change port in service override
sudo systemctl edit trendradar-mcp.service
```

Add:

```ini
[Service]
ExecStart=
ExecStart=/opt/trendradar/.venv/bin/python -m mcp_server.server --transport http --host 127.0.0.1 --port 3334
```
