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
DEPLOY_BACKUP_DIR="${DEPLOY_BACKUP_DIR:-/var/backups/trends/deploy}"
KEEP_DEPLOY_BACKUPS="${KEEP_DEPLOY_BACKUPS:-10}"
DEPLOY_BACKUP_INCLUDE_FILE_STORAGE="${DEPLOY_BACKUP_INCLUDE_FILE_STORAGE:-}"
DEPLOY_BACKUP_RESUME_WORKSPACE="${DEPLOY_BACKUP_RESUME_WORKSPACE:-dev}"

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
UPGRADE_ACTION=""
UPGRADE_DEPLOYED_SHA=""
UPGRADE_DEPLOYED_BRANCH=""
UPGRADE_TARGET_SHA=""
UPGRADE_TARGET_BRANCH=""
UPGRADE_ENV_CHANGED=0
UPGRADE_FRONTEND_ENV_CHANGED=0
UPGRADE_TRACKED_DRIFT=0
UPGRADE_RESOLVED_ENV_PATH=""
WORKSPACE_CURRENT_BRANCH=""
WORKSPACE_TARGET_BRANCH=""
WORKSPACE_LOCAL_SHA=""
WORKSPACE_REMOTE_SHA=""
WORKSPACE_AHEAD=0
WORKSPACE_BEHIND=0
WORKSPACE_DIRTY=0
DEPLOY_BACKUP_RUN_DIR=""
DEPLOY_BACKUP_METADATA_PATH=""
DEPLOY_BACKUP_CONVEX_PATH=""
DEPLOY_BACKUP_RESUME_PATH=""
DEPLOY_BACKUP_RESUME_EXISTS="false"
DEPLOY_BACKUP_CONFIG_ENV_PATH=""
DEPLOY_BACKUP_INSTALL_ENV_PATH=""
DEPLOY_BACKUP_CONVEX_ENV_PATH=""
DEPLOY_BACKUP_INSTALL_PATCH_PATH=""

log_info() { echo -e "${GREEN}[INFO]${NC} $*"; }
log_warn() { echo -e "${YELLOW}[WARN]${NC} $*"; }
log_error() { echo -e "${RED}[ERROR]${NC} $*" >&2; }

is_truthy() {
    [[ "${1:-}" =~ ^(1|true|yes)$ ]]
}

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
    apt_install ca-certificates curl git gnupg zip
}

require_git() {
    if ! command -v git >/dev/null 2>&1; then
        log_error "git is required but not found."
        exit 1
    fi
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

run_convex_migration() {
    local convex_dir="$1"
    local migration_name="$2"
    local migration_args="${3:-}"
    local cursor=""
    local iteration=1
    local batch_count=0
    local consecutive_noop=0
    local max_consecutive_noop=3
    local total_scanned=0
    local total_updated=0
    local saw_scanned=0
    local saw_updated=0

    log_info "Running Convex migration: $migration_name..."

    while true; do
        local call_args=""
        local command="set -a && [ -f '$CONFIG_DIR/env' ] && source '$CONFIG_DIR/env' && set +a && cd '$convex_dir' && npx convex run migrations:$migration_name"

        call_args="$(node - "$migration_args" "$cursor" <<'NODE'
const baseArgs = process.argv[2] ? JSON.parse(process.argv[2]) : {};
const cursor = process.argv[3];
if (cursor) {
  baseArgs.cursor = cursor;
}
process.stdout.write(JSON.stringify(baseArgs));
NODE
)"

        if [[ "$call_args" != "{}" ]]; then
            command="$command '$call_args'"
        fi

        local output=""
        if ! output="$(run_as_service_user "$command" 2>&1)"; then
            printf '%s\n' "$output"
            log_warn "$migration_name failed.${call_args:+ $call_args}"
            return 1
        fi
        batch_count=$((batch_count + 1))

        local progress=""
        progress="$(node - "$output" <<'NODE'
const vm = require('node:vm');
const source = (process.argv[2] ?? '').trim();
const progressKeys = [
  'updated',
  'updatedResumes',
  'patched',
  'count',
  'cleared',
  'scheduled',
  'movedEducationEntries',
  'updatedProfileFields',
];
let hasMore = 0;
let cursor = '';
let updated = -1;
let scanned = -1;

try {
  const value = vm.runInNewContext(`(${source})`);
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    if (value.hasMore === true) {
      hasMore = 1;
      cursor = typeof value.cursor === 'string' ? value.cursor : '';
    }
    if (typeof value.scannedResumes === 'number') {
      scanned = value.scannedResumes;
    }
    for (const key of progressKeys) {
      if (typeof value[key] === 'number') {
        updated = value[key];
        break;
      }
    }
  }
} catch {
  hasMore = 0;
}

