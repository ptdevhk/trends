"""Tests for the CN media resolver evaluation safety and capability contract."""

import contextlib
import io
import json
import os
import unittest
from pathlib import Path

# The test imports the module under test to verify desired APIs.
# In RED phase, this import or its functions fail because production code is not written.
import resolver_eval


class TestUrlClassification(unittest.TestCase):
    """Test strict platform URL classification and safety rules."""

    def test_classify_valid_wechat_channels_urls(self):
        valid_urls = [
            "https://weixin.qq.com/sph/ARDsfj3LrG",
            "https://channels.weixin.qq.com/finder-preview/pages/sph?id=ARDsfj3LrG",
        ]
        for url in valid_urls:
            res = resolver_eval.classify_url(url)
            self.assertEqual(res.platform, "wechat")
            self.assertTrue(res.is_supported)

    def test_classify_valid_douyin_urls(self):
        valid_urls = [
            "https://v.douyin.com/iABC123/",
            "https://www.douyin.com/video/7123456789012345678",
        ]
        for url in valid_urls:
            res = resolver_eval.classify_url(url)
            self.assertEqual(res.platform, "douyin")
            self.assertTrue(res.is_supported)

    def test_classify_valid_xiaohongshu_urls(self):
        valid_urls = [
            "https://xhslink.com/a/ABC123xyz",
            "https://www.xiaohongshu.com/explore/64abcdef1234567890abcdef",
        ]
        for url in valid_urls:
            res = resolver_eval.classify_url(url)
            self.assertEqual(res.platform, "xiaohongshu")
            self.assertTrue(res.is_supported)

    def test_reject_non_https_and_unsupported_schemes(self):
        invalid_urls = [
            "http://weixin.qq.com/sph/ARDsfj3LrG",
            "ftp://weixin.qq.com/sph/ARDsfj3LrG",
            "file:///etc/passwd",
            "javascript:alert(1)",
        ]
        for url in invalid_urls:
            with self.assertRaises(resolver_eval.UnsafeUrlError):
                resolver_eval.classify_url(url)

    def test_reject_userinfo_and_credentials(self):
        for url in [
            "https://user:pass@weixin.qq.com/sph/ARDsfj3LrG",
            "https://:@weixin.qq.com/sph/ARDsfj3LrG",
            "https://@weixin.qq.com/sph/ARDsfj3LrG",
        ]:
            with self.assertRaises(resolver_eval.UnsafeUrlError):
                resolver_eval.classify_url(url)

    def test_reject_all_ip_literals_as_unsafe(self):
        for url in ["https://1.1.1.1/video/1", "https://[2606:4700:4700::1111]/video/1"]:
            with self.assertRaises(resolver_eval.UnsafeUrlError):
                resolver_eval.classify_url(url)

    def test_reject_private_ips_and_loopback(self):
        unsafe_ips = [
            "https://127.0.0.1/test",
            "https://10.0.0.1/feed",
            "https://192.168.1.1/video",
            "https://172.16.0.1/video",
            "https://[::1]/video",
            "https://localhost/sph/123",
        ]
        for url in unsafe_ips:
            with self.assertRaises(resolver_eval.UnsafeUrlError):
                resolver_eval.classify_url(url)

    def test_reject_lookalikes_and_unknown_domains(self):
        lookalikes = [
            "https://weixin.qq.com.attacker.com/sph/123",
            "https://douyin.attacker.com/video/1",
            "https://notweixin.qq.com/sph/123",
            "https://google.com/",
        ]
        for url in lookalikes:
            with self.assertRaises(resolver_eval.UnsupportedUrlError):
                resolver_eval.classify_url(url)

    def test_reject_non_default_ports(self):
        for url in [
            "https://weixin.qq.com:8443/sph/ARDsfj3LrG",
            "https://v.douyin.com:444/iABC123/",
            "https://xhslink.com:9443/a/ABC123xyz",
        ]:
            with self.assertRaises(resolver_eval.UnsafeUrlError):
                resolver_eval.classify_url(url)

    def test_reject_allowed_hosts_with_unsupported_paths(self):
        invalid = [
            "https://weixin.qq.com/not-sph/ARDsfj3LrG",
            "https://channels.weixin.qq.com/web/pages/feed?oid=12345",
            "https://finder.video.qq.com/251/20304/stodownload",
            "https://v.douyin.com/",
            "https://www.douyin.com/user/example",
            "https://xhslink.com/",
            "https://www.xiaohongshu.com/user/profile/example",
        ]
        for url in invalid:
            with self.assertRaises(resolver_eval.UnsupportedUrlError):
                resolver_eval.classify_url(url)


