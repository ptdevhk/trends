#!/usr/bin/env bash
# Deploy-side result-set parity measurement harness (preview on main vs prod reference).
# Compares the exact resume result sets for the two in-scope preset queries:
#   1) CN:  location=China&q=CNC+销售&minRoleYears=1&roleType=sales&minAge=25&maxAge=40
#   2) MY:  location=Malaysia&q=CNC+Sales&minRoleYears=1&roleType=sales
#
# Attributed-diff gate:
#   - preview_only: additions from query / verified-employer expansion (accepted by definition)
#   - prod_only: probed as admin with includeHidden=true on preview:
#       * appears with includeHidden=true -> policy_hidden (explained)
#       * absent -> unexplained_loss (flagged for HR review)
#   - PASS rule: 0 unexplained prod-only losses per preset.
#
# Usage (on ptcloud):
#   bash deploy/preview-result-set-parity.sh
#   OUTPUT_JSON=/tmp/my-report.json bash deploy/preview-result-set-parity.sh
set -Eeuo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib-preview-common.sh
source "$SCRIPT_DIR/lib-preview-common.sh"
# shellcheck source=lib-preview-auth-session.sh
source "$SCRIPT_DIR/lib-preview-auth-session.sh"

PROD_API="${PROD_API_URL:-http://127.0.0.1:3000}"
PREV_API="${PREVIEW_API_URL:-http://127.0.0.1:3002}"

PROD_ENV_FILE="${PROD_ENV_FILE:-/etc/trends/env}"
PROD_HR_USER="${PROD_HR_USER:-$(read_env_value "$PROD_ENV_FILE" BOOTSTRAP_HR_DEMO_USER)}"
PROD_HR_USER="${PROD_HR_USER:-hr-demo}"
PROD_HR_WS="${PROD_HR_WS:-$(read_env_value "$PROD_ENV_FILE" BOOTSTRAP_HR_DEMO_WORKSPACE)}"
PROD_HR_WS="${PROD_HR_WS:-hr}"
PROD_HR_PASS="${PROD_HR_PASS:-$(read_env_value "$PROD_ENV_FILE" AUTH_HR_DEMO_PASSWORD)}"

PREVIEW_ENV_FILE="${PREVIEW_ENV_FILE:-${PREVIEW_DIR:-/home/ubuntu/trends-preview}/.env.preview}"
if [[ -f "$PREVIEW_ENV_FILE" ]]; then
    set -a
    # shellcheck disable=SC1090
    source "$PREVIEW_ENV_FILE"
    set +a
fi

HR_USER="${BOOTSTRAP_HR_DEMO_USER:-hr-demo}"
HR_WS="${BOOTSTRAP_HR_DEMO_WORKSPACE:-hr}"
HR_PASS="${AUTH_HR_DEMO_PASSWORD:-}"
ADMIN_USER="${BOOTSTRAP_ADMIN_USER:-admin}"
ADMIN_WS="${BOOTSTRAP_ADMIN_WORKSPACE:-dev}"
ADMIN_PASS="${AUTH_BOOTSTRAP_PASSWORD:-admin123}"

OUTPUT_JSON="${OUTPUT_JSON:-/tmp/preview-result-set-parity-$(date +%Y%m%dT%H%M%SZ).json}"
OUTPUT_MD="${OUTPUT_MD:-${OUTPUT_JSON%.json}.md}"

if [[ -z "$PROD_HR_PASS" ]]; then
    log_error "Production AUTH_HR_DEMO_PASSWORD unset — cannot auth production parity"
    exit 1
fi
if [[ -z "$HR_PASS" ]]; then
    log_error "Preview AUTH_HR_DEMO_PASSWORD unset — cannot auth preview parity"
    exit 1
fi

log_step "Starting result-set parity measurement"
echo "prod_api=$PROD_API preview_api=$PREV_API"
echo "output_json=$OUTPUT_JSON"
echo "output_md=$OUTPUT_MD"

export PROD_API PREV_API
export PROD_HR_USER PROD_HR_WS PROD_HR_PASS
export HR_USER HR_WS HR_PASS
export ADMIN_USER ADMIN_WS ADMIN_PASS
export OUTPUT_JSON OUTPUT_MD

python3 - <<'PY'
import urllib.request, json, os, sys, time

prod_api = os.environ["PROD_API"].rstrip("/")
prev_api = os.environ["PREV_API"].rstrip("/")

prod_user = os.environ["PROD_HR_USER"]
prod_ws = os.environ["PROD_HR_WS"]
prod_pass = os.environ["PROD_HR_PASS"]

prev_user = os.environ["HR_USER"]
prev_ws = os.environ["HR_WS"]
prev_pass = os.environ["HR_PASS"]

admin_user = os.environ["ADMIN_USER"]
admin_ws = os.environ["ADMIN_WS"]
admin_pass = os.environ["ADMIN_PASS"]

