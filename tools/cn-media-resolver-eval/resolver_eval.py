"""CN Media Resolvers: Anonymous Headless Backend Evaluation.

Strictly stdlib-only implementation supporting URL classification, safety checks,
secret/signed URL redaction, candidate static evidence audit, and bounded WeChat
anonymous probe response normalization.
"""

from __future__ import annotations

import argparse
import ipaddress
import json
import re
import sys
import urllib.parse
import urllib.request
import uuid
from datetime import datetime, timezone
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Dict, List, Optional


# =====================================================================
# Exceptions
# =====================================================================

class UnsafeUrlError(ValueError):
    """Raised when a URL violates safety policies (non-HTTPS, userinfo, private IP, etc.)."""
    pass


class UnsupportedUrlError(ValueError):
    """Raised when a URL domain or scheme is not recognized as a supported platform."""
    pass


# =====================================================================
# URL Classification & Safety
# =====================================================================

SUPPORTED_PLATFORMS = {
    "wechat": {
        "domains": {"weixin.qq.com", "channels.weixin.qq.com"},
    },
    "douyin": {
        "domains": {"v.douyin.com", "douyin.com", "www.douyin.com", "iesdouyin.com"},
    },
    "xiaohongshu": {
        "domains": {"xhslink.com", "xiaohongshu.com", "www.xiaohongshu.com"},
    },
}

SENSITIVE_PARAM_KEYS = {
    "token", "sign", "signature", "key", "encfilekey", "thumbkey",
    "secret", "auth", "authorization", "session", "skey", "uin", "pass_ticket",
    "appmsg_token", "x-signature", "x-secsdk-csrf-token", "cookie"
}


@dataclass(frozen=True)
class UrlClassificationResult:
    url: str
    platform: str
    hostname: str
    is_supported: bool


def _is_private_or_loopback(host: str) -> bool:
    """Check if host is an IP literal or localhost pointing to private/loopback space."""
    clean_host = host.strip("[]").lower()
    if clean_host in ("localhost", "localhost.localdomain", "ip6-localhost", "ip6-loopback"):
        return True
    try:
        ip = ipaddress.ip_address(clean_host)
        return ip.is_private or ip.is_loopback or ip.is_reserved or ip.is_link_local
    except ValueError:
        return False


def classify_url(url_str: str) -> UrlClassificationResult:
    """Validate and classify a public share URL using strict platform allowlists.

    Enforces:
      - Strict HTTPS scheme
      - Rejection of userinfo/credentials
      - Rejection of IP literals, localhost, and private destinations
      - Rejection of lookalikes/unknown hosts
    """
    if not isinstance(url_str, str) or not url_str.strip():
        raise UnsafeUrlError("URL must be a non-empty string")

    parsed = urllib.parse.urlparse(url_str.strip())

    if parsed.scheme.lower() != "https":
        raise UnsafeUrlError(f"Unsupported or insecure scheme '{parsed.scheme}'. Only HTTPS is permitted.")

    if "@" in parsed.netloc or parsed.username is not None or parsed.password is not None:
        raise UnsafeUrlError("URLs containing userinfo or embedded credentials are strictly rejected.")

    hostname = (parsed.hostname or "").lower().rstrip(".")
    if not hostname:
        raise UnsafeUrlError("URL is missing a valid hostname.")

    try:
        port = parsed.port
    except ValueError as exc:
        raise UnsafeUrlError("URL contains an invalid port.") from exc
    if port not in (None, 443):
        raise UnsafeUrlError("Only the default HTTPS port is permitted.")

    try:
        ipaddress.ip_address(hostname)
    except ValueError:
        pass
    else:
        raise UnsafeUrlError("IP-literal destinations are not permitted.")

    if _is_private_or_loopback(hostname):
        raise UnsafeUrlError(f"Private, loopback, or internal address '{hostname}' is rejected.")

    path = parsed.path or "/"
    query = urllib.parse.parse_qs(parsed.query)
    platform = None
    if hostname == "weixin.qq.com" and re.fullmatch(r"/sph/[A-Za-z0-9]+/?", path):
        platform = "wechat"
    elif hostname == "channels.weixin.qq.com" and path == "/finder-preview/pages/sph" and re.fullmatch(r"[A-Za-z0-9]+", (query.get("id") or [""])[0]):
        platform = "wechat"
    elif hostname == "v.douyin.com" and re.fullmatch(r"/[A-Za-z0-9_-]+/?", path):
        platform = "douyin"
    elif hostname in {"douyin.com", "www.douyin.com", "iesdouyin.com"} and re.fullmatch(r"/video/\d+/?", path):
        platform = "douyin"
    elif hostname == "xhslink.com" and re.fullmatch(r"/(?:a|o)/[A-Za-z0-9_-]+/?", path):
        platform = "xiaohongshu"
    elif hostname in {"xiaohongshu.com", "www.xiaohongshu.com"} and re.fullmatch(r"/(?:explore|discovery/item)/[A-Za-z0-9]+/?", path):
        platform = "xiaohongshu"

    if platform:
        return UrlClassificationResult(
            url=url_str,
            platform=platform,
            hostname=hostname,
            is_supported=True,
        )

    if any(hostname in conf["domains"] for conf in SUPPORTED_PLATFORMS.values()):
        raise UnsupportedUrlError(f"URL path is not a supported public share form for '{hostname}'.")

    raise UnsupportedUrlError(f"Hostname '{hostname}' is not in the supported platform allowlist.")


