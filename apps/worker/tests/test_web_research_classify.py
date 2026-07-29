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
