#!/usr/bin/env bash
# Validate profile seed references the extension path and matches the manifest key.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
EXT_DIR="$(dirname "$SCRIPT_DIR")"
MANIFEST_PATH="$EXT_DIR/manifest.json"
SEED_PATH="$EXT_DIR/profile-seed/Preferences"
EXT_PATH="/root/workspace/apps/browser-extension"

PYTHON_BIN="${PYTHON:-}"
if [[ -z "$PYTHON_BIN" ]]; then
  if command -v python >/dev/null 2>&1; then
    PYTHON_BIN=python
  elif command -v python3 >/dev/null 2>&1; then
    PYTHON_BIN=python3
  else
    echo "Python not found. Install python3 to run this check." >&2
    exit 1
  fi
fi

"$PYTHON_BIN" - <<PY
import base64
import hashlib
import json
from pathlib import Path
import sys

manifest_path = Path(r"$MANIFEST_PATH")
seed_path = Path(r"$SEED_PATH")
ext_path = r"$EXT_PATH"

errors = []
if not manifest_path.exists():
    errors.append(f"manifest not found: {manifest_path}")
if not seed_path.exists():
    errors.append(f"profile seed not found: {seed_path}")

if errors:
    for err in errors:
        print("ERROR:", err)
    sys.exit(1)

with manifest_path.open() as f:
    manifest = json.load(f)
key = manifest.get("key")
if not key:
    print("ERROR: manifest.json missing 'key' field")
    sys.exit(1)

try:
    pubkey = base64.b64decode(key)
except Exception as exc:
    print("ERROR: failed to decode manifest key:", exc)
    sys.exit(1)

digest = hashlib.sha256(pubkey).digest()[:16]
alphabet = "abcdefghijklmnop"
expected_id = "".join(alphabet[b >> 4] + alphabet[b & 0xF] for b in digest)

with seed_path.open() as f:
    prefs = json.load(f)
settings = prefs.get("extensions", {}).get("settings", {})

entry = settings.get(expected_id)
if not entry:
    for cfg in settings.values():
        if cfg.get("path") == ext_path:
            entry = cfg
            break

if not entry:
    print("ERROR: extension entry not found in profile seed")
    print("Expected extension ID:", expected_id)
    sys.exit(1)

seed_path_value = entry.get("path")
if seed_path_value != ext_path:
    print("ERROR: profile seed path mismatch")
    print("Expected path:", ext_path)
    print("Found path:", seed_path_value)
    sys.exit(1)

print("OK: profile seed is valid")
print("Extension ID:", expected_id)
print("Extension path:", seed_path_value)
PY
