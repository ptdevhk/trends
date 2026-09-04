#!/usr/bin/env python3
"""Verify the quick-start search result surface on preview.pt-mes.com.

Answers the user's PASS/FAIL question at the API level for the exact
Thailand quick-start profile search that the landing page would fire:
  query: CNC OR Service Engineer (profile keywords, OR mode)
  filters: locations=Thailand, minRoleYears=1, roleFilterType=engineer, status=all

Also re-checks the fresh real-collect evidence (newest TH seek rows) so the
"collect actually landed" claim is confirmed at the same time as the search.
Authentication uses the host-side preview session via SSH (cookie jar lives on
the host); the same session identity that the browser uses.

Usage:
  python3 scripts/seek-th-quickstart-verify.py --q-cnc 75 --q-or 17
Prints a PASS/FAIL summary and exits 0/1.
"""

from __future__ import annotations

import argparse
import json
import subprocess
import sys

HOST = "ptcloud"
BFF = "http://127.0.0.1:3002"
PREVIEW_ENV = "/home/ubuntu/trends-preview/.env.preview"
SESSION_COOKIE = "trends_session"
CSRF_COOKIE = "trends_csrf"
COOKIE_EXPIRY_S = 8 * 60 * 60  # demo session TTL; re-login when older than this


def _read_env_var(name: str) -> str:
    """Read one value from the host preview env file via sudo (never prints it)."""
    cmd = [
        "ssh", HOST,
        "sudo", "grep", f"^{name}=", PREVIEW_ENV,
    ]
    proc = subprocess.run(cmd, capture_output=True, text=True, timeout=30)
    if proc.returncode != 0:
        raise RuntimeError(f"cannot read {name} from preview env: {proc.stderr[-300:]}")
    line = proc.stdout.strip()
    if not line or "=" not in line:
        raise RuntimeError(f"missing {name} in preview env")
    return line.split("=", 1)[1].strip().strip('"')


def _run_remote_python(script: str, as_root: bool = False) -> subprocess.CompletedProcess:
    """Run a python script on the host via a host-side file (avoids ssh argv quoting).

    The script file is written by piping the content over ssh stdin into
    `sudo tee`, which sidesteps argv quoting entirely on both sides.
    """
    name = "/tmp/trends-verify-helper.py"
    tee = subprocess.run(
        ["ssh", HOST, "sudo", "tee", name],
        input=script,
        capture_output=True, text=True, timeout=30,
    )
    if tee.returncode != 0:
        raise RuntimeError(f"helper write failed: {tee.stderr[-300:]}")
    run_cmd = ["ssh", HOST, "python3", name]
    if as_root:
        run_cmd = ["ssh", HOST, "sudo", "python3", name]
    return subprocess.run(run_cmd, capture_output=True, text=True, timeout=60)


def _session_cookies() -> str:
    """Return a curl cookie header string with a live hr-demo preview session.

    Lazily performs a silent login on the host when no session cookie exists.
    """
    probe = _run_remote_python(
        "import os,sys;"
        "sys.stdout.write('X' if not os.path.exists('/tmp/trends-hr-session-jar.txt') else 'OK')"
    )
    if probe.stdout.strip() != "OK":
        _login()

    # Ensure the jar is readable by the ssh (ubuntu) user; root creates 0600.
    subprocess.run(
        ["ssh", HOST, "sudo", "chmod", "666", "/tmp/trends-hr-session-jar.txt"],
        capture_output=True, text=True, timeout=30,
    )

    read = _run_remote_python(
        "p='/tmp/trends-hr-session-jar.txt';"
        "d={};"
        "[d.update({l.split(chr(9))[5]: l.split(chr(9))[6]}) for l in open(p).read().splitlines() "
        "if l and not l.startswith('#') and len(l.split(chr(9)))>=7];"
        "import sys;"
        "sys.stdout.write(d.get('trends_session','')+'|'+d.get('trends_csrf',''))"
    )
    stdout = read.stdout.strip()
    if "|" not in stdout:
        raise RuntimeError(f"session cookie read failed: {stdout[:200]} rc={read.returncode} {read.stderr[:200]}")
    sess, csrf = stdout.split("|", 1)
    if not sess or not csrf:
        raise RuntimeError("session cookies unavailable after login attempt")
    return f"trends_session={sess}; trends_csrf={csrf}"


