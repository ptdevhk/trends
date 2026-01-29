#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

log_info() {
    echo -e "${CYAN}[INFO]${NC} $*"
}

log_warn() {
    echo -e "${YELLOW}[WARN]${NC} $*"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $*"
}

log_ok() {
    echo -e "${GREEN}[OK]${NC} $*"
}

usage() {
    cat << 'EOF'
Usage:
  ./scripts/toggle-repo.sh              Switch to private (default)
  ./scripts/toggle-repo.sh --public     Switch to public
  ./scripts/toggle-repo.sh --status     Show current visibility
  ./scripts/toggle-repo.sh --dry-run    Preview the default private switch
  ./scripts/toggle-repo.sh --help       Show this help

Notes:
  - Must be run in an interactive terminal (TTY).
  - Requires GitHub CLI (gh) and authentication with admin access.
  - Forked repositories cannot have their visibility changed (GitHub restriction).
  - Visibility changes require accepting GitHub's warning via:
      --accept-visibility-change-consequences
EOF
}

require_tty() {
    if [[ ! -t 0 || ! -t 1 ]]; then
        log_error "Refusing to run: not an interactive terminal (TTY required)."
        log_error "This prevents non-interactive automation/bots from changing visibility."
        exit 1
    fi
}

require_gh() {
    if ! command -v gh >/dev/null 2>&1; then
        log_error "GitHub CLI not found: 'gh'"
        log_error "Install from: https://cli.github.com/"
        exit 1
    fi
}

require_git_repo() {
    if ! command -v git >/dev/null 2>&1; then
        log_error "git not found"
        exit 1
    fi
    if ! git -C "$PROJECT_ROOT" rev-parse --is-inside-work-tree >/dev/null 2>&1; then
        log_error "Not a git repository: $PROJECT_ROOT"
        exit 1
    fi
}

require_not_fork() {
    if [[ "${REPO_IS_FORK:-}" == "true" ]]; then
        log_error "Cannot change visibility: ${REPO_NAME} is a fork."
        log_error ""
        log_error "GitHub prohibits visibility changes for forked repositories."
        log_error "See: https://docs.github.com/en/repositories/creating-and-managing-repositories/changing-a-repositories-visibility"
        log_error ""
        log_error "Alternatives:"
        log_error "  1. Detach the fork (contact GitHub support)"
        log_error "  2. Create a new non-fork repository and push the code"
        log_error "  3. Use a different deployment method (Docker, self-hosted)"
        exit 1
    fi
}

get_repo_info() {
    local info
    if ! info="$(cd "$PROJECT_ROOT" && gh repo view --json nameWithOwner,visibility,isFork --jq '.nameWithOwner + "\n" + .visibility + "\n" + (.isFork | tostring)' 2>/dev/null)"; then
        log_error "Failed to query repository via 'gh'."
        log_error "Run: gh auth login"
        exit 1
    fi
    REPO_NAME="$(printf '%s\n' "$info" | sed -n '1p')"
    REPO_VISIBILITY="$(printf '%s\n' "$info" | sed -n '2p')"
    REPO_IS_FORK="$(printf '%s\n' "$info" | sed -n '3p')"
}

print_consequences() {
    cat << EOF
${YELLOW}GitHub warning (gh_repo_edit):${NC}
Changing repository visibility can have unexpected consequences including but not limited to:
  - losing stars and watchers, affecting repository ranking
  - detaching public forks from the network
  - disabling push rulesets
  - allowing access to GitHub Actions history and logs
EOF
}

confirm_visibility_change() {
    local desired="$1"
    local desired_upper
    desired_upper="$(printf '%s' "$desired" | tr '[:lower:]' '[:upper:]')"

    echo -e "${YELLOW}Prerequisites:${NC}"
    echo -e "  - Authenticated via ${CYAN}gh${NC} with admin access"
    echo -e "  - Token permissions include ${CYAN}repo${NC} scope (classic PAT) or equivalent rights"
    echo ""
    echo -e "${RED}About to change visibility${NC} for ${CYAN}${REPO_NAME}${NC}: ${CYAN}${REPO_VISIBILITY}${NC} -> ${CYAN}${desired_upper}${NC}"
    echo ""
    print_consequences
    echo ""
    echo -e "${YELLOW}Command:${NC} gh repo edit \"${REPO_NAME}\" --visibility \"${desired}\" --accept-visibility-change-consequences"
    echo ""

    local answer
    read -r -p "Type 'yes' to proceed: " answer
    if [[ "$answer" != "yes" ]]; then
        log_warn "Aborted. (Expected exactly: yes)"
        exit 1
    fi
}

show_status() {
    log_info "Repository: ${REPO_NAME}"
    log_info "Visibility: ${REPO_VISIBILITY}"
    if [[ "$REPO_IS_FORK" == "true" ]]; then
        log_warn "This repository is a fork (visibility cannot be changed)"
    fi
}

apply_visibility() {
    local desired="$1"
    local current_upper desired_upper

    current_upper="$(printf '%s' "$REPO_VISIBILITY" | tr '[:lower:]' '[:upper:]')"
    desired_upper="$(printf '%s' "$desired" | tr '[:lower:]' '[:upper:]')"

    if [[ "$current_upper" == "$desired_upper" ]]; then
        log_ok "No change needed: ${REPO_NAME} is already ${REPO_VISIBILITY}"
        return 0
    fi

    if [[ "$DRY_RUN" == "true" ]]; then
        log_warn "DRY RUN: no changes will be made."
        show_status
        echo -e "${YELLOW}Would run:${NC} gh repo edit \"${REPO_NAME}\" --visibility \"${desired}\" --accept-visibility-change-consequences"
        return 0
    fi

    confirm_visibility_change "$desired"
    if ! (cd "$PROJECT_ROOT" && gh repo edit "$REPO_NAME" --visibility "$desired" --accept-visibility-change-consequences); then
        log_error "Visibility change failed."
        log_error "Confirm you have admin access and sufficient token permissions."
        log_error "If using a classic PAT, you may need: gh auth refresh -s repo"
        exit 1
    fi

    get_repo_info
    log_ok "Updated visibility: ${REPO_VISIBILITY}"
}

ACTION="private"
DRY_RUN="false"
STATUS_ONLY="false"

while [[ $# -gt 0 ]]; do
    case "$1" in
        --public)
            ACTION="public"
            shift
            ;;
        --status)
            STATUS_ONLY="true"
            shift
            ;;
        --dry-run)
            DRY_RUN="true"
            shift
            ;;
        --help|-h)
            usage
            exit 0
            ;;
        *)
            log_error "Unknown argument: $1"
            echo ""
            usage
            exit 1
            ;;
    esac
done

require_tty
require_gh
require_git_repo
get_repo_info

if [[ "$STATUS_ONLY" == "true" ]]; then
    show_status
    exit 0
fi

require_not_fork
apply_visibility "$ACTION"
