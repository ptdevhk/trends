#!/usr/bin/env bash
# Canonical, environment-neutral Convex migration declarations and batch loop.
#
# Callers must provide:
#   convex_migration_execute <convex-dir> <migration-name> <json-args>
# and may provide log_info/log_warn. Evidence is optional via:
#   CONVEX_MIGRATION_EVIDENCE_DIR=/path
#
# This file intentionally contains no production or preview service identity.

if [[ -n "${TRENDS_LIB_CONVEX_MIGRATIONS_LOADED:-}" ]]; then
    if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then exit 0; else return 0; fi
fi
TRENDS_LIB_CONVEX_MIGRATIONS_LOADED=1

convex_migration_log_info() {
    if declare -F log_info >/dev/null 2>&1; then
        log_info "$@"
    else
        printf '[INFO] %s\n' "$*"
    fi
}

convex_migration_log_warn() {
    if declare -F log_warn >/dev/null 2>&1; then
        log_warn "$@"
    else
        printf '[WARN] %s\n' "$*" >&2
    fi
}

convex_migration_declarations() {
    # name<TAB>base-json<TAB>max-iterations<TAB>max-consecutive-noop<TAB>idempotency-note
    cat <<'EOF'
backfillSourceKey	{}	10000	3	idempotent source-key normalization
backfillTaggingEnvelope	{}	10000	3	idempotent tagging envelope normalization
backfillWorkspaceSlugs	{}	10000	3	idempotent workspace slug backfill
backfillJob5156ProfileUrls	{}	10000	3	idempotent Job5156 profile URL backfill
backfillJob5156WorkHistoryEducation	{}	10000	3	idempotent Job5156 work-history and education backfill
backfillJob5156LocationHierarchy	{}	10000	3	idempotent Job5156 location hierarchy backfill
backfillManual51jobStructuredContent	{"batchSize":100}	10000	3	idempotent manual 51job structured-content backfill
backfillIngestData	{"limit":100}	10000	3	idempotent ingest-data normalization
backfillAge	{}	10000	3	idempotent age derivation
backfillSearchText	{}	10000	3	idempotent search-text derivation
backfillEvidenceText	{}	10000	3	idempotent evidence-text derivation
backfillPrimaryRuleScore	{}	10000	3	idempotent primary-rule score derivation
validateDataConsistency	{}	10000	3	idempotent consistency validation and derived-data repair
EOF
}

convex_migration_declaration_hash() {
    if command -v sha256sum >/dev/null 2>&1; then
        convex_migration_declarations | sha256sum | awk '{print $1}'
    else
        convex_migration_declarations | shasum -a 256 | awk '{print $1}'
    fi
}

convex_migration_merge_args() {
    local base_args="${1:-}"
    local cursor="${2:-}"
    [[ -n "$base_args" ]] || base_args="{}"
    node - "$base_args" "$cursor" <<'NODE'
const base = JSON.parse(process.argv[2] || "{}");
const cursor = process.argv[3] || "";
if (cursor) base.cursor = cursor;
process.stdout.write(JSON.stringify(base));
NODE
}

convex_migration_parse_progress() {
    local output="${1:-}"
    node - "$output" <<'NODE'
const vm = require("node:vm");
const source = (process.argv[2] || "").trim();
const progressKeys = [
  "updated",
  "updatedResumes",
  "patched",
  "count",
  "cleared",
  "scheduled",
  "movedEducationEntries",
  "updatedProfileFields",
];
let value = null;
try {
  value = JSON.parse(source);
} catch {
  try {
    value = vm.runInNewContext(`(${source})`, Object.create(null), { timeout: 100 });
  } catch {
    value = null;
  }
}
let hasMore = 0;
let cursor = "";
let changed = -1;
let scanned = -1;
let scheduled = -1;
if (value && typeof value === "object" && !Array.isArray(value)) {
  if (value.hasMore === true) {
    hasMore = 1;
    cursor = typeof value.cursor === "string" ? value.cursor : "";
  }
  if (typeof value.scannedResumes === "number") scanned = value.scannedResumes;
  if (typeof value.scanned === "number") scanned = value.scanned;
  if (typeof value.scheduled === "number") scheduled = value.scheduled;
  for (const key of progressKeys) {
    if (typeof value[key] === "number") {
      changed = value[key];
      break;
    }
  }
}
process.stdout.write(
  [hasMore, Buffer.from(cursor).toString("base64"), changed, scanned, scheduled].join("\t"),
);
NODE
}

