#!/bin/bash
set -e
echo "Installing Python dependencies..."
uv sync

echo "Installing Node.js dependencies..."
if [ "${CI:-}" = "true" ]; then
    npm install
elif command -v bun &> /dev/null; then
    bun install
else
    npm install
fi
echo "Done!"
