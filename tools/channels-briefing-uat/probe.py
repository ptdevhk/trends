#!/usr/bin/env python3
"""Channels briefing v1 UAT probe (Agent C).

Finder Preview: anonymous metadata only. Preview API: optional session POST.
Never downloads video. Never prints cookies, tokens, or media/video URLs.
"""

from __future__ import annotations

import argparse
import http.cookiejar
import json
import os
import re
import sys
import urllib.error
import urllib.parse
import urllib.request
import uuid
from datetime import datetime, timezone
from typing import Any

GOLDEN_URLS = [
    "https://weixin.qq.com/sph/ALr3ch0zp9",
    "https://weixin.qq.com/sph/A3F4F1Vabv",
    "https://weixin.qq.com/sph/Ah85Fcapqh",
]
GOLDEN_IDS = ["ALr3ch0zp9", "A3F4F1Vabv", "Ah85Fcapqh"]
FINDER_URL = "https://channels.weixin.qq.com/finder-preview/api/feed/get_feed_info"
SPH_RE = re.compile(r"^https://weixin\.qq\.com/sph/([A-Za-z0-9]+)$")
VIDEO_HINTS = (
    ".mp4",
    ".m3u8",
    "wxavfile",
    "finder-video",
    "/video/",
    "play_url",
    "specurl",
    "media_url",
)
MAX_BYTES = 256 * 1024
TIMEOUT = 10


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):  # noqa: ANN001
        raise urllib.error.HTTPError(newurl, code, "redirects-disabled", headers, fp)


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def share_id(url: str) -> str:
    match = SPH_RE.fullmatch(url.strip())
    if not match:
        raise ValueError(f"not an allowlisted sph url: {url!r}")
    return match.group(1)


def looks_like_video_url(value: str) -> bool:
    lowered = value.lower()
    return any(hint in lowered for hint in VIDEO_HINTS)


def collect_video_urls(obj: Any, found: list[str] | None = None) -> list[str]:
    acc = found if found is not None else []
    if isinstance(obj, dict):
        for key, val in obj.items():
            key_l = str(key).lower()
            if key_l in {"media_url", "videourl", "video_url", "playurl", "play_url"}:
                if isinstance(val, str) and val:
                    acc.append(key)
            collect_video_urls(val, acc)
    elif isinstance(obj, list):
        for item in obj:
            collect_video_urls(item, acc)
    elif isinstance(obj, str) and looks_like_video_url(obj):
        acc.append("<string>")
    return acc


def truncate(text: str, limit: int = 80) -> str:
    text = (text or "").replace("\n", " ").strip()
    if len(text) <= limit:
        return text
    return text[: limit - 1] + "…"


def parse_count(value: Any) -> int:
    if value is None:
        return 0
    if isinstance(value, (int, float)):
        return int(value)
    text = str(value).strip().replace(",", "")
    if not text:
        return 0
    try:
        return int(float(text))
    except ValueError:
        return 0


def bounded_read(resp: Any) -> bytes:
    raw = resp.read(MAX_BYTES + 1)
    if len(raw) > MAX_BYTES:
        raise RuntimeError("oversized_response")
    return raw


def finder_probe(url: str) -> dict[str, Any]:
    sid = share_id(url)
    page = f"https://channels.weixin.qq.com/finder-preview/pages/sph?id={sid}"
    request_url = (
        f"{FINDER_URL}?_rid={uuid.uuid4().hex}&_pageUrl={urllib.parse.quote(page, safe='')}"
    )
    payload = json.dumps({"baseReq": {"generalToken": ""}, "shortUri": sid}).encode("utf-8")
    headers = {
        "Accept": "application/json, text/plain, */*",
        "Content-Type": "application/json",
        "Origin": "https://channels.weixin.qq.com",
        "Referer": page,
        "User-Agent": (
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
            "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
        ),
    }
    req = urllib.request.Request(request_url, data=payload, headers=headers, method="POST")
    opener = urllib.request.build_opener(NoRedirect())
    try:
        with opener.open(req, timeout=TIMEOUT) as resp:
            data = json.loads(bounded_read(resp).decode("utf-8", errors="replace"))
    except Exception as exc:  # noqa: BLE001 — surface probe status, not a stack
        return {
            "shareId": sid,
            "url": url,
            "status": "error",
            "has_metadata": False,
            "has_anonymous_playable_media": False,
            "video_urls_present": False,
            "error": type(exc).__name__,
        }

    feed = data.get("data", {}).get("feedInfo") or data.get("feedInfo") or {}
    author_info = data.get("data", {}).get("authorInfo") or data.get("authorInfo") or {}
    obj = data.get("data", {}).get("object") or {}
    title = feed.get("description") or feed.get("title") or obj.get("description") or ""
    author = author_info.get("nickname") or obj.get("nickname") or ""
    createtime = feed.get("createtime") or feed.get("createTime") or obj.get("createtime")
    likes = parse_count(feed.get("likeCount") or feed.get("likeCountFmt") or obj.get("like_count"))
    comments = parse_count(
        feed.get("commentCount") or feed.get("commentCountFmt") or obj.get("comment_count")
    )
    forwards = parse_count(
        feed.get("forwardCount") or feed.get("forwardCountFmt") or obj.get("forward_count")
    )
    favs = parse_count(feed.get("favCount") or feed.get("favCountFmt") or obj.get("fav_count"))
    media_list = feed.get("media") or obj.get("media") or []
    has_media_elements = isinstance(media_list, list) and len(media_list) > 0
    video_keys = collect_video_urls(data)
    cover = feed.get("coverUrl") or feed.get("cover_url")
    has_meta = bool(title or author or likes or forwards or favs or createtime is not None)
    return {
        "shareId": sid,
        "url": url,
        "status": "ok" if has_meta else "no_metadata",
        "has_metadata": has_meta,
        "has_anonymous_playable_media": False,
        "has_media_elements": bool(has_media_elements),
        "cover_present": bool(cover),
        "video_urls_present": bool(video_keys),
        "author": author,
        "caption": truncate(str(title), 96),
        "createtime": createtime,
        "likes": likes,
        "comments": comments,
        "forwards": forwards,
        "favs": favs,
        "video_not_fetched": True,
    }


