# TrendRadar Systemd Services

Native Linux deployment using systemd for service management.

## Quick Setup

```bash
# Run the install script (recommended)
cd /path/to/trendradar
./scripts/install.sh --production
```

## Manual Installation

### 1. Create User

```bash
sudo useradd -r -s /bin/false -d /opt/trendradar trendradar
```

### 2. Install Application

```bash
sudo mkdir -p /opt/trendradar
sudo cp -r . /opt/trendradar/
sudo chown -R trendradar:trendradar /opt/trendradar
```

### 3. Install Dependencies

```bash
cd /opt/trendradar
sudo -u trendradar uv sync
```

### 4. Configure Environment

```bash
sudo cp .env.example /opt/trendradar/.env.production
sudo chmod 600 /opt/trendradar/.env.production
sudo chown trendradar:trendradar /opt/trendradar/.env.production
# Edit with your secrets
sudo nano /opt/trendradar/.env.production
```

### 5. Install Services

```bash
# Copy service files
sudo cp deploy/systemd/trendradar.service /etc/systemd/system/
sudo cp deploy/systemd/trendradar.timer /etc/systemd/system/
sudo cp deploy/systemd/trendradar-mcp.service /etc/systemd/system/

# Reload systemd
sudo systemctl daemon-reload
```

### 6. Enable and Start

```bash
# Crawler (scheduled via timer)
sudo systemctl enable trendradar.timer
sudo systemctl start trendradar.timer

# MCP Server (always running)
sudo systemctl enable trendradar-mcp
sudo systemctl start trendradar-mcp
```

## Service Files

| File | Purpose |
|------|---------|
| `trendradar.service` | One-shot crawler service |
| `trendradar.timer` | Hourly schedule for crawler |
| `trendradar-mcp.service` | Long-running MCP server |

## Commands

```bash
# Check service status
sudo systemctl status trendradar
sudo systemctl status trendradar-mcp

# View logs
journalctl -u trendradar -f
journalctl -u trendradar-mcp -f

# Manual run (crawler)
sudo systemctl start trendradar

# Restart MCP server
sudo systemctl restart trendradar-mcp

# Check timer schedule
systemctl list-timers --all | grep trendradar
```

## Customization

### Change Schedule

Edit the timer file:

```bash
sudo systemctl edit trendradar.timer
```

Add override:

```ini
[Timer]
OnCalendar=*:00,30:00  # Every 30 minutes
```

### Change MCP Port

```bash
sudo systemctl edit trendradar-mcp
```

Add override:

```ini
[Service]
Environment=MCP_PORT=8080
ExecStart=
ExecStart=/usr/bin/uv run python -m mcp_server.server --transport http --port 8080
```

## Uninstall

```bash
sudo systemctl stop trendradar.timer trendradar-mcp
sudo systemctl disable trendradar.timer trendradar-mcp
sudo rm /etc/systemd/system/trendradar.service
sudo rm /etc/systemd/system/trendradar.timer
sudo rm /etc/systemd/system/trendradar-mcp.service
sudo systemctl daemon-reload
sudo userdel trendradar
sudo rm -rf /opt/trendradar
```
