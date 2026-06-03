#!/usr/bin/env bash
# Setup a macOS Chrome profile on a Linux LXC (cmux) to bypass 51job device-bound auth.
#
# Primary use case: copy the logged-in 51job Chrome session from your Mac to a
# cmux LXC, so the container's Chrome inherits the auth cookies and skips re-auth.
#
# Workflow (run from your Mac workspace):
#   1. Create tarball:  scripts/create-chrome-profile-tarball.sh
#   2. Upload to LXC:   scp ./tmp/chrome-profile-for-lxc.tar.gz root@<lxc-ip>:/root/chrome-profile-macos.tar.gz
#   3. On the LXC:      ./scripts/chrome-profile-setup.sh --cmux /root/chrome-profile-macos.tar.gz
#   4. Start Chrome:    systemctl restart cmux-devtools.service
#   5. Verify session:  strings /root/.config/chrome/Default/Cookies | grep -i 51job
#
# Usage: chrome-profile-setup.sh [tarball_path] [target_dir]
#        chrome-profile-setup.sh --cmux /path/to/macos-profile.tar.gz
#
# Default paths:
#   tarball: /root/chrome-profile-macos.tar.gz
#   target:  /root/.config/chrome (or $CHROME_USER_DATA_DIR)
#
# For cmux compatibility, use: --cmux flag to set target to cmux default
#
# Limitations:
#   - The macOS→Linux cookie encryption key migration requires removing the
#     OS-bound key from Local State so Chrome re-wraps it with the Linux keyring
#     (or basic storage when --password-store=basic is in use, as cmux does).
#   - As a side effect, passwords that were saved in the macOS Chrome profile
#     (and carried inside the tarball) are NOT visible in the restored Chrome on
#     the LXC — the decrypted keyring data does not survive the OS migration.
#     This does NOT affect session cookies — 51job device-auth bypass works.
#   - Keep the source Mac profile fresh (re-login periodically); cookies expire.
#   - Do NOT commit the tarball to git — it contains live session secrets.

set -euo pipefail

# Parse args
USE_CMUX=0
TARBALL=""
TARGET_DIR=""

while [[ $# -gt 0 ]]; do
    case "$1" in
        --cmux) USE_CMUX=1; shift ;;
        -h|--help)
            sed -n '2,12p' "$0" | sed 's/^# //'
            exit 0
            ;;
        -*) echo "Unknown option: $1"; exit 1 ;;
        *)
            if [[ -z "$TARBALL" ]]; then
                TARBALL="$1"
            elif [[ -z "$TARGET_DIR" ]]; then
                TARGET_DIR="$1"
            fi
            shift
            ;;
    esac
done

# Set defaults
if [[ -z "$TARBALL" ]]; then
    TARBALL="/root/chrome-profile-macos.tar.gz"
fi

if [[ -z "$TARGET_DIR" ]]; then
    if [[ "$USE_CMUX" -eq 1 ]]; then
        TARGET_DIR="/root/.config/chrome"
    else
        TARGET_DIR="${CHROME_USER_DATA_DIR:-/root/.config/chrome}"
    fi
fi

log_info() { echo "[INFO] $*"; }
log_ok()   { echo "[OK] $*"; }
log_warn() { echo "[WARN] $*"; }
log_error(){ echo "[ERROR] $*" >&2; }

# Check if running as root
if [[ "$EUID" -ne 0 ]]; then
    log_error "This script must be run as root"
    exit 1
fi

# Stop any running Chrome
log_info "Stopping Chrome..."
pkill -9 chrome 2>/dev/null || true
sleep 2

# Verify tarball exists
if [[ ! -f "$TARBALL" ]]; then
    log_error "Tarball not found: $TARBALL"
    log_info "Please upload the tarball first, e.g.:"
    log_info "  scp chrome-profile-macos.tar.gz root@10.10.1.13:$TARBALL"
    exit 1
fi

# Clean and extract
log_info "Cleaning existing profile at $TARGET_DIR..."
rm -rf "$TARGET_DIR"
mkdir -p "$TARGET_DIR"

log_info "Extracting tarball..."
tar xzf "$TARBALL" -C "$TARGET_DIR" 2>/dev/null || {
    log_warn "tar warnings (expected for macOS xattrs)"
}

# Fix ownership
chown -R root:root "$TARGET_DIR"
chmod -R u+rwX "$TARGET_DIR"

log_ok "Profile extracted to $TARGET_DIR"

# Patch Local State for Linux keyring
LOCAL_STATE="$TARGET_DIR/Local State"
if [[ -f "$LOCAL_STATE" ]]; then
    log_info "Patching Local State for Linux keyring compatibility..."
    
    python3 << 'PYFIX' - "$LOCAL_STATE"
import json
import sys
import shutil
from datetime import datetime

state_file = sys.argv[1]
backup_file = state_file + ".backup." + datetime.now().strftime("%Y%m%d_%H%M%S")

# Backup original
shutil.copy2(state_file, backup_file)
print(f"Backed up to: {backup_file}")

with open(state_file, "r") as f:
    data = json.load(f)

# Remove OS-specific encrypted keys to force re-wrap with Linux keyring
modified = False
if "os_crypt" in data:
    if "encrypted_key" in data["os_crypt"]:
        del data["os_crypt"]["encrypted_key"]
        print("Removed os_crypt.encrypted_key")
        modified = True
    if "app_bound_encrypted_key" in data["os_crypt"]:
        del data["os_crypt"]["app_bound_encrypted_key"]
        print("Removed os_crypt.app_bound_encrypted_key")
        modified = True

# Remove any profile-specific machine IDs that might cause issues
if "profile" in data:
    for profile_id, profile_data in data["profile"].items():
        if isinstance(profile_data, dict):
            # Remove machine-specific identifiers
            if "exit_type" in profile_data:
                profile_data["exit_type"] = "Normal"
            if "exited_cleanly" in profile_data:
                profile_data["exited_cleanly"] = True

with open(state_file, "w") as f:
    json.dump(data, f, indent=2)

print("Local State patched for Linux")
PYFIX
    
    log_ok "Local State patched"
else
    log_warn "Local State not found"
fi

# Clear any stale lock files
log_info "Clearing stale lock files..."
rm -f "$TARGET_DIR"/*/SingletonLock 2>/dev/null || true
rm -f "$TARGET_DIR"/*/SingletonCookie 2>/dev/null || true
rm -f "$TARGET_DIR"/*/SingletonSocket 2>/dev/null || true

# Create a marker file for cmux
mkdir -p /var/lib/cmux
echo "$(date -Iseconds)" > /var/lib/cmux/chrome-profile-imported

log_ok "Chrome profile setup complete!"
echo ""
echo "Next steps:"
echo "  1. Start Chrome: systemctl restart cmux-devtools.service"
echo "  2. Or manually: cd /usr/local/lib/cmux && bash cmux-start-chrome"
echo "  3. Verify CDP: curl -s http://127.0.0.1:39382/json/version"
echo ""
echo "To verify 51job session:"
echo "  strings /root/.config/chrome/Default/Cookies | grep -i 51job"
