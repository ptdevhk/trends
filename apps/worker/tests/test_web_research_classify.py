# apps/worker/tests/test_web_research_classify.py
from apps.worker.web_research.classify import classify_source

def test_official_site_by_employer_domain_match():
    out = classify_source(
        "https://www.newlinemachine.com/about",
        "New Line Machine Tool Sdn Bhd",
    )
    assert out == {"sourceType": "official_site", "trustTier": "primary"}

def test_registry_domain():
    out = classify_source(
        "https://www.ssm.com.my/Pages/Company_Info.aspx",
        "New Line Machine Tool Sdn Bhd",
    )
    assert out["sourceType"] == "registry"
    assert out["trustTier"] == "authoritative"

def test_cn_registry_record_pages_are_authoritative():
    for url in [
        "https://shuidi.cn/company-abc.html",
        "https://shuidi.cn/company-fa1c2560bcf8ef08984e30f96c38966d.html?pa_pids=4489",
        "https://shuidi.cn/company-fa1c2560bcf8ef08984e30f96c38966d/hall.html",
        "https://xin.baidu.com/detail/compinfo?pid=abc",
        "https://www.qcc.com/firm/abc.html",
        "https://www.tianyancha.com/company/123",
    ]:
        out = classify_source(url, "深圳市新汉科技有限公司")
        assert out == {"sourceType": "registry", "trustTier": "authoritative"}, url

def test_cn_registry_homepages_and_search_landings_are_discovery():
    # qcc.com/?utm_source=360zrkp is a 360-search landing, not a company
    # record; fetching it fails and hard-blocks review with
    # stale_or_failed_source (observed 2026-08-14).
    for url in [
        "https://www.qcc.com/?utm_source=360zrkp&utm_query=%E6%B5%8E%E5%8D%97",
        "https://www.qcc.com/",
        "https://shuidi.cn/",
        "https://www.tianyancha.com/",
        "https://xin.baidu.com/",
        "https://shuidi.cn/search?key=%E6%B5%8E%E5%8D%97",
        "https://www.qcc.com/company-list-1.html",
    ]:
        out = classify_source(url, "深圳市新汉科技有限公司")
        assert out == {"sourceType": "search_result", "trustTier": "discovery"}, url

def test_aiqicha_baidu_is_discovery_only():
    # aiqicha rate-gates anonymous access (access-restriction pages), so it
    # must never masquerade as an authoritative registry source.
    out = classify_source(
        "https://aiqicha.baidu.com/company_detail_123",
        "深圳市新汉科技有限公司",
    )
    assert out == {"sourceType": "search_result", "trustTier": "discovery"}

def test_cn_directory_domains_are_directory_corroborating():
    for url in [
        "https://www.jobui.com/company/12893733/",
        "https://www.zhipin.com/gongsi/abc.html",
    ]:
        out = classify_source(url, "深圳市新汉科技有限公司")
        assert out == {"sourceType": "directory", "trustTier": "corroborating"}, url

def test_cn_reporting_domains_are_reporting_corroborating():
    for url in [
        "https://www.36kr.com/p/123",
        "https://baike.so.com/doc/6301241-6514764.html",
        "https://www.thepaper.cn/newsDetail_forward_123",
    ]:
        out = classify_source(url, "深圳市新汉科技有限公司")
        assert out == {"sourceType": "reporting", "trustTier": "corroborating"}, url

def test_unknown_domain_is_discovery_search_result():
    out = classify_source(
        "https://random-blog.example/post/123",
        "New Line Machine Tool Sdn Bhd",
    )
    assert out == {"sourceType": "search_result", "trustTier": "discovery"}

def test_directory_domain():
    out = classify_source(
        "https://www.yellowpages.com.my/company/new-line",
        "New Line Machine Tool Sdn Bhd",
    )
    assert out["sourceType"] == "directory"
    assert out["trustTier"] == "corroborating"

def test_google_news_redirect_url_is_reporting():
    out = classify_source(
        "https://news.google.com/rss/articles/CBMiBBBBBBB",
        "New Line Machine Tool Sdn Bhd",
    )
    assert out == {"sourceType": "reporting", "trustTier": "corroborating"}

def test_malaysian_reserve_is_reporting():
    out = classify_source(
        "https://www.themalaysianreserve.com/2026/01/foo",
        "New Line Machine Tool Sdn Bhd",
    )
    assert out == {"sourceType": "reporting", "trustTier": "corroborating"}

def test_market_data_portals_are_directory_corroborating():
    for host in (
        "https://www.tradingview.com/symbols/MYX-EMETALL/",
        "https://www.klsescreener.com/v2/stocks/view/7214",
        "https://www.edgeprop.my/content/12345",
    ):
        out = classify_source(host, "Eonmetall Group Bhd")
        assert out == {"sourceType": "directory", "trustTier": "corroborating"}, host

def test_my_sg_news_domains_are_reporting():
    for url in [
        "https://www.malaymail.com/news/malaysia/2026/01/01/foo/123",
        "https://www.freemalaysiatoday.com/category/nation/2026/01/01/foo",
        "https://www.bernama.com/en/news.php?id=123",
        "https://www.straitstimes.com/business/companies-markets/foo",
        "https://www.channelnewsasia.com/business/foo-123",
    ]:
        out = classify_source(url, "New Line Machine Tool Sdn Bhd")
        assert out == {"sourceType": "reporting", "trustTier": "corroborating"}, url

def test_excerpt_proves_employer_generic_tokens_rejected():
    from apps.worker.web_research.classify import excerpt_proves_employer
    # "line"/"new" appear in any English news homepage; must not count.
    assert not excerpt_proves_employer(
        "New Line Machine Tool Sdn Bhd", title="NST Online")
    # Distinctive token match works.
    assert excerpt_proves_employer(
        "New Line Machine Tool Sdn Bhd",
        excerpt="New Line Machine Tool expanded its Penang plant.")
    # Degenerate surface fails open.
    assert excerpt_proves_employer("Sdn Bhd", title="anything")

def test_excerpt_proves_employer_sector_only_surface_fails_closed():
    from apps.worker.web_research.classify import excerpt_proves_employer
    # Every token is a sector noun → no distinctive vocabulary → cannot
    # prove relevance from content. Prevents southern-pipe fail-open.
    assert not excerpt_proves_employer(
        "southern pipe industry malaysia sdn bhd",
        title="The Edge Malaysia - Make Better Decisions",
        excerpt="BURSA SGX Top Stocks, industry news and pipe reviews.")
    # Degenerate surface (no tokens at all) still fails open.
    assert excerpt_proves_employer("Sdn Bhd", title="anything")
