#!/usr/bin/env bash
#
# Trends Production Install Script
# Installs the full Trends stack as systemd services on Ubuntu.
#
set -euo pipefail

INSTALL_DIR="/opt/trends"
CONFIG_DIR="/etc/trends"
SYSTEMD_DIR="/etc/systemd/system"
SERVICE_USER="trends"
SERVICE_GROUP="trends"
WORKSPACE_DIR="${WORKSPACE_DIR:-$(pwd)}"
ENV_FILE="${ENV_FILE-.env.production}"

SERVICES=(
    "trends-api.service"
    "trends-worker.service"
    "trends-worker-api.service"
    "trends-mcp.service"
)
LEGACY_UNITS=(
    "trendradar.service"
    "trendradar.timer"
    "trendradar-mcp.service"
    "trends-crawler.service"
    "trends-crawler.timer"
)

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

APT_UPDATED=0
REPO_AUTHENTICATED_WITH_GH=0
GH_AUTH_HOME=""

log_info() { echo -e "${GREEN}[INFO]${NC} $*"; }
log_warn() { echo -e "${YELLOW}[WARN]${NC} $*"; }
log_error() { echo -e "${RED}[ERROR]${NC} $*" >&2; }

check_root() {
    if [[ $EUID -ne 0 ]]; then
        log_error "This script must be run as root (use sudo)."
        exit 1
    fi
}

check_systemd() {
    if ! command -v systemctl >/dev/null 2>&1; then
        log_error "systemd is required but not found."
        exit 1
    fi
}

require_apt() {
    if ! command -v apt-get >/dev/null 2>&1; then
        log_error "apt-get is required. This installer currently supports Ubuntu/Debian systems."
        exit 1
    fi
}

