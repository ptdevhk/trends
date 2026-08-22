#!/usr/bin/env bash
# Shared Convex export fixer for restore flows (preview + dev).
# Source this file; do not execute it directly.
#
# fix_convex_export IN_ZIP SCHEMA_TS OUT_ZIP
#   - strips screening_sessions.config.filters.showBlocked (v0.3.0+ schema drop)
#   - keeps system_settings/ but drops environment-local rows
#     (maintenanceMode, industryMaintenanceSchedulePaused) so env-local flags
#     never propagate to the target, while search-affecting settings
#     (resumeWorkHistoryLimit) DO — the target no longer reverts to defaults
#     on every sync (previously the whole table was dropped, leaving it empty
#     after --replace-all)
#   - materializes schema tables missing from the export as EMPTY
#     (import --replace-all would otherwise leave them absent)
# Exits non-zero on failure; writes fixed zip to OUT_ZIP.

fix_convex_export() {
    local in_zip="$1"
    local schema_ts="$2"
    local out_zip="$3"
    local work
    local prev_ret
    work="$(mktemp -d)"
    # Preserve any pre-existing RETURN trap and restore it when this trap
    # fires; otherwise the trap survives the function's return and a later
    # function/source completion fires it with `work` already gone (aborts
    # the caller with "work: unbound variable" under `set -u`). The trap body
    # runs while this function's locals still exist, so this is safe on every
    # return path.
    prev_ret="$(trap -p RETURN 2>/dev/null || true)"
    trap 'rm -rf "$work"; if [ -n "$prev_ret" ]; then eval "$prev_ret"; else trap - RETURN; fi' RETURN

    ( cd "$work" && unzip -q "$in_zip" ) || return 1

    ( cd "$work" && python3 - "$schema_ts" <<'PY'
import json, os, pathlib, re, sys

schema_path = pathlib.Path(sys.argv[1])

# 1. Strip schema-incompatible field
path = "screening_sessions/documents.jsonl"
if os.path.exists(path):
    docs = [json.loads(line) for line in open(path) if line.strip()]
    changed = 0
    for d in docs:
        if isinstance(d.get("config"), dict) and isinstance(d["config"].get("filters"), dict):
            if d["config"]["filters"].pop("showBlocked", None) is not None:
                changed += 1
    with open(path, "w") as f:
        f.write("\n".join(json.dumps(d, ensure_ascii=False) for d in docs) + "\n")
    print(f"Stripped showBlocked from {changed}/{len(docs)} screening_sessions documents")

# 2. Materialize schema tables missing from the export as empty
if not schema_path.exists():
    raise SystemExit(f"Missing target Convex schema: {schema_path}")
schema_tables = re.findall(
    r"^\s*([A-Za-z_][A-Za-z0-9_]*)\s*:\s*defineTable\(",
    schema_path.read_text(),
    flags=re.MULTILINE,
)
created = []
for table in schema_tables:
    if pathlib.Path(table).exists():
        continue
    pathlib.Path(table).mkdir()
    (pathlib.Path(table) / "generated_schema.jsonl").write_text('"uniform"\n')
    (pathlib.Path(table) / "documents.jsonl").write_text("")
    created.append(table)
if created:
    print("Materialized missing schema tables as empty: " + ", ".join(created))

# 3. Keep system_settings/ but drop environment-local rows last (so the
# filtering wins over materialization above). Environment-local flags
# (maintenanceMode, industryMaintenanceSchedulePaused) must not propagate to
# the target; other settings (e.g. resumeWorkHistoryLimit) do, so the target
# no longer reverts to defaults on every sync.
if os.path.exists("system_settings"):
    path = "system_settings/documents.jsonl"
    env_local = {"maintenanceMode", "industryMaintenanceSchedulePaused"}
    if os.path.exists(path):
        docs = [json.loads(line) for line in open(path) if line.strip()]
        kept = [d for d in docs if not (isinstance(d, dict) and d.get("key") in env_local)]
        dropped = len(docs) - len(kept)
        with open(path, "w") as f:
            f.write("".join(json.dumps(d, ensure_ascii=False, separators=(",", ":")) + "\n" for d in kept))
        print(f"Excluded {dropped} environment-local system_settings row(s); kept {len(kept)}")
    else:
        print("system_settings/ has no documents.jsonl")
PY
    ) || return 1

    rm -f "$out_zip"
    ( cd "$work" && zip -rq "$out_zip" . ) || return 1
}
