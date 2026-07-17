#!/usr/bin/env bash
# Shared helpers for preview deployment scripts on ptcloud.
# Source this file; do not execute it directly.
#
# shellcheck disable=SC2034

# Canonical paths (override with env when testing)
PROD_DIR="${PROD_DIR:-/opt/trends}"
PREVIEW_DIR="${PREVIEW_DIR:-/home/ubuntu/trends-preview}"
REPO_MIRROR="${REPO_MIRROR:-/home/ubuntu/trends}"
PROD_ENV_FILE="${PROD_ENV_FILE:-/etc/trends/env}"
PREVIEW_ENV_FILE="${PREVIEW_ENV_FILE:-$PREVIEW_DIR/.env.preview}"
PROD_DB="${PROD_DB:-$PROD_DIR/output/resume_screening.db}"
PREVIEW_DB="${PREVIEW_DB:-$PREVIEW_DIR/output/resume_screening.db}"
PROD_API_URL="${PROD_API_URL:-http://127.0.0.1:3000}"
PREVIEW_API_URL="${PREVIEW_API_URL:-http://127.0.0.1:3002}"
PROD_CONVEX_URL="${PROD_CONVEX_URL:-http://127.0.0.1:3210}"
PREVIEW_CONVEX_URL="${PREVIEW_CONVEX_URL:-http://127.0.0.1:4210}"
PROD_PUBLIC_HOST="${PROD_PUBLIC_HOST:-trends.pt-mes.com}"
PREVIEW_PUBLIC_HOST="${PREVIEW_PUBLIC_HOST:-preview.pt-mes.com}"
PREVIEW_API_SERVICE="${PREVIEW_API_SERVICE:-trends-preview-api}"
BACKUP_ROOT="${BACKUP_ROOT:-/var/backups/trends}"
PROD_SERVICE_USER="${PROD_SERVICE_USER:-trends}"
PREVIEW_SERVICE_USER="${PREVIEW_SERVICE_USER:-ubuntu}"

log_info()  { printf '[INFO] %s\n' "$*"; }
log_warn()  { printf '[WARN] %s\n' "$*" >&2; }
log_error() { printf '[ERROR] %s\n' "$*" >&2; }
log_step()  { printf '\n=== %s ===\n' "$*"; }

require_root() {
    if [[ "$(id -u)" -ne 0 ]]; then
        log_error "Run as root or with sudo."
        exit 1
    fi
}

require_command() {
    local cmd="$1"
    if ! command -v "$cmd" >/dev/null 2>&1; then
        log_error "Missing required command: $cmd"
        exit 1
    fi
}

confirm_or_exit() {
    local prompt="${1:-Continue?}"
    local answer=""
    if [[ "${ASSUME_YES:-}" =~ ^(1|true|yes)$ ]]; then
        log_info "ASSUME_YES set; continuing without prompt."
        return 0
    fi
    if [[ ! -t 0 ]]; then
        log_error "Non-interactive shell and ASSUME_YES not set. Refusing to continue: $prompt"
        exit 1
    fi
    read -r -p "$prompt [y/N] " answer
    case "$answer" in
        y|Y|yes|YES) return 0 ;;
        *) log_error "Aborted by operator."; exit 1 ;;
    esac
}

