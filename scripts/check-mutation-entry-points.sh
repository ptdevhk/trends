#!/bin/bash
# check-mutation-entry-points.sh
#
# Validates that every public Convex mutation in packages/convex/convex/ is
# registered in _mutations_registry.ts. Fails if any unregistered public
# mutation is found. Internal mutations (`internalMutation(...)`) are NOT
# user-reachable via the BFF and are intentionally excluded.
#
# Wired into `make check` via the `check-mutation-entry-points` target.
set -euo pipefail

CONVEX_DIR="packages/convex/convex"
REGISTRY="$CONVEX_DIR/_mutations_registry.ts"

if [ ! -f "$REGISTRY" ]; then
    echo "ERROR: $REGISTRY not found" >&2
    exit 1
fi

# Extract registered file:name pairs from the registry. Entries are expected to
# be one-liners shaped like `{ file: "foo.ts", name: "bar", ... }`.
registered=$(grep -oE '\{ file: "[^"]+", name: "[^"]+"' "$REGISTRY" \
    | sed 's/{ file: "//; s/", name: "/:/; s/"$//' \
    | sort -u)

if [ -z "$registered" ]; then
    echo "ERROR: no entries parsed from $REGISTRY" >&2
    exit 1
fi

unregistered=0
# Walk every .ts file in the convex dir, skipping the registry itself, the
# Convex generated directory, and any *.test.ts files. Subdirs (e.g. lib/) are
# included so nothing slips through.
while IFS= read -r file; do
    base=$(basename "$file")
    # Match `export const NAME = mutation(` exactly. This excludes
    # `internalMutation(` because the regex requires the literal `= mutation(`
    # (no characters between `= ` and `mutation(`).
    while IFS= read -r name; do
        [ -z "$name" ] && continue
        key="$base:$name"
        if ! printf '%s\n' "$registered" | grep -qFx "$key"; then
            echo "UNREGISTERED MUTATION: $key" >&2
            echo "  Add an entry to $REGISTRY" >&2
            unregistered=$((unregistered + 1))
        fi
    done < <(grep -oE '^export const [a-zA-Z_][a-zA-Z0-9_]* = mutation\(' "$file" \
        | sed 's/^export const //; s/ = mutation(//')
done < <(find "$CONVEX_DIR" \
    \( -path "$CONVEX_DIR/_generated" -prune \) -o \
    \( -type f -name '*.ts' \
       ! -name '_mutations_registry.ts' \
       ! -name '*.test.ts' \
       -print \))

if [ "$unregistered" -gt 0 ]; then
    echo "" >&2
    echo "FAIL: $unregistered mutation(s) not registered in $REGISTRY" >&2
    echo "Fix: add { file, name, quiesceAware, reason } entries — set" >&2
    echo "  quiesceAware: true  for user-facing mutations covered by the BFF" >&2
    echo "                       maintenance middleware (Task 4) or a direct" >&2
    echo "                       in-handler guard (Task 3)." >&2
    echo "  quiesceAware: false for system_settings.set, migrations, and any" >&2
    echo "                       other mutation that must run during a restore." >&2
    exit 1
fi

# Reverse drift guard: every registered file:name must still exist as an
# export. Catches stale registry entries (e.g. deleteIndustryVerdictRevision
# lingered after its mutation was removed).
stale=0
while IFS= read -r key; do
    [ -z "$key" ] && continue
    file="${key%%:*}"
    name="${key#*:}"
    if ! grep -qE "^export const ${name} = (?:async )?mutation\(" "$CONVEX_DIR/$file" 2>/dev/null; then
        echo "STALE REGISTRY ENTRY: $key" >&2
        echo "  Export no longer exists in $CONVEX_DIR/$file — remove the entry" >&2
        stale=$((stale + 1))
    fi
done < <(printf '%s\n' "$registered")

if [ "$stale" -gt 0 ]; then
    echo "" >&2
    echo "FAIL: $stale stale registry entr(y/ies) in $REGISTRY" >&2
    exit 1
fi

echo "OK: All public mutations registered in _mutations_registry.ts"