# =====================================================================
# Redaction
# =====================================================================

def redact_sensitive_url(url_str: str) -> str:
    """Redact sensitive query parameters, tokens, and signatures from a URL string."""
    if not isinstance(url_str, str) or not url_str.strip():
        return url_str

    try:
        parsed = urllib.parse.urlparse(url_str)
    except Exception:
        return "[REDACTED_URL]"

    if not parsed.query:
        return url_str

    query_params = urllib.parse.parse_qsl(parsed.query, keep_blank_values=True)
    redacted_params = []
    has_redactions = False

    for k, v in query_params:
        k_lower = k.lower()
        if any(sens in k_lower for sens in SENSITIVE_PARAM_KEYS):
            redacted_params.append((k, "[REDACTED]"))
            has_redactions = True
        else:
            redacted_params.append((k, v))

    if not has_redactions:
        return url_str

    new_query = urllib.parse.urlencode(redacted_params)
    return urllib.parse.urlunparse(parsed._replace(query=new_query))


def redact_payload(obj: Any) -> Any:
    """Recursively redact sensitive keys, tokens, auth headers, and signed URLs in payloads."""
    if isinstance(obj, dict):
        clean = {}
        for k, v in obj.items():
            k_lower = str(k).lower()
            if any(sens in k_lower for sens in ("cookie", "auth", "authorization", "token", "password", "secret")):
                clean[k] = "[REDACTED]"
            elif isinstance(v, str) and ("http://" in v or "https://" in v):
                clean[k] = redact_sensitive_url(v)
            else:
                clean[k] = redact_payload(v)
        return clean
    elif isinstance(obj, list):
        return [redact_payload(item) for item in obj]
    elif isinstance(obj, str) and ("http://" in obj or "https://" in obj):
        return redact_sensitive_url(obj)
    return obj


# =====================================================================
# Static Evidence Classification
# =====================================================================

@dataclass(frozen=True)
class CandidateClassification:
    candidate_id: str
    commit: str
    license_status: str  # permissive, restricted, unlicensed
    anonymous_metadata: bool
    anonymous_media: bool
    is_headless: bool
    backend_safe_foundation: bool
    notes: str = ""


def classify_candidate_evidence(candidate_dict: Dict[str, Any]) -> CandidateClassification:
    """Classify candidate static audit facts into structured evaluation properties."""
    cid = candidate_dict.get("id", "")
    commit = candidate_dict.get("commit", "")
    lic = candidate_dict.get("license")

    # Determine license status
    lic_status = candidate_dict.get("license_status")
    if not lic_status:
        if lic in ("MIT", "Apache-2.0", "BSD-2-Clause", "BSD-3-Clause"):
            lic_status = "permissive"
        elif lic in ("Commons-Clause-over-MIT", "PolyForm-Noncommercial", "GPL-3.0", "AGPL-3.0"):
            lic_status = "restricted"
        else:
            lic_status = "unlicensed"

    anonymous_metadata = bool(candidate_dict.get("anonymous_metadata", False))
    anonymous_media = bool(candidate_dict.get("anonymous_media", False))
    is_headless = bool(candidate_dict.get("is_headless", False))
    backend_safe_foundation = (
        lic_status == "permissive"
        and anonymous_metadata
        and anonymous_media
        and is_headless
        and not bool(candidate_dict.get("requires_cookie", False))
        and not bool(candidate_dict.get("requires_desktop_proxy", False))
        and not bool(candidate_dict.get("requires_desktop_client", False))
        and not bool(candidate_dict.get("has_subprocesses", False))
        and not bool(candidate_dict.get("remote_third_party_apis", []))
    )
    notes = candidate_dict.get("notes", "")

    return CandidateClassification(
        candidate_id=cid,
        commit=commit,
        license_status=lic_status,
        anonymous_metadata=anonymous_metadata,
        anonymous_media=anonymous_media,
        is_headless=is_headless,
        backend_safe_foundation=backend_safe_foundation,
        notes=notes
    )


