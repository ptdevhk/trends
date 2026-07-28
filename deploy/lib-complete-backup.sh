#!/usr/bin/env bash
# Strict parser and verifier for deploy/backup-prod-complete.sh artifacts.
# Safe to source. It never reads live production state or exports Convex.

if [[ -n "${TRENDS_LIB_COMPLETE_BACKUP_LOADED:-}" ]]; then
    if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then exit 0; else return 0; fi
fi
TRENDS_LIB_COMPLETE_BACKUP_LOADED=1

declare -Ag COMPLETE_BACKUP_MANIFEST=()
COMPLETE_BACKUP_DIR=""

complete_backup_die() {
    printf 'complete-backup: %s\n' "$*" >&2
    return 1
}

complete_backup_sha256() {
    local path="$1"
    if command -v sha256sum >/dev/null 2>&1; then
        sha256sum "$path" | awk '{print $1}'
    else
        shasum -a 256 "$path" | awk '{print $1}'
    fi
}

complete_backup_realpath() {
    python3 - "$1" <<'PY'
import os, sys
print(os.path.realpath(sys.argv[1]))
PY
}

complete_backup_parse_manifest() {
    local selected_dir="$1"
    local backup_root="${BACKUP_ROOT:-/var/backups/trends}"
    local selected_real root_real manifest line key value
    local -A seen=()
    local -A sensitive=()
    local required

    selected_real="$(complete_backup_realpath "$selected_dir")"
    root_real="$(complete_backup_realpath "$backup_root")"
    [[ "$selected_real" == "$root_real"/* ]] || complete_backup_die "selected backup escapes BACKUP_ROOT: $selected_real" || return
    [[ -d "$selected_real" ]] || complete_backup_die "backup directory missing: $selected_real" || return
    manifest="$selected_real/MANIFEST.txt"
    [[ -f "$manifest" && ! -L "$manifest" ]] || complete_backup_die "MANIFEST.txt missing or symlinked" || return

    sensitive[status]=1
    sensitive[prod_sha]=1
    sensitive[prod_branch]=1
    sensitive[prod_version]=1
    sensitive[sqlite_path]=1
    sensitive[sqlite_sha256]=1
    sensitive[candidate_actions_count]=1
    sensitive[convex_zip]=1
    sensitive[convex_zip_sha256]=1
    sensitive[include_file_storage]=1
    sensitive[output_tgz]=1
    sensitive[output_tgz_sha256]=1

    COMPLETE_BACKUP_MANIFEST=()
    while IFS= read -r line || [[ -n "$line" ]]; do
        [[ -z "$line" || "$line" == \#* ]] && continue
        [[ "$line" == *=* ]] || complete_backup_die "invalid manifest line" || return
        key="${line%%=*}"
        value="${line#*=}"
        [[ "$key" =~ ^[a-z][a-z0-9_]*$ ]] || complete_backup_die "invalid manifest key: $key" || return
        [[ "$value" != *$'\n'* && "$value" != *$'\r'* ]] || complete_backup_die "invalid manifest value for $key" || return
        if [[ -n "${seen[$key]:-}" && -n "${sensitive[$key]:-}" ]]; then
            complete_backup_die "duplicate security-sensitive manifest key: $key" || return
        fi
        seen[$key]=1
        COMPLETE_BACKUP_MANIFEST["$key"]="$value"
    done < "$manifest"

    for required in created_at status prod_sha prod_branch prod_version sqlite_path \
        sqlite_sha256 candidate_actions_count convex_zip convex_zip_sha256 include_file_storage; do
        [[ -n "${COMPLETE_BACKUP_MANIFEST[$required]:-}" ]] \
            || complete_backup_die "missing manifest key: $required" || return
    done
    [[ "${COMPLETE_BACKUP_MANIFEST[status]}" == "OK" ]] || complete_backup_die "backup status is not OK" || return
    [[ "${COMPLETE_BACKUP_MANIFEST[created_at]}" =~ ^[0-9]{8}T[0-9]{6}Z$ ]] || complete_backup_die "invalid created_at" || return
    [[ "${COMPLETE_BACKUP_MANIFEST[prod_sha]}" =~ ^[0-9a-f]{40}$ ]] || complete_backup_die "invalid prod_sha" || return
    [[ "${COMPLETE_BACKUP_MANIFEST[prod_branch]}" =~ ^[A-Za-z0-9][A-Za-z0-9._/-]*$ ]] || complete_backup_die "invalid prod_branch" || return
    [[ "${COMPLETE_BACKUP_MANIFEST[prod_branch]}" != *".."* && "${COMPLETE_BACKUP_MANIFEST[prod_branch]}" != *"@{"* ]] \
        || complete_backup_die "unsafe prod_branch" || return
    [[ "${COMPLETE_BACKUP_MANIFEST[prod_version]}" =~ ^[0-9]+\.[0-9]+\.[0-9]+([.-][A-Za-z0-9.-]+)?$ ]] || complete_backup_die "invalid prod_version" || return
    [[ "${COMPLETE_BACKUP_MANIFEST[sqlite_sha256]}" =~ ^[0-9a-f]{64}$ ]] || complete_backup_die "invalid sqlite_sha256" || return
    [[ "${COMPLETE_BACKUP_MANIFEST[convex_zip_sha256]}" =~ ^[0-9a-f]{64}$ ]] || complete_backup_die "invalid convex_zip_sha256" || return
    [[ "${COMPLETE_BACKUP_MANIFEST[candidate_actions_count]}" =~ ^[0-9]+$ ]] || complete_backup_die "invalid candidate_actions_count" || return
    [[ "${COMPLETE_BACKUP_MANIFEST[include_file_storage]}" =~ ^(true|false)$ ]] || complete_backup_die "invalid include_file_storage" || return
    if [[ -n "${COMPLETE_BACKUP_MANIFEST[output_tgz_sha256]:-}" ]]; then
        [[ "${COMPLETE_BACKUP_MANIFEST[output_tgz_sha256]}" =~ ^[0-9a-f]{64}$ ]] \
            || complete_backup_die "invalid output_tgz_sha256" || return
    fi
    if [[ -n "${COMPLETE_BACKUP_MANIFEST[output_tgz]:-}" || -n "${COMPLETE_BACKUP_MANIFEST[output_tgz_sha256]:-}" ]]; then
        [[ -n "${COMPLETE_BACKUP_MANIFEST[output_tgz]:-}" && -n "${COMPLETE_BACKUP_MANIFEST[output_tgz_sha256]:-}" ]] \
            || complete_backup_die "output_tgz and output_tgz_sha256 must appear together" || return
    fi
    COMPLETE_BACKUP_DIR="$selected_real"
}

complete_backup_artifact_path() {
    local key="$1"
    local relative="${COMPLETE_BACKUP_MANIFEST[$key]:-}"
    local candidate resolved
    [[ -n "$relative" ]] || complete_backup_die "manifest path missing: $key" || return
    [[ "$relative" != /* && "$relative" != *".."* ]] || complete_backup_die "unsafe relative path for $key" || return
    candidate="$COMPLETE_BACKUP_DIR/$relative"
    [[ -f "$candidate" && ! -L "$candidate" ]] || complete_backup_die "artifact missing or symlinked: $relative" || return
    resolved="$(complete_backup_realpath "$candidate")"
    [[ "$resolved" == "$COMPLETE_BACKUP_DIR"/* ]] || complete_backup_die "artifact escapes backup: $relative" || return
    printf '%s\n' "$resolved"
}

complete_backup_validate_allowlist() {
    local allowlist="$1"
    [[ -f "$allowlist" && ! -L "$allowlist" ]] || complete_backup_die "allowlist missing or symlinked" || return
    python3 - "$allowlist" <<'PY'
import pathlib, sys
path = pathlib.Path(sys.argv[1])
seen = set()
for number, raw in enumerate(path.read_text().splitlines(), 1):
    value = raw.strip()
    if not value or value.startswith("#"):
        continue
    if value.startswith("/") or ".." in pathlib.PurePosixPath(value).parts:
        raise SystemExit(f"unsafe allowlist path at line {number}: {value}")
    if not value.startswith("output/") or value.endswith("/"):
        raise SystemExit(f"allowlist entries must be exact files under output/ at line {number}: {value}")
    if any(ch in value for ch in "*?["):
        raise SystemExit(f"globs are forbidden in allowlist at line {number}: {value}")
    if value in seen:
        raise SystemExit(f"duplicate allowlist entry at line {number}: {value}")
    seen.add(value)
PY
}

complete_backup_inspect_archives() {
    local convex_zip="$1"
    local output_tgz="${2:-}"
    local allowlist="$3"
    local evidence_dir="$4"
    mkdir -p "$evidence_dir"
    python3 - "$convex_zip" "$output_tgz" "$allowlist" "$evidence_dir" \
        "${COMPLETE_BACKUP_MANIFEST[include_file_storage]}" <<'PY'
import hashlib, json, pathlib, posixpath, sys, tarfile, zipfile

zip_path = pathlib.Path(sys.argv[1])
tar_arg = sys.argv[2]
allowlist_path = pathlib.Path(sys.argv[3])
evidence = pathlib.Path(sys.argv[4])
include_storage = sys.argv[5] == "true"

allow = []
for raw in allowlist_path.read_text().splitlines():
    value = raw.strip()
    if value and not value.startswith("#"):
        allow.append(value)

def safe_name(name: str) -> bool:
    normalized = posixpath.normpath(name)
    return (
        bool(name)
        and not name.startswith("/")
        and normalized not in (".", "..")
        and not normalized.startswith("../")
        and "\x00" not in name
    )

tables = {}
storage = []
with zipfile.ZipFile(zip_path) as archive:
    bad = archive.testzip()
    if bad:
        raise SystemExit(f"corrupt Convex ZIP member: {bad}")
    for info in archive.infolist():
        if not safe_name(info.filename):
            raise SystemExit(f"unsafe Convex ZIP path: {info.filename}")
        mode = (info.external_attr >> 16) & 0o170000
        if mode == 0o120000:
            raise SystemExit(f"unsafe Convex ZIP symlink: {info.filename}")
        parts = pathlib.PurePosixPath(info.filename).parts
        if info.filename.endswith("/documents.jsonl") and len(parts) >= 2:
            table = parts[-2]
            if table == "system_settings":
                continue
            with archive.open(info) as stream:
                tables[table] = sum(1 for line in stream if line.strip())
        if parts and (parts[0] in {"_storage", "storage"} or "storage" in parts[0].lower()):
            if not info.is_dir():
                storage.append({"path": info.filename, "bytes": info.file_size})
if include_storage and not storage:
    raise SystemExit("manifest requires file storage, but ZIP has no storage inventory")

(evidence / "source-inventory.json").write_text(json.dumps({
    "schema": "trends-convex-inventory/v1",
    "tables": dict(sorted(tables.items())),
    "storage": sorted(storage, key=lambda item: item["path"]),
}, indent=2) + "\n")

output = {"members": [], "allowed": [], "skipped": []}
if tar_arg:
    tar_path = pathlib.Path(tar_arg)
    with tarfile.open(tar_path, "r:gz") as archive:
        for member in archive.getmembers():
            name = member.name.rstrip("/")
            if not safe_name(name):
                raise SystemExit(f"unsafe TAR path: {member.name}")
            if member.isdir():
                continue
            if not member.isreg():
                raise SystemExit(f"unsafe TAR member type: {member.name}")
            permitted = any(name == item or (item.endswith("/") and name.startswith(item)) for item in allow)
            record = {"path": name, "bytes": member.size}
            output["members"].append(record)
            (output["allowed"] if permitted else output["skipped"]).append(record)
(evidence / "output-inventory.json").write_text(json.dumps(output, indent=2) + "\n")
PY
}

complete_backup_extract_allowlisted_output() {
    local output_tgz="$1"
    local allowlist="$2"
    local destination="$3"
    complete_backup_validate_allowlist "$allowlist"
    mkdir -p "$destination"
    python3 - "$output_tgz" "$allowlist" "$destination" <<'PY'
import os, pathlib, posixpath, shutil, sys, tarfile, tempfile
archive_path, allowlist_path, destination = map(pathlib.Path, sys.argv[1:])
allow = [
    line.strip() for line in allowlist_path.read_text().splitlines()
    if line.strip() and not line.strip().startswith("#")
]
destination = destination.resolve()
with tarfile.open(archive_path, "r:gz") as archive:
    for member in archive.getmembers():
        name = member.name.rstrip("/")
        if member.isdir():
            continue
        safe = (
            name and not name.startswith("/")
            and not posixpath.normpath(name).startswith("../")
            and member.isreg()
        )
        if not safe:
            raise SystemExit(f"unsafe TAR member: {member.name}")
        if not any(name == item or (item.endswith("/") and name.startswith(item)) for item in allow):
            continue
        target = (destination / name).resolve()
        if destination not in target.parents:
            raise SystemExit(f"TAR extraction escape: {name}")
        target.parent.mkdir(parents=True, exist_ok=True)
        source = archive.extractfile(member)
        if source is None:
            raise SystemExit(f"unable to read TAR member: {name}")
        fd, temp_name = tempfile.mkstemp(prefix=f".{target.name}.", dir=target.parent)
        try:
            with os.fdopen(fd, "wb") as out:
                shutil.copyfileobj(source, out)
            os.chmod(temp_name, member.mode & 0o777)
            os.replace(temp_name, target)
        finally:
            if os.path.exists(temp_name):
                os.unlink(temp_name)
PY
}

complete_backup_validate() {
    local selected_dir="$1"
    local evidence_dir="$2"
    local allowlist="${3:-$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/preview-output-restore.allowlist}"
    local sqlite_path convex_zip output_tgz="" actual expected count head
    complete_backup_parse_manifest "$selected_dir"
    complete_backup_validate_allowlist "$allowlist"
    sqlite_path="$(complete_backup_artifact_path sqlite_path)"
    convex_zip="$(complete_backup_artifact_path convex_zip)"
    if [[ -n "${COMPLETE_BACKUP_MANIFEST[output_tgz]:-}" ]]; then
        output_tgz="$(complete_backup_artifact_path output_tgz)"
    fi
    [[ -f "$COMPLETE_BACKUP_DIR/git/HEAD" && ! -L "$COMPLETE_BACKUP_DIR/git/HEAD" ]] \
        || complete_backup_die "git/HEAD missing or symlinked" || return
    head="$(tr -d '[:space:]' < "$COMPLETE_BACKUP_DIR/git/HEAD")"
    [[ "$head" == "${COMPLETE_BACKUP_MANIFEST[prod_sha]}" ]] || complete_backup_die "git/HEAD does not match prod_sha" || return

    actual="$(complete_backup_sha256 "$sqlite_path")"
    expected="${COMPLETE_BACKUP_MANIFEST[sqlite_sha256]}"
    [[ "$actual" == "$expected" ]] || complete_backup_die "SQLite checksum mismatch" || return
    actual="$(complete_backup_sha256 "$convex_zip")"
    expected="${COMPLETE_BACKUP_MANIFEST[convex_zip_sha256]}"
    [[ "$actual" == "$expected" ]] || complete_backup_die "Convex ZIP checksum mismatch" || return
    if [[ -n "$output_tgz" && -n "${COMPLETE_BACKUP_MANIFEST[output_tgz_sha256]:-}" ]]; then
        actual="$(complete_backup_sha256 "$output_tgz")"
        [[ "$actual" == "${COMPLETE_BACKUP_MANIFEST[output_tgz_sha256]}" ]] || complete_backup_die "output TAR checksum mismatch" || return
    fi
    sqlite3 "$sqlite_path" "PRAGMA integrity_check;" | grep -qx ok \
        || complete_backup_die "SQLite integrity_check failed" || return
    count="$(sqlite3 "$sqlite_path" "SELECT count(*) FROM candidate_actions;")"
    [[ "$count" == "${COMPLETE_BACKUP_MANIFEST[candidate_actions_count]}" ]] \
        || complete_backup_die "candidate_actions count mismatch" || return

    mkdir -p "$evidence_dir"
    complete_backup_inspect_archives "$convex_zip" "$output_tgz" "$allowlist" "$evidence_dir"
    node - "$evidence_dir/backup-summary.json" "$COMPLETE_BACKUP_DIR" \
        "${COMPLETE_BACKUP_MANIFEST[created_at]}" "${COMPLETE_BACKUP_MANIFEST[prod_sha]}" \
        "${COMPLETE_BACKUP_MANIFEST[prod_branch]}" "${COMPLETE_BACKUP_MANIFEST[prod_version]}" \
        "$count" "${COMPLETE_BACKUP_MANIFEST[include_file_storage]}" "$actual" <<'NODE'
const fs = require("node:fs");
const [path, backupDir, createdAt, sourceSha, sourceBranch, sourceVersion, candidateActions, includeFileStorage] = process.argv.slice(2);
const data = {
  schema: "trends-complete-backup-summary/v1",
  backupDir,
  createdAt,
  source: { sha: sourceSha, branch: sourceBranch, version: sourceVersion },
  candidateActions: Number(candidateActions),
  includeFileStorage: includeFileStorage === "true",
  verifiedAt: new Date().toISOString(),
};
fs.writeFileSync(path, `${JSON.stringify(data, null, 2)}\n`, { mode: 0o600 });
NODE
}