class TestSecretAndSignedUrlRedaction(unittest.TestCase):
    """Test redaction of secrets, tokens, cookies, and signed URLs."""

    def test_redact_sensitive_query_parameters(self):
        raw_url = "https://finder.video.qq.com/251/20304/stodownload?encfilekey=secretkey123&token=signedtokenabc&sign=xyz"
        redacted = resolver_eval.redact_sensitive_url(raw_url)
        self.assertNotIn("secretkey123", redacted)
        self.assertNotIn("signedtokenabc", redacted)
        self.assertIn("REDACTED", redacted)

    def test_redact_dictionary_payload(self):
        payload = {
            "title": "Public Title",
            "cookie": "uin=12345; skey=secret",
            "authorization": "Bearer supersecrettoken",
            "media_url": "https://finder.video.qq.com/download?encfilekey=secret",
            "stats": {"views": 100}
        }
        clean = resolver_eval.redact_payload(payload)
        self.assertEqual(clean["title"], "Public Title")
        self.assertEqual(clean["cookie"], "[REDACTED]")
        self.assertEqual(clean["authorization"], "[REDACTED]")
        self.assertNotIn("secret", clean["media_url"])
        self.assertEqual(clean["stats"]["views"], 100)


class TestCandidateStaticEvidenceClassification(unittest.TestCase):
    """Test candidate static audit classification based on manifest fixtures.

    Encodes separate anonymous_metadata, anonymous_media, is_headless,
    backend_safe_foundation, and license_status attributes.
    """

    def setUp(self):
        fixtures_dir = Path(__file__).parent / "fixtures"
        manifest_path = fixtures_dir / "candidates_manifest.json"
        with open(manifest_path, "r", encoding="utf-8") as f:
            self.manifest = json.load(f)

    def test_backend_safety_is_derived_not_trusted_from_manifest(self):
        candidate = {
            "id": "unsafe/example",
            "commit": "abc",
            "license": None,
            "license_status": "unlicensed",
            "anonymous_metadata": True,
            "anonymous_media": True,
            "is_headless": True,
            "requires_cookie": True,
            "has_subprocesses": True,
            "backend_safe_foundation": True,
        }
        classification = resolver_eval.classify_candidate_evidence(candidate)
        self.assertFalse(classification.backend_safe_foundation)

    def test_classify_ucmao_media_parser(self):
        # ucmao/media-parser is MIT, headless, anonymous metadata true, but anonymous media false (requires Yuanbao auth)
        candidate = next(c for c in self.manifest["candidates"] if c["id"] == "ucmao/media-parser")
        classification = resolver_eval.classify_candidate_evidence(candidate)
        self.assertTrue(classification.anonymous_metadata)
        self.assertFalse(classification.anonymous_media)
        self.assertTrue(classification.is_headless)
        self.assertFalse(classification.backend_safe_foundation)
        self.assertEqual(classification.license_status, "permissive")

    def test_classify_datawhale_video_devour(self):
        # datawhalechina/video-devour is MIT, headless, anonymous metadata true, but media requires Yuanbao auth
        candidate = next(c for c in self.manifest["candidates"] if c["id"] == "datawhalechina/video-devour")
        classification = resolver_eval.classify_candidate_evidence(candidate)
        self.assertTrue(classification.anonymous_metadata)
        self.assertFalse(classification.anonymous_media)
        self.assertTrue(classification.is_headless)
        self.assertFalse(classification.backend_safe_foundation)
        self.assertEqual(classification.license_status, "permissive")

    def test_classify_ltaoo_wx_channels_download(self):
        # ltaoo/wx_channels_download is Commons-Clause-over-MIT / restricted, desktop proxy, authenticated Yuanbao worker
        candidate = next(c for c in self.manifest["candidates"] if c["id"] == "ltaoo/wx_channels_download")
        classification = resolver_eval.classify_candidate_evidence(candidate)
        self.assertFalse(classification.anonymous_metadata)
        self.assertFalse(classification.anonymous_media)
        self.assertFalse(classification.is_headless)
        self.assertFalse(classification.backend_safe_foundation)
        self.assertEqual(classification.license_status, "restricted")

    def test_classify_putyy_res_downloader(self):
        # putyy/res-downloader is Apache-2.0, requires desktop proxy
        candidate = next(c for c in self.manifest["candidates"] if c["id"] == "putyy/res-downloader")
        classification = resolver_eval.classify_candidate_evidence(candidate)
        self.assertFalse(classification.is_headless)
        self.assertFalse(classification.backend_safe_foundation)
        self.assertEqual(classification.license_status, "permissive")

    def test_classify_qiye45_wechat_video_download(self):
        # qiye45/wechatVideoDownload has no license, requires desktop proxy
        candidate = next(c for c in self.manifest["candidates"] if c["id"] == "qiye45/wechatVideoDownload")
        classification = resolver_eval.classify_candidate_evidence(candidate)
        self.assertFalse(classification.is_headless)
        self.assertFalse(classification.backend_safe_foundation)
        self.assertEqual(classification.license_status, "unlicensed")

    def test_classify_nobiyou_wx_channel(self):
        # nobiyou/wx_channel is MIT, but requires active desktop client
        candidate = next(c for c in self.manifest["candidates"] if c["id"] == "nobiyou/wx_channel")
        classification = resolver_eval.classify_candidate_evidence(candidate)
        self.assertFalse(classification.is_headless)
        self.assertFalse(classification.backend_safe_foundation)
        self.assertEqual(classification.license_status, "permissive")

    def test_classify_videotranscriptapi(self):
        # zlxlabs/VideoTranscriptAPI is PolyForm-Noncommercial, headless, delegates media to external MediaResolverAPI
        candidate = next(c for c in self.manifest["candidates"] if c["id"] == "zlxlabs/VideoTranscriptAPI")
        classification = resolver_eval.classify_candidate_evidence(candidate)
        self.assertTrue(classification.is_headless)
        self.assertFalse(classification.anonymous_media)
        self.assertFalse(classification.backend_safe_foundation)
        self.assertEqual(classification.license_status, "restricted")

    def test_classify_angasky_x_download(self):
        # Angasky/x-download has no license, Douyin only, requires cookie, uses subprocess & vendored components
        candidate = next(c for c in self.manifest["candidates"] if c["id"] == "Angasky/x-download")
        classification = resolver_eval.classify_candidate_evidence(candidate)
        self.assertTrue(classification.is_headless)
        self.assertFalse(classification.backend_safe_foundation)
        self.assertEqual(classification.license_status, "unlicensed")
        self.assertFalse(classification.anonymous_media)


