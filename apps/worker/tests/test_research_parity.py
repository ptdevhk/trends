"""Unit tests for research parity pure decision (PR6)."""

from apps.worker.research_parity import evaluate_research_parity, next_green_streak


def test_parity_pass_all_rules():
    result = evaluate_research_parity(
        [{"platform": "weibo", "nativeCount": 10, "shadowCount": 10}],
        [{"companyKey": "pro-technic-machinery", "signalCount": 2}],
    )
    assert result["green"] is True
    assert result["aggregateRatio"] >= 0.8
    assert result["nativeNonEmpty"] is True


def test_parity_fail_aggregate_ratio():
    result = evaluate_research_parity(
        [{"platform": "weibo", "nativeCount": 5, "shadowCount": 10}],
        [{"companyKey": "pro-technic-machinery", "signalCount": 2}],
    )
    assert result["green"] is False


def test_parity_fail_zero_native_with_shadow():
    result = evaluate_research_parity(
        [
            {"platform": "weibo", "nativeCount": 20, "shadowCount": 10},
            {"platform": "toutiao", "nativeCount": 0, "shadowCount": 3},
        ],
        [{"companyKey": "pro-technic-machinery", "signalCount": 1}],
    )
    assert result["green"] is False
    assert any(p["zeroWithShadow"] for p in result["platformBreakdown"])


def test_parity_fail_golden_and_empty_native():
    result = evaluate_research_parity(
        [{"platform": "weibo", "nativeCount": 0, "shadowCount": 0}],
        [{"companyKey": "pro-technic-machinery", "signalCount": 0}],
        native_total=0,
    )
    assert result["green"] is False
    assert result["nativeNonEmpty"] is False


def test_green_streak():
    assert next_green_streak(2, True) == 3
    assert next_green_streak(3, False) == 0
