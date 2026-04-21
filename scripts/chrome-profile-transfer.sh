#!/usr/bin/env bash
# Clone the local Chrome debug profile to a remote SSH host (Windows or Linux)
# and launch Chrome on the remote side in headed mode.
#
# Primary use case: bypass device-bound auth (e.g., 51job) by transferring the
# logged-in session from the device where auth was performed. The Chrome profile
# carries cookies + localStorage + the Local State encryption key; on first
# launch the remote OS re-wraps that key using its own keyring.
#
# Usage:
#   scripts/chrome-profile-transfer.sh <ssh-host>
#   scripts/chrome-profile-transfer.sh <ssh-host> --no-launch
#   scripts/chrome-profile-transfer.sh <ssh-host> --source /path/to/profile
#
# Requirements:
#   - SSH access to the target host (Windows OpenSSH or Linux OpenSSH).
#   - On Windows target: `tar` (bundled with Windows 10 1803+ and all Windows 11).
#   - On Windows target: `schtasks` (for interactive GUI launch from SSH).
#   - Chrome installed on the target (use `winget install Google.Chrome` or
#     distro package manager). See dev-docs for the install recipe.
#
# Safety:
#   - The transferred profile contains live session cookies. Treat as a secret.
#   - The tar is removed from the remote after extraction.
#   - This script does NOT delete the local source profile.

set -euo pipefail

SSH_HOST=""
LAUNCH=1
SOURCE_PROFILE=""

log_info()  { echo "[INFO] $*"; }
log_ok()    { echo "[OK] $*"; }
log_error() { echo "[ERROR] $*" >&2; }

usage() {
  sed -n '2,25p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
  exit 1
}

# SSH multiplexing: one master connection, all subsequent calls ride it.
SSH_SOCKET="$(mktemp -t ssh-ctrl-XXXX)"
cleanup_ssh() {
  ssh -o ControlPath="$SSH_SOCKET" -O exit "$SSH_HOST" 2>/dev/null || true
  rm -f "$SSH_SOCKET"
}
# shellcheck disable=SC2064
trap 'cleanup_ssh' EXIT

ssh_m() { ssh -o ControlPath="$SSH_SOCKET" "$@"; }
scp_m() { scp -o ControlPath="$SSH_SOCKET" "$@"; }

while [[ $# -gt 0 ]]; do
  case "$1" in
    --no-launch) LAUNCH=0; shift ;;
    --source)    SOURCE_PROFILE="$2"; shift 2 ;;
    -h|--help)   usage ;;
    -*)          log_error "Unknown flag: $1"; usage ;;
    *)           SSH_HOST="$1"; shift ;;
  esac
done

if [[ -z "$SSH_HOST" ]]; then
  log_error "ssh-host is required"
  usage
fi

# Default source profile: matches chrome-debug.sh's get_default_user_clone_dir().
if [[ -z "$SOURCE_PROFILE" ]]; then
  if [[ "${OSTYPE:-}" == "darwin"* ]]; then
    SOURCE_PROFILE="$HOME/Library/Application Support/Google/chrome-debug-profile-from-default"
  else
    SOURCE_PROFILE="${XDG_CONFIG_HOME:-$HOME/.config}/Google/chrome-debug-profile-from-default"
  fi
fi

if [[ ! -d "$SOURCE_PROFILE" ]]; then
  log_error "Source profile not found: $SOURCE_PROFILE"
  log_error "Run scripts/chrome-debug.sh first to create it, and log in to the target site."
  exit 1
fi

# Establish SSH multiplexing master — all subsequent ssh/scp calls reuse it.
ssh -o ControlMaster=auto -o ControlPath="$SSH_SOCKET" -o ControlPersist=60 "$SSH_HOST" "true"

# Detect target OS + resolve remote username in a single SSH round-trip.
# Windows OpenSSH does not have `uname`, so that part fails; fallback to cmd.
log_info "Detecting target OS on $SSH_HOST..."
REMOTE_INFO="$(ssh_m "$SSH_HOST" "uname -s 2>/dev/null; whoami 2>/dev/null || cmd /c echo %USERNAME%" 2>/dev/null || true)"
TARGET_UNAME="$(echo "$REMOTE_INFO" | head -1 | tr -d '\r\n')"
REMOTE_USER="$(echo "$REMOTE_INFO" | tail -1 | tr -d '\r\n')"

if [[ -n "$TARGET_UNAME" ]]; then
  case "$TARGET_UNAME" in
    Darwin)  TARGET_OS="macos" ;;
    Linux)   TARGET_OS="linux" ;;
    *)       TARGET_OS="linux" ;;
  esac
else
  TARGET_OS="windows"
