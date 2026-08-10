#!/usr/bin/env bash
# Shared Convex export fixer for restore flows (preview + dev).
# Source this file; do not execute it directly.
#
# fix_convex_export IN_ZIP SCHEMA_TS OUT_ZIP
#   - strips screening_sessions.config.filters.showBlocked (v0.3.0+ schema drop)
#   - removes system_settings/ (maintenance flag is environment-local)
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
import json, os, pathlib, re, shutil, sys

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

# 3. Drop system_settings last so the drop wins over materialization above
# (environment-local maintenance flag must not propagate to the target)
if os.path.exists("system_settings"):
    shutil.rmtree("system_settings")
    print("Excluded system_settings/ from import")
PY
    ) || return 1

    rm -f "$out_zip"
    ( cd "$work" && zip -rq "$out_zip" . ) || return 1
}