process.stdout.write(`${hasMore}\t${Buffer.from(cursor, 'utf8').toString('base64')}\t${updated}\t${scanned}`);
NODE
)"

        local has_more="${progress%%$'\t'*}"
        local rest="${progress#*$'\t'}"
        local cursor_b64="${rest%%$'\t'*}"
        local trailing="${rest#*$'\t'}"
        local batch_updated="${trailing%%$'\t'*}"
        local batch_scanned="${trailing#*$'\t'}"

        if [[ "$batch_updated" =~ ^-?[0-9]+$ ]] && [[ "$batch_updated" -ge 0 ]]; then
            total_updated=$((total_updated + batch_updated))
            saw_updated=1
        fi

        if [[ "$batch_scanned" =~ ^-?[0-9]+$ ]] && [[ "$batch_scanned" -ge 0 ]]; then
            total_scanned=$((total_scanned + batch_scanned))
            saw_scanned=1
        fi

        if [[ "$has_more" != "1" ]]; then
            break
        fi

        if [[ "$batch_updated" == "0" ]]; then
            consecutive_noop=$((consecutive_noop + 1))
        else
            consecutive_noop=0
        fi

        if [[ "$consecutive_noop" -ge "$max_consecutive_noop" ]]; then
            log_info "$migration_name: $consecutive_noop consecutive batches with 0 updates, skipping remaining."
            break
        fi

        if [[ -n "$cursor_b64" ]]; then
            cursor="$(printf '%s' "$cursor_b64" | base64 --decode)"
        else
            cursor=""
        fi
        iteration=$((iteration + 1))

        if [[ "$iteration" -gt 10000 ]]; then
            log_warn "$migration_name exceeded the maximum batch iterations."
            break
        fi
    done

    local summary="Completed Convex migration: $migration_name (batches: $batch_count"
    if [[ "$saw_scanned" -eq 1 ]]; then
        summary="$summary, scanned: $total_scanned"
    fi
    if [[ "$saw_updated" -eq 1 ]]; then
        summary="$summary, changed: $total_updated"
    fi
    summary="$summary)"
    log_info "$summary"
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
    source_root="$WORKSPACE_DIR"
    if [[ -z "$source_root" || ! -d "$source_root" ]]; then
        source_root="$(cd "$script_dir/.." && pwd)"
    fi

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

run_git_as_service_user() {
    local escaped_args=()
    local arg=""

    for arg in "$@"; do
        escaped_args+=("$(shell_escape "$arg")")
    done

    run_as_service_user "git ${escaped_args[*]}"
}

run_install_repo_git() {
    if id "$SERVICE_USER" >/dev/null 2>&1; then
        run_git_as_service_user -C "$INSTALL_DIR" "$@"
        return
    fi

    git -C "$INSTALL_DIR" "$@"
}

run_workspace_repo_git() {
    if [[ -n "${SUDO_USER:-}" ]]; then
        run_as_invoking_user git -C "$WORKSPACE_DIR" "$@"
        return
    fi

    git -C "$WORKSPACE_DIR" "$@"
}

workspace_repo_exists() {
    run_workspace_repo_git rev-parse --is-inside-work-tree >/dev/null 2>&1
}

resolve_workspace_current_branch() {
    local branch=""

    if ! workspace_repo_exists; then
        return 1
    fi

    branch="$(run_workspace_repo_git rev-parse --abbrev-ref HEAD 2>/dev/null || true)"
    if [[ -z "$branch" || "$branch" == "HEAD" ]]; then
        return 1
    fi

    printf '%s' "$branch"
}

preflight_workspace_repo() {
    local auto_pull="${1:-0}"
    local desired_branch=""
    local current_branch=""
    local local_ref="HEAD"
    local dirty_status=""
    local counts=""

    WORKSPACE_CURRENT_BRANCH=""
    WORKSPACE_TARGET_BRANCH=""
    WORKSPACE_LOCAL_SHA=""
    WORKSPACE_REMOTE_SHA=""
    WORKSPACE_AHEAD=0
    WORKSPACE_BEHIND=0
    WORKSPACE_DIRTY=0

    if ! workspace_repo_exists; then
        log_info "WORKSPACE_DIR $WORKSPACE_DIR is not a git checkout; skipping workspace git preflight."
        return 0
    fi

    current_branch="$(resolve_workspace_current_branch || true)"
    if [[ -n "${INSTALL_BRANCH:-}" ]]; then
        desired_branch="$INSTALL_BRANCH"
    else
        desired_branch="$current_branch"
    fi

    WORKSPACE_CURRENT_BRANCH="$current_branch"
    WORKSPACE_TARGET_BRANCH="$desired_branch"

    dirty_status="$(run_workspace_repo_git status --porcelain --untracked-files=no 2>/dev/null || true)"
    if [[ -n "$dirty_status" ]]; then
        WORKSPACE_DIRTY=1
        log_error "Workspace checkout at $WORKSPACE_DIR has tracked git changes."
        log_error "Commit, stash, or discard them before running deploy. make deploy only promotes committed git history."
        return 1
    fi

    log_info "Fetching workspace checkout at $WORKSPACE_DIR..."
    run_workspace_repo_git fetch --prune origin

    if [[ -z "$desired_branch" ]]; then
        log_warn "Workspace is on a detached HEAD and INSTALL_BRANCH is unset; skipping workspace pull preflight."
        return 0
    fi

    if ! run_workspace_repo_git show-ref --verify --quiet "refs/remotes/origin/$desired_branch"; then
        log_error "origin/$desired_branch does not exist for workspace checkout $WORKSPACE_DIR."
        return 1
    fi

    if [[ -n "$current_branch" && "$current_branch" == "$desired_branch" ]]; then
        local_ref="HEAD"
    elif run_workspace_repo_git show-ref --verify --quiet "refs/heads/$desired_branch"; then
        local_ref="$desired_branch"
    else
        log_warn "Workspace branch $desired_branch does not exist locally; deploy will use origin/$desired_branch."
        WORKSPACE_REMOTE_SHA="$(run_workspace_repo_git rev-parse "origin/$desired_branch" 2>/dev/null || true)"
        return 0
    fi

    WORKSPACE_LOCAL_SHA="$(run_workspace_repo_git rev-parse "$local_ref" 2>/dev/null || true)"
    WORKSPACE_REMOTE_SHA="$(run_workspace_repo_git rev-parse "origin/$desired_branch" 2>/dev/null || true)"
    counts="$(run_workspace_repo_git rev-list --left-right --count "$local_ref...origin/$desired_branch" 2>/dev/null || true)"
    if [[ -n "$counts" ]]; then
        WORKSPACE_AHEAD="${counts%%[[:space:]]*}"
        WORKSPACE_BEHIND="${counts##*[[:space:]]}"
    fi

    if [[ "$WORKSPACE_AHEAD" -gt 0 && "$WORKSPACE_BEHIND" -gt 0 ]]; then
        log_error "Workspace branch $desired_branch has diverged from origin/$desired_branch."
        log_error "Rebase or reset the workspace branch before deploy."
        return 1
    fi

    if [[ "$WORKSPACE_AHEAD" -gt 0 ]]; then
        log_error "Workspace branch $desired_branch has local commits not pushed to origin."
        log_error "Push the branch before deploy so /opt/trends can pull the same commit."
        return 1
    fi

    if [[ "$WORKSPACE_BEHIND" -gt 0 ]]; then
        if [[ "$auto_pull" == "1" && -n "$current_branch" && "$current_branch" == "$desired_branch" ]]; then
            log_info "Fast-forwarding workspace branch $desired_branch..."
            run_workspace_repo_git pull --ff-only origin "$desired_branch"
            WORKSPACE_LOCAL_SHA="$(run_workspace_repo_git rev-parse HEAD 2>/dev/null || true)"
            WORKSPACE_REMOTE_SHA="$WORKSPACE_LOCAL_SHA"
            WORKSPACE_BEHIND=0
        else
            log_warn "Workspace branch $desired_branch is behind origin/$desired_branch."
            if [[ "$auto_pull" == "1" ]]; then
                log_warn "Auto-pull skipped because the workspace is not currently on $desired_branch."
            fi
        fi
        return 0
    fi

    log_info "Workspace branch ${desired_branch} is already up to date with origin/${desired_branch}."
}

