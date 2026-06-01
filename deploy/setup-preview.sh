#!/bin/bash
# Sets up the preview environment at /home/ubuntu/trends-preview/ from origin/main.
# Run on ptcloud as root.  Usage: bash deploy/setup-preview.sh
#
# IMPORTANT: This pulls from origin/main, NOT /opt/trends. Production might be
# weeks behind main. Preview should always reflect the bleeding-edge code.
set -e

REPO_HEAD=/home/ubuntu/trends                # mirror of origin/main, fetched fresh each run
DST=/home/ubuntu/trends-preview
TS=$(date +%Y%m%d-%H%M%S)

echo "=== Trends Preview Setup ==="
echo "Source: $REPO_HEAD (will be reset to origin/main)"
echo "Destination: $DST"

# 1. Update mirror to latest origin/main
if [ ! -d "$REPO_HEAD/.git" ]; then
    echo "[1/7] Cloning trends repo to $REPO_HEAD"
    sudo -u ubuntu git clone https://github.com/ptdevhk/trends.git "$REPO_HEAD"
else
    echo "[1/7] Resetting $REPO_HEAD to origin/main"
    sudo -u ubuntu git -C "$REPO_HEAD" fetch origin main
    sudo -u ubuntu git -C "$REPO_HEAD" reset --hard origin/main
fi
sudo -u ubuntu git -C "$REPO_HEAD" log -1 --oneline

# 2. Backup any existing preview env (do not lose secrets)
if [ -f "$DST/.env.preview" ]; then
    echo "[2/7] Backing up existing .env.preview to /tmp/preview-env-$TS.env"
    cp "$DST/.env.preview" "/tmp/preview-env-$TS.env"
fi
if [ -d "$DST" ]; then
    echo "[2/7] Moving existing $DST to $DST.bak.$TS"
    mv "$DST" "$DST.bak.$TS"
fi

# 3. Sync code (excluding heavy/runtime dirs)
echo "[3/7] Syncing fresh code from $REPO_HEAD..."
sudo -u ubuntu mkdir -p "$DST"
sudo -u ubuntu rsync -a --delete \
    --exclude '.git' --exclude 'node_modules' --exclude '.venv' \
    --exclude '.cache' --exclude 'output/*.db' --exclude 'logs' \
    "$REPO_HEAD/" "$DST/"

# 4. Place compose + start script at the project root for convenience
echo "[4/7] Copying compose + start script to project root..."
sudo -u ubuntu cp "$DST/deploy/docker/docker-compose.preview.yml" "$DST/"
sudo -u ubuntu cp "$DST/deploy/docker/start-convex.sh" "$DST/"
sudo -u ubuntu chmod +x "$DST/start-convex.sh"

# 5. Restore .env.preview (or create from template)
if [ -f "/tmp/preview-env-$TS.env" ]; then
    echo "[5/7] Restoring backed-up .env.preview"
    cp "/tmp/preview-env-$TS.env" "$DST/.env.preview"
elif [ -f "$REPO_HEAD/deploy/env.preview" ]; then
    echo "[5/7] No existing .env.preview — copying from template (EDIT IT)"
    cp "$REPO_HEAD/deploy/env.preview" "$DST/.env.preview"
fi
# Must run as root (not sudo -u ubuntu) because the file may be root-owned from cp above
chown ubuntu:ubuntu "$DST/.env.preview"

# 6. Install dependencies + rebuild native modules for the host Node
echo "[6/7] Installing npm dependencies..."
sudo -u ubuntu bash -c "cd '$DST' && npm install --no-audit --no-fund 2>&1 | tail -3"
echo "[6/7] Rebuilding better-sqlite3 for host Node version..."
sudo -u ubuntu bash -c "cd '$DST' && npm rebuild better-sqlite3 2>&1 | tail -3"

# 7. Build (web only — API runs via tsx, see deploy/systemd/trends-preview-api.service)
# Vite bakes import.meta.env.VITE_* values into the bundle at BUILD time, not runtime.
# Without this file, the web bundle prints "Warning: VITE_CONVEX_URL not set in .env"
# and Convex queries via useMutation/useQuery fail with "Could not find Convex client!".
echo "[7/7] Setting apps/web/.env.local for preview build..."
sudo -u ubuntu tee "$DST/apps/web/.env.local" >/dev/null <<EOF
VITE_CONVEX_URL=https://preview.pt-mes.com/convex
EOF

echo "[7/7] Building shared + web..."
sudo -u ubuntu bash -c "cd '$DST' && npm --workspace @trends/shared run build 2>&1 | tail -2"
sudo -u ubuntu bash -c "cd '$DST' && npm --workspace @trends/web run build 2>&1 | tail -3"

echo ""
echo "=== Setup complete ==="
echo "Next steps:"
echo "  1. Verify .env.preview has secrets: vi $DST/.env.preview"
echo "  2. Start Docker services: cd $DST && docker compose -f docker-compose.preview.yml up -d"
echo "  3. Restart preview API systemd: systemctl restart trends-preview-api"
echo "  4. (Optional) Restore prod data: bash deploy/restore-preview-from-prod.sh"
echo ""
echo "  Smoke check: curl https://preview.pt-mes.com/api/blocks → 200"