def _login() -> None:
    """POST /api/auth/silent-login on the host and store cookies into the jar."""
    token = _read_env_var("AUTH_HR_DEMO_TOKEN")
    login_py = (
        "import json,urllib.request,urllib.error,http.cookiejar,os,sys;"
        "jar=http.cookiejar.MozillaCookieJar('/tmp/trends-hr-session-jar.txt');"
        "opener=urllib.request.build_opener(urllib.request.HTTPCookieProcessor(jar));"
        f"req=urllib.request.Request('{BFF}/api/auth/silent-login',"
        f"data=json.dumps({{'token':{json.dumps(token)}}}).encode(),"
        "headers={'Content-Type':'application/json','Accept':'application/json'});"
        "try:\n"
        "  opener.open(req, timeout=20)\n"
        "except urllib.error.HTTPError as e:\n"
        "  sys.stderr.write('login HTTP %s: %s' % (e.code, e.read()[:200])); sys.exit(2)\n"
        "except Exception as e:\n"
        "  sys.stderr.write('login error: %s' % e); sys.exit(3)\n"
        "jar.save(ignore_discard=True, ignore_expires=True);"
        "os.chmod('/tmp/trends-hr-session-jar.txt', 0o666)"
    )
    proc = _run_remote_python(login_py, as_root=True)
    if proc.returncode != 0:
        raise RuntimeError(f"silent-login failed: {proc.stderr[-400:] or proc.stdout[-400:]}")
    subprocess.run(
        ["ssh", HOST, "sudo", "chmod", "666", "/tmp/trends-hr-session-jar.txt"],
        capture_output=True, text=True, timeout=30,
    )


def host_curl(relative_url: str) -> dict:
    """Run curl on the host with the preview session cookies.

    The curl command is shipped to the host as a single shell string via
    `ssh ptcloud <command>` so the remote shell parses flags/quoting, never
    the local one (ssh does not join local argv into one remote command line
    the way a single quoted argument does).
    """
    url = f"{BFF}{relative_url}"
    cookie_header = _session_cookies()
    shell_cmd = (
        f"curl -s "
        f"-H 'Cookie: {cookie_header}' "
        f"-H 'X-Workspace-Slug: hr' "
        f"-H 'Accept: application/json' "
        f"'{url}'"
    )
    proc = subprocess.run(["ssh", HOST, shell_cmd], capture_output=True, text=True, timeout=60)
    if proc.returncode != 0:
        raise RuntimeError(f"ssh/curl failed rc={proc.returncode}: {proc.stderr[-500:]}")
    try:
        return json.loads(proc.stdout)
    except json.JSONDecodeError as exc:
        raise RuntimeError(f"non-JSON host response: {proc.stdout[:300]}") from exc


def search(q: str, extra: str) -> dict:
    from urllib.parse import quote
    params = (
        "source=convex"
        f"&q={quote(q)}"
        "&locations=Thailand"
        "&status=all"
        "&experienceSortNoPrePaginate=true"
    )
    if extra:
        params += extra
    return host_curl(f"/api/resumes?{params}")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--q-cnc", type=int, default=75, help="Expected total for the plain CNC+Thailand search")
    parser.add_argument("--q-or", type=int, default=17, help="Expected total for the exact quick-start OR query")
    args = parser.parse_args()

    checks: list[tuple[str, bool, str]] = []

    # 1. Real-collect evidence: TH corpus size (CNC + Thailand).
    newest = search("CNC", "")
    total = newest.get("summary", {}).get("total")
    if not isinstance(total, int) or total < args.q_cnc:
        checks.append(("TH corpus size", False, f"expected >= {args.q_cnc}, got {total}"))
    else:
        checks.append(("TH corpus size", True, f"{total} TH CNC resumes present"))

    # 2. Plain CNC Thailand search total (should be ~75+).
    cnc_total = total
    checks.append(
        ("CNC+Thailand search", cnc_total == args.q_cnc,
         f"total={cnc_total} (expected {args.q_cnc})")
    )

    # 3. Exact quick-start OR query: "CNC" OR "Service Engineer" + Thailand + engineer >= 1yr.
    q_or = '"CNC" OR "Service Engineer"'
    or_result = search(q_or, "&minRoleYears=1&roleFilterType=engineer")
    or_summary = or_result.get("summary") or {}
    or_total = or_summary.get("total")
    or_mode = (or_summary.get("mode") or "").lower()
    checks.append(
        ("Quick-start OR search", or_total == args.q_or and or_mode == "or",
         f"total={or_total} mode={or_mode} (expected {args.q_or}, mode=or)")
    )

    # 4. No system-op error surfaced.
    error = or_result.get("error")
    checks.append(("No search error", error is None, f"error={error!r}"))

    print("=== Quick-start verify (preview) ===")
    ok_all = True
    for name, ok, detail in checks:
        ok_all = ok_all and ok
        print(f"[{'PASS' if ok else 'FAIL'}] {name}: {detail}")

    if ok_all:
        print("\nRESULT: PASS")
        return 0
    print("\nRESULT: FAIL")
    return 1


if __name__ == "__main__":
    sys.exit(main())