class TestCliPrivacy(unittest.TestCase):
    def test_opt_in_platform_output_does_not_echo_submitted_urls(self):
        douyin_id = "iSENSITIVE123"
        xhs_id = "SENSITIVEabc"
        output = io.StringIO()
        with contextlib.redirect_stdout(output):
            exit_code = resolver_eval.run_cli([
                "--douyin-url", f"https://v.douyin.com/{douyin_id}/",
                "--xiaohongshu-url", f"https://xhslink.com/a/{xhs_id}",
            ])
        rendered = output.getvalue()
        self.assertEqual(exit_code, 0)
        self.assertNotIn(douyin_id, rendered)
        self.assertNotIn(xhs_id, rendered)
        self.assertNotIn("https://", rendered)


class TestWeChatFinderPreviewNormalization(unittest.TestCase):
    """Test bounded WeChat anonymous probe response normalization using fake transport (no network)."""

    def setUp(self):
        fixtures_dir = Path(__file__).parent / "fixtures"
        fixture_path = fixtures_dir / "wechat_finder_preview_response.json"
        with open(fixture_path, "r", encoding="utf-8") as f:
            self.raw_response = json.load(f)

    def test_normalize_anonymous_finder_preview(self):
        class FakeTransport:
            def __init__(self, response_dict):
                self.response_dict = response_dict

            def get(self, url, headers=None, timeout=None):
                return resolver_eval.FakeResponse(status_code=200, json_data=self.response_dict)

        transport = FakeTransport(self.raw_response)
        probe = resolver_eval.WeChatAnonymousProbe(transport=transport)
        result = probe.resolve_preview("https://weixin.qq.com/sph/ARDsfj3LrG")

        # Must extract metadata successfully
        self.assertEqual(result.title, "CNC加工中心实操演示与技巧讲解")
        self.assertEqual(result.author, "CNC工匠")
        self.assertEqual(result.views, 1250)
        self.assertTrue(result.has_metadata)

        # In anonymous probe, media payload without valid auth token must be flagged unplayable/restricted
        self.assertFalse(result.has_anonymous_playable_media)
        # Anonymous results omit media URLs entirely, including redacted signed forms.
        self.assertIsNone(result.media_url)
        self.assertNotIn("media", result.raw_normalized)

    def test_count_formatter_supports_plus_suffixes(self):
        self.assertEqual(resolver_eval._parse_count_fmt("100+"), 100)
        self.assertEqual(resolver_eval._parse_count_fmt("10万+"), 100000)
        self.assertEqual(resolver_eval._parse_count_fmt("1.5w+"), 15000)

    def test_live_probe_request_construction_regression(self):
        """Test that live anonymous probe constructs requests to the official finder-preview endpoint.

        Must target:
          https://channels.weixin.qq.com/finder-preview/api/feed/get_feed_info
        Query parameters must include _pageUrl pointing to finder-preview pages/sph.
        Headers must include Origin and Referer for channels.weixin.qq.com finder-preview.
        Payload must contain shortUri extracted from /sph/{id} and baseReq.generalToken="".
        """
        from unittest.mock import patch
        import urllib.parse

        captured_requests = []

        class CapturingOpener:
            def open(self, req, *args, **kwargs):
                captured_requests.append(req)
                raise RuntimeError("Intercepted without network")

        probe = resolver_eval.WeChatAnonymousProbe(transport=None)
        test_sph_url = "https://weixin.qq.com/sph/ARDsfj3LrG"

        with patch("urllib.request.build_opener", return_value=CapturingOpener()):
            probe.resolve_preview(test_sph_url)

        self.assertEqual(len(captured_requests), 1, "Expected exactly one live HTTP request to be constructed")
        req = captured_requests[0]

        # 1. Target URL check
        parsed_url = urllib.parse.urlparse(req.full_url)
        expected_base = "https://channels.weixin.qq.com/finder-preview/api/feed/get_feed_info"
        self.assertTrue(
            req.full_url.startswith(expected_base),
            f"Expected endpoint to start with '{expected_base}', but got '{req.full_url}'"
        )

        # 2. _pageUrl query parameter check
        query_dict = urllib.parse.parse_qs(parsed_url.query)
        self.assertIn("_pageUrl", query_dict, "Request URL query must contain '_pageUrl'")
        page_url = query_dict["_pageUrl"][0]
        self.assertIn("channels.weixin.qq.com/finder-preview/pages/sph", page_url)
        self.assertIn("ARDsfj3LrG", page_url)

        # 3. Origin and Referer header checks
        headers = {k.lower(): v for k, v in req.headers.items()}
        self.assertIn("origin", headers, "Request headers must contain Origin")
        self.assertEqual(headers["origin"], "https://channels.weixin.qq.com")
        self.assertIn("referer", headers, "Request headers must contain Referer")
        self.assertTrue(headers["referer"].startswith("https://channels.weixin.qq.com/finder-preview/pages/sph"))

        # 4. JSON body check
        body = json.loads(req.data.decode("utf-8"))
        self.assertIn("shortUri", body, "Payload must contain 'shortUri'")
        self.assertEqual(body["shortUri"], "ARDsfj3LrG")
        self.assertIn("baseReq", body, "Payload must contain 'baseReq'")
        self.assertIsInstance(body["baseReq"], dict)
        self.assertEqual(body["baseReq"].get("generalToken"), "")

    def test_live_probe_uses_a_fresh_request_id(self):
        from unittest.mock import patch

        urls = []

        class CapturingOpener:
            def open(self, req, *args, **kwargs):
                urls.append(req.full_url)
                raise RuntimeError("intercepted")

        probe = resolver_eval.WeChatAnonymousProbe()
        with patch("urllib.request.build_opener", return_value=CapturingOpener()):
            probe.resolve_preview("https://weixin.qq.com/sph/ARDsfj3LrG")
            probe.resolve_preview("https://weixin.qq.com/sph/ARDsfj3LrG")
        self.assertEqual(len(urls), 2)
        self.assertNotEqual(urls[0], urls[1])


if __name__ == "__main__":
    unittest.main()
