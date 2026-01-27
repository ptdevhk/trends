#!/bin/bash
set -e

# TrendRadar Static Site Builder
# ==============================
# Builds a complete static site for deployment to GitHub Pages or other static hosts.
#
# Outputs:
#   dist/           - Complete static site ready for deployment
#   dist/index.html - Main entry point
#   dist/reports/   - Historical HTML reports (if available)
#
# Usage:
#   ./scripts/build-static.sh              # Build from existing output
#   ./scripts/build-static.sh --fresh      # Run crawler first, then build
#   ./scripts/build-static.sh --web-only   # Build only apps/web (if exists)

# Configuration
DIST_DIR="${DIST_DIR:-dist}"
OUTPUT_DIR="${OUTPUT_DIR:-output}"
WEB_APP_DIR="apps/web"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

log_info() {
    echo -e "${GREEN}[INFO]${NC} $1"
}

log_warn() {
    echo -e "${YELLOW}[WARN]${NC} $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# Parse arguments
FRESH_BUILD=false
WEB_ONLY=false
for arg in "$@"; do
    case $arg in
        --fresh)
            FRESH_BUILD=true
            ;;
        --web-only)
            WEB_ONLY=true
            ;;
        --help|-h)
            echo "Usage: $0 [OPTIONS]"
            echo ""
            echo "Options:"
            echo "  --fresh      Run crawler first to generate fresh reports"
            echo "  --web-only   Build only the React frontend (apps/web)"
            echo "  --help, -h   Show this help message"
            exit 0
            ;;
    esac
done

# Clean and create dist directory
log_info "Preparing output directory: $DIST_DIR"
rm -rf "$DIST_DIR"
mkdir -p "$DIST_DIR"

# Run crawler if --fresh flag is provided
if [ "$FRESH_BUILD" = true ]; then
    log_info "Running crawler to generate fresh reports..."
    SKIP_ROOT_INDEX=true uv run python -m trendradar
fi

# Build React frontend if it exists
build_web_frontend() {
    if [ -d "$WEB_APP_DIR" ] && [ -f "$WEB_APP_DIR/package.json" ]; then
        log_info "Building React frontend from $WEB_APP_DIR..."

        # Check for package manager
        if [ -f "$WEB_APP_DIR/pnpm-lock.yaml" ]; then
            (cd "$WEB_APP_DIR" && pnpm install && pnpm build)
        elif [ -f "$WEB_APP_DIR/yarn.lock" ]; then
            (cd "$WEB_APP_DIR" && yarn install && yarn build)
        elif [ -f "$WEB_APP_DIR/bun.lockb" ]; then
            (cd "$WEB_APP_DIR" && bun install && bun run build)
        else
            (cd "$WEB_APP_DIR" && npm install && npm run build)
        fi

        # Copy built files to dist
        if [ -d "$WEB_APP_DIR/dist" ]; then
            log_info "Copying React build to $DIST_DIR..."
            cp -r "$WEB_APP_DIR/dist/"* "$DIST_DIR/"
            return 0
        elif [ -d "$WEB_APP_DIR/build" ]; then
            log_info "Copying React build to $DIST_DIR..."
            cp -r "$WEB_APP_DIR/build/"* "$DIST_DIR/"
            return 0
        else
            log_error "React build completed but no output found"
            return 1
        fi
    else
        log_warn "No React frontend found at $WEB_APP_DIR"
        return 1
    fi
}

