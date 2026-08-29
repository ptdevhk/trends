#!/usr/bin/env bash
set -euo pipefail
if [[ "$OSTYPE" == "darwin"* ]]; then
  echo refuse-darwin
  exit 1
fi