def load_env_file(path: str) -> None:
    """Load KEY=VALUE lines into os.environ without printing values."""
    try:
        with open(path, encoding="utf-8") as handle:
            lines = handle.readlines()
    except OSError:
        return
    for raw in lines:
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        if line.startswith("export "):
            line = line[len("export ") :]
        key, _, value = line.partition("=")
        key = key.strip()
        value = value.strip()
        if len(value) >= 2 and value[0] == value[-1] and value[0] in {'"', "'"}:
            value = value[1:-1]
        if key and key not in os.environ:
            os.environ[key] = value


def cookie_value(jar: http.cookiejar.CookieJar, name: str) -> str:
    for cookie in jar:
        if cookie.name == name:
            return cookie.value
    return ""


def preview_login(base: str) -> tuple[urllib.request.OpenerDirector, dict[str, Any]]:
    """Silent-token first, password second. Never logs secrets."""
    token = os.environ.get("AUTH_HR_DEMO_TOKEN") or os.environ.get("AUTH_HR_DESK_TOKEN") or ""
    password = os.environ.get("AUTH_HR_DEMO_PASSWORD") or ""
    username = os.environ.get("BOOTSTRAP_HR_DEMO_USER") or os.environ.get("AUTH_HR_DEMO_USERNAME") or "hr-demo"
    jar = http.cookiejar.CookieJar()
    opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(jar))
    meta: dict[str, Any] = {"user": username, "method": None, "ok": False}

    def post(path: str, body: dict[str, Any], csrf: str = "") -> tuple[int, dict[str, Any]]:
        data = json.dumps(body).encode("utf-8")
        headers = {"Content-Type": "application/json", "Accept": "application/json"}
        if csrf:
            headers["X-CSRF-Token"] = csrf
        req = urllib.request.Request(base + path, data=data, headers=headers, method="POST")
        try:
            with opener.open(req, timeout=TIMEOUT) as resp:
                raw = bounded_read(resp)
                return resp.status, json.loads(raw.decode("utf-8", errors="replace"))
        except urllib.error.HTTPError as exc:
            raw = exc.read(MAX_BYTES)
            try:
                parsed = json.loads(raw.decode("utf-8", errors="replace"))
            except json.JSONDecodeError:
                parsed = {"error": f"http_{exc.code}"}
            return exc.code, parsed

    if token:
        code, body = post("/api/auth/silent-login", {"token": token})
        meta["method"] = "silent-login"
        meta["http"] = code
        meta["error"] = body.get("error") if isinstance(body, dict) else None
        meta["ok"] = bool(isinstance(body, dict) and body.get("success") is True)
        if meta["ok"]:
            return opener, meta

    if password:
        code, body = post("/api/auth/login", {"username": username, "password": password})
        if code == 403 and "CSRF" in json.dumps(body):
            csrf = cookie_value(jar, "trends_csrf")
            code, body = post(
                "/api/auth/login",
                {"username": username, "password": password},
                csrf=csrf,
            )
        meta["method"] = "password-login"
        meta["http"] = code
        meta["error"] = body.get("error") if isinstance(body, dict) else None
        meta["ok"] = bool(isinstance(body, dict) and body.get("success") is True)
        return opener, meta

    meta["method"] = "none"
    meta["error"] = "AUTH_HR_DEMO_TOKEN and AUTH_HR_DEMO_PASSWORD unset"
    return opener, meta


