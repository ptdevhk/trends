#!/bin/bash
# Restore production data into preview Convex via Convex export/import API.
# Run on ptcloud as root.
#
# This is the CORRECT way to copy data between Convex deployments.
# DO NOT use raw SQLite file copy — binary version mismatch breaks schema push.
set -e

EXPORT_PATH=/tmp/prod-convex-export.zip
PREVIEW_DIR=/home/ubuntu/trends-preview

echo "=== Step 1: Export production Convex data ==="
sudo -u trends bash -c "cd /opt/trends/packages/convex && \
    CONVEX_URL=http://127.0.0.1:3210 \
    npx convex export --path $EXPORT_PATH --include-file-storage"

ls -lh "$EXPORT_PATH"

echo ""
echo "=== Step 2: Copy export into preview workspace (Docker bind mount) ==="
cp "$EXPORT_PATH" "$PREVIEW_DIR/prod-convex-export.zip"
chown ubuntu:ubuntu "$PREVIEW_DIR/prod-convex-export.zip"

echo ""
echo "=== Step 3: Import into preview Convex ==="
# The preview Convex container needs the .env.local pointing at its own deployment.
# The deployment name comes from /app/packages/convex/.convex/local/default/config.json
DEPLOY_NAME=$(docker exec trends-preview-convex sh -c \
    'cat /app/packages/convex/.convex/local/default/config.json' \
    | python3 -c 'import json,sys; print(json.loads(sys.stdin.read())["deploymentName"])')

echo "Deployment name: $DEPLOY_NAME"

cat > "$PREVIEW_DIR/packages/convex/.env.local" <<EOF
CONVEX_DEPLOYMENT=anonymous:$DEPLOY_NAME
CONVEX_URL=http://127.0.0.1:3210
CONVEX_SITE_URL=http://127.0.0.1:3211
EOF

# Run import inside the container (where 127.0.0.1:3210 resolves to local backend)
docker exec trends-preview-convex bash -c "
    cd /app/packages/convex && \
    timeout 600 npx convex import --replace-all /app/prod-convex-export.zip --yes
"

echo ""
echo "=== Step 4: Restart API to pick up fresh data ==="
systemctl restart trends-preview-api
sleep 3

echo ""
echo "=== Verification ==="
echo -n "/api/blocks: " && curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:3002/api/blocks
echo -n "/api/search-profiles: " && curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:3002/api/search-profiles

echo ""
echo "=== Done ==="
echo "Visit https://preview.pt-mes.com/hr/resumes to verify"
