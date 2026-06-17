# Casdoor Live Smoke Runbook

This runbook covers the optional live portion of the Casdoor/WeCom provider
claims smoke. The smoke is fixture-first and CI-safe by default: it runs local
storage checks every time, but it does not contact Casdoor unless explicitly
enabled.

Do not paste real CorpIDs, client secrets, tokens, passwords, raw provider
profiles, or full authorization headers into this file, issue comments, CI
logs, or vault notes.

## Default Safe Smoke

Run the deterministic fixture smoke with live validation skipped:

```bash
make auth-provider-claims-smoke
```

Expected result:

- Exit code `0`.
- JSON has `success: true`.
- `optionalLive.status` is `skipped_live_provider_smoke`.
- `optionalLive.reason` is `LIVE_PROVIDER_SMOKE is not set`.
- No live network request is attempted.

This is the only mode expected in normal CI.

## Live Smoke Environment

Set `LIVE_PROVIDER_SMOKE=1` to opt in to the live discovery check. All four
Casdoor variables are required for an actual live request:

| Variable | Required | Notes |
| --- | --- | --- |
| `LIVE_PROVIDER_SMOKE` | Yes | Must be exactly `1` to enable live validation. |
| `CASDOOR_SMOKE_BASE_URL` | Yes | Casdoor origin, for example `https://casdoor.example.invalid`. |
| `CASDOOR_SMOKE_CLIENT_ID` | Yes | Casdoor application client id. This may appear in success output. |
| `CASDOOR_SMOKE_CLIENT_SECRET` | Yes | Secret value. It must be redacted from diagnostics. |
| `CASDOOR_SMOKE_REDIRECT_URI` | Yes | Callback URI configured on the Casdoor application. |

No `WECOM_*` environment variables are consumed by this smoke. WeCom identity
claims are covered by the deterministic fixture path.

Use a local, untracked env file for real values:

```bash
cat > .env.casdoor-smoke.local <<'EOF'
LIVE_PROVIDER_SMOKE=1
CASDOOR_SMOKE_BASE_URL=https://casdoor.example.invalid
CASDOOR_SMOKE_CLIENT_ID=<casdoor-client-id>
CASDOOR_SMOKE_CLIENT_SECRET=<casdoor-client-secret>
CASDOOR_SMOKE_REDIRECT_URI=https://trends.example.invalid/api/auth/oidc/callback
EOF
chmod 600 .env.casdoor-smoke.local
set -a
. ./.env.casdoor-smoke.local
set +a
make auth-provider-claims-smoke
```

Remove the local env file after the run if the machine is shared.

## Example Targets

Local development:

```bash
LIVE_PROVIDER_SMOKE=1 \
CASDOOR_SMOKE_BASE_URL=https://casdoor.local.example.invalid \
CASDOOR_SMOKE_CLIENT_ID=<local-client-id> \
CASDOOR_SMOKE_CLIENT_SECRET=<local-client-secret> \
CASDOOR_SMOKE_REDIRECT_URI=http://localhost:3001/api/auth/oidc/callback \
make auth-provider-claims-smoke
```

Preview:

```bash
LIVE_PROVIDER_SMOKE=1 \
CASDOOR_SMOKE_BASE_URL=https://casdoor.preview.example.invalid \
CASDOOR_SMOKE_CLIENT_ID=<preview-client-id> \
CASDOOR_SMOKE_CLIENT_SECRET=<preview-client-secret> \
CASDOOR_SMOKE_REDIRECT_URI=https://preview.pt-mes.com/api/auth/oidc/callback \
make auth-provider-claims-smoke
```

Production-like validation:

```bash
LIVE_PROVIDER_SMOKE=1 \
CASDOOR_SMOKE_BASE_URL=https://casdoor.production.example.invalid \
CASDOOR_SMOKE_CLIENT_ID=<production-client-id> \
CASDOOR_SMOKE_CLIENT_SECRET=<production-client-secret> \
CASDOOR_SMOKE_REDIRECT_URI=https://trends.pt-mes.com/api/auth/oidc/callback \
make auth-provider-claims-smoke
```

Run production-like validation only from an approved operator shell. Do not put
real production values in committed scripts, shell history captures, screenshots,
or chat transcripts.

## Result Statuses

| Status or code | Command exit behavior | Meaning |
| --- | --- | --- |
| `skipped_live_provider_smoke` | `0` | Live validation is disabled or the live env is incomplete. Fixture checks still ran. |
| `live_provider_discovery_ok` | `0` | The Casdoor discovery document returned issuer, authorization endpoint, and token endpoint. |
| `live_provider_discovery_failed` | non-zero | The discovery request failed or returned a non-2xx HTTP status. The script sets exit code `1`; `make` may report this as `Error 1` with process exit `2`. |
| `live_provider_discovery_invalid` | non-zero | The discovery response was not valid JSON or missed required OIDC fields. The script sets exit code `1`; `make` may report this as `Error 1` with process exit `2`. |

When `LIVE_PROVIDER_SMOKE=1` is set but required Casdoor variables are missing,
the smoke still exits `0` with `skipped_live_provider_smoke`. Treat that as
"live validation did not run", not as a successful live validation.

## Redaction Checks

Before sharing output, scan it for forbidden fields and secret-like labels:

```bash
make auth-provider-claims-smoke 2>&1 | tee /tmp/casdoor-live-smoke.log
rg -n "clientSecret|client_secret|password|access_token|id_token|Authorization|rawProfile|profileJson" /tmp/casdoor-live-smoke.log
```

The scan should have no matches for real secret values. In expected failure
diagnostics, `clientSecret` may appear only with the value `[redacted]`.

For an invalid-placeholder live check, use fake values and a non-production
base URL. The command may fail with `live_provider_discovery_failed`, but the
serialized error must not contain the fake secret:

```bash
LIVE_PROVIDER_SMOKE=1 \
CASDOOR_SMOKE_BASE_URL=https://casdoor.invalid.example.invalid \
CASDOOR_SMOKE_CLIENT_ID=fake-client-id \
CASDOOR_SMOKE_CLIENT_SECRET=fake-client-secret-do-not-use \
CASDOOR_SMOKE_REDIRECT_URI=https://trends.example.invalid/api/auth/oidc/callback \
make auth-provider-claims-smoke 2>&1 | tee /tmp/casdoor-live-smoke-invalid.log
rg -n "fake-client-secret-do-not-use|client_secret|password|access_token|id_token|Authorization|rawProfile|profileJson" /tmp/casdoor-live-smoke-invalid.log
```

The first command is expected to return a non-zero exit code for invalid
discovery. The `rg` command must not find the fake secret or forbidden fields.

## Failure Handling

1. Confirm `optionalLive.status` or the top-level error `code`.
2. If status is `skipped_live_provider_smoke`, fix env completeness before
   treating the run as live validation.
3. If code is `live_provider_discovery_failed`, verify DNS, firewall, TLS,
   and the Casdoor base URL.
4. If code is `live_provider_discovery_invalid`, inspect the Casdoor OIDC
   discovery document from a secure operator machine and confirm it includes
   `issuer`, `authorization_endpoint`, and `token_endpoint`.
5. If any output leaks secrets or raw provider profile fields, stop sharing the
   log, rotate the exposed secret, and file a security bug before rerunning.