# =====================================================================
# WeChat Anonymous Probe & Normalization
# =====================================================================

@dataclass
class FakeResponse:
    status_code: int
    json_data: Dict[str, Any]

    def json(self) -> Dict[str, Any]:
        return self.json_data


@dataclass
class WeChatPreviewResult:
    has_metadata: bool
    status: str = "ok"  # "ok", "error", "oversized_response"
    title: str = ""
    author: str = ""
    views: int = 0
    likes: int = 0
    comments: int = 0
    forwards: int = 0
    fav_count: int = 0
    createtime: Optional[int] = None
    has_anonymous_playable_media: bool = False
    media_url: Optional[str] = None
    raw_normalized: Dict[str, Any] = field(default_factory=dict)


def _extract_sph_short_id(url_str: str) -> str:
    """Extract short ID only from accepted weixin /sph/{id} path or channels /pages/sph?id={id}."""
    parsed = urllib.parse.urlparse(url_str.strip())
    path = parsed.path.rstrip("/")
    if "/sph/" in path:
        return path.split("/sph/")[-1].split("/")[0]
    elif path.endswith("/sph"):
        qs = urllib.parse.parse_qs(parsed.query)
        if "id" in qs and qs["id"]:
            return qs["id"][0]
        return path.split("/")[-1]
    parts = [p for p in path.split("/") if p]
    return parts[-1] if parts else ""


def _parse_count_fmt(val: Any) -> int:
    """Parse integer from numeric or string formatting like '165', '1.2万'."""
    if val is None:
        return 0
    if isinstance(val, (int, float)):
        return int(val)
    s = str(val).strip().rstrip("+").strip()
    if not s:
        return 0
    try:
        if s.endswith("万") or s.endswith("w") or s.endswith("W"):
            return int(float(s[:-1]) * 10000)
        if s.endswith("k") or s.endswith("K"):
            return int(float(s[:-1]) * 1000)
        return int(float(s))
    except (ValueError, TypeError):
        return 0


