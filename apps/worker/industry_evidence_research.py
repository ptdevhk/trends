# coding=utf-8
"""Governed company-industry evidence research and freshness maintenance.

Compatibility re-export shim for the focused evidence research modules:
- evidence_nlp: HTML/JSON-LD parsing, NLP regexes, legal name normalization
- evidence_classifier: Industry classification logic and constants
- evidence_transport: HTTP transport, SSRF validation, guarded fetcher, circuit breaker
- evidence_researcher: Researcher, maintenance job, discovery wiring, runner
"""

from __future__ import annotations

import socket
import threading
import urllib.request

from apps.worker.research_convex import ResearchConvexClient

# Re-export entire surface of the four modules
from apps.worker.evidence_classifier import *  # noqa: F401,F403
from apps.worker.evidence_nlp import *  # noqa: F401,F403
from apps.worker.evidence_researcher import *  # noqa: F401,F403
from apps.worker.evidence_transport import *  # noqa: F401,F403
# Explicit imports for private / test-facing seams patched or directly accessed across the repo
from apps.worker.evidence_classifier import (
    SOURCE_ORDER,
    TRUST_ORDER,
    classify_industry_excerpt,
)
from apps.worker.evidence_nlp import (
    IDENTITY_LEGAL_SUFFIX_RE,
    IDENTITY_NAME_RE,
    MAX_EXCERPT_LENGTH,
    _CJK_COMPANY_NAME_RE,
    _COPYRIGHT_LEGAL_NAME_RE,
    _LEGAL_SUFFIX_TOKENS,
    _PAGE_CHROME_TOKENS,
    _distinctive_employer_tokens,
    _excerpt_with_legal_name,
    _excerpt_with_organization_names,
    _find_first_legal_name,
    _find_legal_names,
    _identity_org_from_excerpt,
    _json_ld_org_names,
    _name_overlap_passes,
    _normalize_identity_name,
    _suffix_case_ok,
    _text_from_html,
    _title_from_html,
    _trim_page_chrome,
    _walk_json_ld_nodes,
)
from apps.worker.evidence_researcher import (
    MAX_SOURCES_PER_PROPOSAL,
    IndustryEvidenceMaintenanceJob,
    IndustryEvidenceResearcher,
    _candidate_content_proves_employer,
    _candidate_sort_key,
    _source_content_proves_employer,
    build_discovery_job_from_env,
    employer_surface_for_search,
    industry_evidence_maintenance_enabled,
    run_industry_evidence_maintenance,
)
from apps.worker.evidence_transport import (
    DEFAULT_FETCH_RETRIES,
    DEFAULT_FETCH_TIMEOUT_SECONDS,
    DomainConcurrencyLimiter,
    GuardedEvidenceFetcher,
    HostCircuitBreaker,
    _SplitConnectTimeoutHTTPConnection,
    _SplitConnectTimeoutHTTPHandler,
    _SplitConnectTimeoutHTTPSConnection,
    _SplitConnectTimeoutHTTPSHandler,
    _connection_factory,
    _env_clamped_int,
    _env_connect_timeout_seconds,
    _module_urlopen,
    _normalize_evidence_url,
    _resolved_host_is_public,
    _transport_opener,
    _unsafe_hostname,
    safe_public_evidence_url,
    urlopen,
)

__all__ = [
    "DEFAULT_FETCH_RETRIES",
    "DEFAULT_FETCH_TIMEOUT_SECONDS",
    "DomainConcurrencyLimiter",
    "GuardedEvidenceFetcher",
    "HostCircuitBreaker",
    "IDENTITY_LEGAL_SUFFIX_RE",
    "IDENTITY_NAME_RE",
    "IndustryEvidenceMaintenanceJob",
    "IndustryEvidenceResearcher",
    "MAX_EXCERPT_LENGTH",
    "MAX_SOURCES_PER_PROPOSAL",
    "ResearchConvexClient",
    "SOURCE_ORDER",
    "TRUST_ORDER",
    "build_discovery_job_from_env",
    "classify_industry_excerpt",
    "employer_surface_for_search",
    "industry_evidence_maintenance_enabled",
    "run_industry_evidence_maintenance",
    "safe_public_evidence_url",
    "urlopen",
]
