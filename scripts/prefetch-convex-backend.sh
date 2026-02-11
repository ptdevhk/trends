#!/usr/bin/env bash
set -euo pipefail

GITHUB_API="https://api.github.com/repos/get-convex/convex-backend/releases?per_page=100"
DEFAULT_MIRROR_BASES="https://ghproxy.net,https://gh.ddlc.top"
DEFAULT_DOWNLOAD_TIMEOUT_SECS="240"
DEFAULT_CONNECT_TIMEOUT_SECS="10"
DASHBOARD_ASSET_NAME="dashboard.zip"
DEFAULT_DASHBOARD_PORT="6790"
DEFAULT_DASHBOARD_API_PORT="6791"

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
        log "Required command '$1' not found. Skipping Convex prefetch."
        exit 0
    fi
}

trim() {
    echo "$1" | sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//'
}

effective_mirror_mode() {
    if [ -n "${CONVEX_MIRROR_MODE:-}" ]; then
        echo "${CONVEX_MIRROR_MODE}"
        return
    fi
    if [ "${CI:-}" = "true" ]; then
        echo "off"
        return
    fi
    echo "fallback"
}

validate_mirror_mode() {
    case "$1" in
        fallback|mirror-first|off) ;;
        *)
            log "Invalid CONVEX_MIRROR_MODE='$1'. Expected one of: fallback, mirror-first, off."
            exit 1
            ;;
    esac
}

validate_positive_integer() {
    local value="$1"
    local name="$2"
    if ! [[ "$value" =~ ^[0-9]+$ ]] || [ "$value" -le 0 ]; then
        log "Invalid ${name}='${value}'. Expected a positive integer."
        exit 1
    fi
}

hash_tool() {
    if command -v shasum >/dev/null 2>&1; then
        echo "shasum"
        return
    fi
    if command -v sha256sum >/dev/null 2>&1; then
        echo "sha256sum"
        return
    fi
    echo ""
}

sha256_of_file() {
    local file="$1"
    local tool="$2"
    case "$tool" in
        shasum)
            shasum -a 256 "$file" | awk '{print tolower($1)}'
            ;;
        sha256sum)
            sha256sum "$file" | awk '{print tolower($1)}'
            ;;
        *)
            return 1
            ;;
    esac
}

normalize_digest_sha256() {
    local digest="$1"
    if [[ "$digest" == sha256:* ]]; then
        echo "${digest#sha256:}" | tr '[:upper:]' '[:lower:]'
        return
    fi
    echo ""
}

mirror_bases() {
    local csv raw_entry cleaned
    local -a entries

    csv="${CONVEX_MIRROR_BASES:-$DEFAULT_MIRROR_BASES}"
    IFS=',' read -r -a entries <<< "$csv"

    for raw_entry in "${entries[@]}"; do
        cleaned="$(trim "$raw_entry")"
        if [ -n "$cleaned" ]; then
            echo "${cleaned%/}"
        fi
    done
}

emit_source() {
    printf '%s\t%s\n' "$1" "$2"
}

build_sources() {
    local mode="$1"
    local official_url="$2"
    local base

    case "$mode" in
        off)
            emit_source "official" "$official_url"
            ;;
        fallback)
            emit_source "official" "$official_url"
            while IFS= read -r base; do
                emit_source "mirror:${base}" "${base}/${official_url}"
            done < <(mirror_bases)
            ;;
        mirror-first)
            while IFS= read -r base; do
                emit_source "mirror:${base}" "${base}/${official_url}"
            done < <(mirror_bases)
            emit_source "official" "$official_url"
            ;;
    esac
}

download_with_retry() {
    local source_url="$1"
    local output_file="$2"
    local connect_timeout="$3"
    local download_timeout="$4"
    local -a curl_args

    curl_args=(
        -fL
        --retry 3
        --retry-delay 2
        --connect-timeout "$connect_timeout"
        --max-time "$download_timeout"
        -o "$output_file"
    )

    if [ "${CONVEX_CURL_NO_SILENT:-}" = "true" ] || [ "${CONVEX_CURL_NO_SILENT:-}" = "1" ]; then
        curl "${curl_args[@]}" "$source_url"
        return
    fi

    curl --silent --show-error "${curl_args[@]}" "$source_url"
}