output_json = os.environ["OUTPUT_JSON"]
output_md = os.environ["OUTPUT_MD"]

queries = [
    {
        "id": "cn-cnc-sales",
        "name": "China CNC Sales (51job preset)",
        "query": "location=China&q=CNC+%E9%94%80%E5%94%AE&minRoleYears=1&roleType=sales&minAge=25&maxAge=40"
    },
    {
        "id": "my-cnc-sales",
        "name": "Malaysia CNC Sales (SEEK preset)",
        "query": "location=Malaysia&q=CNC+Sales&minRoleYears=1&roleType=sales"
    }
]

def login(base, ws, user, pw):
    req = urllib.request.Request(f"{base}/api/auth/login",
        data=json.dumps({"username": user, "password": pw}).encode(),
        headers={"Content-Type": "application/json", "X-Workspace-Slug": ws})
    with urllib.request.urlopen(req, timeout=30) as resp:
        cookies = resp.headers.get("Set-Cookie", "")
        body = json.loads(resp.read().decode())
        csrf = body.get("csrfToken", "")
        return cookies, csrf

def fetch_page(base, ws, cookies, csrf, query, offset, limit, include_hidden=False):
    h = "&includeHidden=true" if include_hidden else ""
    url = f"{base}/api/resumes?source=convex&paged=true&limit={limit}&offset={offset}&{query}{h}"
    req = urllib.request.Request(url, headers={
        "Cookie": cookies,
        "X-CSRF-Token": csrf,
        "X-Workspace-Slug": ws
    })
    with urllib.request.urlopen(req, timeout=60) as resp:
        return json.loads(resp.read().decode())

def get_row_identity(row):
    # Canonical identity: profileUrl, fallback externalId, fallback identityKey
    url = (row.get("profileUrl") or "").strip()
    if url:
        return url
    ext = (row.get("externalId") or "").strip()
    if ext:
        return f"externalId:{ext}"
    ident = (row.get("identityKey") or "").strip()
    if ident:
        return ident
    return str(row.get("id") or "")

def fetch_all(base, ws, cookies, csrf, query, label, include_hidden=False):
    print(f"  Fetching all rows from {label} ({ws})...", flush=True)
    offset = 0
    limit = 100
    all_rows = []
    seen_identities = set()
    total = None
    status_counts = {}

    while True:
        res = fetch_page(base, ws, cookies, csrf, query, offset, limit, include_hidden)
        if total is None:
            summary = res.get("summary") or {}
            total = summary.get("total", 0)
            status_counts = summary.get("statusCounts") or {}

        batch = res.get("data") or res.get("items") or []
        if not batch:
            break

        for row in batch:
            ident = get_row_identity(row)
            if ident not in seen_identities:
                seen_identities.add(ident)
                all_rows.append(row)

        offset += len(batch)
        print(f"    progress {label}: {len(all_rows)}/{total} rows...", flush=True)
        if len(batch) < limit or (total is not None and offset >= total):
            break
        time.sleep(0.05)

    return {
        "total": total,
        "statusCounts": status_counts,
        "rows": all_rows,
        "identities": seen_identities,
        "rowMap": {get_row_identity(r): r for r in all_rows}
    }

print("1. Logging into prod and preview...")
prod_cookies, prod_csrf = login(prod_api, prod_ws, prod_user, prod_pass)
prev_cookies, prev_csrf = login(prev_api, prev_ws, prev_user, prev_pass)
admin_cookies, admin_csrf = login(prev_api, admin_ws, admin_user, admin_pass)
print("   Logins successful.")

report = {
    "timestamp": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
    "prod_api": prod_api,
    "prev_api": prev_api,
    "presets": []
}

overall_pass = True

