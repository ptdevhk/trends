#!/usr/bin/env bash
# Read-only rollback-readiness audit for deploy/backup-prod-complete.sh bundles.
#
# This script ONLY validates an existing complete-backup bundle and emits a
# deterministic secret-safe JSON report. It must NEVER:
#   - import data into any Convex deployment
#   - restore any artifact
#   - stop or start any service
#   - accept a Convex-only artifact as complete
#
# Usage:
#   bash deploy/audit-complete-backup.sh --backup-dir DIR \
#       [--evidence-dir DIR] [--allowlist FILE] | tee audit.json
#
# Exit codes:
#   0  audit ran and bundle is complete (complete=true)
#   1  audit ran and bundle is NOT complete (complete=false, no_go_reasons set)
#   2  usage error
#
# Env:
#   BACKUP_ROOT   backup root used to verify the bundle is inside it
set -Eeuo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKUP_DIR=""
EVIDENCE_DIR=""
ALLOWLIST="$SCRIPT_DIR/preview-output-restore.allowlist"

# --- deterministic JSON helper (never leaks secret values) ------------------
json_str() { node -e 'process.stdout.write(JSON.stringify(process.argv[1]))' "$1"; }

usage() {
    cat >&2 <<'EOF'
Usage: deploy/audit-complete-backup.sh --backup-dir DIR [--evidence-dir DIR] [--allowlist FILE]

Read-only rollback-readiness audit of a prod-complete-* backup bundle.
Never restores, imports, or stops services.
EOF
}

while [[ $# -gt 0 ]]; do
    case "$1" in
        --backup-dir) BACKUP_DIR="${2:-}"; shift 2 ;;
        --evidence-dir) EVIDENCE_DIR="${2:-}"; shift 2 ;;
        --allowlist) ALLOWLIST="${2:-}"; shift 2 ;;
        -h|--help) usage; exit 2 ;;
        *) printf 'unknown argument: %s\n' "$1" >&2; usage; exit 2 ;;
    esac
done
[[ -n "$BACKUP_DIR" ]] || { printf 'missing --backup-dir\n' >&2; usage; exit 2; }

# shellcheck source=lib-complete-backup.sh
source "$SCRIPT_DIR/lib-complete-backup.sh"

checks=""
no_go=()
add_check() {
    local name="$1" state="$2" detail="$3" reason="${4:-}"
    checks="${checks}${checks:+,}\"${name}\":{\"state\":$(json_str "$state"),\"detail\":$(json_str "$detail")}"
    if [[ -n "$reason" ]]; then
        no_go+=("$reason")
    fi
}

