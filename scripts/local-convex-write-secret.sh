#!/usr/bin/env bash

# Sourceable helpers for pairing a local API process with the local Convex
# runtime. Functions are intentionally silent because the managed value is a
# write credential.

local_convex_read_env_value() {
    local env_path="$1"
    local key="$2"
    local line
    local value=""

    if [[ ! -f "$env_path" ]]; then
        return 0
    fi

    while IFS= read -r line || [[ -n "$line" ]]; do
        case "$line" in
            "$key="*) value="${line#*=}" ;;
        esac
    done < "$env_path"

    value="${value%$'\r'}"
    if [[ "$value" == \"*\" && "$value" == *\" && ${#value} -ge 2 ]]; then
        value="${value:1:${#value}-2}"
    elif [[ "$value" == \'*\' && "$value" == *\' && ${#value} -ge 2 ]]; then
        value="${value:1:${#value}-2}"
    fi
    printf '%s' "$value"
}

local_convex_resolve_setting() {
    local project_root="$1"
    local key="$2"
    local value="${!key:-}"

    if [[ -z "$value" ]]; then
        value="$(local_convex_read_env_value "$project_root/packages/convex/.env.local" "$key")"
    fi
    if [[ -z "$value" ]]; then
        value="$(local_convex_read_env_value "$project_root/.env.local" "$key")"
    fi
    printf '%s' "$value"
}

local_convex_is_loopback_url() {
    local value="$1"
    [[ "$value" =~ ^https?://(localhost|127\.0\.0\.1|\[::1\])(:[0-9]+)?(/|$) ]]
}

is_local_anonymous_convex() {
    local project_root="${LOCAL_CONVEX_PROJECT_ROOT:-$(pwd)}"
    local deployment
    local convex_url
    deployment="$(local_convex_resolve_setting "$project_root" CONVEX_DEPLOYMENT)"
    convex_url="$(local_convex_resolve_setting "$project_root" CONVEX_URL)"

    if [[ -n "$convex_url" ]] && ! local_convex_is_loopback_url "$convex_url"; then
        return 1
    fi

    if [[ "$deployment" == anonymous:* || "${CONVEX_AGENT_MODE:-}" == "anonymous" ]]; then
        return 0
    fi

    [[ -n "$convex_url" ]] && local_convex_is_loopback_url "$convex_url"
}

local_convex_generate_write_secret() {
    local value=""
    if command -v openssl >/dev/null 2>&1; then
        value="$(openssl rand -hex 32 2>/dev/null || true)"
    fi
    if [[ ${#value} -lt 64 ]] && [[ -r /dev/urandom ]]; then
        value="$(od -An -N32 -tx1 /dev/urandom 2>/dev/null | tr -d '[:space:]')"
    fi
    if [[ ${#value} -lt 64 ]]; then
        return 1
    fi
    printf '%s' "$value"
}

local_convex_write_secret_to_env_file() {
    local env_path="$1"
    local secret="$2"
    local temp_path
    local old_umask
    local line
    local wrote_secret="false"

    mkdir -p "$(dirname "$env_path")"
    old_umask="$(umask)"
    umask 077
    temp_path="$(mktemp "${env_path}.tmp.XXXXXX")"

    if [[ -f "$env_path" ]]; then
        while IFS= read -r line || [[ -n "$line" ]]; do
            case "$line" in
                CONVEX_WRITE_SECRET=*)
                    if [[ "$wrote_secret" == "false" ]]; then
                        printf 'CONVEX_WRITE_SECRET=%s\n' "$secret" >> "$temp_path"
                        wrote_secret="true"
                    fi
                    ;;
                *) printf '%s\n' "$line" >> "$temp_path" ;;
            esac
        done < "$env_path"
    fi

    if [[ "$wrote_secret" == "false" ]]; then
        if [[ -s "$temp_path" ]]; then
            printf '\n' >> "$temp_path"
        fi
        printf 'CONVEX_WRITE_SECRET=%s\n' "$secret" >> "$temp_path"
    fi

    mv "$temp_path" "$env_path"
    chmod 600 "$env_path"
    umask "$old_umask"
}

ensure_local_convex_write_secret() {
    local project_root="${LOCAL_CONVEX_PROJECT_ROOT:-$(pwd)}"
    local root_env="$project_root/.env.local"
    local secret="${CONVEX_WRITE_SECRET:-}"

    if ! is_local_anonymous_convex; then
        return 0
    fi

    if [[ -z "$secret" ]]; then
        secret="$(local_convex_read_env_value "$root_env" CONVEX_WRITE_SECRET)"
    fi
    if [[ -z "$secret" ]]; then
        secret="$(local_convex_generate_write_secret)" || return 1
    fi

    local_convex_write_secret_to_env_file "$root_env" "$secret"
    export CONVEX_WRITE_SECRET="$secret"
    export LOCAL_CONVEX_WRITE_SECRET_ACTIVE=1
}