is_preview_path() {
    local path="${1:-}"
    [[ -n "$path" ]] || return 1
    local resolved
    resolved="$(cd "$path" 2>/dev/null && pwd -P || true)"
    [[ -n "$resolved" ]] || resolved="$path"
    case "$resolved" in
        */trends-preview|*/trends-preview/*) return 0 ;;
    esac
    [[ "$resolved" == "$PREVIEW_DIR" || "$resolved" == "$PREVIEW_DIR"/* ]] && return 0
    return 1
}

is_prod_path() {
    local path="${1:-}"
    [[ -n "$path" ]] || return 1
    local resolved
    resolved="$(cd "$path" 2>/dev/null && pwd -P || true)"
    [[ -n "$resolved" ]] || resolved="$path"
    [[ "$resolved" == "$PROD_DIR" || "$resolved" == "$PROD_DIR"/* ]] && return 0
    return 1
}

assert_not_prod_install_dir() {
    local target="${1:-}"
    if is_prod_path "$target"; then
        log_error "Refusing to treat production path as preview target: $target"
        return 1
    fi
    return 0
}

assert_preview_cwd() {
    local cwd
    cwd="$(pwd -P)"
    if ! is_preview_path "$cwd" && ! is_preview_path "${1:-}"; then
        log_error "Current directory is not the preview installation."
        log_error "  cwd: $cwd"
        log_error "  expected: $PREVIEW_DIR (or TRENDS_ALLOW_PREVIEW_PATH override)"
        return 1
    fi
    return 0
}

read_env_value() {
    local file_path="$1"
    local key="$2"
    if [[ ! -f "$file_path" ]]; then
        return 0
    fi
    python3 - "$file_path" "$key" <<'PY'
import pathlib, sys
path = pathlib.Path(sys.argv[1])
target = sys.argv[2]
for raw in path.read_text().splitlines():
    line = raw.strip()
    if not line or line.startswith("#"):
        continue
    if line.startswith("export "):
        line = line[len("export "):].strip()
    if "=" not in line:
        continue
    k, v = line.split("=", 1)
    if k.strip() != target:
        continue
    v = v.strip()
    if len(v) >= 2 and v[0] == v[-1] and v[0] in "\"'":
        v = v[1:-1]
    print(v)
    break
PY
}

print_context_report() {
    local label="${1:-context}"
    local app_dir="${2:-$PREVIEW_DIR}"
    local env_file="${3:-$PREVIEW_ENV_FILE}"
    local hostname_val git_branch git_commit app_version env_name convex_url public_url auth_origins db_path

    hostname_val="$(hostname -f 2>/dev/null || hostname)"
    git_branch="n/a"
    git_commit="n/a"
    app_version="n/a"
    if [[ -d "$app_dir/.git" ]]; then
        git_branch="$(git -C "$app_dir" rev-parse --abbrev-ref HEAD 2>/dev/null || echo n/a)"
        git_commit="$(git -C "$app_dir" rev-parse --short HEAD 2>/dev/null || echo n/a)"
    elif [[ -f "$app_dir/.trends-source-meta" ]]; then
        # Read meta in a subshell so SOURCE_REF / SOURCE_* do not clobber the
        # caller's deploy environment (preview-upgrade SOURCE_REF=vX.Y.Z).
        # shellcheck disable=SC1090
        eval "$(
            set -a
            # shellcheck source=/dev/null
            source "$app_dir/.trends-source-meta"
            set +a
            printf 'git_branch=%q\n' "${SOURCE_BRANCH:-n/a}"
            printf 'git_commit=%q\n' "${SOURCE_SHA_SHORT:-${SOURCE_SHA:-n/a}}"
        )"
    fi
    if [[ -f "$app_dir/version" ]]; then
        app_version="$(tr -d '[:space:]' < "$app_dir/version")"
    fi
    env_name="$(basename "$env_file")"
    convex_url="$(read_env_value "$env_file" CONVEX_URL)"
    public_url="$(read_env_value "$env_file" CONVEX_PUBLIC_URL)"
    auth_origins="$(read_env_value "$env_file" AUTH_ALLOWED_ORIGINS)"
    db_path="$app_dir/output/resume_screening.db"

    cat <<EOF
--- $label ---
hostname:           $hostname_val
working_directory:  $(pwd -P)
application_path:   $app_dir
environment_file:   $env_file
environment_name:   $env_name
database_target:    $db_path
convex_url:         ${convex_url:-<unset>}
convex_public_url:  ${public_url:-<unset>}
auth_allowed_origins: ${auth_origins:-<unset>}
git_branch:         $git_branch
git_commit:         $git_commit
application_version: $app_version
EOF
}

assert_preview_env_file() {
    local env_file="${1:-$PREVIEW_ENV_FILE}"
    local convex_url public_url auth_origins

    if [[ ! -f "$env_file" ]]; then
        log_error "Preview env file missing: $env_file"
        return 1
    fi

    convex_url="$(read_env_value "$env_file" CONVEX_URL)"
    public_url="$(read_env_value "$env_file" CONVEX_PUBLIC_URL)"
    auth_origins="$(read_env_value "$env_file" AUTH_ALLOWED_ORIGINS)"

    if [[ "$convex_url" == *":3210"* ]] || [[ "$convex_url" == *"production"* ]]; then
        log_error "Preview CONVEX_URL looks like production: $convex_url"
        return 1
    fi
    if [[ "$convex_url" != *":4210"* && "$convex_url" != *"preview"* ]]; then
        log_error "Preview CONVEX_URL must target preview Convex (:4210). Got: ${convex_url:-<empty>}"
        return 1
    fi
    if [[ "$public_url" == *"$PROD_PUBLIC_HOST"* ]]; then
        log_error "Preview CONVEX_PUBLIC_URL points at production host: $public_url"
        return 1
    fi
    if [[ "$auth_origins" == *"$PROD_PUBLIC_HOST"* ]]; then
        log_error "Preview AUTH_ALLOWED_ORIGINS includes production host: $auth_origins"
        return 1
    fi
    if [[ "$public_url" != *"$PREVIEW_PUBLIC_HOST"* ]]; then
        log_warn "CONVEX_PUBLIC_URL does not mention $PREVIEW_PUBLIC_HOST: ${public_url:-<empty>}"
    fi
    return 0
}

assert_not_prod_services_targeted() {
    # Soft checks used before restarting anything
    if systemctl is-active --quiet trends-api.service 2>/dev/null; then
        :
    fi
    # Never stop/start these from preview scripts
    local forbidden=(trends-api.service trends-worker.service trends-worker-api.service trends-mcp.service trends-convex.service)
    local unit
    for unit in "${forbidden[@]}"; do
        if [[ "${1:-}" == "stop" || "${1:-}" == "restart" ]]; then
            if [[ "$*" == *"$unit"* ]]; then
                log_error "Preview scripts must not control production unit: $unit"
                exit 1
            fi
        fi
    done
}

wait_for_http() {
    # Accept any HTTP status < 500 (auth-enabled APIs often return 401 until login).
    # Prefer /health for liveness. Override: WAIT_HTTP_OK_CODES=200,401
    local url="$1"
    local max_wait="${2:-120}"
    local waited=0
    local code=""
    log_info "Waiting for $url (max ${max_wait}s)..."
    while true; do
        code="$(curl -sS -o /dev/null -w '%{http_code}' --max-time 5 "$url" 2>/dev/null || echo 000)"
        if [[ "$code" =~ ^[1234][0-9][0-9]$ ]]; then
            log_info "Ready after ${waited}s: $url → $code"
            return 0
        fi
        sleep 2
        waited=$((waited + 2))
        if [[ "$waited" -ge "$max_wait" ]]; then
            log_error "Timed out waiting for $url (last code=$code)"
            return 1
        fi
    done
}

sha256_file() {
    local path="$1"
    if command -v sha256sum >/dev/null 2>&1; then
        sha256sum "$path" | awk '{print $1}'
    else
        shasum -a 256 "$path" | awk '{print $1}'
    fi
}

write_manifest_line() {
    local manifest="$1"
    local key="$2"
    local value="$3"
    printf '%s=%s\n' "$key" "$value" >> "$manifest"
}
