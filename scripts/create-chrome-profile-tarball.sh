#!/usr/bin/env bash
# Create a clean tarball of Chrome profile for LXC transfer
# Usage: create-chrome-profile-tarball.sh [source_profile] [output_tarball]

set -euo pipefail

SOURCE="${1:-$HOME/Library/Application Support/Google/chrome-debug-profile-from-default}"
OUTPUT="${2:-$HOME/chrome-profile-for-lxc.tar.gz}"

if [[ ! -d "$SOURCE" ]]; then
    echo "ERROR: Source profile not found: $SOURCE"
    echo "Run scripts/chrome-debug.sh first to create the profile"
    exit 1
fi

echo "Creating tarball from: $SOURCE"
echo "Output: $OUTPUT"

# Create tarball excluding caches and extended attributes
# --no-xattrs prevents macOS extended attributes from being included
if tar --no-xattrs -czf "$OUTPUT" \
    --exclude='Cache' \
    --exclude='GPUCache' \
    --exclude='Code Cache' \
    --exclude='Service Worker' \
    --exclude='blob_storage' \
    --exclude='GrShaderCache' \
    --exclude='ShaderCache' \
    --exclude='GraphiteDawnCache' \
    --exclude='SingletonLock' \
    --exclude='SingletonCookie' \
    --exclude='SingletonSocket' \
    --exclude='.DS_Store' \
    --exclude='._*' \
    -C "$SOURCE" . 2>/dev/null; then
    echo "✓ Tarball created successfully (no-xattrs method)"
else
    # Fallback for BSD tar (macOS default) which doesn't support --no-xattrs
    echo "Using fallback method (BSD tar)..."
    
    # Create temp directory and copy without xattrs
    TMPDIR=$(mktemp -d)
    trap 'rm -rf "$TMPDIR"' EXIT
    
    echo "Copying profile to temp dir..."
    cp -rX "$SOURCE" "$TMPDIR/chrome-profile" 2>/dev/null || cp -r "$SOURCE" "$TMPDIR/chrome-profile"
    
    # Remove problematic files
    find "$TMPDIR/chrome-profile" -name '._*' -delete 2>/dev/null || true
    find "$TMPDIR/chrome-profile" -name '.DS_Store' -delete 2>/dev/null || true
    find "$TMPDIR/chrome-profile" -type d \( \
        -name 'Cache' -o \
        -name 'GPUCache' -o \
        -name 'Code Cache' -o \
        -name 'Service Worker' -o \
        -name 'blob_storage' -o \
        -name 'GrShaderCache' -o \
        -name 'ShaderCache' -o \
        -name 'GraphiteDawnCache' \
    \) -exec rm -rf {} + 2>/dev/null || true
    
    # Remove lock files
    find "$TMPDIR/chrome-profile" -maxdepth 2 -type l \( \
        -name 'SingletonLock' -o \
        -name 'SingletonCookie' -o \
        -name 'SingletonSocket' \
    \) -delete 2>/dev/null || true
    
    # Create tarball
    tar czf "$OUTPUT" -C "$TMPDIR/chrome-profile" .
    echo "✓ Tarball created successfully (BSD tar fallback)"
fi

echo ""
ls -lh "$OUTPUT"
echo ""
echo "Next steps:"
echo "  1. Upload to LXC: scp '$OUTPUT' root@10.10.1.13:/root/chrome-profile-macos.tar.gz"
echo "  2. SSH to LXC and run: chrome-profile-setup.sh"