apt_install() {
    local packages=("$@")
    if [[ ${#packages[@]} -eq 0 ]]; then
        return
    fi
    if [[ "$APT_UPDATED" -eq 0 ]]; then
        apt-get update
        APT_UPDATED=1
    fi
    DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends "${packages[@]}"
}

ensure_base_dependencies() {
    require_apt
    apt_install ca-certificates curl git gnupg
}

ensure_node_22() {
    local node_major=""
    local node_major_int=0
    local node_version=""
    local node_22_version=""
    if command -v node >/dev/null 2>&1; then
        node_version="$(node -v)"
        node_major="$(echo "$node_version" | sed -E 's/^v([0-9]+).*/\1/')"
    fi

    if [[ "$node_major" == "22" ]]; then
        log_info "Node.js $node_version already installed."
        return
    fi

    if [[ "$node_major" =~ ^[0-9]+$ ]]; then
        node_major_int="$node_major"
    fi

    if [[ "$node_major_int" -gt 22 && ! "${ALLOW_NODE_DOWNGRADE:-}" =~ ^(1|true|yes)$ ]]; then
        log_warn "Detected Node.js $node_version (expected v22). Continuing without changes."
        log_warn "Set ALLOW_NODE_DOWNGRADE=1 to downgrade to Node.js 22."
        return
    fi

    log_info "Installing Node.js 22 (NodeSource)..."
    ensure_base_dependencies
    curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
    apt-get update
    APT_UPDATED=1
    node_22_version="$(apt-cache madison nodejs | awk '/22\./ { print $3; exit }')"
    if [[ -z "$node_22_version" ]]; then
        log_error "Unable to find a Node.js 22 package candidate from apt metadata."
        exit 1
    fi

    if [[ "$node_major_int" -gt 22 ]]; then
        log_warn "Detected Node.js $node_version; downgrading to Node.js 22 ($node_22_version)."
        DEBIAN_FRONTEND=noninteractive apt-get install -y --allow-downgrades --no-install-recommends "nodejs=$node_22_version"
    else
        DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends "nodejs=$node_22_version"
    fi

    node_major="$(node -v | sed -E 's/^v([0-9]+).*/\1/')"
    if [[ "$node_major" != "22" ]]; then
        log_error "Expected Node.js 22, found $(node -v)."
        exit 1
    fi
    log_info "Installed Node.js $(node -v)."
}

ensure_uv() {
    if command -v uv >/dev/null 2>&1; then
        log_info "uv already installed: $(uv --version)"
        return
    fi

    log_info "Installing uv..."
    ensure_base_dependencies
    curl -LsSf https://astral.sh/uv/install.sh | env UV_INSTALL_DIR=/usr/local/bin sh

    if ! command -v uv >/dev/null 2>&1; then
        log_error "uv installation failed."
        exit 1
    fi
    log_info "Installed uv: $(uv --version)"
}

run_as_invoking_user() {
    if [[ -z "${SUDO_USER:-}" ]]; then
        log_error "SUDO_USER is required to run commands as the invoking user."
        exit 1
    fi

    if command -v sudo >/dev/null 2>&1; then
        sudo -u "$SUDO_USER" -H "$@"
    else
        runuser -u "$SUDO_USER" -- "$@"
    fi
}

ensure_gh_cli() {
    if command -v gh >/dev/null 2>&1; then
        log_info "GitHub CLI already installed: $(gh --version | head -n 1)"
        return
    fi

    log_info "Installing GitHub CLI..."
    ensure_base_dependencies

    install -d -m 0755 /etc/apt/keyrings
    curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg \
        -o /etc/apt/keyrings/githubcli-archive-keyring.gpg
    chmod go+r /etc/apt/keyrings/githubcli-archive-keyring.gpg

    cat > /etc/apt/sources.list.d/github-cli.list << EOF
deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main
EOF

    apt-get update
    APT_UPDATED=1
    DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends gh

    if ! command -v gh >/dev/null 2>&1; then
        log_error "GitHub CLI installation failed."
        exit 1
    fi
    log_info "Installed GitHub CLI: $(gh --version | head -n 1)"
}

ensure_repo_access() {
    local repo_url auth_home
    repo_url="$(resolve_repo_url)"

    # Check if the service user can access the repo (has cached credentials or public repo).
    # Checking as root is misleading because root's credentials don't help the service user
    # who actually runs git operations in clone_or_update_repo.
    if id "$SERVICE_USER" >/dev/null 2>&1 && run_as_service_user "git ls-remote '$repo_url'" >/dev/null 2>&1; then
        log_info "Repository access verified for $repo_url (service user)."
        return
    fi

    if [[ -n "${SUDO_USER:-}" ]] && run_as_invoking_user git ls-remote "$repo_url" >/dev/null 2>&1; then
        REPO_AUTHENTICATED_WITH_GH=1
        auth_home="$(getent passwd "$SUDO_USER" | cut -d: -f6 || true)"
        if [[ -n "$auth_home" ]]; then
            GH_AUTH_HOME="$auth_home"
        fi
        log_info "Repository access verified for $repo_url with invoking user credentials."
        return
    fi

    if [[ -z "${SUDO_USER:-}" ]]; then
        log_error "Cannot authenticate private repository without SUDO_USER. Run via sudo from a regular user account."
        exit 1
    fi

    ensure_gh_cli

    log_warn "Repository access failed for $repo_url. Starting GitHub device login for user $SUDO_USER..."
    if ! run_as_invoking_user gh auth login --protocol https --web --git-protocol https; then
        log_warn "gh auth login did not complete successfully. Re-checking repository access..."
    fi
    if ! run_as_invoking_user gh auth setup-git; then
        log_warn "gh auth setup-git failed. Re-checking repository access..."
    fi

    if ! run_as_invoking_user git ls-remote "$repo_url" >/dev/null 2>&1; then
        log_error "Unable to access $repo_url after GitHub authentication."
        log_error "Retry with: sudo -u $SUDO_USER -H gh auth login --protocol https --web --git-protocol https"
        exit 1
    fi

    auth_home="$(getent passwd "$SUDO_USER" | cut -d: -f6 || true)"
    if [[ -z "$auth_home" ]]; then
        log_warn "Could not resolve home directory for $SUDO_USER; will skip GitHub credential sync for service user."
        return
    fi
    REPO_AUTHENTICATED_WITH_GH=1
    GH_AUTH_HOME="$auth_home"
}

run_as_service_user() {
    local cmd="$1"
    if command -v sudo >/dev/null 2>&1; then
        sudo -u "$SERVICE_USER" bash -lc "$cmd"
    else
        runuser -u "$SERVICE_USER" -- bash -lc "$cmd"
    fi
}

create_service_user() {
    if id "$SERVICE_USER" >/dev/null 2>&1; then
        log_info "User $SERVICE_USER already exists."
        usermod -d "$INSTALL_DIR" -s /bin/bash "$SERVICE_USER" >/dev/null 2>&1 || true
        return
    fi

    log_info "Creating system user $SERVICE_USER..."
    useradd --system --home-dir "$INSTALL_DIR" --shell /bin/bash --user-group "$SERVICE_USER"
}

resolve_repo_url() {
    if [[ -n "${REPO_URL:-}" ]]; then
        echo "$REPO_URL"
        return
    fi

    local script_dir source_root remote_url git_config_path gitdir_path
    script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
    source_root="$(cd "$script_dir/.." && pwd)"

    remote_url=""
    git_config_path=""

    # Prefer git for accuracy, but avoid failing on "dubious ownership" when root runs git in a repo
    # owned by another user (e.g. /opt/trends owned by the service user).
    if git -C "$source_root" rev-parse --is-inside-work-tree >/dev/null 2>&1; then
        remote_url="$(git -C "$source_root" config --get remote.origin.url 2>/dev/null || true)"
    fi

    if [[ -z "$remote_url" && -n "${SUDO_USER:-}" ]]; then
        remote_url="$(run_as_invoking_user git -C "$source_root" config --get remote.origin.url 2>/dev/null || true)"
    fi

    if [[ -z "$remote_url" ]] && id "$SERVICE_USER" >/dev/null 2>&1; then
        remote_url="$(run_as_service_user "git -C '$source_root' config --get remote.origin.url 2>/dev/null || true")"
    fi

    # Final fallback: parse origin url from git config without invoking git (works even when git refuses).
    if [[ -z "$remote_url" ]]; then
        if [[ -f "$source_root/.git/config" ]]; then
            git_config_path="$source_root/.git/config"
        elif [[ -f "$source_root/.git" ]]; then
            gitdir_path="$(sed -nE 's/^[[:space:]]*gitdir:[[:space:]]*(.+)[[:space:]]*$/\1/p' "$source_root/.git" | head -n 1 || true)"
            if [[ -n "$gitdir_path" && "$gitdir_path" != /* ]]; then
                gitdir_path="$source_root/$gitdir_path"
            fi
            if [[ -n "$gitdir_path" && -f "$gitdir_path/config" ]]; then
                git_config_path="$gitdir_path/config"
            fi
        fi

        if [[ -n "$git_config_path" ]]; then
            remote_url="$(awk '
                $0 ~ /^\\[remote \"origin\"\\]$/ { in_origin=1; next }
                $0 ~ /^\\[/ { in_origin=0 }
                in_origin && $1 == \"url\" { print $3; exit }
            ' "$git_config_path" 2>/dev/null || true)"
        fi
    fi

    if [[ -n "$remote_url" ]]; then
        echo "$remote_url"
        return
    fi

    log_error "Unable to determine repository URL. Set REPO_URL explicitly, e.g. REPO_URL=https://github.com/ptdevhk/trends.git"
    exit 1
}

clone_or_update_repo() {
    local repo_url repo_git_owner repo_git_group
    local desired_branch="${INSTALL_BRANCH:-}"
    local default_ref=""
    local default_branch=""
    repo_url="$(resolve_repo_url)"
    repo_git_owner="$SERVICE_USER"
    repo_git_group="$SERVICE_GROUP"
    if [[ "$REPO_AUTHENTICATED_WITH_GH" -eq 1 && -n "${SUDO_USER:-}" ]]; then
        repo_git_owner="$SUDO_USER"
        repo_git_group="$(id -gn "$SUDO_USER")"
    fi

    mkdir -p "$INSTALL_DIR"
    chown -R "$repo_git_owner:$repo_git_group" "$INSTALL_DIR"

    if [[ -d "$INSTALL_DIR/.git" ]]; then
        if [[ "$REPO_AUTHENTICATED_WITH_GH" -eq 1 && -n "${SUDO_USER:-}" ]]; then
            run_as_invoking_user git -C "$INSTALL_DIR" fetch --prune origin
            default_ref="$(run_as_invoking_user git -C "$INSTALL_DIR" symbolic-ref --quiet --short refs/remotes/origin/HEAD 2>/dev/null || true)"
            run_as_invoking_user git -C "$INSTALL_DIR" checkout -- . >/dev/null 2>&1 || true
            run_as_invoking_user git -C "$INSTALL_DIR" pull --ff-only
        else
            run_as_service_user "cd '$INSTALL_DIR' && git fetch --prune origin"
            default_ref="$(run_as_service_user "git -C '$INSTALL_DIR' symbolic-ref --quiet --short refs/remotes/origin/HEAD 2>/dev/null || true")"
            run_as_service_user "cd '$INSTALL_DIR' && git checkout -- . >/dev/null 2>&1 || true"
            run_as_service_user "cd '$INSTALL_DIR' && git pull --ff-only"
        fi

        if [[ -z "$desired_branch" && -n "$default_ref" && "$default_ref" == origin/* ]]; then
            default_branch="${default_ref#origin/}"
            if [[ -n "$default_branch" && "$default_branch" != "HEAD" ]]; then
                desired_branch="$default_branch"
            fi
        fi

        if [[ -n "$desired_branch" ]]; then
            log_info "Aligning $INSTALL_DIR to branch $desired_branch..."
            if [[ "$REPO_AUTHENTICATED_WITH_GH" -eq 1 && -n "${SUDO_USER:-}" ]]; then
                run_as_invoking_user git -C "$INSTALL_DIR" checkout -B "$desired_branch" "origin/$desired_branch"
                run_as_invoking_user git -C "$INSTALL_DIR" checkout -- . >/dev/null 2>&1 || true
                run_as_invoking_user git -C "$INSTALL_DIR" pull --ff-only
            else
                run_as_service_user "cd '$INSTALL_DIR' && git checkout -B '$desired_branch' 'origin/$desired_branch'"
                run_as_service_user "cd '$INSTALL_DIR' && git checkout -- . >/dev/null 2>&1 || true"
                run_as_service_user "cd '$INSTALL_DIR' && git pull --ff-only"
            fi
        else
            log_warn "Could not resolve desired branch (INSTALL_BRANCH unset, origin/HEAD missing). Keeping existing branch."
        fi

        chown -R "$SERVICE_USER:$SERVICE_GROUP" "$INSTALL_DIR"
        return
    fi

    if [[ -n "$(ls -A "$INSTALL_DIR" 2>/dev/null)" ]]; then
        log_error "$INSTALL_DIR exists and is not an initialized git repository. Clean it or clone manually first."
        exit 1
    fi

    if [[ -n "$desired_branch" ]]; then
        log_info "Cloning repository (branch $desired_branch) into $INSTALL_DIR from $repo_url..."
    else
        log_info "Cloning repository into $INSTALL_DIR from $repo_url..."
    fi
    if [[ "$REPO_AUTHENTICATED_WITH_GH" -eq 1 && -n "${SUDO_USER:-}" ]]; then
        if [[ -n "$desired_branch" ]]; then
            run_as_invoking_user git clone --branch "$desired_branch" "$repo_url" "$INSTALL_DIR"
        else
            run_as_invoking_user git clone "$repo_url" "$INSTALL_DIR"
        fi
    else
        if [[ -n "$desired_branch" ]]; then
            run_as_service_user "git clone --branch '$desired_branch' '$repo_url' '$INSTALL_DIR'"
        else
            run_as_service_user "git clone '$repo_url' '$INSTALL_DIR'"
        fi
    fi
    chown -R "$SERVICE_USER:$SERVICE_GROUP" "$INSTALL_DIR"
}

sync_service_user_gh_credentials() {
    local source_gh_dir="$GH_AUTH_HOME/.config/gh"
    local target_gh_dir="$INSTALL_DIR/.config/gh"

    if [[ "$REPO_AUTHENTICATED_WITH_GH" -ne 1 ]]; then
        return
    fi

    if [[ ! -d "$source_gh_dir" ]]; then
        log_warn "GitHub config not found at $source_gh_dir; skipping service-user credential sync."
        return
    fi

    mkdir -p "$INSTALL_DIR/.config"
    rm -rf "$target_gh_dir"
    cp -R "$source_gh_dir" "$target_gh_dir"
    chmod -R go-rwx "$target_gh_dir" || true
    chown -R "$SERVICE_USER:$SERVICE_GROUP" "$INSTALL_DIR/.config"

    if ! run_as_service_user "gh auth setup-git"; then
        log_warn "Failed to run gh auth setup-git for $SERVICE_USER; future git pull may need manual setup."
    fi

    log_info "Synced GitHub credentials to $target_gh_dir for future service-user git pulls."
}

sync_dependencies() {
    log_info "Syncing Python dependencies with uv..."
    run_as_service_user "cd '$INSTALL_DIR' && uv sync"

    log_info "Installing Node dependencies..."
    run_as_service_user "cd '$INSTALL_DIR' && npm install"
}

build_artifacts() {
    log_info "Building @trends/shared..."
    run_as_service_user "cd '$INSTALL_DIR' && npm run --workspace @trends/shared build"

    log_info "Building @trends/api..."
    run_as_service_user "cd '$INSTALL_DIR' && npm run --workspace @trends/api build"

    log_info "Generating @trends/web API types..."
    run_as_service_user "cd '$INSTALL_DIR' && npm --workspace @trends/web run gen:api"

    log_info "Building @trends/web..."
    run_as_service_user "cd '$INSTALL_DIR' && npm run --workspace @trends/web build"
}

read_env_var_from_file() {
    local file_path="$1"
    local key="$2"
    local line=""
    local value=""
    local first_char=""
    local last_char=""

    if [[ ! -f "$file_path" ]]; then
        return 1
    fi

    line="$(grep -E "^[[:space:]]*${key}=" "$file_path" | tail -n 1 || true)"
    if [[ -z "$line" ]]; then
        return 1
    fi

    value="${line#*=}"
    value="$(echo "$value" | sed -E 's/^[[:space:]]+//; s/[[:space:]]+$//')"

    if [[ "${#value}" -ge 2 ]]; then
        first_char="${value:0:1}"
        last_char="${value: -1}"
        if [[ ( "$first_char" == "\"" && "$last_char" == "\"" ) || ( "$first_char" == "'" && "$last_char" == "'" ) ]]; then
            value="${value:1:${#value}-2}"
        fi
    fi

    printf '%s' "$value"
}

resolve_runtime_env_var() {
    local key="$1"
    local value="${!key:-}"

    if [[ -z "$value" ]]; then
        value="$(read_env_var_from_file "$CONFIG_DIR/env" "$key" || true)"
    fi

    printf '%s' "$value"
}

upsert_env_var_in_file() {
    local file_path="$1"
    local key="$2"
    local value="$3"
    local tmp_file=""

    mkdir -p "$(dirname "$file_path")"
    if [[ ! -f "$file_path" ]]; then
        touch "$file_path"
    fi

    tmp_file="$(mktemp)"
    awk -v key="$key" -v value="$value" '
        BEGIN { updated = 0 }
        $0 ~ "^[[:space:]]*" key "=" {
            print key "=" value
            updated = 1
            next
        }
        { print }
        END {
            if (updated == 0) {
                print key "=" value
            }
        }
    ' "$file_path" > "$tmp_file"
    mv "$tmp_file" "$file_path"
}

shell_escape() {
    printf '%q' "$1"
}

wait_for_port_listen() {
    local port="$1"
    local timeout="${2:-60}"
    local elapsed=0

    while [[ "$elapsed" -lt "$timeout" ]]; do
        if ss -ltn "sport = :$port" 2>/dev/null | grep -q "LISTEN"; then
            return 0
        fi
        sleep 1
        elapsed=$((elapsed + 1))
    done

    return 1
}

is_convex_cloud_mode() {
    local deploy_key=""
    deploy_key="$(resolve_runtime_env_var "CONVEX_DEPLOY_KEY")"
    [[ -n "$deploy_key" ]]
}

sync_convex_url_to_web() {
    local sync_script="$INSTALL_DIR/scripts/sync-convex-env.sh"

    if [[ ! -x "$sync_script" ]]; then
        log_warn "Convex URL sync script not found: $sync_script"
        return 0
    fi

    log_info "Syncing Convex URL to apps/web/.env.local..."
    run_as_service_user "set -a && [ -f '$CONFIG_DIR/env' ] && source '$CONFIG_DIR/env' && set +a && cd '$INSTALL_DIR' && '$sync_script'"
}

sync_convex_ai_env() {
    local convex_dir="$INSTALL_DIR/packages/convex"
    local convex_env_file="$convex_dir/.env.local"
    local keys=("AI_ANALYSIS_ENABLED" "AI_ANALYSIS_RESUMES_ENABLED" "AI_MODEL" "AI_API_KEY" "AI_API_BASE")
    local key=""
    local value=""
    local escaped_value=""
    local synced=0
    local failed=0

    if [[ ! -d "$convex_dir" ]]; then
        return 0
    fi

    for key in "${keys[@]}"; do
        value="$(resolve_runtime_env_var "$key")"
        if [[ -z "$value" ]]; then
            continue
        fi
        escaped_value="$(shell_escape "$value")"

        if [[ -f "$convex_env_file" ]]; then
            if run_as_service_user "set -a && [ -f '$CONFIG_DIR/env' ] && source '$CONFIG_DIR/env' && set +a && cd '$convex_dir' && npx convex env set --env-file '$convex_env_file' '$key' $escaped_value >/dev/null 2>&1"; then
                synced=$((synced + 1))
            else
                log_warn "Failed to sync $key into Convex deployment env."
                failed=$((failed + 1))
            fi
        else
            if run_as_service_user "set -a && [ -f '$CONFIG_DIR/env' ] && source '$CONFIG_DIR/env' && set +a && cd '$convex_dir' && npx convex env set '$key' $escaped_value >/dev/null 2>&1"; then
                synced=$((synced + 1))
            else
                log_warn "Failed to sync $key into Convex deployment env."
                failed=$((failed + 1))
            fi
        fi
    done

    if [[ "$synced" -gt 0 ]]; then
        log_info "Synced $synced AI env var(s) to Convex deployment."
    else
        log_warn "No AI env vars found in environment (expected AI_ANALYSIS_ENABLED/AI_ANALYSIS_RESUMES_ENABLED/AI_MODEL/AI_API_KEY/AI_API_BASE)."
    fi

    if [[ "$failed" -gt 0 ]]; then
        log_warn "$failed Convex env var(s) failed to sync."
    fi
}

setup_convex_local() {
    local convex_dir="$INSTALL_DIR/packages/convex"
    local convex_env_file="$convex_dir/.env.local"
    local convex_unit_source="$INSTALL_DIR/deploy/systemd/trends-convex.service"
    local convex_unit_target="$SYSTEMD_DIR/trends-convex.service"
    local prefetch_script="$INSTALL_DIR/scripts/prefetch-convex-backend.sh"
    local convex_url=""

    log_info "Configuring Convex local backend..."

    upsert_env_var_in_file "$convex_env_file" "CONVEX_DEPLOYMENT" "anonymous:anonymous-agent-1"
    chmod 600 "$convex_env_file"
    chown "$SERVICE_USER:$SERVICE_GROUP" "$convex_env_file"

    if [[ -x "$prefetch_script" ]]; then
        if ! run_as_service_user "cd '$INSTALL_DIR' && '$prefetch_script'"; then
            log_warn "Convex backend prefetch failed; continuing with normal startup."
        fi
    else
        log_warn "Convex prefetch script not found: $prefetch_script"
    fi

    if [[ ! -f "$convex_unit_source" ]]; then
        log_error "Missing unit file: $convex_unit_source"
        exit 1
    fi
    cp "$convex_unit_source" "$convex_unit_target"

    systemctl daemon-reload
    systemctl enable trends-convex.service

    # Stop existing backend to free port 3210 before pushing schema.
    # `convex dev --local --once` starts its own backend subprocess, pushes
    # schema/functions, then exits (backend subprocess also exits).
    systemctl stop trends-convex.service 2>/dev/null || true

    log_info "Pushing Convex schema/functions to local backend..."
    run_as_service_user "set -a && [ -f '$CONFIG_DIR/env' ] && source '$CONFIG_DIR/env' && set +a && cd '$convex_dir' && export CONVEX_AGENT_MODE=anonymous && env -u TZ npx convex dev --local --once"

    # Now start the persistent backend service.
    log_info "Starting Convex local backend service..."
    systemctl start trends-convex.service

    log_info "Waiting for Convex local backend on port 3210..."
    if ! wait_for_port_listen 3210 60; then
        log_error "Timed out waiting for Convex backend on port 3210."
        log_error "Inspect logs: journalctl -u trends-convex -n 100 --no-pager"
        exit 1
    fi

    convex_url="$(read_env_var_from_file "$convex_env_file" "CONVEX_URL" || true)"
    if [[ -z "$convex_url" ]]; then
        convex_url="http://127.0.0.1:3210"
    fi

    upsert_env_var_in_file "$CONFIG_DIR/env" "CONVEX_URL" "$convex_url"
    chmod 600 "$CONFIG_DIR/env"
    chown "$SERVICE_USER:$SERVICE_GROUP" "$CONFIG_DIR/env"
    export CONVEX_URL="$convex_url"
}

setup_convex_cloud() {
    local convex_dir="$INSTALL_DIR/packages/convex"
    local convex_env_file="$convex_dir/.env.local"
    local deploy_key=""
    local escaped_deploy_key=""
    local convex_url=""

    deploy_key="$(resolve_runtime_env_var "CONVEX_DEPLOY_KEY")"
    if [[ -z "$deploy_key" ]]; then
        log_error "CONVEX_DEPLOY_KEY is required for cloud mode."
        exit 1
    fi
    escaped_deploy_key="$(shell_escape "$deploy_key")"

    log_info "Deploying Convex backend to Convex Cloud..."
    run_as_service_user "set -a && [ -f '$CONFIG_DIR/env' ] && source '$CONFIG_DIR/env' && set +a && cd '$convex_dir' && CONVEX_DEPLOY_KEY=$escaped_deploy_key npx convex deploy"

    convex_url="$(read_env_var_from_file "$convex_env_file" "CONVEX_URL" || true)"
    if [[ -z "$convex_url" ]]; then
        convex_url="$(resolve_runtime_env_var "CONVEX_URL")"
    fi
    if [[ -z "$convex_url" ]]; then
        log_error "Failed to resolve CONVEX_URL after cloud deploy."
        exit 1
    fi

    upsert_env_var_in_file "$CONFIG_DIR/env" "CONVEX_URL" "$convex_url"
    chmod 600 "$CONFIG_DIR/env"
    chown "$SERVICE_USER:$SERVICE_GROUP" "$CONFIG_DIR/env"
    export CONVEX_URL="$convex_url"

    systemctl stop trends-convex.service 2>/dev/null || true
    systemctl disable trends-convex.service 2>/dev/null || true
}

setup_convex() {
    local convex_dir="$INSTALL_DIR/packages/convex"

    if [[ ! -d "$convex_dir" ]]; then
        log_info "Skipping Convex setup: $convex_dir not found."
        return 0
    fi

    if is_convex_cloud_mode; then
        log_info "Convex mode detected: cloud."
        setup_convex_cloud
    else
        log_info "Convex mode detected: self-hosted local backend."
        setup_convex_local
    fi

    sync_convex_url_to_web
    sync_convex_ai_env
}

seed_and_migrate_convex() {
    local convex_dir="$INSTALL_DIR/packages/convex"
    local seed_script="$INSTALL_DIR/scripts/seed-convex.ts"
    local seed_args="--force"

    if [[ ! -d "$convex_dir" ]]; then
        return 0
    fi

    # Always seed JDs (idempotent). Optionally include sample resumes.
    if [[ -n "${SEED_RESUMES:-}" ]]; then
        seed_args="$seed_args --with-resumes"
        log_info "Seeding Convex: job descriptions + sample resumes..."
    else
        log_info "Seeding Convex: job descriptions only..."
    fi

    run_as_service_user "set -a && [ -f '$CONFIG_DIR/env' ] && source '$CONFIG_DIR/env' && set +a && cd '$INSTALL_DIR' && npx tsx '$seed_script' $seed_args" \
        || log_warn "Convex seed failed. Continuing with migrations."

    log_info "Running Convex migration: reindexSearchText..."
    run_as_service_user "set -a && [ -f '$CONFIG_DIR/env' ] && source '$CONFIG_DIR/env' && set +a && cd '$convex_dir' && npx convex run migrations:reindexSearchText" \
        || log_warn "reindexSearchText failed."

    log_info "Running Convex migration: backfillPrimaryRuleScore..."
    run_as_service_user "set -a && [ -f '$CONFIG_DIR/env' ] && source '$CONFIG_DIR/env' && set +a && cd '$convex_dir' && npx convex run migrations:backfillPrimaryRuleScore" \
        || log_warn "backfillPrimaryRuleScore failed."

    log_info "Running Convex migration: backfillIngestData..."
    run_as_service_user "set -a && [ -f '$CONFIG_DIR/env' ] && source '$CONFIG_DIR/env' && set +a && cd '$convex_dir' && npx convex run migrations:backfillIngestData '{\"limit\":100}'" \
        || log_warn "backfillIngestData failed."
}

resolve_env_file() {
    if [[ -z "${ENV_FILE:-}" ]]; then
        return 1
    fi

    local resolved_path="$ENV_FILE"
    local configured_values=0

    if [[ "$resolved_path" != /* ]]; then
        resolved_path="$WORKSPACE_DIR/$resolved_path"
    fi

    if [[ ! -f "$resolved_path" ]]; then
        log_error "Env file not found: $resolved_path"
        log_error "Hint: cp deploy/env.production .env.production"
        exit 1
    fi

    configured_values="$(grep -Evc '^[[:space:]]*($|#)' "$resolved_path" || true)"
    if [[ "$configured_values" -lt 3 ]]; then
        log_warn "Env file $resolved_path appears to have only $configured_values configured value(s)."
    fi

    echo "$resolved_path"
}

deploy_env_file() {
    local resolved_env_path=""
    local install_env_path="$INSTALL_DIR/.env.production"
    local system_env_path="$CONFIG_DIR/env"

    if ! resolved_env_path="$(resolve_env_file)"; then
        setup_env_file_legacy
        return
    fi

    mkdir -p "$INSTALL_DIR" "$CONFIG_DIR"
    cp "$resolved_env_path" "$install_env_path"
    cp "$resolved_env_path" "$system_env_path"
    chmod 600 "$install_env_path" "$system_env_path"
    chown "$SERVICE_USER:$SERVICE_GROUP" "$install_env_path" "$system_env_path"

    log_info "Deployed env file from $resolved_env_path to:"
    log_info "  - $install_env_path"
    log_info "  - $system_env_path"
}

setup_env_file_legacy() {
    mkdir -p "$CONFIG_DIR"

    if [[ ! -f "$CONFIG_DIR/env" ]]; then
        if [[ -f "$INSTALL_DIR/deploy/env.production" ]]; then
            cp "$INSTALL_DIR/deploy/env.production" "$CONFIG_DIR/env"
            log_warn "Created $CONFIG_DIR/env from deploy/env.production. Please review values."
        elif [[ -f "$INSTALL_DIR/.env.example" ]]; then
            cp "$INSTALL_DIR/.env.example" "$CONFIG_DIR/env"
            log_warn "Created $CONFIG_DIR/env from .env.example. Please review values."
        else
            cat > "$CONFIG_DIR/env" << 'EOF'
# Trends production environment
DEBUG=false
TIMEZONE=Asia/Hong_Kong
TZ=Asia/Hong_Kong
EOF
            log_warn "Created minimal $CONFIG_DIR/env. Please configure required variables."
        fi
    else
        log_info "$CONFIG_DIR/env already exists; keeping existing configuration."
    fi

    chmod 600 "$CONFIG_DIR/env"
    chown "$SERVICE_USER:$SERVICE_GROUP" "$CONFIG_DIR/env"
}

remove_legacy_units() {
    log_info "Removing legacy trendradar unit files (if present)..."
    local unit
    for unit in "${LEGACY_UNITS[@]}"; do
        systemctl stop "$unit" 2>/dev/null || true
        systemctl disable "$unit" 2>/dev/null || true
        rm -f "$SYSTEMD_DIR/$unit"
    done
}

install_systemd_units() {
    local source_dir="$INSTALL_DIR/deploy/systemd"
    local unit

    log_info "Installing trends systemd unit files..."
    for unit in "${SERVICES[@]}" "trends-convex.service"; do
        if [[ ! -f "$source_dir/$unit" ]]; then
            log_error "Missing unit file: $source_dir/$unit"
            exit 1
        fi
        cp "$source_dir/$unit" "$SYSTEMD_DIR/$unit"
    done
}

enable_units() {
    log_info "Reloading systemd daemon..."
    systemctl daemon-reload

    log_info "Enabling trends services..."
    local unit
    for unit in "${SERVICES[@]}"; do
        systemctl enable "$unit"
    done
}

restart_units() {
    log_info "Reloading systemd daemon..."
    systemctl daemon-reload

    log_info "Restarting trends services..."
    local unit
    for unit in "${SERVICES[@]}"; do
        systemctl restart "$unit"
    done
}

start_services() {
    local units=(
        "trends-api.service"
        "trends-worker-api.service"
        "trends-worker.service"
        "trends-mcp.service"
    )
    local unit

    log_info "Starting trends services..."
    for unit in "${units[@]}"; do
        if systemctl start "$unit"; then
            log_info "Started $unit"
        else
            log_error "Failed to start $unit"
            log_error "Inspect logs: journalctl -u $unit -n 100 --no-pager"
        fi
    done

    sleep 2

    log_info "Verifying service health..."
    for unit in "${units[@]}"; do
        if systemctl is-active --quiet "$unit"; then
            log_info "$unit is active."
        else
            log_error "$unit is not active."
            log_error "Inspect logs: journalctl -u $unit -n 100 --no-pager"
        fi
    done
}

stop_port_processes() {
    local port="$1"
    local pids pid
    pids="$(ss -ltnp "sport = :$port" 2>/dev/null | grep -oE 'pid=[0-9]+' | cut -d= -f2 | sort -u || true)"

    if [[ -z "$pids" ]]; then
        return
    fi

    log_warn "Stopping existing process(es) on port $port: $pids"
    for pid in $pids; do
        kill "$pid" 2>/dev/null || true
    done

    sleep 2
    for pid in $pids; do
        if kill -0 "$pid" 2>/dev/null; then
            kill -9 "$pid" 2>/dev/null || true
        fi
    done
}

print_caddy_block() {
    cat << 'EOF'

Recommended Caddyfile block:

trends.pt-mes.com {
    tls leotse@datadigitalisation.com
    encode gzip

    # Convex backend — self-hosted on port 3210 (WebSocket + HTTP)
    # Set CONVEX_PUBLIC_URL=https://trends.pt-mes.com/convex in .env.production
    handle_path /convex/* {
        reverse_proxy 127.0.0.1:3210
    }

    # BFF API — Hono on port 3000
    handle /api/* {
        reverse_proxy 127.0.0.1:3000
    }

    # MCP HTTP — optional, for AI clients
    handle /mcp/* {
        reverse_proxy 127.0.0.1:3333
    }

    # React SPA — production build served as static files
    handle {
        root * /opt/trends/apps/web/dist
        try_files {path} /index.html
        file_server
    }
}
EOF
}

install_flow() {
    check_root
    check_systemd
    ensure_base_dependencies
    ensure_node_22
    ensure_uv
    ensure_repo_access
    create_service_user
    sync_service_user_gh_credentials
    clone_or_update_repo
    sync_dependencies
    deploy_env_file
    setup_convex
    build_artifacts
    seed_and_migrate_convex
    stop_port_processes 3000
    remove_legacy_units
    install_systemd_units
    enable_units
    start_services

    echo ""
    log_info "Installation completed."
    echo ""
    echo "Verification commands:"
    echo "  systemctl status trends-convex trends-api trends-worker trends-worker-api trends-mcp"
    echo "  curl -s http://127.0.0.1:3000/api/health"
    echo "  curl -s https://trends.pt-mes.com/"
    echo ""
    echo "Caddy setup recommendation:"
    echo "  sudo nano /etc/caddy/Caddyfile"
    echo "  sudo systemctl reload caddy"
    print_caddy_block
}

upgrade_flow() {
    check_root
    check_systemd
    ensure_base_dependencies
    ensure_node_22
    ensure_uv
    ensure_repo_access

    if [[ ! -d "$INSTALL_DIR/.git" ]]; then
        log_error "$INSTALL_DIR is not a git repository. Run install first."
        exit 1
    fi

    create_service_user
    sync_service_user_gh_credentials
    clone_or_update_repo

    sync_dependencies
    if [[ -n "$ENV_FILE" ]]; then
        deploy_env_file
    else
        log_info "ENV_FILE is empty; keeping existing $CONFIG_DIR/env unchanged."
    fi
    setup_convex
    build_artifacts
    seed_and_migrate_convex
    stop_port_processes 3000
    remove_legacy_units
    install_systemd_units
    restart_units

    echo ""
    log_info "Upgrade completed. Services restarted."
    echo "Check status with:"
    echo "  systemctl status trends-convex trends-api trends-worker trends-worker-api trends-mcp"
}

uninstall_flow() {
    check_root
    check_systemd

    log_info "Stopping and disabling trends services..."
    systemctl stop trends-api.service trends-worker.service trends-worker-api.service trends-mcp.service trends-convex.service 2>/dev/null || true
    systemctl disable trends-api.service trends-worker.service trends-worker-api.service trends-mcp.service trends-convex.service 2>/dev/null || true

    remove_legacy_units

    log_info "Removing trends unit files..."
    local unit
    for unit in "${SERVICES[@]}" "trends-convex.service"; do
        rm -f "$SYSTEMD_DIR/$unit"
    done
    systemctl daemon-reload

    log_info "Uninstall complete."
    log_warn "Application files at $INSTALL_DIR were NOT removed."
    log_warn "Configuration at $CONFIG_DIR was NOT removed."
    log_warn "User $SERVICE_USER was NOT removed."
    echo ""
    echo "To fully remove manually:"
    echo "  sudo rm -rf $INSTALL_DIR"
    echo "  sudo rm -rf $CONFIG_DIR"
    echo "  sudo userdel $SERVICE_USER"
}

main() {
    case "${1:-install}" in
        install)
            install_flow
            ;;
        upgrade)
            upgrade_flow
            ;;
        uninstall)
            uninstall_flow
            ;;
        *)
            echo "Usage: $0 [install|upgrade|uninstall]"
            exit 1
            ;;
    esac
}

main "$@"