class _NoRedirectHandler(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        raise UnsafeUrlError("HTTP redirects are disabled for live probes.")


class WeChatAnonymousProbe:
    """Bounded WeChat Finder Preview probe supporting injected fake transport or bounded live requests."""

    OFFICIAL_PREVIEW_URL = "https://channels.weixin.qq.com/finder-preview/api/feed/get_feed_info"

    def __init__(self, transport: Optional[Any] = None, timeout_sec: int = 10, max_bytes: int = 256 * 1024):
        self.transport = transport
        self.timeout_sec = timeout_sec
        self.max_bytes = max_bytes

    def resolve_preview(self, url_str: str) -> WeChatPreviewResult:
        classify_url(url_str)

        if self.transport is not None:
            if hasattr(self.transport, "get"):
                resp = self.transport.get(url_str, timeout=self.timeout_sec)
            elif hasattr(self.transport, "post"):
                resp = self.transport.post(url_str, timeout=self.timeout_sec)
            else:
                raise ValueError("Injected transport must implement get() or post()")

            if hasattr(resp, "json"):
                data = resp.json()
            elif hasattr(resp, "json_data"):
                data = resp.json_data
            else:
                data = {}
            return self._normalize_response(data)
        else:
            return self._live_probe(url_str)

    def _normalize_response(self, data: Dict[str, Any]) -> WeChatPreviewResult:
        """Normalizes both fixture object shape and official finder-preview feedInfo/authorInfo shapes."""
        # 1. Inspect object-level container
        obj = data.get("data", {}).get("object") or data.get("object") or {}

        # 2. Inspect feedInfo / authorInfo structure
        feed_info = data.get("data", {}).get("feedInfo") or data.get("feedInfo") or obj
        author_info = data.get("data", {}).get("authorInfo") or data.get("authorInfo") or obj.get("contact") or {}

        title = (
            feed_info.get("description")
            or feed_info.get("title")
            or obj.get("description")
            or ""
        )
        author = (
            author_info.get("nickname")
            or obj.get("nickname")
            or ""
        )
        createtime = (
            feed_info.get("createtime")
            or feed_info.get("createTime")
            or obj.get("createtime")
        )

        views = _parse_count_fmt(
            feed_info.get("readCountFmt")
            or feed_info.get("read_count")
            or feed_info.get("readCount")
            or obj.get("read_count")
        )
        likes = _parse_count_fmt(
            feed_info.get("likeCountFmt")
            or feed_info.get("like_count")
            or feed_info.get("likeCount")
            or obj.get("like_count")
        )
        comments = _parse_count_fmt(
            feed_info.get("commentCountFmt")
            or feed_info.get("comment_count")
            or feed_info.get("commentCount")
            or obj.get("comment_count")
        )
        forwards = _parse_count_fmt(
            feed_info.get("forwardCountFmt")
            or feed_info.get("forward_count")
            or feed_info.get("forwardCount")
            or obj.get("forward_count")
        )
        fav_count = _parse_count_fmt(
            feed_info.get("favCountFmt")
            or feed_info.get("fav_count")
            or feed_info.get("favCount")
            or obj.get("fav_count")
        )

        media_list = feed_info.get("media") or obj.get("media") or []
        has_media_elements = len(media_list) > 0
        first_media_url = media_list[0].get("url") if has_media_elements and isinstance(media_list[0], dict) else None

        # Anonymous capability reports never retain media URLs or raw response bodies.
        has_anonymous_playable = False
        has_meta = bool(title or author or views > 0 or likes > 0 or fav_count > 0 or forwards > 0 or createtime is not None)

        return WeChatPreviewResult(
            has_metadata=has_meta,
            status="ok" if has_meta else "no_metadata",
            title=title,
            author=author,
            views=views,
            likes=likes,
            comments=comments,
            forwards=forwards,
            fav_count=fav_count,
            createtime=createtime,
            has_anonymous_playable_media=has_anonymous_playable,
            media_url=None,
            raw_normalized={
                "has_metadata": has_meta,
                "has_media_elements": has_media_elements,
            }
        )

    def _live_probe(self, share_url: str) -> WeChatPreviewResult:
        """Issue bounded POST request to official finder-preview endpoint.

        Adheres strictly to official parameters and headers:
          - POST https://channels.weixin.qq.com/finder-preview/api/feed/get_feed_info?_rid=...&_pageUrl=...
          - Body: {"baseReq": {"generalToken": ""}, "shortUri": "<shortId>"}
          - Rejects oversized responses exceeding max_bytes.
        """
        short_id = _extract_sph_short_id(share_url)
        page_url_val = f"https://channels.weixin.qq.com/finder-preview/pages/sph?id={short_id}"
        encoded_page_url = urllib.parse.quote(page_url_val, safe="")
        rid = uuid.uuid4().hex

        request_url = f"{self.OFFICIAL_PREVIEW_URL}?_rid={rid}&_pageUrl={encoded_page_url}"

        payload = json.dumps({
            "baseReq": {"generalToken": ""},
            "shortUri": short_id
        }).encode("utf-8")

        headers = {
            "Accept": "application/json, text/plain, */*",
            "Content-Type": "application/json",
            "Origin": "https://channels.weixin.qq.com",
            "Referer": page_url_val,
            "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        }

        req = urllib.request.Request(
            request_url,
            data=payload,
            headers=headers,
            method="POST"
        )

        try:
            opener = urllib.request.build_opener(_NoRedirectHandler())
            with opener.open(req, timeout=self.timeout_sec) as resp:
                # Bounded read: read max_bytes + 1 to detect oversized payload and reject rather than accept truncation
                raw_bytes = resp.read(self.max_bytes + 1)
                if len(raw_bytes) > self.max_bytes:
                    return WeChatPreviewResult(
                        has_metadata=False,
                        status="oversized_response",
                        has_anonymous_playable_media=False,
                        raw_normalized={"error": f"Response exceeded maximum ceiling of {self.max_bytes} bytes"}
                    )
                data = json.loads(raw_bytes.decode("utf-8", errors="replace"))
                return self._normalize_response(data)
        except Exception as exc:
            return WeChatPreviewResult(
                has_metadata=False,
                status="error",
                has_anonymous_playable_media=False,
                raw_normalized={"error": str(exc)}
            )


# =====================================================================
# CLI Entry Point
# =====================================================================

def build_cli() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="CN Media Headless Resolver Evaluation CLI"
    )
    parser.add_argument(
        "--manifest",
        type=str,
        help="Path to candidates manifest JSON for static audit report"
    )
    parser.add_argument(
        "--wechat-url",
        type=str,
        help="Public WeChat share URL to live probe anonymously"
    )
    parser.add_argument(
        "--douyin-url",
        type=str,
        help="Public Douyin share URL to validate and classify (adapter opt-in)"
    )
    parser.add_argument(
        "--xiaohongshu-url",
        type=str,
        help="Public Xiaohongshu share URL to validate and classify (adapter opt-in)"
    )
    parser.add_argument(
        "--mtotech",
        action="store_true",
        help="Opt-in flag for mtotech comparison (currently disabled/not implemented)"
    )
    return parser


def run_cli(args: Optional[List[str]] = None) -> int:
    parser = build_cli()
    parsed = parser.parse_args(args)

    output: Dict[str, Any] = {
        "timestamp": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
        "evaluator": "cn-media-resolver-eval",
    }

    # 1. Manifest static report
    if parsed.manifest:
        manifest_path = Path(parsed.manifest)
        if not manifest_path.exists():
            print(f"Error: Manifest file '{parsed.manifest}' not found.", file=sys.stderr)
            return 1
        with open(manifest_path, "r", encoding="utf-8") as f:
            manifest_data = json.load(f)

        candidates_report = []
        for cand in manifest_data.get("candidates", []):
            classification = classify_candidate_evidence(cand)
            candidates_report.append({
                "id": classification.candidate_id,
                "commit": classification.commit,
                "license_status": classification.license_status,
                "anonymous_metadata": classification.anonymous_metadata,
                "anonymous_media": classification.anonymous_media,
                "is_headless": classification.is_headless,
                "backend_safe_foundation": classification.backend_safe_foundation,
                "notes": classification.notes
            })
        output["static_audit"] = candidates_report

    # 2. WeChat URL live probe
    if parsed.wechat_url:
        classified = classify_url(parsed.wechat_url)
        probe = WeChatAnonymousProbe(timeout_sec=10)
        result = probe.resolve_preview(parsed.wechat_url)

        # Emit ONLY presence booleans, statistics, and timestamp
        # Omit description, author, cover URL, or signed media URLs
        output["wechat_probe"] = {
            "url_classified_platform": classified.platform,
            "status": result.status,
            "has_metadata": result.has_metadata,
            "has_anonymous_playable_media": result.has_anonymous_playable_media,
            "views": result.views,
            "likes": result.likes,
            "comments": result.comments,
            "forwards": result.forwards,
            "fav_count": result.fav_count,
            "createtime": result.createtime,
        }

    # 3. Douyin URL classification
    if parsed.douyin_url:
        classified = classify_url(parsed.douyin_url)
        output["douyin_probe"] = {
            "platform": classified.platform,
            "is_supported": classified.is_supported,
            "live_adapter_status": "not_run_opt_in_only"
        }

    # 4. Xiaohongshu URL classification
    if parsed.xiaohongshu_url:
        classified = classify_url(parsed.xiaohongshu_url)
        output["xiaohongshu_probe"] = {
            "platform": classified.platform,
            "is_supported": classified.is_supported,
            "live_adapter_status": "not_run_opt_in_only"
        }

    # 5. mtotech opt-in
    if parsed.mtotech:
        output["mtotech_comparison"] = {
            "status": "disabled_not_implemented",
            "message": "Closed-source mtotech probe is disabled and not implemented."
        }

    print(json.dumps(output, indent=2, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    sys.exit(run_cli())