# Build static reports from Python output
build_static_reports() {
    log_info "Building static site from Python-generated reports..."

    # Check if output directory exists
    if [ ! -d "$OUTPUT_DIR" ]; then
        log_error "Output directory not found: $OUTPUT_DIR"
        log_error "Run 'make run' or use --fresh flag to generate reports first"
        exit 1
    fi

    # Copy main index.html
    if [ -f "$OUTPUT_DIR/index.html" ]; then
        log_info "Copying main index.html..."
        cp "$OUTPUT_DIR/index.html" "$DIST_DIR/index.html"
    elif [ -f "index.html" ]; then
        log_info "Copying root index.html..."
        cp "index.html" "$DIST_DIR/index.html"
    else
        log_warn "No index.html found. Site may not work correctly."
    fi

    # Copy HTML reports directory
    if [ -d "$OUTPUT_DIR/html" ]; then
        log_info "Copying HTML reports..."
        mkdir -p "$DIST_DIR/reports"
        cp -r "$OUTPUT_DIR/html/"* "$DIST_DIR/reports/"

        # Count copied files
        REPORT_COUNT=$(find "$DIST_DIR/reports" -name "*.html" | wc -l)
        log_info "Copied $REPORT_COUNT HTML report(s)"
    fi

    # Copy latest reports for easy access
    if [ -d "$OUTPUT_DIR/html/latest" ]; then
        log_info "Copying latest reports to root..."
        for mode in daily current incremental; do
            if [ -f "$OUTPUT_DIR/html/latest/${mode}.html" ]; then
                cp "$OUTPUT_DIR/html/latest/${mode}.html" "$DIST_DIR/${mode}.html"
            fi
        done
    fi
}

# Create a simple 404.html for SPA routing (GitHub Pages)
create_404_page() {
    log_info "Creating 404.html for SPA routing..."
    cat > "$DIST_DIR/404.html" << 'EOF'
<!DOCTYPE html>
<html lang="zh-Hant">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Page Not Found - TrendRadar</title>
    <style>
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, sans-serif;
            display: flex;
            justify-content: center;
            align-items: center;
            min-height: 100vh;
            margin: 0;
            background: #f5f5f5;
            color: #333;
        }
        .container {
            text-align: center;
            padding: 2rem;
        }
        h1 {
            font-size: 4rem;
            margin: 0;
            color: #e74c3c;
        }
        p {
            font-size: 1.2rem;
            color: #666;
        }
        a {
            color: #3498db;
            text-decoration: none;
        }
        a:hover {
            text-decoration: underline;
        }
    </style>
</head>
<body>
    <div class="container">
        <h1>404</h1>
        <p>Page not found</p>
        <p><a href="/">Return to TrendRadar</a></p>
    </div>
</body>
</html>
EOF
}

# Create .nojekyll file (prevents GitHub Pages from processing with Jekyll)
create_nojekyll() {
    log_info "Creating .nojekyll file..."
    touch "$DIST_DIR/.nojekyll"
}

# Create CNAME file if custom domain is configured
create_cname() {
    if [ -n "$CNAME_DOMAIN" ]; then
        log_info "Creating CNAME file for $CNAME_DOMAIN..."
        echo "$CNAME_DOMAIN" > "$DIST_DIR/CNAME"
    fi
}

# Main build logic
main() {
    log_info "Starting TrendRadar static build..."

    if [ "$WEB_ONLY" = true ]; then
        # Only build React frontend
        if ! build_web_frontend; then
            log_error "Failed to build React frontend"
            exit 1
        fi
    else
        # Try React frontend first, fallback to Python reports
        if build_web_frontend 2>/dev/null; then
            log_info "React frontend built successfully"
        else
            log_info "Falling back to Python-generated reports..."
            build_static_reports
        fi
    fi

    # Create supporting files
    create_404_page
    create_nojekyll
    create_cname

    # Summary
    echo ""
    log_info "Build complete!"
    log_info "Output directory: $DIST_DIR"

    # List generated files
    if command -v tree &> /dev/null; then
        tree -L 2 "$DIST_DIR"
    else
        ls -la "$DIST_DIR"
    fi

    echo ""
    log_info "To preview locally:"
    echo "  npx serve $DIST_DIR"
    echo "  # or"
    echo "  python -m http.server -d $DIST_DIR 8000"
}

main
