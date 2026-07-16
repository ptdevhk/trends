#!/bin/bash
# Sets up the preview environment at /home/ubuntu/trends-preview/ from origin/main.
# Run on the preview host as root.  Usage: bash deploy/setup-preview.sh
#
# IMPORTANT: This pulls from origin/main, NOT /opt/trends. Production might be
# weeks behind main. Preview should always reflect the bleeding-edge code.
#
# Preferred modern workflow (backup → clone prod version → data sync → upgrade):
#   docs/preview-upgrade-runbook.md
#   deploy/backup-prod-complete.sh
#   deploy/preview-clone-from-prod.sh   # pin preview app to production SHA
#   deploy/restore-preview-full-state-from-prod.sh
#   deploy/preview-upgrade.sh           # or: cd /home/ubuntu/trends-preview && make deploy
#
# Optional: SOURCE_REF=origin/main (default) when using preview-upgrade.sh instead.
set -e

REPO_HEAD=/home/ubuntu/trends                # mirror of origin/main, fetched fresh each run
DST=/home/ubuntu/trends-preview
TS=$(date +%Y%m%d-%H%M%S)

echo "=== Trends Preview Setup ==="
echo "Source: $REPO_HEAD (will be reset to origin/main)"
echo "Destination: $DST"

# 1. Update mirror to latest origin/main
if [ ! -d "$REPO_HEAD/.git" ]; then
    echo "[1/8] Cloning trends repo to $REPO_HEAD"
    sudo -u ubuntu git clone https://github.com/ptdevhk/trends.git "$REPO_HEAD"
else
    echo "[1/8] Resetting $REPO_HEAD to origin/main"
    sudo -u ubuntu git -C "$REPO_HEAD" fetch origin main
    sudo -u ubuntu git -C "$REPO_HEAD" reset --hard origin/main
fi
sudo -u ubuntu git -C "$REPO_HEAD" log -1 --oneline

# 2. Backup any existing preview env (do not lose secrets)
if [ -f "$DST/.env.preview" ]; then
    echo "[2/8] Backing up existing .env.preview to /tmp/preview-env-$TS.env"
    cp "$DST/.env.preview" "/tmp/preview-env-$TS.env"
fi
if [ -d "$DST" ]; then
    echo "[2/8] Moving existing $DST to $DST.bak.$TS"
    mv "$DST" "$DST.bak.$TS"
fi

# 3. Sync code (excluding heavy/runtime dirs)
echo "[3/8] Syncing fresh code from $REPO_HEAD..."
sudo -u ubuntu mkdir -p "$DST"
sudo -u ubuntu rsync -a --delete \
    --exclude '.git' --exclude 'node_modules' --exclude '.venv' \
    --exclude '.cache' --exclude 'output/*.db' --exclude 'logs' \
    "$REPO_HEAD/" "$DST/"

# 4. Place compose + start script at the project root for convenience
echo "[4/8] Copying compose + start script to project root..."
sudo -u ubuntu cp "$DST/deploy/docker/docker-compose.preview.yml" "$DST/"
sudo -u ubuntu cp "$DST/deploy/docker/start-convex.sh" "$DST/"
sudo -u ubuntu chmod +x "$DST/start-convex.sh"

# 5. Restore .env.preview (or create from template)
if [ -f "/tmp/preview-env-$TS.env" ]; then
    echo "[5/8] Restoring backed-up .env.preview"
    cp "/tmp/preview-env-$TS.env" "$DST/.env.preview"
elif [ -f "$REPO_HEAD/deploy/env.preview" ]; then
    echo "[5/8] No existing .env.preview — copying from template (EDIT IT)"
    cp "$REPO_HEAD/deploy/env.preview" "$DST/.env.preview"
fi
# Must run as root (not sudo -u ubuntu) because the file may be root-owned from cp above
chown ubuntu:ubuntu "$DST/.env.preview"
chmod 600 "$DST/.env.preview"

if [ -x "$DST/deploy/sync-preview-convex-env.sh" ]; then
    echo "[5/8] Hydrating missing preview AI env vars from production env"
    PREVIEW_DIR="$DST" "$DST/deploy/sync-preview-convex-env.sh" --hydrate-only
fi