fi
log_info "Target OS: $TARGET_OS  User: $REMOTE_USER"

TAR_LOCAL="$(mktemp -t chrome-profile-XXXX).tar.gz"
cleanup_local() { rm -f "$TAR_LOCAL"; cleanup_ssh; }
# shellcheck disable=SC2064
trap 'cleanup_local' EXIT

# Exclude cache dirs that are irrelevant for session transfer — reduces tar by 50-80%.
log_info "Packing profile: $SOURCE_PROFILE"
tar czf "$TAR_LOCAL" \
  --exclude='Cache' --exclude='GPUCache' --exclude='Code Cache' \
  --exclude='Service Worker' --exclude='blob_storage' --exclude='GrShaderCache' \
  --exclude='ShaderCache' --exclude='GraphiteDawnCache' \
  -C "$SOURCE_PROFILE" .
log_ok "Packed $(du -h "$TAR_LOCAL" | awk '{print $1}')"

launch_chrome() {
  local ssh_host="$1" chrome_cmd="$2" user_data_dir="$3" note="$4"
  if [[ "$LAUNCH" == "1" ]]; then
    log_info "Launching Chrome (headed) on $ssh_host... $note"
    ssh_m "$ssh_host" "$chrome_cmd --user-data-dir=\"$user_data_dir\""
    log_ok "Chrome launched on $ssh_host (headed)."
  else
    log_info "--no-launch set; skipping Chrome launch."
    log_info "To launch manually: $chrome_cmd --user-data-dir=\"$user_data_dir\""
  fi
}

case "$TARGET_OS" in
  windows)
    WIN_BASE="C:\\Users\\${REMOTE_USER}\\AppData\\Local\\Google"
    EXTRACT_DIR="${WIN_BASE}\\Chrome\\User Data"
    SCP_DEST="C:/Users/${REMOTE_USER}/AppData/Local/Google/chrome-profile.tar.gz"
    TAR_REMOTE="${WIN_BASE}\\chrome-profile.tar.gz"

    # Idempotent directory creation (no TOCTOU).
    log_info "Creating remote directories..."
    ssh_m "$SSH_HOST" "powershell -Command \"New-Item -ItemType Directory -Force -Path '${EXTRACT_DIR}'\" | Out-Null"

    log_info "Uploading tarball..."
    scp_m "$TAR_LOCAL" "$SSH_HOST:$SCP_DEST"

    # Extract + delete tarball in one SSH session; if extraction fails, still delete.
    log_info "Extracting on remote..."
    ssh_m "$SSH_HOST" "powershell -Command \"tar -xzf '${TAR_REMOTE}' -C '${EXTRACT_DIR}'; Remove-Item '${TAR_REMOTE}' -Force\""

    log_ok "Profile extracted to $EXTRACT_DIR"

    # Windows SSH runs in a non-interactive session — schtasks /it bridges to the desktop.
    launch_chrome "$SSH_HOST" \
      "schtasks /create /tn TrendsChromeProfile /tr \"\\\"C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe\\\" --user-data-dir=\\\"${EXTRACT_DIR}\\\"\" /sc once /st 23:59 /rl highest /f /it && schtasks /run /tn TrendsChromeProfile && schtasks /delete /tn TrendsChromeProfile /f" \
      "$EXTRACT_DIR" \
      "(via schtasks /it for interactive desktop)"
    ;;

  linux|macos)
    if [[ "$TARGET_OS" == "macos" ]]; then
      REMOTE_DIR="/Users/${REMOTE_USER}/Library/Application Support/Google/chrome-debug-profile-from-default"
      CHROME_CMD="nohup \"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome\""
    else
      REMOTE_DIR="/home/${REMOTE_USER}/.config/google-chrome-debug-profile"
      CHROME_CMD="DISPLAY=\${DISPLAY:-:0} nohup google-chrome-stable || nohup google-chrome || nohup chromium-browser"
    fi
    REMOTE_TMP="/tmp/chrome-profile.tar.gz"

    log_info "Uploading tarball..."
    scp_m "$TAR_LOCAL" "$SSH_HOST:$REMOTE_TMP"

    # mkdir + extract + rm in one SSH session.
    log_info "Extracting on remote..."
    ssh_m "$SSH_HOST" "mkdir -p \"$REMOTE_DIR\" && tar xzf \"$REMOTE_TMP\" -C \"$REMOTE_DIR\" && rm -f \"$REMOTE_TMP\""
    log_ok "Profile extracted to $REMOTE_DIR"

    launch_chrome "$SSH_HOST" "$CHROME_CMD" "$REMOTE_DIR" ""
    ;;
esac

log_ok "Done."
