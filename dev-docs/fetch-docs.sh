#!/bin/bash
set -e
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CONFIG="$SCRIPT_DIR/packages.yaml"
echo "Fetching documentation packages..."
if command -v yq &> /dev/null; then
    yq -r '.packages[] | "\(.name)|\(.source)?tokens=\(.tokens)|\(.output)"' "$CONFIG" | while IFS='|' read -r name url output; do
        echo "  Fetching: $name"
        mkdir -p "$(dirname "$output")"
        curl -sL "$url" > "$output"
        echo "    → $output"
    done
else
    # Fallback without yq
    curl -sL "https://context7.com/sansan0/trendradar/llms.txt?tokens=10000" > dev-docs/trendradar/llms.txt
fi
echo "Done!"
