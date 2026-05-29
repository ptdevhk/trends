#!/bin/bash
# Sets up the preview environment at /home/ubuntu/trends-preview/
# Run from the production host (ptcloud) as root.
# Usage: bash deploy/setup-preview.sh
set -e

SRC=/opt/trends
DST=/home/ubuntu/trends-preview

echo "=== Trends Preview Setup ==="
echo "Source: $SRC"
echo "Destination: $DST"

# Create destination directory
mkdir -p "$DST"

# 1. Sync code from production (excludes heavy/runtime dirs)
echo "[1/6] Syncing code from production..."
rsync -a --delete \
    --exclude '.git' \
    --exclude 'node_modules' \
    --exclude '.venv' \
    --exclude '.cache' \
    --exclude 'output/*.db' \
    --exclude 'output/resume-backups' \
    --exclude 'output/resume-samples' \
    --exclude 'logs' \
    --exclude '.npm' \
    "$SRC/" "$DST/"

# Keep our config files (not overwritten by rsync since they don't exist in src)
mkdir -p "$DST/output"

# 2. Fix ownership
echo "[2/6] Setting ownership..."
chown -R ubuntu:ubuntu "$DST"

# 3. Install npm dependencies
echo "[3/6] Installing npm dependencies..."
cd "$DST"
sudo -u ubuntu npm install --no-audit --no-fund 2>&1 | tail -5

# 4. Rebuild native modules for the host Node.js version
echo "[4/6] Rebuilding native modules..."
sudo -u ubuntu npm rebuild better-sqlite3 2>&1 | tail -3

# 5. Build API
echo "[5/6] Building API..."
sudo -u ubuntu npm --workspace @trends/api run build 2>&1 | tail -5

# 6. Build Web
echo "[6/6] Building Web frontend..."
sudo -u ubuntu npm --workspace @trends/web run build 2>&1 | tail -5

echo ""
echo "=== Setup complete ==="
echo "Next steps:"
echo "  1. Copy .env.preview: cp deploy/env.preview $DST/.env.preview && vi $DST/.env.preview"
echo "  2. Start Docker services: cd $DST && docker compose -f docker-compose.preview.yml up -d"
echo "  3. Install API systemd service:"
echo "     cp deploy/systemd/trends-preview-api.service /etc/systemd/system/"
echo "     systemctl daemon-reload && systemctl enable --now trends-preview-api"
echo "  4. Reload Caddy (already configured): systemctl reload caddy"
echo ""
echo "  To update with prod DB: cp /opt/trends/output/resume_screening.db $DST/output/"