run_remote_git() {
    if [[ "$REPO_AUTHENTICATED_WITH_GH" -eq 1 && -n "${SUDO_USER:-}" ]]; then
        run_as_invoking_user git "$@"
        return
    fi

    if id "$SERVICE_USER" >/dev/null 2>&1; then
        run_git_as_service_user "$@"
        return
    fi

    git "$@"
}

resolve_desired_branch() {
    local repo_url="$1"
    local desired_branch="${INSTALL_BRANCH:-}"
    local remote_head=""

    if [[ -n "$desired_branch" ]]; then
        printf '%s' "$desired_branch"
        return 0
    fi

    desired_branch="$(resolve_workspace_current_branch || true)"
    if [[ -n "$desired_branch" ]]; then
        printf '%s' "$desired_branch"
        return 0
    fi

    remote_head="$(run_remote_git ls-remote --symref "$repo_url" HEAD 2>/dev/null | awk '/^ref:/ { sub("refs/heads/", "", $2); print $2; exit }')"
    if [[ -n "$remote_head" ]]; then
        printf '%s' "$remote_head"
        return 0
    fi

    remote_head="$(run_install_repo_git symbolic-ref --quiet --short refs/remotes/origin/HEAD 2>/dev/null || true)"
    if [[ "$remote_head" == origin/* ]]; then
        remote_head="${remote_head#origin/}"
    fi

    printf '%s' "$remote_head"
}

clone_or_update_repo() {
    local repo_url repo_git_owner repo_git_group
    local desired_branch=""
    repo_url="$(resolve_repo_url)"
    desired_branch="$(resolve_desired_branch "$repo_url" || true)"
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
        else
            run_as_service_user "cd '$INSTALL_DIR' && git fetch --prune origin"
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
            log_warn "Could not resolve desired branch (INSTALL_BRANCH unset, origin/HEAD missing). Pulling the current branch."
            if [[ "$REPO_AUTHENTICATED_WITH_GH" -eq 1 && -n "${SUDO_USER:-}" ]]; then
                run_as_invoking_user git -C "$INSTALL_DIR" checkout -- . >/dev/null 2>&1 || true
                run_as_invoking_user git -C "$INSTALL_DIR" pull --ff-only
            else
                run_as_service_user "cd '$INSTALL_DIR' && git checkout -- . >/dev/null 2>&1 || true"
                run_as_service_user "cd '$INSTALL_DIR' && git pull --ff-only"
            fi
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

plan_upgrade_action() {
    local repo_url=""
    local desired_branch=""
    local deployed_sha=""
    local deployed_branch=""
    local target_sha=""
    local tracked_drift=0
    local env_changed=0
    local frontend_env_changed_flag=0
    local resolved_env_path=""
    local dirty_status=""

    repo_url="$(resolve_repo_url)"
    desired_branch="$(resolve_desired_branch "$repo_url" || true)"
    deployed_sha="$(run_install_repo_git rev-parse HEAD 2>/dev/null || true)"
    deployed_branch="$(run_install_repo_git rev-parse --abbrev-ref HEAD 2>/dev/null || true)"
    dirty_status="$(run_install_repo_git status --porcelain --untracked-files=no 2>/dev/null || true)"
    target_sha=""

    if [[ -n "$desired_branch" ]]; then
        target_sha="$(run_remote_git ls-remote "$repo_url" "refs/heads/$desired_branch" 2>/dev/null | awk 'NR == 1 { print $1; exit }')"
    fi

    if [[ -n "$dirty_status" ]]; then
        tracked_drift=1
    fi

    if [[ -n "${ENV_FILE:-}" ]]; then
        resolved_env_path="$(resolve_env_file)"
        if [[ ! -f "$CONFIG_DIR/env" ]] || ! cmp -s "$resolved_env_path" "$CONFIG_DIR/env"; then
            env_changed=1
        fi
        if frontend_env_changed "$INSTALL_DIR/.env.production" "$resolved_env_path"; then
            frontend_env_changed_flag=1
        fi
    fi

    UPGRADE_ACTION="full"
    if is_truthy "${SEED_RESUMES:-}"; then
        UPGRADE_ACTION="full"
    elif is_truthy "${FORCE:-}"; then
        UPGRADE_ACTION="full"
    elif [[ -n "$deployed_sha" && -n "$target_sha" && "$deployed_sha" == "$target_sha" && "$tracked_drift" -eq 0 ]]; then
        if frontend_dist_requires_rebuild; then
            UPGRADE_ACTION="full"
        elif [[ "$frontend_env_changed_flag" -eq 1 ]]; then
            UPGRADE_ACTION="full"
        elif [[ "$env_changed" -eq 1 ]]; then
            UPGRADE_ACTION="env-only"
        else
            UPGRADE_ACTION="skip"
        fi
    fi

    UPGRADE_DEPLOYED_SHA="$deployed_sha"
    UPGRADE_DEPLOYED_BRANCH="$deployed_branch"
    UPGRADE_TARGET_SHA="$target_sha"
    UPGRADE_TARGET_BRANCH="$desired_branch"
    UPGRADE_ENV_CHANGED="$env_changed"
    UPGRADE_FRONTEND_ENV_CHANGED="$frontend_env_changed_flag"
    UPGRADE_TRACKED_DRIFT="$tracked_drift"
    UPGRADE_RESOLVED_ENV_PATH="$resolved_env_path"
}

print_upgrade_plan() {
    echo ""
    log_info "Upgrade precheck summary:"
    if [[ -n "$WORKSPACE_DIR" ]]; then
        echo "  workspace dir: $WORKSPACE_DIR"
        echo "  workspace current branch: ${WORKSPACE_CURRENT_BRANCH:-<detached-or-unresolved>}"
        echo "  workspace deploy branch: ${WORKSPACE_TARGET_BRANCH:-<unresolved>}"
        echo "  workspace local sha: ${WORKSPACE_LOCAL_SHA:-<unresolved>}"
        echo "  workspace remote sha: ${WORKSPACE_REMOTE_SHA:-<unresolved>}"
        echo "  workspace dirty: $([[ "$WORKSPACE_DIRTY" -eq 1 ]] && echo yes || echo no)"
        echo "  workspace ahead/behind: ${WORKSPACE_AHEAD}/${WORKSPACE_BEHIND}"
    fi
    echo "  target branch: ${UPGRADE_TARGET_BRANCH:-<unresolved>}"
    echo "  deployed branch: ${UPGRADE_DEPLOYED_BRANCH:-<unknown>}"
    echo "  deployed sha: ${UPGRADE_DEPLOYED_SHA:-<unknown>}"
    echo "  target sha: ${UPGRADE_TARGET_SHA:-<unresolved>}"
    echo "  tracked drift: $([[ "$UPGRADE_TRACKED_DRIFT" -eq 1 ]] && echo yes || echo no)"
    if [[ -n "${ENV_FILE:-}" ]]; then
        echo "  env file: ${UPGRADE_RESOLVED_ENV_PATH:-<unresolved>}"
        echo "  env changed: $([[ "$UPGRADE_ENV_CHANGED" -eq 1 ]] && echo yes || echo no)"
        echo "  frontend env changed: $([[ "$UPGRADE_FRONTEND_ENV_CHANGED" -eq 1 ]] && echo yes || echo no)"
    else
        echo "  env file: unchanged (ENV_FILE empty)"
    fi
    if is_truthy "${SEED_RESUMES:-}"; then
        echo "  seed resumes: yes"
    fi
    if is_truthy "${FORCE:-}"; then
        echo "  force: yes"
    fi
    echo "  action: $UPGRADE_ACTION"
}

env_only_upgrade_steps() {
    ensure_node_22
    ensure_uv
    create_service_user
    sync_service_user_gh_credentials
    deploy_env_file
    setup_convex
    restart_units
}

env_only_upgrade_flow() {
    run_upgrade_steps_with_rollback "env-only" "env_only_upgrade_steps"

    echo ""
    log_info "Environment updated. Services restarted without rebuilding artifacts."
    echo "Check status with:"
    echo "  systemctl status trends-convex trends-api trends-worker trends-worker-api trends-mcp"
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

build_shared_artifact() {
    log_info "Building @trends/shared..."
    run_as_service_user "cd '$INSTALL_DIR' && npm run --workspace @trends/shared build"
}

build_artifacts() {
    log_info "Building @trends/api..."
    run_as_service_user "cd '$INSTALL_DIR' && npm run --workspace @trends/api build"

    log_info "Generating @trends/web API types..."
    run_as_service_user "cd '$INSTALL_DIR' && npm --workspace @trends/web run gen:api"

    log_info "Building browser extension zip for web download..."
    run_as_service_user "cd '$INSTALL_DIR' && ./scripts/build-extension-zip.sh"

    log_info "Building @trends/web..."
    run_as_service_user "cd '$INSTALL_DIR' && npm run --workspace @trends/web build"
    write_frontend_build_meta
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

frontend_dist_metadata_path() {
    printf '%s' "$INSTALL_DIR/apps/web/dist/.trends-build-meta"
}

write_frontend_build_meta() {
    local web_dir="$INSTALL_DIR/apps/web"
    local dist_dir="$web_dir/dist"
    local metadata_path=""
    local current_sha=""
    local current_branch=""
    local built_at=""

    if [[ ! -d "$web_dir" || ! -d "$dist_dir" ]]; then
        log_warn "Skipping frontend build metadata write because $dist_dir is missing."
        return 0
    fi

    metadata_path="$(frontend_dist_metadata_path)"
    current_sha="$(run_install_repo_git rev-parse HEAD 2>/dev/null || true)"
    current_branch="$(run_install_repo_git rev-parse --abbrev-ref HEAD 2>/dev/null || true)"
    built_at="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

    cat > "$metadata_path" <<EOF
git_sha=$current_sha
git_branch=$current_branch
built_at=$built_at
EOF
    chmod 600 "$metadata_path"
    chown "$SERVICE_USER:$SERVICE_GROUP" "$metadata_path"
}

frontend_dist_requires_rebuild() {
    local web_dir="$INSTALL_DIR/apps/web"
    local index_path="$web_dir/dist/index.html"
    local metadata_path=""
    local current_sha=""
    local current_commit_ts=""
    local built_sha=""
    local index_mtime=""

    if [[ ! -d "$web_dir" ]]; then
        return 1
    fi

    current_sha="$(run_install_repo_git rev-parse HEAD 2>/dev/null || true)"
    current_commit_ts="$(run_install_repo_git show -s --format=%ct HEAD 2>/dev/null || true)"
    metadata_path="$(frontend_dist_metadata_path)"

    if [[ ! -f "$index_path" ]]; then
        log_warn "Detected missing frontend dist index at $index_path; forcing a full upgrade."
        return 0
    fi

    index_mtime="$(stat -c %Y "$index_path" 2>/dev/null || true)"
    if [[ -n "$current_commit_ts" && -n "$index_mtime" && "$index_mtime" -lt "$current_commit_ts" ]]; then
        log_warn "Detected stale frontend dist index at $index_path (older than deployed commit); forcing a full upgrade."
        return 0
    fi

    if [[ ! -f "$metadata_path" ]]; then
        log_warn "Detected missing frontend build metadata at $metadata_path; forcing a full upgrade."
        return 0
    fi

    built_sha="$(read_env_var_from_file "$metadata_path" "git_sha" || true)"
    if [[ -z "$built_sha" || -z "$current_sha" || "$built_sha" != "$current_sha" ]]; then
        log_warn "Detected frontend build metadata drift (built sha: ${built_sha:-<missing>}, expected: ${current_sha:-<missing>}); forcing a full upgrade."
        return 0
    fi

    return 1
}

write_prefixed_env_snapshot() {
    local source_path="$1"
    local prefix="$2"
    local output_path="$3"

    : > "$output_path"
    if [[ ! -f "$source_path" ]]; then
        return
    fi

    grep -E "^[[:space:]]*${prefix}[A-Za-z0-9_]*=" "$source_path" | sort > "$output_path" || true
}

frontend_env_changed() {
    local current_env_path="$1"
    local next_env_path="$2"
    local current_snapshot=""
    local next_snapshot=""

    current_snapshot="$(mktemp)"
    next_snapshot="$(mktemp)"

    write_prefixed_env_snapshot "$current_env_path" "VITE_" "$current_snapshot"
    write_prefixed_env_snapshot "$next_env_path" "VITE_" "$next_snapshot"

    if cmp -s "$current_snapshot" "$next_snapshot"; then
        rm -f "$current_snapshot" "$next_snapshot"
        return 1
    fi

    rm -f "$current_snapshot" "$next_snapshot"
    return 0
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

sync_web_build_env() {
    local web_dir="$INSTALL_DIR/apps/web"
    local source_env="$INSTALL_DIR/.env.production"
    local web_env="$web_dir/.env.production"

    if [[ ! -d "$web_dir" ]]; then
        return 0
    fi

    log_info "Syncing VITE_* env vars to apps/web/.env.production..."
    mkdir -p "$web_dir"
    write_prefixed_env_snapshot "$source_env" "VITE_" "$web_env"
    chmod 600 "$web_env"
    chown "$SERVICE_USER:$SERVICE_GROUP" "$web_env"
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
    if is_truthy "${SEED_RESUMES:-}"; then
        seed_args="$seed_args --with-resumes"
        log_info "Seeding Convex: job descriptions + sample resumes..."
    else
        log_info "Seeding Convex: job descriptions only..."
    fi

    run_as_service_user "set -a && [ -f '$CONFIG_DIR/env' ] && source '$CONFIG_DIR/env' && set +a && cd '$INSTALL_DIR' && npx tsx '$seed_script' $seed_args" \
        || log_warn "Convex seed failed. Continuing with migrations."

    run_convex_migration "$convex_dir" "reindexSearchText"
    run_convex_migration "$convex_dir" "backfillPrimaryRuleScore"
    run_convex_migration "$convex_dir" "backfillEvidenceText"
    run_convex_migration "$convex_dir" "backfillWorkspaceSlugs"
    run_convex_migration "$convex_dir" "backfillManual51jobStructuredContent" '{"batchSize":100}'
    run_convex_migration "$convex_dir" "backfillIngestData" '{"limit":100}'
    run_convex_migration "$convex_dir" "backfillJob5156ProfileUrls"
    run_convex_migration "$convex_dir" "backfillJob5156WorkHistoryEducation"
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

copy_file_if_exists() {
    local source_path="$1"
    local target_path="$2"

    if [[ ! -f "$source_path" ]]; then
        return 0
    fi

    mkdir -p "$(dirname "$target_path")"
    cp "$source_path" "$target_path"
}

prepare_deploy_backup_dir() {
    local timestamp=""

    timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
    mkdir -p "$DEPLOY_BACKUP_DIR"
    DEPLOY_BACKUP_RUN_DIR="$DEPLOY_BACKUP_DIR/deploy-$timestamp-$$"
    mkdir -p "$DEPLOY_BACKUP_RUN_DIR"
    chown "$SERVICE_USER:$SERVICE_GROUP" "$DEPLOY_BACKUP_RUN_DIR" 2>/dev/null || true
    chmod 750 "$DEPLOY_BACKUP_RUN_DIR" 2>/dev/null || true

    DEPLOY_BACKUP_METADATA_PATH="$DEPLOY_BACKUP_RUN_DIR/metadata.txt"
    DEPLOY_BACKUP_CONVEX_PATH="$DEPLOY_BACKUP_RUN_DIR/convex.zip"
    DEPLOY_BACKUP_RESUME_PATH="$DEPLOY_BACKUP_RUN_DIR/resumes-${DEPLOY_BACKUP_RESUME_WORKSPACE}.tar.gz"
    DEPLOY_BACKUP_RESUME_EXISTS="false"
    DEPLOY_BACKUP_CONFIG_ENV_PATH="$DEPLOY_BACKUP_RUN_DIR/config.env"
    DEPLOY_BACKUP_INSTALL_ENV_PATH="$DEPLOY_BACKUP_RUN_DIR/install.env"
    DEPLOY_BACKUP_CONVEX_ENV_PATH="$DEPLOY_BACKUP_RUN_DIR/convex.env.local"
    DEPLOY_BACKUP_INSTALL_PATCH_PATH="$DEPLOY_BACKUP_RUN_DIR/install.patch"
}

write_deploy_backup_metadata() {
    cat > "$DEPLOY_BACKUP_METADATA_PATH" <<EOF
workspace_dir=$WORKSPACE_DIR
workspace_current_branch=${WORKSPACE_CURRENT_BRANCH:-}
workspace_target_branch=${WORKSPACE_TARGET_BRANCH:-}
workspace_local_sha=${WORKSPACE_LOCAL_SHA:-}
workspace_remote_sha=${WORKSPACE_REMOTE_SHA:-}
deployed_branch=${UPGRADE_DEPLOYED_BRANCH:-}
deployed_sha=${UPGRADE_DEPLOYED_SHA:-}
target_branch=${UPGRADE_TARGET_BRANCH:-}
target_sha=${UPGRADE_TARGET_SHA:-}
created_at=$(date -u +%Y-%m-%dT%H:%M:%SZ)
resume_backup_workspace=${DEPLOY_BACKUP_RESUME_WORKSPACE:-}
resume_backup_path=${DEPLOY_BACKUP_RESUME_PATH:-}
resume_backup_exists=${DEPLOY_BACKUP_RESUME_EXISTS:-false}
EOF
}

create_deploy_backup() {
    local convex_dir="$INSTALL_DIR/packages/convex"
    local convex_env_file="$convex_dir/.env.local"
    local export_command=""
    local resume_backup_command=""

    if [[ ! -d "$convex_dir" ]]; then
        log_warn "Skipping Convex backup: $convex_dir not found."
        return 0
    fi

    prepare_deploy_backup_dir
    copy_file_if_exists "$CONFIG_DIR/env" "$DEPLOY_BACKUP_CONFIG_ENV_PATH"
    copy_file_if_exists "$INSTALL_DIR/.env.production" "$DEPLOY_BACKUP_INSTALL_ENV_PATH"
    copy_file_if_exists "$convex_env_file" "$DEPLOY_BACKUP_CONVEX_ENV_PATH"

    if [[ "$UPGRADE_TRACKED_DRIFT" -eq 1 ]]; then
        if run_install_repo_git diff --binary --full-index > "$DEPLOY_BACKUP_INSTALL_PATCH_PATH"; then
            :
        else
            log_warn "Failed to capture tracked-drift patch for $INSTALL_DIR."
            rm -f "$DEPLOY_BACKUP_INSTALL_PATCH_PATH"
        fi
    fi

    if [[ ! -f "$convex_env_file" ]]; then
        log_error "Convex CLI env file not found: $convex_env_file"
        log_error "Cannot create a deploy backup without the existing Convex deployment selector."
        return 1
    fi

    export_command="set -a && [ -f '$CONFIG_DIR/env' ] && source '$CONFIG_DIR/env' && set +a && cd '$convex_dir' && npx convex export --path '$DEPLOY_BACKUP_CONVEX_PATH' --env-file '$convex_env_file'"
    if is_truthy "${DEPLOY_BACKUP_INCLUDE_FILE_STORAGE:-}"; then
        export_command="$export_command --include-file-storage"
    fi

    log_info "Exporting Convex backup to $DEPLOY_BACKUP_CONVEX_PATH..."
    run_as_service_user "$export_command"

    resume_backup_command="set -a && [ -f '$CONFIG_DIR/env' ] && source '$CONFIG_DIR/env' && set +a && cd '$INSTALL_DIR' && API_URL=\"http://127.0.0.1:\${PORT:-3000}\" WORKSPACE='$DEPLOY_BACKUP_RESUME_WORKSPACE' OUT='$DEPLOY_BACKUP_RESUME_PATH' npx tsx 'scripts/resume/backup-resumes.ts'"
    log_info "Exporting resume backup to $DEPLOY_BACKUP_RESUME_PATH (workspace: $DEPLOY_BACKUP_RESUME_WORKSPACE)..."
    if run_as_service_user "$resume_backup_command"; then
        DEPLOY_BACKUP_RESUME_EXISTS="true"
    else
        log_warn "Resume backup export failed; continuing with Convex snapshot only."
        rm -f "$DEPLOY_BACKUP_RESUME_PATH"
    fi

    write_deploy_backup_metadata
}

restore_deploy_files_from_backup() {
    if [[ -f "$DEPLOY_BACKUP_CONFIG_ENV_PATH" ]]; then
        mkdir -p "$CONFIG_DIR"
        cp "$DEPLOY_BACKUP_CONFIG_ENV_PATH" "$CONFIG_DIR/env"
        chmod 600 "$CONFIG_DIR/env"
        chown "$SERVICE_USER:$SERVICE_GROUP" "$CONFIG_DIR/env"
    fi

    if [[ -f "$DEPLOY_BACKUP_INSTALL_ENV_PATH" ]]; then
        mkdir -p "$INSTALL_DIR"
        cp "$DEPLOY_BACKUP_INSTALL_ENV_PATH" "$INSTALL_DIR/.env.production"
        chmod 600 "$INSTALL_DIR/.env.production"
        chown "$SERVICE_USER:$SERVICE_GROUP" "$INSTALL_DIR/.env.production"
    fi

    if [[ -f "$DEPLOY_BACKUP_CONVEX_ENV_PATH" ]]; then
        mkdir -p "$INSTALL_DIR/packages/convex"
        cp "$DEPLOY_BACKUP_CONVEX_ENV_PATH" "$INSTALL_DIR/packages/convex/.env.local"
        chmod 600 "$INSTALL_DIR/packages/convex/.env.local"
        chown "$SERVICE_USER:$SERVICE_GROUP" "$INSTALL_DIR/packages/convex/.env.local"
    fi
}

restore_install_repo_from_backup() {
    if [[ -z "$UPGRADE_DEPLOYED_SHA" ]]; then
        log_warn "Skipping code rollback because the previously deployed SHA is unknown."
        return 0
    fi

    log_warn "Rolling $INSTALL_DIR back to ${UPGRADE_DEPLOYED_SHA}..."
    if [[ -n "$UPGRADE_DEPLOYED_BRANCH" && "$UPGRADE_DEPLOYED_BRANCH" != "HEAD" ]]; then
        run_as_service_user "cd '$INSTALL_DIR' && git checkout -B '$UPGRADE_DEPLOYED_BRANCH' '$UPGRADE_DEPLOYED_SHA'"
    else
        run_as_service_user "cd '$INSTALL_DIR' && git checkout '$UPGRADE_DEPLOYED_SHA'"
    fi

    if [[ -s "$DEPLOY_BACKUP_INSTALL_PATCH_PATH" ]]; then
        run_as_service_user "cd '$INSTALL_DIR' && git apply '$DEPLOY_BACKUP_INSTALL_PATCH_PATH'"
    fi

    chown -R "$SERVICE_USER:$SERVICE_GROUP" "$INSTALL_DIR"
}

restore_convex_from_backup() {
    local convex_dir="$INSTALL_DIR/packages/convex"
    local convex_env_file="$convex_dir/.env.local"

    if [[ ! -f "$DEPLOY_BACKUP_CONVEX_PATH" ]]; then
        log_warn "Skipping Convex restore: backup snapshot not found at $DEPLOY_BACKUP_CONVEX_PATH."
        return 0
    fi

    if [[ -f "$DEPLOY_BACKUP_CONVEX_ENV_PATH" ]]; then
        convex_env_file="$DEPLOY_BACKUP_CONVEX_ENV_PATH"
    fi

    if [[ ! -f "$convex_env_file" ]]; then
        log_error "Cannot restore Convex snapshot because no CLI env file is available."
        return 1
    fi

    log_warn "Restoring Convex snapshot from $DEPLOY_BACKUP_CONVEX_PATH..."
    run_as_service_user "set -a && [ -f '$CONFIG_DIR/env' ] && source '$CONFIG_DIR/env' && set +a && cd '$convex_dir' && npx convex import --replace-all -y --env-file '$convex_env_file' '$DEPLOY_BACKUP_CONVEX_PATH'"
}

rollback_failed_upgrade() {
    local rollback_mode="$1"
    local rollback_failed=0

    if [[ -z "$DEPLOY_BACKUP_RUN_DIR" ]]; then
        log_error "Deploy failed before rollback state was prepared."
        return 1
    fi

    log_warn "Deploy failed. Rolling back using backup in $DEPLOY_BACKUP_RUN_DIR..."
    restore_deploy_files_from_backup || rollback_failed=1

    if [[ "$rollback_mode" == "full" ]]; then
        restore_install_repo_from_backup || rollback_failed=1
        sync_dependencies || rollback_failed=1
        sync_web_build_env || rollback_failed=1
        build_shared_artifact || rollback_failed=1
    fi

    if [[ -d "$INSTALL_DIR/packages/convex" ]]; then
        setup_convex || rollback_failed=1
        restore_convex_from_backup || rollback_failed=1
    fi

    if [[ "$rollback_mode" == "full" ]]; then
        build_artifacts || rollback_failed=1
        stop_port_processes 3000
        remove_legacy_units
        install_systemd_units || rollback_failed=1
    fi

    restart_units || rollback_failed=1

    if [[ "$rollback_failed" -ne 0 ]]; then
        log_error "Rollback completed with errors. Inspect $DEPLOY_BACKUP_RUN_DIR and systemd logs."
        return 1
    fi

    log_warn "Rollback completed successfully."
}

prune_deploy_backups() {
    local keep="${KEEP_DEPLOY_BACKUPS:-10}"
    local backups=()
    local backup_path=""
    local excess=0
    local index=0

    if [[ ! "$keep" =~ ^[0-9]+$ ]]; then
        log_warn "KEEP_DEPLOY_BACKUPS=$keep is not numeric; skipping backup pruning."
        return 0
    fi

    if [[ "$keep" -lt 1 || ! -d "$DEPLOY_BACKUP_DIR" ]]; then
        return 0
    fi

    while IFS= read -r backup_path; do
        backups+=("$backup_path")
    done < <(find "$DEPLOY_BACKUP_DIR" -mindepth 1 -maxdepth 1 -type d -name 'deploy-*' | sort)

    excess=$(( ${#backups[@]} - keep ))
    if [[ "$excess" -le 0 ]]; then
        return 0
    fi

    for ((index = 0; index < excess; index += 1)); do
        rm -rf "${backups[$index]}"
    done
}

run_upgrade_steps_with_rollback() {
    local rollback_mode="$1"
    local flow_name="$2"
    local status=0

    create_deploy_backup

    set +e
    "$flow_name"
    status=$?
    set -e

    if [[ "$status" -ne 0 ]]; then
        rollback_failed_upgrade "$rollback_mode" || true
        return "$status"
    fi

    prune_deploy_backups
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
    sync_web_build_env
    build_shared_artifact
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

full_upgrade_steps() {
    clone_or_update_repo
    sync_dependencies
    if [[ -n "$ENV_FILE" ]]; then
        deploy_env_file
        sync_web_build_env
    else
        log_info "ENV_FILE is empty; keeping existing $CONFIG_DIR/env unchanged."
    fi
    build_shared_artifact
    setup_convex
    build_artifacts
    seed_and_migrate_convex
    stop_port_processes 3000
    remove_legacy_units
    install_systemd_units
    restart_units
}

upgrade_flow() {
    check_root
    check_systemd
    require_git
    ensure_repo_access
    preflight_workspace_repo "1"

    if [[ ! -d "$INSTALL_DIR/.git" ]]; then
        log_error "$INSTALL_DIR is not a git repository. Run install first."
        exit 1
    fi

    create_service_user
    plan_upgrade_action
    print_upgrade_plan

    if [[ "$UPGRADE_ACTION" == "skip" ]]; then
        log_info "No update required. Deployed code and environment already match the target."
        return 0
    fi

    if [[ "$UPGRADE_ACTION" == "env-only" ]]; then
        env_only_upgrade_flow
        return 0
    fi

    ensure_node_22
    ensure_uv
    sync_service_user_gh_credentials
    run_upgrade_steps_with_rollback "full" "full_upgrade_steps"

    echo ""
    log_info "Upgrade completed. Services restarted."
    echo "Check status with:"
    echo "  systemctl status trends-convex trends-api trends-worker trends-worker-api trends-mcp"
}

upgrade_check_flow() {
    check_root
    check_systemd
    require_git
    ensure_repo_access
    preflight_workspace_repo "0"

    if [[ ! -d "$INSTALL_DIR/.git" ]]; then
        log_error "$INSTALL_DIR is not a git repository. Run install first."
        exit 1
    fi

    create_service_user
    plan_upgrade_action
    print_upgrade_plan

    if [[ "$UPGRADE_ACTION" == "skip" ]]; then
        log_info "No update required."
    elif [[ "$UPGRADE_ACTION" == "env-only" ]]; then
        log_info "Deploy would refresh environment and restart services."
    else
        log_info "Deploy would run a full upgrade."
    fi
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

print_usage() {
    echo "Usage: $0 [install|upgrade|upgrade-check|uninstall|--help]"
    echo ""
    echo "Commands:"
    echo "  install        Install the full Trends production stack"
    echo "  upgrade        Pull, rebuild, and restart the deployed stack"
    echo "  upgrade-check  Show whether deploy would skip, refresh env, or run full upgrade"
    echo "  uninstall      Remove installed systemd services"
    echo "  --help, -h     Show this help message"
    echo ""
    echo "Environment variables:"
    echo "  ENV_FILE               Production env file path (default: .env.production)"
    echo "  WORKSPACE_DIR          Source checkout to compare against origin before deploy (default: current directory)"
    echo "                         When INSTALL_BRANCH is unset, deploy uses the workspace's current branch"
    echo "  INSTALL_BRANCH         Branch to install or upgrade to (overrides workspace branch)"
    echo "  FORCE                  Force upgrade flow even when no changes are detected"
    echo "  SEED_RESUMES           Seed demo resumes during install/upgrade when truthy"
    echo "  ALLOW_NODE_DOWNGRADE   Permit downgrading a newer Node.js to the required v22"
    echo "  DEPLOY_BACKUP_DIR      Directory for pre-deploy Convex snapshots (default: /var/backups/trends/deploy)"
    echo "  KEEP_DEPLOY_BACKUPS    Number of deploy backups to retain after successful upgrades (default: 10)"
    echo "  DEPLOY_BACKUP_INCLUDE_FILE_STORAGE"
    echo "                         Include Convex file storage in the pre-deploy backup when truthy"
    echo "  DEPLOY_BACKUP_RESUME_WORKSPACE"
    echo "                         Workspace slug for best-effort resumes-<workspace>.tar.gz export (default: dev)"
    echo "  CONVEX_MIRROR_MODE     Convex prefetch source order: off|fallback|mirror-first"
    echo "                         Default is fallback, or off when CI=true/1"
    echo "  CONVEX_MIRROR_BASES    Convex prefetch mirror base URLs (comma-separated)"
    echo "  CONVEX_DOWNLOAD_TIMEOUT_SECS / CONVEX_CONNECT_TIMEOUT_SECS"
    echo "                         Convex prefetch timeout overrides"
    echo "  CONVEX_CURL_NO_SILENT  When true/1, keep Convex prefetch curl progress output enabled"
    echo "  CI                     When true/1, shared Convex prefetch mode defaults to off"
    echo ""
    echo "See $WORKSPACE_DIR/scripts/prefetch-convex-backend.sh --help for the full Convex prefetch env contract."
}

main() {
    case "${1:-install}" in
        --help|-h)
            print_usage
            ;;
        install)
            install_flow
            ;;
        upgrade)
            upgrade_flow
            ;;
        upgrade-check)
            upgrade_check_flow
            ;;
        uninstall)
            uninstall_flow
            ;;
        *)
            print_usage >&2
            exit 1
            ;;
    esac
}

main "$@"
