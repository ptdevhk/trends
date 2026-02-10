#!/usr/bin/env bash
set -euo pipefail

GITHUB_API="https://api.github.com/repos/get-convex/convex-backend/releases?per_page=100"

log() {
    echo "[convex-prefetch] $*"
}

is_windows() {
    case "$(uname -s)" in
        CYGWIN*|MINGW*|MSYS*) return 0 ;;
        *) return 1 ;;
    esac
}

cache_dir() {
    if is_windows; then
        if [ -n "${LOCALAPPDATA:-}" ]; then
            echo "${LOCALAPPDATA}/convex/binaries"
            return
        fi
        if [ -n "${USERPROFILE:-}" ]; then
            echo "${USERPROFILE}/AppData/Local/convex/binaries"
            return
        fi
        echo "${HOME}/AppData/Local/convex/binaries"
        return
    fi
    echo "${HOME}/.cache/convex/binaries"
}

detect_platform() {
    local os arch
    os="$(uname -s)"
    arch="$(uname -m)"

    case "$os-$arch" in
        Darwin-arm64|Darwin-aarch64)
            echo "convex-local-backend-aarch64-apple-darwin.zip|convex-local-backend"
            ;;
        Darwin-x86_64)
            echo "convex-local-backend-x86_64-apple-darwin.zip|convex-local-backend"
            ;;
        Linux-aarch64|Linux-arm64)
            echo "convex-local-backend-aarch64-unknown-linux-gnu.zip|convex-local-backend"
            ;;
        Linux-x86_64)
            echo "convex-local-backend-x86_64-unknown-linux-gnu.zip|convex-local-backend"
            ;;
        CYGWIN_NT*-x86_64|MINGW64_NT*-x86_64|MSYS_NT*-x86_64)
            echo "convex-local-backend-x86_64-pc-windows-msvc.zip|convex-local-backend.exe"
            ;;
        *)
            echo ""
            ;;
    esac
}

require_command() {
    if ! command -v "$1" >/dev/null 2>&1; then
        log "Required command '$1' not found. Skipping Convex backend prefetch."
        exit 0
    fi
}

main() {
    require_command curl
    require_command jq
    require_command unzip

    local target_info artifact_name binary_name release_info version url cache_root dest_dir binary_path tmp_zip
    target_info="$(detect_platform)"
    if [ -z "$target_info" ]; then
        log "Unsupported platform $(uname -s)/$(uname -m). Skipping."
        exit 0
    fi

    artifact_name="${target_info%%|*}"
    binary_name="${target_info##*|}"
    cache_root="$(cache_dir)"

    log "Prefetching Convex backend binary for asset: ${artifact_name}"

    release_info="$(curl -fsSL "$GITHUB_API" | jq -r --arg asset "$artifact_name" '
        map(select((.prerelease | not) and (.draft | not)))
        | map(select(any(.assets[]?; .name == $asset)))
        | .[0] // empty
        | [.tag_name, (.assets[] | select(.name == $asset) | .browser_download_url)]
        | @tsv
    ')"

    if [ -z "$release_info" ]; then
        log "Could not find a stable release with asset ${artifact_name}. Skipping."
        exit 0
    fi

    version="${release_info%%$'\t'*}"
    url="${release_info##*$'\t'}"
    dest_dir="${cache_root}/${version}"
    binary_path="${dest_dir}/${binary_name}"

    if [ -f "$binary_path" ]; then
        log "Already cached: ${binary_path}"
        exit 0
    fi

    mkdir -p "$dest_dir"
    tmp_zip="$(mktemp "${TMPDIR:-/tmp}/convex-backend.XXXXXX.zip")"
    trap 'rm -f "$tmp_zip"' EXIT

    curl -fL --retry 3 --retry-delay 2 -o "$tmp_zip" "$url"
    unzip -o -q "$tmp_zip" -d "$dest_dir"

    if [ ! -f "$binary_path" ]; then
        log "Archive did not contain expected file: ${binary_name}"
        exit 1
    fi

    if ! is_windows; then
        chmod +x "$binary_path"
    fi

    log "Cached: ${binary_path}"
}

main "$@"
