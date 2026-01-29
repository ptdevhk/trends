#!/bin/bash
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CONFIG="$SCRIPT_DIR/packages.yaml"
echo "Fetching documentation packages..."

get_packages() {
    if command -v yq &> /dev/null; then
        yq -r '.packages[] | "\(.name)|\(.source)|\(.tokens)|\(.output)"' "$CONFIG"
        return
    fi

    # Fallback without yq (simple YAML subset parser)
    awk '
        $1 == "-" && $2 == "name:" { name=$3; source=""; tokens=""; output=""; next }
        $1 == "source:" { source=$2; next }
        $1 == "tokens:" { tokens=$2; next }
        $1 == "output:" { output=$2; if (name && source && tokens && output) print name "|" source "|" tokens "|" output; next }
    ' "$CONFIG"
}

get_packages | while IFS='|' read -r name source tokens output; do
    echo "  Fetching: $name"
    mkdir -p "$(dirname "$output")"
    if [[ "$source" == *"?"* ]]; then
        url="${source}&tokens=${tokens}"
    else
        url="${source}?tokens=${tokens}"
    fi
    curl -sL "$url" > "$output"
    echo "    → $output"
done
echo "Done!"
