#!/bin/bash
set -e

# Use --env-file flag for explicit env loading

ENV_FILE="${ENV_FILE:-.env}"

echo "Starting TrendRadar development environment..."
if [ -f "$ENV_FILE" ]; then
    echo "Using environment from: $ENV_FILE"
    uv run --env-file "$ENV_FILE" python -m trendradar
else
    echo "No $ENV_FILE found, using system environment"
    uv run python -m trendradar
fi
