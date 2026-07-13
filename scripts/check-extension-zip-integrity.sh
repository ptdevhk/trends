#!/usr/bin/env bash
set -euo pipefail

if [ "$#" -ne 3 ]; then
  echo "Usage: $0 <source-manifest> <extension-metadata> <archive-directory>" >&2
  exit 2
fi

MANIFEST_PATH="$1"
METADATA_PATH="$2"
OUTPUT_DIR="$3"

fail() {
  echo "Extension ZIP integrity check failed: $*" >&2
  exit 1
}

command -v node >/dev/null 2>&1 || fail "node is unavailable"
command -v unzip >/dev/null 2>&1 || fail "unzip is unavailable"
[ -f "$MANIFEST_PATH" ] || fail "source manifest is missing"
[ -f "$METADATA_PATH" ] || fail "extension metadata is missing"

SOURCE_VERSION="$(
  node -e '
    const fs = require("node:fs");
    const manifest = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
    if (typeof manifest.version !== "string" || manifest.version.length === 0) process.exit(1);
    process.stdout.write(manifest.version);
  ' "$MANIFEST_PATH" 2>/dev/null
)" || fail "source manifest has no valid version"

EXPECTED_FILENAME="trends-resume-collector-v${SOURCE_VERSION}.zip"
VERSIONED_ZIP_PATH="$OUTPUT_DIR/$EXPECTED_FILENAME"
LATEST_ZIP_PATH="$OUTPUT_DIR/trends-resume-collector-latest.zip"

if ! node -e '
  const fs = require("node:fs");
  const metadata = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
  if (metadata.version !== process.argv[2] || metadata.filename !== process.argv[3]) process.exit(1);
' "$METADATA_PATH" "$SOURCE_VERSION" "$EXPECTED_FILENAME" >/dev/null 2>&1; then
  fail "metadata does not match source manifest version $SOURCE_VERSION"
fi

validate_archive() {
  local label="$1"
  local archive_path="$2"
  local embedded_version

  [ -f "$archive_path" ] || fail "$label archive is missing: $archive_path"

  if ! unzip -tqq "$archive_path" >/dev/null 2>&1; then
    fail "$label archive is not a valid ZIP: $archive_path"
  fi

  if ! unzip -Z1 "$archive_path" 2>/dev/null | awk '$0 == "manifest.json" { found = 1 } END { exit !found }'; then
    fail "$label archive has no root manifest.json: $archive_path"
  fi

  if ! embedded_version="$(
    unzip -p "$archive_path" manifest.json 2>/dev/null |
      node -e '
        const fs = require("node:fs");
        const manifest = JSON.parse(fs.readFileSync(0, "utf8"));
        if (typeof manifest.version !== "string" || manifest.version.length === 0) process.exit(1);
        process.stdout.write(manifest.version);
      ' 2>/dev/null
  )"; then
    fail "$label archive manifest is invalid: $archive_path"
  fi

  if [ "$embedded_version" != "$SOURCE_VERSION" ]; then
    fail "$label archive embeds manifest version $embedded_version, expected $SOURCE_VERSION"
  fi
}

validate_archive "versioned" "$VERSIONED_ZIP_PATH"
validate_archive "latest" "$LATEST_ZIP_PATH"