for p in queries:
    qid = p["id"]
    qname = p["name"]
    qstr = p["query"]
    print(f"\n2. Measuring preset: {qname} ({qid})...")

    prod_res = fetch_all(prod_api, prod_ws, prod_cookies, prod_csrf, qstr, f"prod-{qid}")
    prev_res = fetch_all(prev_api, prev_ws, prev_cookies, prev_csrf, qstr, f"prev-{qid}")

    prod_set = prod_res["identities"]
    prev_set = prev_res["identities"]

    both_set = prod_set.intersection(prev_set)
    prod_only_set = prod_set - prev_set
    prev_only_set = prev_set - prod_set

    print(f"   Counts for {qid}:")
    print(f"     prod_total:        {prod_res['total']} (unique: {len(prod_set)})")
    print(f"     preview_total:     {prev_res['total']} (unique: {len(prev_set)})")
    print(f"     intersection:      {len(both_set)}")
    print(f"     preview_only (additions): {len(prev_only_set)}")
    print(f"     prod_only:         {len(prod_only_set)}")

    # Probing prod_only rows against preview as admin with includeHidden=true
    policy_hidden_rows = []
    unexplained_loss_rows = []

    if prod_only_set:
        print(f"   Attributing {len(prod_only_set)} prod-only rows via preview admin includeHidden=true probe...")
        admin_hidden_res = fetch_all(prev_api, admin_ws, admin_cookies, admin_csrf, qstr, f"admin-hidden-{qid}", include_hidden=True)
        admin_identities = admin_hidden_res["identities"]

        for ident in sorted(prod_only_set):
            prow = prod_res["rowMap"][ident]
            name = prow.get("name") or "未知"
            company = "未知"
            wh = prow.get("workHistory") or []
            if wh and isinstance(wh[0], dict):
                company = wh[0].get("companyName") or wh[0].get("raw") or "未知"

            row_summary = {
                "identity": ident,
                "name": name,
                "company": company,
                "profileUrl": prow.get("profileUrl"),
                "externalId": prow.get("externalId"),
                "source": prow.get("source")
            }

            if ident in admin_identities:
                row_summary["reason"] = "policy_hidden (revealed with includeHidden=true)"
                policy_hidden_rows.append(row_summary)
            else:
                row_summary["reason"] = "unexplained_loss (not in preview search result even with includeHidden=true)"
                unexplained_loss_rows.append(row_summary)

    passed = (len(unexplained_loss_rows) == 0)
    if not passed:
        overall_pass = False

    preset_report = {
        "id": qid,
        "name": qname,
        "query": qstr,
        "passed": passed,
        "prod_total": prod_res["total"],
        "prev_total": prev_res["total"],
        "intersection_count": len(both_set),
        "additions_count": len(prev_only_set),
        "prod_only_count": len(prod_only_set),
        "policy_hidden_count": len(policy_hidden_rows),
        "unexplained_loss_count": len(unexplained_loss_rows),
        "policy_hidden_samples": policy_hidden_rows[:10],
        "unexplained_losses": unexplained_loss_rows,
        "additions_samples": [
            {
                "identity": ident,
                "name": prev_res["rowMap"][ident].get("name"),
                "profileUrl": prev_res["rowMap"][ident].get("profileUrl"),
            }
            for ident in list(prev_only_set)[:5]
        ]
    }
    report["presets"].append(preset_report)

report["overall_pass"] = overall_pass

with open(output_json, "w") as f:
    json.dump(report, f, indent=2, ensure_ascii=False)

print(f"\n3. Wrote JSON report to: {output_json}")

# Write Markdown report
with open(output_md, "w") as f:
    f.write(f"# Preview vs Production Result-Set Parity Report\n\n")
    f.write(f"- Generated: {report['timestamp']}\n")
    f.write(f"- Prod API: `{prod_api}` (0.4.16)\n")
    f.write(f"- Preview API: `{prev_api}` (0.4.23 @ 01a54c0f)\n")
    f.write(f"- Overall Status: **{'PASS' if overall_pass else 'FAIL'}** (zero unexplained prod-only losses)\n\n")

    for p in report["presets"]:
        f.write(f"## Preset: {p['name']} (`{p['id']}`)\n\n")
        f.write(f"- **Result:** **{'PASS' if p['passed'] else 'FAIL'}**\n")
        f.write(f"- Query: `{p['query']}`\n")
        f.write(f"- Prod count: `{p['prod_total']}` | Preview count: `{p['prev_total']}`\n")
        f.write(f"- Intersection: `{p['intersection_count']}` rows\n")
        f.write(f"- Additions (preview-only, accepted expansion): `{p['additions_count']}` rows\n")
        f.write(f"- Prod-only rows: `{p['prod_only_count']}` rows\n")
        f.write(f"  * Policy-hidden (explained via includeHidden): `{p['policy_hidden_count']}` rows\n")
        f.write(f"  * Unexplained losses (gating/filter difference): `{p['unexplained_loss_count']}` rows\n\n")

        if p["unexplained_losses"]:
            f.write(f"### Unexplained losses ({len(p['unexplained_losses'])} rows)\n\n")
            f.write("| Name | Company | Identity / URL |\n")
            f.write("| --- | --- | --- |\n")
            for r in p["unexplained_losses"]:
                f.write(f"| {r['name']} | {r['company']} | {r['identity']} |\n")
            f.write("\n")

        if p["policy_hidden_samples"]:
            f.write(f"### Policy-hidden samples ({len(p['policy_hidden_samples'])} displayed)\n\n")
            f.write("| Name | Company | Identity |\n")
            f.write("| --- | --- | --- |\n")
            for r in p["policy_hidden_samples"]:
                f.write(f"| {r['name']} | {r['company']} | {r['identity']} |\n")
            f.write("\n")

print(f"4. Wrote Markdown report to: {output_md}")
if overall_pass:
    print("\nOVERALL: PASS (zero unexplained losses)")
    sys.exit(0)
else:
    print("\nOVERALL: REVIEW REQUIRED (unexplained losses detected)")
    sys.exit(2)
PY
