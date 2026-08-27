# coding=utf-8
"""Typed configuration for industry evidence research and maintenance."""

from __future__ import annotations

import os
from dataclasses import dataclass
from typing import Dict, Optional


def _env_clamped_int(
    name: str,
    default: int,
    lo: int,
    hi: int,
    env: Optional[Dict[str, str]] = None,
) -> int:
    """Read an int env var clamped to [lo, hi]; fall back to default."""
    source = env if env is not None else os.environ
    try:
        value = int(source.get(name, str(default)))
    except (TypeError, ValueError):
        return default
    return max(lo, min(hi, value))


def _env_connect_timeout_seconds(
    env: Optional[Dict[str, str]] = None,
) -> float:
    """Connect-phase timeout (split from the read timeout), clamped < 10s."""
    source = env if env is not None else os.environ
    try:
        value = float(
            source.get("INDUSTRY_RESEARCH_CONNECT_TIMEOUT_SECONDS", "5")
        )
    except (TypeError, ValueError):
        return 5.0
    return max(1.0, min(9.0, value))


@dataclass(frozen=True)
class IndustryResearchConfig:
    connect_timeout_seconds: float = 5.0
    fetch_timeout_seconds: int = 10
    max_retries: int = 2
    circuit_breaker_threshold: int = 3
    domain_concurrency: int = 2
    research_concurrency: int = 4
    proposal_limit: int = 200
    freshness_limit: int = 50
    workspace_slug: str = "dev"
    maintenance_enabled: bool = False

    @classmethod
    def from_env(
        cls,
        env: Optional[Dict[str, str]] = None,
    ) -> IndustryResearchConfig:
        source = env if env is not None else os.environ
        try:
            proposal_limit = int(source.get("INDUSTRY_PROPOSAL_LIMIT", "200"))
        except (TypeError, ValueError):
            proposal_limit = 200

        maintenance_val = str(
            source.get("INDUSTRY_EVIDENCE_MAINTENANCE_ENABLED", "")
        ).strip().lower()
        maintenance_enabled = maintenance_val in {"1", "true", "yes", "on"}

        return cls(
            connect_timeout_seconds=_env_connect_timeout_seconds(env=source),
            fetch_timeout_seconds=_env_clamped_int(
                "INDUSTRY_RESEARCH_FETCH_TIMEOUT_SECONDS", 10, 1, 30, env=source
            ),
            max_retries=_env_clamped_int(
                "INDUSTRY_RESEARCH_MAX_RETRIES", 2, 1, 3, env=source
            ),
            circuit_breaker_threshold=_env_clamped_int(
                "INDUSTRY_RESEARCH_CIRCUIT_BREAKER_THRESHOLD", 3, 1, 10, env=source
            ),
            domain_concurrency=_env_clamped_int(
                "INDUSTRY_RESEARCH_DOMAIN_CONCURRENCY", 2, 1, 8, env=source
            ),
            research_concurrency=_env_clamped_int(
                "INDUSTRY_RESEARCH_CONCURRENCY", 4, 1, 16, env=source
            ),
            proposal_limit=proposal_limit,
            freshness_limit=50,
            workspace_slug=source.get("WORKSPACE_SLUG", "dev").strip() or "dev",
            maintenance_enabled=maintenance_enabled,
        )


__all__ = [
    "IndustryResearchConfig",
    "_env_clamped_int",
    "_env_connect_timeout_seconds",
]
