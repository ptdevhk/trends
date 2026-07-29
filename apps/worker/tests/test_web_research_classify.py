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