latest_release_tag() {
    local effective_url
    effective_url="$(curl -fsSL -o /dev/null -w '%{url_effective}' -L "https://github.com/get-convex/convex-backend/releases/latest")"
    case "$effective_url" in
        */releases/tag/*)
            echo "${effective_url##*/tag/}"
            return 0
            ;;
        *)
            return 1
            ;;
    esac
}

release_info_from_latest_redirect() {
    local asset_name="$1"
    local dashboard_asset_name="$2"
    local version
    version="$(latest_release_tag)" || return 1
    printf '%s\t%s\t%s\t%s\t%s\n' \
        "$version" \
        "https://github.com/get-convex/convex-backend/releases/download/${version}/${asset_name}" \
        "" \
        "https://github.com/get-convex/convex-backend/releases/download/${version}/${dashboard_asset_name}" \
        ""
}

download_asset_zip() {
    local asset_label="$1"
    local official_url="$2"
    local expected_sha="$3"
    local base_mirror_mode="$4"
    local connect_timeout="$5"
    local download_timeout="$6"
    local hash_cmd="$7"
    local output_file="$8"

    local mirror_mode source_line source_label source_url actual_sha
    local selected_source_label selected_source_url
    local -a source_lines

    if [ -z "$official_url" ]; then
        log "No download URL found for ${asset_label}."
        return 2
    fi

    mirror_mode="$base_mirror_mode"
    if [ -z "$expected_sha" ] && [ "$mirror_mode" != "off" ]; then
        log "Release digest is unavailable for ${asset_label}. For safety, forcing mirror mode to 'off' for this asset."
        mirror_mode="off"
    fi

    log "${asset_label}: mirror mode ${mirror_mode} (download timeout ${download_timeout}s, connect timeout ${connect_timeout}s)"
    if [ -n "$expected_sha" ]; then
        log "${asset_label}: expected SHA-256 ${expected_sha}"
    else
        log "${asset_label}: release metadata has no SHA-256 digest; download will proceed from official source only."
    fi

    source_lines=()
    while IFS= read -r source_line; do
        source_lines+=("$source_line")
    done < <(build_sources "$mirror_mode" "$official_url")

    if [ "${#source_lines[@]}" -eq 0 ]; then
        log "No download sources are available for ${asset_label}."
        return 1
    fi

    selected_source_label=""
    selected_source_url=""
    for source_line in "${source_lines[@]}"; do
        IFS=$'\t' read -r source_label source_url <<< "$source_line"
        rm -f "$output_file"

        log "${asset_label}: attempting source: ${source_label}"
        if ! download_with_retry "$source_url" "$output_file" "$connect_timeout" "$download_timeout"; then
            log "${asset_label}: source failed: ${source_label}"
            continue
        fi

        if [ -n "$expected_sha" ]; then
            actual_sha="$(sha256_of_file "$output_file" "$hash_cmd")"
            if [ "$actual_sha" != "$expected_sha" ]; then
                log "${asset_label}: SHA-256 mismatch from ${source_label} (expected ${expected_sha}, got ${actual_sha})."
                continue
            fi
            log "${asset_label}: SHA-256 verified for source: ${source_label}"
        fi

        selected_source_label="$source_label"
        selected_source_url="$source_url"
        break
    done

    if [ -z "$selected_source_url" ]; then
        log "Failed to download ${asset_label} from all sources."
        return 1
    fi

    log "${asset_label}: download source: ${selected_source_label}"
    return 0
}

