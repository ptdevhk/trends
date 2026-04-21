#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
EXTENSION_DIR="$ROOT_DIR/apps/browser-extension"
MANIFEST_PATH="$EXTENSION_DIR/manifest.json"
OUTPUT_DIR="$ROOT_DIR/apps/web/public/extension"

VERSION="$(
  node -e "console.log(JSON.parse(require('fs').readFileSync('$MANIFEST_PATH','utf8')).version)"
)"

VERSIONED_FILENAME="trends-resume-collector-v${VERSION}.zip"
VERSIONED_ZIP_PATH="$OUTPUT_DIR/$VERSIONED_FILENAME"
LATEST_ZIP_PATH="$OUTPUT_DIR/trends-resume-collector-latest.zip"
METADATA_PATH="$OUTPUT_DIR/extension-meta.json"
UPDATED_AT="$(date -u +"%Y-%m-%dT%H:%M:%SZ")"

mkdir -p "$OUTPUT_DIR"
rm -f "$VERSIONED_ZIP_PATH" "$LATEST_ZIP_PATH"

(
  cd "$EXTENSION_DIR"
  npm run build
  test -f content.js || { echo "error: content.js missing after build" >&2; exit 1; }
  zip -r "$VERSIONED_ZIP_PATH" \
    manifest.json background.js content.js content-styles.css page-hook.js \
    seek-auto-sync-window.js \
    popup.html popup.js popup.css options.html options.js \
    offscreen.html offscreen.js icons/
)

ln -sf "$VERSIONED_FILENAME" "$LATEST_ZIP_PATH"

cat > "$METADATA_PATH" <<EOF
{
  "version": "$VERSION",
  "filename": "$VERSIONED_FILENAME",
  "updatedAt": "$UPDATED_AT"
}
EOF

echo "Built extension zip: $VERSIONED_ZIP_PATH"
echo "Updated latest alias: $LATEST_ZIP_PATH"
echo "Wrote metadata: $METADATA_PATH"