emit_report() {
    local complete_state=false status="INCOMPLETE" summary="not rollback-ready"
    if [[ ${#no_go[@]} -eq 0 ]]; then
        complete_state=true
        status="OK"
        summary="rollback-ready"
    fi
    local reasons_json="["
    local first=1
    local reason
    for reason in "${no_go[@]}"; do
        [[ "$first" == 1 ]] || reasons_json="${reasons_json},"
        reasons_json="${reasons_json}$(json_str "$reason")"
        first=0
    done
    reasons_json="${reasons_json}]"

    local report_out
    report_out="$(printf '{"schema":"trends-complete-backup-audit/v1","complete":%s,"status":"%s","backup_dir":%s,"summary":%s,"checks":{%s},"no_go_reasons":%s}\n' \
        "$complete_state" \
        "$status" \
        "$(json_str "$COMPLETE_BACKUP_DIR")" \
        "$(json_str "$summary")" \
        "$checks" \
        "$reasons_json")"

    printf '%s\n' "$report_out"
    if [[ -n "$EVIDENCE_DIR" ]]; then
        printf '%s\n' "$report_out" > "$EVIDENCE_DIR/audit-report.json"
    fi
}

# --- 0. manifest (fail-fast; error text never contains secret values) -------
ERRFILE="$(mktemp)"
if ! complete_backup_parse_manifest "$BACKUP_DIR" 2>"$ERRFILE"; then
    manifest_output="$(cat "$ERRFILE")"
    rm -f "$ERRFILE"
    early_report="$(printf '{"schema":"trends-complete-backup-audit/v1","complete":false,"status":"INCOMPLETE","backup_dir":%s,"summary":"not rollback-ready","checks":{"manifest":{"state":"fail","detail":%s}},"no_go_reasons":[%s]}\n' \
        "$(json_str "$(complete_backup_realpath "$BACKUP_DIR")")" \
        "$(json_str "$manifest_output")" \
        "$(json_str "manifest invalid: $manifest_output")")"
    printf '%s\n' "$early_report"
    if [[ -n "$EVIDENCE_DIR" ]]; then
        mkdir -p "$EVIDENCE_DIR"
        printf '%s\n' "$early_report" > "$EVIDENCE_DIR/audit-report.json"
    fi
    exit 1
fi
rm -f "$ERRFILE"

if [[ -n "$EVIDENCE_DIR" ]]; then
    mkdir -p "$EVIDENCE_DIR"
fi

# -- 1. manifest -------------------------------------------------------------
add_check manifest ok "MANIFEST.txt parsed; status=${COMPLETE_BACKUP_MANIFEST[status]}"

# -- 2. allowlist ------------------------------------------------------------
if complete_backup_validate_allowlist "$ALLOWLIST" 2> /dev/null; then
    add_check allowlist ok "allowlist valid: $(basename "$ALLOWLIST")"
else
    add_check allowlist fail "allowlist invalid" "allowlist invalid"
fi

# -- 3. env copies (required: etc-trends-env mode 0600 + config_env_sha256; optional: others)
env_ok=1
env_reason=""
etc_env="$COMPLETE_BACKUP_DIR/config/etc-trends-env"

if [[ -f "$etc_env" && ! -L "$etc_env" ]]; then
    etc_mode="$(python3 -c 'import os, stat, sys; print(oct(stat.S_IMODE(os.stat(sys.argv[1]).st_mode)))' "$etc_env" 2>/dev/null || echo "error")"
    if [[ "$etc_mode" != "0o600" && "$etc_mode" != "0600" ]]; then
        env_ok=0
        env_reason="${env_reason}config/etc-trends-env mode is ${etc_mode}, expected 0600;"
    fi
else
    env_ok=0
    env_reason="${env_reason}missing or symlinked config/etc-trends-env;"
fi

if [[ -z "${COMPLETE_BACKUP_MANIFEST[config_env_sha256]:-}" ]]; then
    env_ok=0
    env_reason="${env_reason}missing config_env_sha256 in manifest;"
elif [[ -f "$etc_env" ]]; then
    config_actual="$(complete_backup_sha256 "$etc_env" 2>/dev/null || true)"
    if [[ -z "$config_actual" || "$config_actual" != "${COMPLETE_BACKUP_MANIFEST[config_env_sha256]}" ]]; then
        env_ok=0
        env_reason="${env_reason}config/etc-trends-env sha256 mismatch;"
    fi
fi

# Optional configs: preserve producer-optional status, only ensure safe if present
for name in install-env.production convex.env.local web.env.production; do
    opt_file="$COMPLETE_BACKUP_DIR/config/$name"
    if [[ -e "$opt_file" ]]; then
        if [[ -L "$opt_file" || ! -f "$opt_file" ]]; then
            env_ok=0
            env_reason="${env_reason}config/${name} is symlinked or not regular file;"
        fi
    fi
done

if [[ "$env_ok" == 1 ]]; then
    add_check env_copies ok "config/etc-trends-env (mode 0600, sha256 valid); optional configs valid"
else
    add_check env_copies fail "$env_reason" "$env_reason"
fi

# -- 4. artifact directories ----------------------------------------------------
for key in git sqlite convex output; do
    if [[ -d "$COMPLETE_BACKUP_DIR/$key" ]]; then
        add_check "${key}_dir" ok "present"
    else
        add_check "${key}_dir" fail "missing directory" "missing ${key}/ directory"
    fi
done

# -- 5. git identity ----------------------------------------------------------
git_head="$COMPLETE_BACKUP_DIR/git/HEAD"
if [[ -f "$git_head" && ! -L "$git_head" ]]; then
    head="$(tr -d '[:space:]' < "$git_head")"
    if [[ "$head" == "${COMPLETE_BACKUP_MANIFEST[prod_sha]}" ]]; then
        add_check git_identity ok "git/HEAD == prod_sha (${head:0:12}…) branch=${COMPLETE_BACKUP_MANIFEST[prod_branch]}"
    else
        add_check git_identity fail "git/HEAD does not match prod_sha" "git/HEAD does not match prod_sha"
    fi
else
    add_check git_identity fail "git/HEAD missing or symlinked" "git/HEAD missing or symlinked"
fi

# -- 6. artifact paths resolved via lib (safe-path + symlink + escape checks) --
sqlite_path="$(complete_backup_artifact_path sqlite_path 2>/dev/null || true)"
convex_zip="$(complete_backup_artifact_path convex_zip 2>/dev/null || true)"
output_tgz=""
if [[ -n "${COMPLETE_BACKUP_MANIFEST[output_tgz]:-}" ]]; then
    output_tgz="$(complete_backup_artifact_path output_tgz 2>/dev/null || true)"
fi
if [[ -z "$sqlite_path" ]]; then
    add_check sqlite_path fail "sqlite artifact missing or unsafe" "sqlite artifact missing or unsafe"
else
    add_check sqlite_path ok "sqlite artifact resolved and safe"
fi
if [[ -z "$convex_zip" ]]; then
    add_check convex_zip fail "convex artifact missing or unsafe" "convex artifact missing or unsafe"
else
    add_check convex_zip ok "convex artifact resolved and safe"
fi
if [[ -z "${COMPLETE_BACKUP_MANIFEST[output_tgz]:-}" || -z "${COMPLETE_BACKUP_MANIFEST[output_tgz_sha256]:-}" ]]; then
    add_check output_tgz fail "output_tgz or output_tgz_sha256 missing from manifest" "output_tgz is required in manifest"
elif [[ -z "$output_tgz" ]]; then
    add_check output_tgz fail "output artifact missing or unsafe" "output artifact missing or unsafe"
else
    add_check output_tgz ok "output artifact resolved and safe"
fi

# -- 7. archive inspection + SQLite integrity + file storage + doc count + allowlist --
PYREPORT="$(BACKUP_DIR="$COMPLETE_BACKUP_DIR" SQLITE_PATH="$sqlite_path" CONVEX_ZIP="$convex_zip" \
    OUTPUT_TGZ="$output_tgz" ALLOWLIST="$ALLOWLIST" EVIDENCE_DIR="$EVIDENCE_DIR" \
    python3 - <<'PY' 2>/dev/null || true
import hashlib, json, os, pathlib, posixpath, sqlite3, tarfile, zipfile

backup_dir = os.path.realpath(os.environ["BACKUP_DIR"])
sqlite_raw = os.environ.get("SQLITE_PATH", "")
sqlite_path = os.path.realpath(sqlite_raw) if sqlite_raw else ""
convex_raw = os.environ.get("CONVEX_ZIP", "")
convex_zip = os.path.realpath(convex_raw) if convex_raw else ""
output_raw = os.environ.get("OUTPUT_TGZ", "")
output_tgz = os.path.realpath(output_raw) if output_raw else ""
allowlist_file = os.environ.get("ALLOWLIST", "")
evidence_dir = os.environ.get("EVIDENCE_DIR", "")

def inside(path: str) -> bool:
    return path == backup_dir or path.startswith(backup_dir + os.sep)

def safe_name(name: str) -> bool:
    normalized = posixpath.normpath(name)
    return (
        bool(name)
        and not name.startswith("/")
        and normalized not in (".", "..")
        and not normalized.startswith("../")
        and "\x00" not in name
    )

report = {
    "sqlite_integrity": "skip",
    "sqlite_count": None,
    "sqlite_sha256_actual": "",
    "file_storage": "absent",
    "file_storage_count": 0,
    "zip_test": None,
    "safe_paths": "ok",
    "safe_path_detail": "",
    "convex_doc_count": 0,
    "convex_table_count": 0,
    "allowlist_members_ok": True,
    "output_missing_members": [],
    "output_tar_member_count": 0,
}

# SQLite: read-only open, integrity + count + sha256
if sqlite_path and inside(sqlite_path) and os.path.isfile(sqlite_path):
    try:
        hasher = hashlib.sha256()
        with open(sqlite_path, "rb") as f:
            for chunk in iter(lambda: f.read(65536), b""):
                hasher.update(chunk)
        report["sqlite_sha256_actual"] = hasher.hexdigest()
    except Exception as exc:
        report["sqlite_sha256_actual"] = ""
    try:
        with sqlite3.connect(f"file:{sqlite_path}?mode=ro", uri=True) as db:
            rows = list(db.execute("PRAGMA integrity_check;"))
            report["sqlite_integrity"] = "ok" if rows == [("ok",)] else rows
            if report["sqlite_integrity"] == "ok":
                report["sqlite_count"] = db.execute(
                    "SELECT count(*) FROM candidate_actions;"
                ).fetchone()[0]
    except Exception as exc:
        report["sqlite_integrity"] = f"error: {exc}"

# Convex ZIP: integrity test + safe names + file-storage inventory + doc counts
storage_found = []
convex_tables = {}
doc_count = 0
if convex_zip and inside(convex_zip) and os.path.isfile(convex_zip):
    try:
        with zipfile.ZipFile(convex_zip) as archive:
            bad = archive.testzip()
            report["zip_test"] = "ok" if bad is None else f"corrupt member: {bad}"
            for info in archive.infolist():
                if not safe_name(info.filename):
                    report["safe_paths"] = "fail"
                    report["safe_path_detail"] = f"unsafe ZIP path: {info.filename}"
                    break
                mode = (info.external_attr >> 16) & 0o170000
                if mode == 0o120000:
                    report["safe_paths"] = "fail"
                    report["safe_path_detail"] = f"unsafe ZIP symlink: {info.filename}"
                    break
                parts = pathlib.PurePosixPath(info.filename).parts
                if info.filename.endswith("/documents.jsonl") and len(parts) >= 2:
                    table = parts[-2]
                    with archive.open(info) as stream:
                        lines = sum(1 for line in stream if line.strip())
                        convex_tables[table] = lines
                        doc_count += lines
                # Only accept actual _storage/ or storage/ members; never arbitrary table names
                if len(parts) >= 1 and parts[0] in ("_storage", "storage"):
                    if not info.is_dir():
                        storage_found.append({"path": info.filename, "bytes": info.file_size})
        if storage_found:
            report["file_storage"] = "present"
            report["file_storage_count"] = len(storage_found)
        report["convex_doc_count"] = doc_count
        report["convex_table_count"] = len(convex_tables)
    except Exception as exc:
        report["zip_test"] = f"error: {exc}"
else:
    report["zip_test"] = "missing artifact path"

# Allowlist verification for output TAR
allow_entries = []
if allowlist_file and os.path.isfile(allowlist_file):
    try:
        with open(allowlist_file, "r") as f:
            for line in f:
                stripped = line.strip()
                if stripped and not stripped.startswith("#"):
                    allow_entries.append(stripped)
    except Exception:
        pass

tar_members = []
tar_members_set = set()
if output_tgz and inside(output_tgz) and os.path.isfile(output_tgz):
    try:
        with tarfile.open(output_tgz, "r:gz") as archive:
            for member in archive.getmembers():
                name = member.name.rstrip("/")
                if not safe_name(name):
                    report["safe_paths"] = "fail"
                    report["safe_path_detail"] = f"unsafe TAR path: {member.name}"
                    break
                if member.isdir():
                    continue
                if not member.isreg():
                    report["safe_paths"] = "fail"
                    report["safe_path_detail"] = f"unsafe TAR member type: {member.name}"
                    break
                if not inside(os.path.realpath(os.path.join(backup_dir, name))):
                    report["safe_paths"] = "fail"
                    report["safe_path_detail"] = f"TAR member escapes backup: {member.name}"
                    break
                tar_members.append({"path": name, "bytes": member.size})
                tar_members_set.add(name)
        report["output_tar_member_count"] = len(tar_members)
    except Exception as exc:
        report["safe_paths"] = "fail"
        report["safe_path_detail"] = f"TAR open error: {exc}"
else:
    report["allowlist_members_ok"] = False

missing_allowlist = [item for item in allow_entries if item not in tar_members_set]
if missing_allowlist or not output_tgz:
    report["allowlist_members_ok"] = False
    report["output_missing_members"] = missing_allowlist
else:
    report["allowlist_members_ok"] = True
    report["output_missing_members"] = []

# Write evidence files if evidence_dir is specified
if evidence_dir and os.path.isdir(evidence_dir):
    try:
        with open(os.path.join(evidence_dir, "source-inventory.json"), "w") as f:
            json.dump({
                "schema": "trends-convex-inventory/v1",
                "tables": dict(sorted(convex_tables.items())),
                "storage": sorted(storage_found, key=lambda x: x["path"]),
                "document_count": doc_count,
            }, f, indent=2)
            f.write("\n")
        with open(os.path.join(evidence_dir, "output-inventory.json"), "w") as f:
            json.dump({
                "schema": "trends-output-inventory/v1",
                "members": tar_members,
                "allowlist": allow_entries,
                "missing": missing_allowlist,
            }, f, indent=2)
            f.write("\n")
    except Exception:
        pass

print(json.dumps(report, separators=(",", ":")))
PY
)"

if [[ -n "$PYREPORT" ]]; then
    read -r sqlite_integrity sqlite_count storage_state storage_count zip_test safe_state convex_doc_count convex_table_count allowlist_members_ok sqlite_actual <<<"$(
        printf '%s' "$PYREPORT" | python3 -c '
import json, sys
d = json.load(sys.stdin)
def esc(v):
    if v is None: return ""
    return str(v).replace(" ", "_").replace("\t", "_").replace("\n", "_")
print(" ".join([
    esc(d.get("sqlite_integrity", "error")),
    esc(d.get("sqlite_count", "")),
    esc(d.get("file_storage", "absent")),
    esc(d.get("file_storage_count", 0)),
    esc(d.get("zip_test", "")),
    esc(d.get("safe_paths", "fail")),
    esc(d.get("convex_doc_count", 0)),
    esc(d.get("convex_table_count", 0)),
    esc(d.get("allowlist_members_ok", False)),
    esc(d.get("sqlite_sha256_actual", "")),
]))
'
    )"

    if [[ "$sqlite_integrity" == "ok" ]]; then
        add_check sqlite_integrity ok "integrity_check=ok (candidate_actions=${sqlite_count:-?})"
    else
        add_check sqlite_integrity fail "integrity_check not ok" "SQLite integrity_check failed"
    fi
    if [[ -n "$sqlite_count" && "$sqlite_count" == "${COMPLETE_BACKUP_MANIFEST[candidate_actions_count]}" ]]; then
        add_check candidate_actions ok "count=${sqlite_count}"
    elif [[ -n "$sqlite_count" ]]; then
        add_check candidate_actions fail "count mismatch (backup=${sqlite_count}, manifest=${COMPLETE_BACKUP_MANIFEST[candidate_actions_count]})" "candidate_actions count mismatch"
    else
        add_check candidate_actions fail "unable to read candidate_actions count" "candidate_actions count unreadable"
    fi

    # Require include_file_storage=true and actual _storage/ or storage/ members
    if [[ "${COMPLETE_BACKUP_MANIFEST[include_file_storage]:-}" != "true" ]]; then
        add_check file_storage fail "manifest include_file_storage must be true (got ${COMPLETE_BACKUP_MANIFEST[include_file_storage]:-missing})" "missing file storage: manifest include_file_storage must be true"
    elif [[ "$storage_state" == "present" ]]; then
        add_check file_storage ok "file storage present in Convex ZIP (${storage_count} files)"
    else
        add_check file_storage fail "no file storage inventory in Convex ZIP" "missing file storage in Convex ZIP"
    fi

    # Reject empty/no-document Convex exports
    if [[ -n "$convex_doc_count" && "$convex_doc_count" -gt 0 ]]; then
        add_check convex_documents ok "Convex export contains ${convex_doc_count} documents across ${convex_table_count} tables"
    else
        add_check convex_documents fail "Convex export contains 0 documents" "Convex export has no documents"
    fi

    if [[ "$zip_test" == "ok" ]]; then
        add_check zip_integrity ok "ZIP testzip passed"
    else
        add_check zip_integrity fail "ZIP integrity test failed: $zip_test" "Convex ZIP integrity test failed"
    fi
    if [[ "$safe_state" == "ok" ]]; then
        add_check safe_paths ok "paths safe"
    else
        safe_detail="$(python3 -c 'import json, sys; print(json.loads(sys.argv[1]).get("safe_path_detail", "unsafe path"))' "$PYREPORT" 2>/dev/null || true)"
        add_check safe_paths fail "$safe_detail" "unsafe artifact path"
    fi

    # Verify every allowlisted output member exists
    if [[ "$allowlist_members_ok" == "True" ]]; then
        add_check output_members ok "all allowlisted output members present in output TAR"
    else
        missing_str="$(python3 -c 'import json, sys; print(", ".join(json.loads(sys.argv[1]).get("output_missing_members", [])))' "$PYREPORT" 2>/dev/null || true)"
        add_check output_members fail "missing allowlisted output members: ${missing_str}" "missing allowlisted output members in output_tgz: ${missing_str}"
    fi

    # -- 8. manifest hash comparison (expected vs recomputed) ------------------
    # Fail when computed artifact hash is empty or mismatched and emit explicit fail checks
    hash_ok=1
    hash_reason=""

    # SQLite sha256
    if [[ -n "$sqlite_actual" && "$sqlite_actual" == "${COMPLETE_BACKUP_MANIFEST[sqlite_sha256]}" ]]; then
        add_check sqlite_hash ok "sqlite sha256 matches manifest"
    else
        hash_ok=0
        detail="sqlite sha256 mismatch (actual=${sqlite_actual:-empty}, expected=${COMPLETE_BACKUP_MANIFEST[sqlite_sha256]:-empty})"
        add_check sqlite_hash fail "$detail" "sqlite checksum mismatch"
        hash_reason="${hash_reason}sqlite checksum mismatch;"
    fi

    # Convex ZIP sha256
    convex_actual="$(complete_backup_sha256 "$convex_zip" 2>/dev/null || true)"
    if [[ -n "$convex_actual" && "$convex_actual" == "${COMPLETE_BACKUP_MANIFEST[convex_zip_sha256]}" ]]; then
        add_check convex_hash ok "convex zip sha256 matches manifest"
    else
        hash_ok=0
        detail="convex sha256 mismatch (actual=${convex_actual:-empty}, expected=${COMPLETE_BACKUP_MANIFEST[convex_zip_sha256]:-empty})"
        add_check convex_hash fail "$detail" "convex_zip checksum mismatch"
        hash_reason="${hash_reason}convex_zip checksum mismatch;"
    fi

    # Output TGZ sha256
    if [[ -n "$output_tgz" && -n "${COMPLETE_BACKUP_MANIFEST[output_tgz_sha256]:-}" ]]; then
        output_actual="$(complete_backup_sha256 "$output_tgz" 2>/dev/null || true)"
        if [[ -n "$output_actual" && "$output_actual" == "${COMPLETE_BACKUP_MANIFEST[output_tgz_sha256]}" ]]; then
            add_check output_hash ok "output tgz sha256 matches manifest"
        else
            hash_ok=0
            detail="output tgz sha256 mismatch (actual=${output_actual:-empty}, expected=${COMPLETE_BACKUP_MANIFEST[output_tgz_sha256]:-empty})"
            add_check output_hash fail "$detail" "output_tgz checksum mismatch"
            hash_reason="${hash_reason}output_tgz checksum mismatch;"
        fi
    else
        hash_ok=0
        add_check output_hash fail "output_tgz artifact or manifest hash missing" "output_tgz checksum mismatch"
        hash_reason="${hash_reason}output_tgz hash missing;"
    fi

    # Config env sha256
    config_env_file="$COMPLETE_BACKUP_DIR/config/etc-trends-env"
    if [[ -f "$config_env_file" && -n "${COMPLETE_BACKUP_MANIFEST[config_env_sha256]:-}" ]]; then
        config_actual="$(complete_backup_sha256 "$config_env_file" 2>/dev/null || true)"
        if [[ -n "$config_actual" && "$config_actual" == "${COMPLETE_BACKUP_MANIFEST[config_env_sha256]}" ]]; then
            add_check config_hash ok "config/etc-trends-env sha256 matches manifest"
        else
            hash_ok=0
            detail="config_env sha256 mismatch (actual=${config_actual:-empty}, expected=${COMPLETE_BACKUP_MANIFEST[config_env_sha256]:-empty})"
            add_check config_hash fail "$detail" "config_env_sha256 checksum mismatch"
            hash_reason="${hash_reason}config_env checksum mismatch;"
        fi
    else
        hash_ok=0
        add_check config_hash fail "config/etc-trends-env or config_env_sha256 missing" "config_env_sha256 checksum mismatch"
        hash_reason="${hash_reason}config_env_sha256 missing;"
    fi

    if [[ "$hash_ok" == 1 ]]; then
        add_check hashes ok "manifest hashes match recomputed hashes"
    else
        add_check hashes fail "$hash_reason" "$hash_reason"
    fi
else
    add_check archive_internal fail "Python archive inspection failed" "archive inspection failed"
fi

# -- 9. summary ---------------------------------------------------------------
emit_report

if [[ ${#no_go[@]} -eq 0 ]]; then
    exit 0
fi
exit 1
