from scripts.browser_cdp import select_cdp_target


def test_select_cdp_target_prefers_exact_search_url_over_same_domain():
    search_url = (
        "https://hk.employer.seek.com/talentsearch?searchQuery=CNC+Sales"
        "&market=MY&pageNumber=1&roleTitles=Sales&salaryType=MONTHLY"
        "&minSalary=0&salaryUnspecified=true&keywords=CNC"
        "&matchAll=false&sortBy=RELEVANCE"
    )
    stripped_url = (
        "https://hk.employer.seek.com/talentsearch?searchQuery=CNC+Sales"
        "&market=MY&pageNumber=1&salaryType=MONTHLY"
        "&minSalary=0&salaryUnspecified=true&sortBy=RELEVANCE"
    )
    pages = [
        {"type": "page", "url": stripped_url, "id": "stripped"},
        {"type": "page", "url": search_url, "id": "exact"},
    ]

    assert select_cdp_target(pages, search_url)["id"] == "exact"


def test_select_cdp_target_falls_back_to_same_domain():
    search_url = "https://hk.employer.seek.com/candidates/recommended?jobId=92216704"
    pages = [
        {"type": "page", "url": "https://hk.employer.seek.com/jobs", "id": "jobs"},
    ]

    assert select_cdp_target(pages, search_url)["id"] == "jobs"