convex_migration_write_evidence() {
    local name="$1"
    local started_at="$2"
    local ended_at="$3"
    local batches="$4"
    local scanned="$5"
    local changed="$6"
    local scheduled="$7"
    local result="$8"
    local raw_hash="$9"
    local base_args="${10}"
    local iterations="${11}"
    local declaration_hash="${12}"

    [[ -n "${CONVEX_MIGRATION_EVIDENCE_DIR:-}" ]] || return 0
    mkdir -p "$CONVEX_MIGRATION_EVIDENCE_DIR"
    node - "$CONVEX_MIGRATION_EVIDENCE_DIR/$name.json" \
        "$name" "$started_at" "$ended_at" "$batches" "$scanned" "$changed" \
        "$scheduled" "$result" "$raw_hash" "$base_args" "$iterations" "$declaration_hash" <<'NODE'
const fs = require("node:fs");
const [
  path, name, startedAt, endedAt, batches, scanned, changed, scheduled,
  result, rawOutputSha256, baseArguments, cursorIterations, declarationHash,
] = process.argv.slice(2);
const numberOrNull = (value) => Number(value) >= 0 ? Number(value) : null;
const data = {
  schema: "trends-convex-migration-evidence/v1",
  declarationHash,
  name,
  baseArguments: JSON.parse(baseArguments || "{}"),
  cursorIterations: Number(cursorIterations),
  batchCount: Number(batches),
  totals: {
    scanned: numberOrNull(scanned),
    changed: numberOrNull(changed),
    scheduled: numberOrNull(scheduled),
  },
  startedAt,
  endedAt,
  rawOutputSha256,
  result,
};
const tmp = `${path}.tmp-${process.pid}`;
fs.writeFileSync(tmp, `${JSON.stringify(data, null, 2)}\n`, { mode: 0o600 });
fs.renameSync(tmp, path);
NODE
}

convex_migration_bound_raw() {
    local file="$1"
    python3 - "$file" <<'PY'
import os, pathlib, re, sys, tempfile
path = pathlib.Path(sys.argv[1])
data = path.read_bytes()[:1024 * 1024].decode("utf-8", errors="replace")
data = re.sub(
    r"(?im)^([^\n]*(?:password|token|secret|authorization|cookie)[^\n]*?)(=|:)\s*[^\s,}]+",
    r"\1\2 [REDACTED]",
    data,
)
fd, temp = tempfile.mkstemp(prefix=f".{path.name}.", dir=path.parent)
try:
    with os.fdopen(fd, "w") as stream:
        stream.write(data)
        if data and not data.endswith("\n"):
            stream.write("\n")
    os.chmod(temp, 0o600)
    os.replace(temp, path)
finally:
    if os.path.exists(temp):
        os.unlink(temp)
PY
}

