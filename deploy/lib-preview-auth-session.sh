#!/usr/bin/env bash
# Cookie + CSRF helpers for preview auth smoke / parity / gate.
# shellcheck disable=SC2034
# Source after lib-preview-common.sh

preview_auth_login() {
    # usage: preview_auth_login <username> <password> <cookie_jar_path>
    local username="$1"
    local password="$2"
    local jar="$3"
    local api="${PREVIEW_API_URL:-http://127.0.0.1:3002}"
    rm -f "$jar"
    local body
    body="$(curl -sS -c "$jar" -b "$jar" \
        -X POST "$api/api/auth/login" \
        -H 'Content-Type: application/json' \
        -d "{\"username\":\"$username\",\"password\":\"$password\"}" 2>&1)" || true
    if ! echo "$body" | grep -q '"success":true'; then
        # CSRF retry if prior cookies existed elsewhere
        if echo "$body" | grep -qi 'CSRF'; then
            local csrf
            csrf="$(preview_auth_csrf_from_jar "$jar")"
            body="$(curl -sS -c "$jar" -b "$jar" \
                -X POST "$api/api/auth/login" \
                -H 'Content-Type: application/json' \
                -H "X-CSRF-Token: $csrf" \
                -d "{\"username\":\"$username\",\"password\":\"$password\"}" 2>&1)" || true
        fi
    fi
    if ! echo "$body" | grep -q '"success":true'; then
        log_error "login failed for user=$username"
        echo "$body" | head -c 400 >&2
        echo >&2
        return 1
    fi
    return 0
}

preview_auth_csrf_from_jar() {
    local jar="$1"
    awk '$6=="trends_csrf"{print $7}' "$jar" 2>/dev/null | tail -1
}

preview_auth_curl() {
    # usage: preview_auth_curl <cookie_jar> <workspace_slug> <curl args after URL...>
    # Example: preview_auth_curl /tmp/j.jar hr -o /tmp/out -w '%{http_code}' \
    #            "http://127.0.0.1:3002/api/blocks"
    local jar="$1"
    local workspace="$2"
    shift 2
    local csrf
    csrf="$(preview_auth_csrf_from_jar "$jar")"
    curl -sS -b "$jar" -c "$jar" \
        -H "X-CSRF-Token: $csrf" \
        -H "X-Workspace-Slug: $workspace" \
        "$@"
}