def preview_briefing(base: str, opener: urllib.request.OpenerDirector) -> dict[str, Any]:
    jar = None
    for handler in opener.handlers:
        if isinstance(handler, urllib.request.HTTPCookieProcessor):
            jar = handler.cookiejar
            break
    csrf = cookie_value(jar, "trends_csrf") if jar is not None else ""
    payload = json.dumps({"urls": GOLDEN_URLS}).encode("utf-8")
    headers = {
        "Content-Type": "application/json",
        "Accept": "application/json",
        "X-Workspace-Slug": os.environ.get("BOOTSTRAP_HR_DEMO_WORKSPACE") or "hr",
    }
    if csrf:
        headers["X-CSRF-Token"] = csrf
    req = urllib.request.Request(
        base + "/api/research/channels-briefing",
        data=payload,
        headers=headers,
        method="POST",
    )
    try:
        with opener.open(req, timeout=20) as resp:
            raw = bounded_read(resp)
            body = json.loads(raw.decode("utf-8", errors="replace"))
            http_code = resp.status
    except urllib.error.HTTPError as exc:
        raw = exc.read(MAX_BYTES)
        http_code = exc.code
        try:
            body = json.loads(raw.decode("utf-8", errors="replace"))
        except json.JSONDecodeError:
            body = {"parse_error": True, "text": raw.decode("utf-8", errors="replace")[:200]}
    except Exception as exc:  # noqa: BLE001
        return {"http": None, "error": type(exc).__name__, "deployed": False}

    video_keys = collect_video_urls(body)
    briefing = body.get("briefing") if isinstance(body, dict) else None
    posts = briefing.get("posts") if isinstance(briefing, dict) else None
    summary = {
        "http": http_code,
        "success": bool(isinstance(body, dict) and body.get("success") is True),
        "error": body.get("error") if isinstance(body, dict) else None,
        "oneLiner_present": bool(isinstance(briefing, dict) and briefing.get("oneLiner")),
        "post_count": len(posts) if isinstance(posts, list) else 0,
        "shareIds": [p.get("shareId") for p in posts] if isinstance(posts, list) else [],
        "video_urls_present": bool(video_keys),
        "video_not_fetched": True,
    }
    if http_code == 404:
        summary["deployed"] = False
        summary["note"] = "route-not-deployed-yet"
    elif http_code == 401:
        summary["deployed"] = None
        summary["note"] = "auth-required-or-session-dropped"
    elif http_code == 200:
        summary["deployed"] = True
    else:
        summary["deployed"] = None
        summary["note"] = f"unexpected-http-{http_code}"
    return summary


def main() -> int:
    parser = argparse.ArgumentParser(description="Channels briefing v1 UAT probe")
    parser.add_argument("--finder-only", action="store_true")
    parser.add_argument("--preview", action="store_true")
    parser.add_argument("--skip-finder", action="store_true")
    parser.add_argument("--preview-base", default="https://preview.pt-mes.com")
    parser.add_argument("--env-file", default="", help="Load KEY=VALUE env without printing")
    args = parser.parse_args()
    if args.env_file:
        load_env_file(args.env_file)

    report: dict[str, Any] = {
        "schema": "channels-briefing-uat/v1",
        "generatedAt": utc_now(),
        "goldenUrls": GOLDEN_URLS,
        "video_not_fetched": True,
    }

    run_finder = not args.skip_finder
    if args.finder_only:
        run_finder = True
        args.preview = False

    if run_finder:
        probes = [finder_probe(url) for url in GOLDEN_URLS]
        report["finder"] = {
            "empty_env_contract": "caller should wrap with env -i",
            "probes": probes,
            "all_metadata_yes": all(p.get("has_metadata") for p in probes),
            "all_playable_media_no": all(not p.get("has_anonymous_playable_media") for p in probes),
            "any_video_urls": any(p.get("video_urls_present") for p in probes),
        }

    if args.preview:
        base = args.preview_base.rstrip("/")
        opener, login_meta = preview_login(base)
        report["preview_login"] = login_meta
        if not login_meta.get("ok"):
            report["preview_briefing"] = {
                "skipped": True,
                "reason": "login-failed",
                "command": (
                    f"AUTH_HR_DEMO_TOKEN|PASSWORD from env; "
                    f"POST {base}/api/auth/silent-login then "
                    f"POST {base}/api/research/channels-briefing"
                ),
                "login_error": login_meta.get("error"),
                "login_http": login_meta.get("http"),
            }
        else:
            report["preview_briefing"] = preview_briefing(base, opener)

    json.dump(report, sys.stdout, ensure_ascii=False, indent=2)
    sys.stdout.write("\n")

    finder = report.get("finder") or {}
    finder_ok = (not run_finder) or (
        finder.get("all_metadata_yes")
        and finder.get("all_playable_media_no")
        and not finder.get("any_video_urls")
    )
    return 0 if finder_ok else 2


if __name__ == "__main__":
    raise SystemExit(main())