run_convex_migration_loop() {
    local convex_dir="$1"
    local migration_name="$2"
    local migration_args="${3:-}"
    local max_iterations="${4:-10000}"
    local max_consecutive_noop="${5:-3}"
    local cursor=""
    local iteration=1
    local batch_count=0
    local consecutive_noop=0
    local total_scanned=0
    local total_changed=0
    local total_scheduled=0
    local saw_scanned=0
    local saw_changed=0
    local saw_scheduled=0
    local started_at ended_at raw_file raw_hash declaration_hash

    [[ -n "$migration_args" ]] || migration_args="{}"

    if ! declare -F convex_migration_execute >/dev/null 2>&1; then
        convex_migration_log_warn "convex_migration_execute adapter is not defined"
        return 2
    fi
    [[ "$max_iterations" =~ ^[1-9][0-9]*$ ]] || return 2
    [[ "$max_consecutive_noop" =~ ^[1-9][0-9]*$ ]] || return 2

    started_at="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
    declaration_hash="$(convex_migration_declaration_hash)"
    raw_file="$(mktemp "${TMPDIR:-/tmp}/trends-migration-${migration_name}.XXXXXX")"
    chmod 600 "$raw_file"
    convex_migration_log_info "Running Convex migration: $migration_name..."

    while true; do
        local call_args output progress has_more rest cursor_b64 trailing
        local batch_changed batch_scanned batch_scheduled
        call_args="$(convex_migration_merge_args "$migration_args" "$cursor")"
        if ! output="$(convex_migration_execute "$convex_dir" "$migration_name" "$call_args" 2>&1)"; then
            printf '%s\n' "$output" | tee -a "$raw_file"
            ended_at="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
            convex_migration_bound_raw "$raw_file"
            raw_hash="$(convex_migration_hash_file "$raw_file")"
            convex_migration_write_evidence "$migration_name" "$started_at" "$ended_at" \
                "$batch_count" "$total_scanned" "$total_changed" "$total_scheduled" \
                "failed" "$raw_hash" "$migration_args" "$iteration" "$declaration_hash"
            rm -f "$raw_file"
            convex_migration_log_warn "$migration_name failed."
            return 1
        fi
        printf '%s\n' "$output" >> "$raw_file"
        batch_count=$((batch_count + 1))
        progress="$(convex_migration_parse_progress "$output")"
        has_more="${progress%%$'\t'*}"
        rest="${progress#*$'\t'}"
        cursor_b64="${rest%%$'\t'*}"
        trailing="${rest#*$'\t'}"
        batch_changed="${trailing%%$'\t'*}"
        trailing="${trailing#*$'\t'}"
        batch_scanned="${trailing%%$'\t'*}"
        batch_scheduled="${trailing#*$'\t'}"

        if [[ "$batch_changed" =~ ^[0-9]+$ ]]; then
            total_changed=$((total_changed + batch_changed))
            saw_changed=1
        fi
        if [[ "$batch_scanned" =~ ^[0-9]+$ ]]; then
            total_scanned=$((total_scanned + batch_scanned))
            saw_scanned=1
        fi
        if [[ "$batch_scheduled" =~ ^[0-9]+$ ]]; then
            total_scheduled=$((total_scheduled + batch_scheduled))
            saw_scheduled=1
        fi
        [[ "$has_more" == "1" ]] || break

        if [[ "$batch_changed" == "0" ]]; then
            consecutive_noop=$((consecutive_noop + 1))
        else
            consecutive_noop=0
        fi
        if [[ "$consecutive_noop" -ge "$max_consecutive_noop" ]]; then
            convex_migration_log_info "$migration_name: $consecutive_noop consecutive batches with 0 updates, skipping remaining."
            break
        fi
        if [[ -n "$cursor_b64" ]]; then
            cursor="$(printf '%s' "$cursor_b64" | base64 --decode)"
        else
            cursor=""
        fi
        iteration=$((iteration + 1))
        if [[ "$iteration" -gt "$max_iterations" ]]; then
            convex_migration_log_warn "$migration_name exceeded the maximum batch iterations."
            ended_at="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
            raw_hash="$(convex_migration_hash_file "$raw_file")"
            convex_migration_write_evidence "$migration_name" "$started_at" "$ended_at" \
                "$batch_count" "$total_scanned" "$total_changed" "$total_scheduled" \
                "failed-max-iterations" "$raw_hash" "$migration_args" "$iteration" "$declaration_hash"
            rm -f "$raw_file"
            return 1
        fi
    done

    ended_at="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
    convex_migration_bound_raw "$raw_file"
    raw_hash="$(convex_migration_hash_file "$raw_file")"
    if [[ -n "${CONVEX_MIGRATION_EVIDENCE_DIR:-}" ]]; then
        mkdir -p "$CONVEX_MIGRATION_EVIDENCE_DIR/raw"
        mv "$raw_file" "$CONVEX_MIGRATION_EVIDENCE_DIR/raw/$migration_name.log"
        chmod 600 "$CONVEX_MIGRATION_EVIDENCE_DIR/raw/$migration_name.log"
    else
        rm -f "$raw_file"
    fi
    convex_migration_write_evidence "$migration_name" "$started_at" "$ended_at" \
        "$batch_count" "$total_scanned" "$total_changed" "$total_scheduled" \
        "passed" "$raw_hash" "$migration_args" "$iteration" "$declaration_hash"

    local summary="Completed Convex migration: $migration_name (batches: $batch_count"
    [[ "$saw_scanned" -eq 1 ]] && summary="$summary, scanned: $total_scanned"
    [[ "$saw_changed" -eq 1 ]] && summary="$summary, changed: $total_changed"
    [[ "$saw_scheduled" -eq 1 ]] && summary="$summary, scheduled: $total_scheduled"
    convex_migration_log_info "$summary)"
}

convex_migration_hash_file() {
    local file="$1"
    if command -v sha256sum >/dev/null 2>&1; then
        sha256sum "$file" | awk '{print $1}'
    else
        shasum -a 256 "$file" | awk '{print $1}'
    fi
}

run_convex_migration_sequence() {
    local convex_dir="$1"
    local name args max_iterations max_noop _note
    while IFS=$'\t' read -r name args max_iterations max_noop _note; do
        [[ -n "$name" ]] || continue
        run_convex_migration_loop "$convex_dir" "$name" "$args" "$max_iterations" "$max_noop" || return
    done < <(convex_migration_declarations)
}