# 6. Install dependencies + rebuild native modules for the host Node
echo "[6/8] Installing npm dependencies..."
sudo -u ubuntu bash -c "cd '$DST' && npm install --no-audit --no-fund 2>&1 | tail -3"
echo "[6/8] Rebuilding better-sqlite3 for host Node version..."
sudo -u ubuntu bash -c "cd '$DST' && npm rebuild better-sqlite3 2>&1 | tail -3"

# 6b. Build extension zip (gitignored — must be built before web so Vite copies it to dist/)
echo "[6b/8] Building browser extension zip..."
sudo -u ubuntu bash -c "cd '$DST' && bash scripts/build-extension-zip.sh 2>&1 | tail -3"

# 7. Build (web only — API runs via tsx, see deploy/systemd/trends-preview-api.service)
# Vite bakes import.meta.env.VITE_* values into the bundle at BUILD time, not runtime.
# Without this file, the web bundle prints "Warning: VITE_CONVEX_URL not set in .env"
# and Convex queries via useMutation/useQuery fail with "Could not find Convex client!".
echo "[7/8] Setting apps/web/.env.local for preview build..."
sudo -u ubuntu tee "$DST/apps/web/.env.local" >/dev/null <<EOF
VITE_CONVEX_URL=https://preview.pt-mes.com/convex
EOF

echo "[7/8] Building shared + web..."
sudo -u ubuntu bash -c "cd '$DST' && npm --workspace @trends/shared run build 2>&1 | tail -2"
sudo -u ubuntu bash -c "cd '$DST' && npm --workspace @trends/web run build 2>&1 | tail -3"

# 8. Seed bootstrap admin(s) — mirrors scripts/install.sh:seed_bootstrap_admins
echo "[8/8] Seeding bootstrap admin(s) (idempotent)..."
sudo -u ubuntu bash -c "
    set -a; source '$DST/.env.preview'; set +a
    if [ -z \"\${BOOTSTRAP_ADMIN_USERS:-}\" ]; then
        echo '  -> BOOTSTRAP_ADMIN_USERS unset; skipping'
        exit 0
    fi
    workspace=\"\${BOOTSTRAP_ADMIN_WORKSPACE:-dev}\"
    password_env=\"\${BOOTSTRAP_ADMIN_PASSWORD_ENV:-AUTH_BOOTSTRAP_PASSWORD}\"
    cd '$DST'
    failures=0
    IFS=',' read -ra users <<< \"\$BOOTSTRAP_ADMIN_USERS\"
    for u in \"\${users[@]}\"; do
        u=\"\$(echo \"\$u\" | sed 's/^[[:space:]]*//;s/[[:space:]]*\$//')\"
        [ -z \"\$u\" ] && continue
        echo \"  -> seeding admin '\$u' in workspace '\$workspace'\"
        if ! bunx tsx scripts/auth/manage-user.ts --username \"\$u\" --workspace \"\$workspace\" --role admin --password-env \"\$password_env\" --output agent; then
            echo \"  -> ERROR: failed to seed admin '\$u'. Deploy cannot continue without a usable admin account.\" >&2
            exit 1
        fi
    done
    echo 'Bootstrap admin seeding complete.'
"

echo ""
echo "=== Setup complete ==="
echo "Next steps:"
echo "  1. Verify .env.preview has secrets: vi $DST/.env.preview"
echo "  2. Start Docker services: cd $DST && docker compose -f docker-compose.preview.yml up -d"
echo "  3. Sync AI env to Convex: PREVIEW_DIR=$DST bash deploy/sync-preview-convex-env.sh"
echo "  4. Restart preview API systemd: systemctl restart trends-preview-api"
echo "  5. (Optional) Restore prod data: bash deploy/restore-preview-from-prod.sh"
echo ""
echo "  Smoke checks:"
echo "    curl https://preview.pt-mes.com/api/blocks -> 200"
echo "    # After API restart, verify admin login (replace password if different):"
echo "    curl -s -X POST https://preview.pt-mes.com/api/auth/login \\"
echo "      -H 'Content-Type: application/json' \\"
echo "      -d '{\"username\":\"admin\",\"password\":\"admin123\"}' | grep -q '\"success\":true && echo OK"