main() {
    require_command curl
    require_command jq
    require_command unzip

    local target_info artifact_name binary_name release_info version
    local backend_url backend_digest backend_expected_sha
    local dashboard_url dashboard_digest dashboard_expected_sha
    local cache_root cache_parent dest_dir binary_path tmp_zip
    local dashboard_cache_dir dashboard_out_dir dashboard_config_path dashboard_tmp_zip dashboard_extract_dir
    local dashboard_cached existing_dashboard_version
    local dashboard_port dashboard_api_port parsed_dashboard_port parsed_dashboard_api_port
    local mirror_mode hash_cmd download_timeout connect_timeout

    tmp_zip=""
    dashboard_tmp_zip=""
    dashboard_extract_dir=""
    trap 'rm -f "${tmp_zip:-}" "${dashboard_tmp_zip:-}"; if [ -n "${dashboard_extract_dir:-}" ]; then rm -rf "${dashboard_extract_dir}"; fi' EXIT

    target_info="$(detect_platform)"
    if [ -z "$target_info" ]; then
        log "Unsupported platform $(uname -s)/$(uname -m). Skipping."
        exit 0
    fi

    artifact_name="${target_info%%|*}"
    binary_name="${target_info##*|}"
    cache_root="$(cache_dir)"

    log "Prefetching Convex backend and dashboard assets for backend artifact: ${artifact_name}"

    if ! release_info="$(curl -fsSL "$GITHUB_API" | jq -r --arg backend "$artifact_name" --arg dashboard "$DASHBOARD_ASSET_NAME" '
        map(select((.prerelease | not) and (.draft | not)))
        | map(select(any(.assets[]?; .name == $backend)))
        | .[0] // empty
        | [
            .tag_name,
            (first(.assets[]? | select(.name == $backend) | .browser_download_url) // ""),
            (first(.assets[]? | select(.name == $backend) | (.digest // "")) // ""),
            (first(.assets[]? | select(.name == $dashboard) | .browser_download_url) // ""),
            (first(.assets[]? | select(.name == $dashboard) | (.digest // "")) // "")
        ]
        | @tsv
    ')"; then
        release_info=""
    fi

    if [ -z "$release_info" ]; then
        log "GitHub API metadata unavailable. Trying releases/latest redirect fallback..."
        if ! release_info="$(release_info_from_latest_redirect "$artifact_name" "$DASHBOARD_ASSET_NAME")"; then
            release_info=""
        fi
    fi

    if [ -z "$release_info" ]; then
        log "Could not find a stable release with asset ${artifact_name}. Skipping."
        exit 0
    fi

    IFS=$'\t' read -r version backend_url backend_digest dashboard_url dashboard_digest <<< "$release_info"
    backend_expected_sha="$(normalize_digest_sha256 "$backend_digest")"
    dashboard_expected_sha="$(normalize_digest_sha256 "$dashboard_digest")"

    mirror_mode="$(effective_mirror_mode)"
    validate_mirror_mode "$mirror_mode"

    download_timeout="${CONVEX_DOWNLOAD_TIMEOUT_SECS:-$DEFAULT_DOWNLOAD_TIMEOUT_SECS}"
    connect_timeout="${CONVEX_CONNECT_TIMEOUT_SECS:-$DEFAULT_CONNECT_TIMEOUT_SECS}"
    validate_positive_integer "$download_timeout" "CONVEX_DOWNLOAD_TIMEOUT_SECS"
    validate_positive_integer "$connect_timeout" "CONVEX_CONNECT_TIMEOUT_SECS"

    hash_cmd="$(hash_tool)"
    if { [ -n "$backend_expected_sha" ] || [ -n "$dashboard_expected_sha" ]; } && [ -z "$hash_cmd" ]; then
        log "Neither 'shasum' nor 'sha256sum' is available; cannot verify SHA-256."
        exit 1
    fi

    dest_dir="${cache_root}/${version}"
    binary_path="${dest_dir}/${binary_name}"
    cache_parent="$(dirname "$cache_root")"
    dashboard_cache_dir="${cache_parent}/dashboard"
    dashboard_out_dir="${dashboard_cache_dir}/out"
    dashboard_config_path="${dashboard_cache_dir}/config.json"

    if [ -f "$binary_path" ]; then
        log "Already cached: ${binary_path}"
    else
        mkdir -p "$dest_dir"
        tmp_zip="$(mktemp "${TMPDIR:-/tmp}/convex-backend.XXXXXX")"
        if ! download_asset_zip \
            "Convex backend binary (${artifact_name})" \
            "$backend_url" \
            "$backend_expected_sha" \
            "$mirror_mode" \
            "$connect_timeout" \
            "$download_timeout" \
            "$hash_cmd" \
            "$tmp_zip"; then
            exit 1
        fi

        unzip -o -q "$tmp_zip" -d "$dest_dir"

        if [ ! -f "$binary_path" ]; then
            log "Archive did not contain expected file: ${binary_name}"
            exit 1
        fi

        if ! is_windows; then
            chmod +x "$binary_path"
        fi

        log "Cached: ${binary_path}"
    fi

    dashboard_cached="false"
    if [ -f "$dashboard_config_path" ] && [ -d "$dashboard_out_dir" ] && [ -f "$dashboard_out_dir/index.html" ]; then
        existing_dashboard_version="$(jq -r '.version // empty' "$dashboard_config_path" 2>/dev/null || true)"
        if [ "$existing_dashboard_version" = "$version" ]; then
            dashboard_cached="true"
        fi
    fi

    if [ "$dashboard_cached" = "true" ]; then
        log "Dashboard already cached for version ${version}: ${dashboard_out_dir}"
        return
    fi

    if [ -z "$dashboard_url" ]; then
        log "Dashboard asset URL not found for version ${version}. Skipping dashboard prefetch."
        return
    fi

    dashboard_tmp_zip="$(mktemp "${TMPDIR:-/tmp}/convex-dashboard.XXXXXX")"
    if ! download_asset_zip \
        "Convex dashboard asset (${DASHBOARD_ASSET_NAME})" \
        "$dashboard_url" \
        "$dashboard_expected_sha" \
        "$mirror_mode" \
        "$connect_timeout" \
        "$download_timeout" \
        "$hash_cmd" \
        "$dashboard_tmp_zip"; then
        log "Dashboard prefetch failed (non-fatal)."
        return
    fi

    dashboard_extract_dir="$(mktemp -d "${TMPDIR:-/tmp}/convex-dashboard.XXXXXX")"
    if ! unzip -o -q "$dashboard_tmp_zip" -d "$dashboard_extract_dir"; then
        log "Failed to extract Convex dashboard archive (non-fatal)."
        return
    fi

    if ! mkdir -p "$dashboard_cache_dir"; then
        log "Failed to create dashboard cache directory ${dashboard_cache_dir} (non-fatal)."
        return
    fi

    if ! rm -rf "$dashboard_out_dir"; then
        log "Failed to clean dashboard output directory ${dashboard_out_dir} (non-fatal)."
        return
    fi
    if ! mkdir -p "$dashboard_out_dir"; then
        log "Failed to create dashboard output directory ${dashboard_out_dir} (non-fatal)."
        return
    fi
    if ! cp -R "$dashboard_extract_dir"/. "$dashboard_out_dir"/; then
        log "Failed to copy dashboard assets into ${dashboard_out_dir} (non-fatal)."
        return
    fi

    if [ ! -f "$dashboard_out_dir/index.html" ]; then
        log "Dashboard archive did not contain expected file: index.html (non-fatal)."
        return
    fi

    dashboard_port="$DEFAULT_DASHBOARD_PORT"
    dashboard_api_port="$DEFAULT_DASHBOARD_API_PORT"
    if [ -f "$dashboard_config_path" ]; then
        parsed_dashboard_port="$(jq -r 'if (.port|type) == "number" then .port else empty end' "$dashboard_config_path" 2>/dev/null || true)"
        parsed_dashboard_api_port="$(jq -r 'if (.apiPort|type) == "number" then .apiPort else empty end' "$dashboard_config_path" 2>/dev/null || true)"
        if [ -n "$parsed_dashboard_port" ]; then
            dashboard_port="$parsed_dashboard_port"
        fi
        if [ -n "$parsed_dashboard_api_port" ]; then
            dashboard_api_port="$parsed_dashboard_api_port"
        fi
    fi

    if ! cat > "$dashboard_config_path" <<EOF
{"port":${dashboard_port},"apiPort":${dashboard_api_port},"version":"${version}"}
EOF
    then
        log "Failed to update dashboard config at ${dashboard_config_path} (non-fatal)."
        return
    fi

    log "Dashboard cached: ${dashboard_out_dir}"
    log "Dashboard config updated: ${dashboard_config_path}"
}

main "$@"
