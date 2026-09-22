#!/usr/bin/env bash
# Attach Cursor/shell on pvelxc to a remote Orca runtime (usually Mac desktop)
# that owns Claude/Codex terminal handles like term_<uuid>.
#
# Recommended topology (Codex wiki advice 2026-09-22):
#   Cursor→Mac: Orca CLI on pvelxc → Tailscale WS → Mac Orca runtime → term_*
#   Mac→pvelxc: optional; Mac Orca SSH / paired Linux env (not required for Cursor→Mac)
#
# One-time (on Mac Orca): Settings → create CLI / environment pairing code
#   (orca://pair?code=...)
# Then on this host:
#   ORCA_PAIRING_CODE='orca://pair?code=...' ./scripts/orca-attach-env.sh add
# Afterwards:
#   ./scripts/orca-attach-env.sh doctor
#   ./scripts/orca-attach-env.sh agents
#   ./scripts/orca-attach-env.sh terminal read --terminal term_...
#   ./scripts/orca-attach-env.sh terminal send --terminal term_... --text '...' --enter
set -euo pipefail

ORCA_BIN="${ORCA_CLI_COMMAND:-/opt/orca/squashfs-root/resources/bin/orca-ide}"
ENV_NAME="${ORCA_ENV_NAME:-mac-desktop}"
export PATH="/home/orca/.local/bin:/opt/orca/squashfs-root/resources/bin:/usr/bin:/bin:${PATH:-}"

run_orca() {
  if [[ "$(id -un)" == "orca" ]]; then
    env HOME=/home/orca DISPLAY="${DISPLAY:-:99}" "$ORCA_BIN" "$@"
  else
    sudo -u orca -H env \
      HOME=/home/orca \
      DISPLAY="${DISPLAY:-:99}" \
      PATH="/home/orca/.local/bin:/opt/orca/squashfs-root/resources/bin:/usr/bin:/bin" \
      "$ORCA_BIN" "$@"
  fi
}

cmd="${1:-}"
shift || true

case "$cmd" in
  add)
    code="${ORCA_PAIRING_CODE:-${1:-}}"
    if [[ -z "$code" ]]; then
      echo "Set ORCA_PAIRING_CODE or pass pairing URL as arg." >&2
      exit 2
    fi
    run_orca environment add --name "$ENV_NAME" --pairing-code "$code" --json
    ;;
  list-env)
    run_orca environment list --json
    ;;
  list)
    run_orca terminal list --environment "$ENV_NAME" --json
    ;;
  agents)
    TMP=$(mktemp)
    run_orca terminal list --environment "$ENV_NAME" --json >"$TMP"
    ENV_NAME="$ENV_NAME" python3 - "$TMP" <<'PY'
import json, os, sys
d = json.load(open(sys.argv[1]))
terms = (d.get("result") or {}).get("terminals") or []
by = {}
for t in terms:
    by.setdefault(t.get("agentIdentity") or "shell", []).append(t)
print("environment=%r terminals=%d" % (os.environ.get("ENV_NAME"), len(terms)))
for k in sorted(by):
    print("\n## %s (%d)" % (k, len(by[k])))
    for t in by[k]:
        print("  %s" % t.get("handle"))
        print("    title=%r" % ((t.get("title") or "")[:72],))
        print(
            "    path=%s connected=%s writable=%s"
            % (t.get("worktreePath"), t.get("connected"), t.get("writable"))
        )
PY
    rm -f "$TMP"
    ;;
  doctor)
    echo "== environment: $ENV_NAME =="
    TMP=$(mktemp)
    run_orca environment list --json >"$TMP"
    ORCA_ENV_NAME="$ENV_NAME" python3 - "$TMP" <<'PY'
import json, os, socket, sys
d = json.load(open(sys.argv[1]))
envs = (d.get("result") or {}).get("environments") or []
name = os.environ["ORCA_ENV_NAME"]
match = [e for e in envs if e.get("name") == name]
if not match:
    print(
        "FAIL: environment %r not saved. Run: ORCA_PAIRING_CODE=... ./scripts/orca-attach-env.sh add"
        % name
    )
    sys.exit(1)
e = match[0]
eps = e.get("endpoints") or []
print("OK env id=%s runtimeId=%s" % (e.get("id"), e.get("runtimeId")))
for ep in eps:
    print("  endpoint %s %s" % (ep.get("kind"), ep.get("endpoint")))
ws = [ep for ep in eps if ep.get("kind") == "websocket"]
if not ws:
    print("FAIL: no websocket endpoint")
    sys.exit(2)
endpoint = ws[0].get("endpoint") or ""
hostport = endpoint.split("://", 1)[-1]
host, _, port = hostport.partition(":")
port = int(port or "6768")
try:
    s = socket.create_connection((host, port), timeout=3)
    s.close()
    print("OK tcp %s:%s" % (host, port))
except OSError as err:
    print("FAIL tcp %s:%s: %s" % (host, port, err))
    sys.exit(2)
PY
    rm -f "$TMP"

    echo "== remote status =="
    TMP=$(mktemp)
    run_orca status --environment "$ENV_NAME" --json >"$TMP"
    python3 - "$TMP" <<'PY'
import json, sys
d = json.load(open(sys.argv[1]))
rt = (d.get("result") or {}).get("runtime") or {}
ok = rt.get("reachable") is True
print(
    "%s reachable=%s runtimeId=%s version=%s"
    % (("OK" if ok else "FAIL"), rt.get("reachable"), rt.get("runtimeId"), rt.get("appVersion"))
)
sys.exit(0 if ok else 3)
PY
    rm -f "$TMP"

    echo "== sample terminals =="
    TMP=$(mktemp)
    run_orca terminal list --environment "$ENV_NAME" --json >"$TMP"
    python3 - "$TMP" <<'PY'
import json, sys
d = json.load(open(sys.argv[1]))
terms = (d.get("result") or {}).get("terminals") or []
print("OK listed %d terminals on remote runtime" % len(terms))
for aid in ("claude", "codex", "cursor"):
    hits = [t for t in terms if t.get("agentIdentity") == aid]
    print("  %s: %d" % (aid, len(hits)))
    for t in hits[:3]:
        print("    %s  %r" % (t.get("handle"), (t.get("title") or "")[:50]))
PY
    rm -f "$TMP"
    echo "doctor: PASS"
    ;;
  show|read|send|wait|focus|close)
    run_orca terminal "$cmd" --environment "$ENV_NAME" "$@"
    ;;
  terminal)
    sub="${1:-}"; shift || true
    run_orca terminal "$sub" --environment "$ENV_NAME" "$@"
    ;;
  status)
    run_orca status --environment "$ENV_NAME" --json
    ;;
  raw)
    run_orca --environment "$ENV_NAME" "$@"
    ;;
  *)
    cat <<EOF
Usage:
  ORCA_PAIRING_CODE='orca://pair?code=...' $0 add
  $0 doctor          # verify Tailscale WS + runtime + terminal list
  $0 list-env
  $0 status
  $0 list
  $0 agents          # group terminals by agentIdentity
  $0 terminal show --terminal term_<uuid> --json
  $0 terminal read --terminal term_<uuid> --json
  $0 terminal send --terminal term_<uuid> --text '...' --enter --json
Env:
  ORCA_ENV_NAME (default: mac-desktop)
  ORCA_CLI_COMMAND (default: extracted orca-ide)
EOF
    exit 1
    ;;
esac
