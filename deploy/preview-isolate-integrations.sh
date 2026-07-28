#!/usr/bin/env bash
# Disable production-facing integrations on the preview environment.
# Mutates only $PREVIEW_ENV_FILE (and optionally Convex env via sync).
# Never touches /etc/trends/env or production services.
#
# Usage:
#   sudo bash deploy/preview-isolate-integrations.sh
#   sudo ASSUME_YES=1 bash deploy/preview-isolate-integrations.sh --apply
#
# Default is dry-run. Pass --apply to write changes.
set -Eeuo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib-preview-common.sh
# shellcheck disable=SC1091
source "$SCRIPT_DIR/lib-preview-common.sh"

APPLY=0
for arg in "$@"; do
    case "$arg" in
        --apply) APPLY=1 ;;
        --dry-run) APPLY=0 ;;
        -h|--help)
            sed -n '2,14p' "$0"
            exit 0
            ;;
        *)
            log_error "Unknown argument: $arg"
            exit 2
            ;;
    esac
done

require_root
assert_not_prod_install_dir "$PREVIEW_DIR" || exit 1

if [[ ! -f "$PREVIEW_ENV_FILE" ]]; then
    log_error "Missing preview env: $PREVIEW_ENV_FILE"
    exit 1
fi

TS="$(date -u +%Y%m%dT%H%M%SZ)"
BACKUP_ENV="/tmp/preview-env-before-isolate-${TS}.env"
cp -a "$PREVIEW_ENV_FILE" "$BACKUP_ENV"
chmod 600 "$BACKUP_ENV"
log_info "Backed up preview env to $BACKUP_ENV"

# Keys to clear or force for preview safety
# - Telegram: clear tokens so notifications cannot hit prod chats
# - Optional webhook/payment-style keys if present
CLEAR_KEYS=(
    TELEGRAM_BOT_TOKEN
    TELEGRAM_CHAT_ID
    TELEGRAM_CHAT_ID_2
    SLACK_WEBHOOK_URL
    SLACK_BOT_TOKEN
    WEBHOOK_URL
    STRIPE_SECRET_KEY
    STRIPE_WEBHOOK_SECRET
    PAYMENT_WEBHOOK_SECRET
)

# Force-set keys (preview isolation)
FORCE_SETS=(
    "AUTH_ALLOWED_ORIGINS=https://${PREVIEW_PUBLIC_HOST},chrome-extension://pafaiemddagkegcjcaihcomblnpjfmkf"
    "CONVEX_URL=http://127.0.0.1:4210"
    "CONVEX_PUBLIC_URL=https://${PREVIEW_PUBLIC_HOST}/convex"
)

log_step "Preview integration isolation ($([[ $APPLY -eq 1 ]] && echo APPLY || echo DRY-RUN))"

python3 - "$PREVIEW_ENV_FILE" "$APPLY" "${CLEAR_KEYS[@]}" -- "${FORCE_SETS[@]}" <<'PY'
import pathlib, sys

env_path = pathlib.Path(sys.argv[1])
apply = sys.argv[2] == "1"
args = sys.argv[3:]
sep = args.index("--")
clear_keys = set(args[:sep])
force_pairs = {}
for item in args[sep + 1 :]:
    if "=" not in item:
        continue
    k, v = item.split("=", 1)
    force_pairs[k] = v

lines = env_path.read_text().splitlines()
seen = set()
out = []
changes = []

def set_line(key, value):
    # shell-safe single-quote if needed
    if any(c in value for c in " #'\"\\$"):
        value = "'" + value.replace("'", "'\"'\"'") + "'"
    return f"{key}={value}"

for raw in lines:
    stripped = raw.strip()
    if not stripped or stripped.startswith("#") or "=" not in stripped:
        out.append(raw)
        continue
    line = stripped[7:].strip() if stripped.startswith("export ") else stripped
    key, val = line.split("=", 1)
    key = key.strip()
    seen.add(key)
    if key in clear_keys:
        if val.strip() not in ("", "''", '""'):
            changes.append(f"CLEAR {key}")
        out.append(f"{key}=")
        continue
    if key in force_pairs:
        new = force_pairs[key]
        if val.strip().strip("'\"") != new:
            changes.append(f"SET {key}={new}")
        out.append(set_line(key, new))
        continue
    out.append(raw)

for key, new in force_pairs.items():
    if key not in seen:
        changes.append(f"ADD {key}={new}")
        out.append(set_line(key, new))

for key in sorted(clear_keys):
    if key not in seen:
        # no-op for absent keys
        pass

print("Planned changes:")
if not changes:
    print("  (none)")
else:
    for c in changes:
        print(f"  {c}")

if apply:
    env_path.write_text("\n".join(out) + "\n")
    print(f"Wrote {env_path}")
else:
    print("Dry-run only; re-run with --apply to write.")
PY

if [[ "$APPLY" -eq 1 ]]; then
    chmod 600 "$PREVIEW_ENV_FILE"
    chown "$PREVIEW_SERVICE_USER:$PREVIEW_SERVICE_USER" "$PREVIEW_ENV_FILE"
    assert_preview_env_file "$PREVIEW_ENV_FILE" || exit 1
    log_info "Isolation applied. Env backup: $BACKUP_ENV"
    fixed_sync_script="$SCRIPT_DIR/sync-preview-convex-env.sh"
    preview_sync_script="$PREVIEW_DIR/deploy/sync-preview-convex-env.sh"
    sync_script=""
    if [[ -x "$fixed_sync_script" ]]; then
        sync_script="$fixed_sync_script"
    elif [[ -x "$preview_sync_script" ]]; then
        sync_script="$preview_sync_script"
    fi
    if [[ -n "$sync_script" ]]; then
        log_info "Re-syncing preview Convex AI env (does not re-enable Telegram)."
        PREVIEW_DIR="$PREVIEW_DIR" bash "$sync_script" --sync-only || true
    fi
else
    log_info "Dry-run complete. Backup kept at $BACKUP_ENV"
fi
