# coding=utf-8
"""
Direct Convex HTTP helpers for Research Eng ingest.

Uses CONVEX_URL + CONVEX_WRITE_SECRET only — never the BFF write path.
Modeled on apps.worker.resume_tasks._convex_mutation patterns.
"""

from __future__ import annotations

import json
import logging
import os
from pathlib import Path
from typing import Any, Dict, List, Optional
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

logger = logging.getLogger(__name__)


def _read_env_var_from_file(file_path: Path, key: str) -> Optional[str]:
    if not file_path.is_file():
        return None
    try:
        text = file_path.read_text(encoding="utf-8")
    except OSError:
        return None
    for line in text.splitlines():
        stripped = line.strip()
        if not stripped or stripped.startswith("#") or "=" not in stripped:
            continue
        name, _, value = stripped.partition("=")
        if name.strip() != key:
            continue
        value = value.strip().strip('"').strip("'")
        return value or None
    return None


def resolve_convex_url() -> Optional[str]:
    direct = os.environ.get("CONVEX_URL")
    if direct:
        return direct
    vite = os.environ.get("VITE_CONVEX_URL")
    if vite:
        return vite

    project_root = Path(__file__).resolve().parents[2]
    for file_path in (
        project_root / "packages" / "convex" / ".env.local",
        project_root / "apps" / "web" / ".env.local",
        project_root / ".env.local",
        project_root / ".env",
    ):
        file_direct = _read_env_var_from_file(file_path, "CONVEX_URL")
        if file_direct:
            return file_direct
        file_vite = _read_env_var_from_file(file_path, "VITE_CONVEX_URL")
        if file_vite:
            return file_vite
    return None


def resolve_write_secret() -> Optional[str]:
    secret = os.environ.get("CONVEX_WRITE_SECRET")
    if secret:
        return secret
    project_root = Path(__file__).resolve().parents[2]
    for file_path in (
        project_root / "packages" / "convex" / ".env.local",
        project_root / ".env.local",
        project_root / ".env",
    ):
        found = _read_env_var_from_file(file_path, "CONVEX_WRITE_SECRET")
        if found:
            return found
    return None


def convex_mutation(convex_url: str, mutation_path: str, args: Dict[str, Any]) -> Any:
    """POST to Convex /api/mutation. Does not go through BFF."""
    api_url = f"{convex_url.rstrip('/')}/api/mutation"
    payload = json.dumps({"path": mutation_path, "args": args}).encode("utf-8")
    request = Request(
        api_url,
        data=payload,
        method="POST",
        headers={
            "Content-Type": "application/json",
            "Accept": "application/json",
        },
    )
    try:
        with urlopen(request, timeout=20) as response:
            body = response.read().decode("utf-8")
    except HTTPError as error:
        detail = error.read().decode("utf-8", errors="replace") if error.fp else str(error)
        raise RuntimeError(f"Convex mutation failed ({error.code}): {detail}") from error
    except URLError as error:
        raise RuntimeError(f"Convex mutation network error: {error}") from error

    data = json.loads(body)
    if data.get("status") != "success":
        message = data.get("errorMessage") or "Unknown Convex mutation error"
        raise RuntimeError(message)
    return data.get("value")


def convex_query(convex_url: str, query_path: str, args: Dict[str, Any]) -> Any:
    """POST to Convex /api/query. Does not go through BFF."""
    api_url = f"{convex_url.rstrip('/')}/api/query"
    payload = json.dumps({"path": query_path, "args": args}).encode("utf-8")
    request = Request(
        api_url,
        data=payload,
        method="POST",
        headers={
            "Content-Type": "application/json",
            "Accept": "application/json",
        },
    )
    try:
        with urlopen(request, timeout=20) as response:
            body = response.read().decode("utf-8")
    except HTTPError as error:
        detail = error.read().decode("utf-8", errors="replace") if error.fp else str(error)
        raise RuntimeError(f"Convex query failed ({error.code}): {detail}") from error
    except URLError as error:
        raise RuntimeError(f"Convex query network error: {error}") from error

    data = json.loads(body)
    if data.get("status") != "success":
        message = data.get("errorMessage") or "Unknown Convex query error"
        raise RuntimeError(message)
    return data.get("value")


class ResearchConvexClient:
    """Thin client: all research ingest writes go here, never via BFF."""

    def __init__(
        self,
        convex_url: Optional[str] = None,
        write_secret: Optional[str] = None,
        *,
        mutator=None,
        querier=None,
    ):
        self.convex_url = convex_url or resolve_convex_url()
        self.write_secret = write_secret or resolve_write_secret()
        self._mutator = mutator or convex_mutation
        self._querier = querier or convex_query

    def require_ready(self) -> None:
        if not self.convex_url:
            raise RuntimeError("CONVEX_URL is not configured for research ingest")
        if not self.write_secret:
            raise RuntimeError("CONVEX_WRITE_SECRET is not configured for research ingest")

    def _args(self, payload: Dict[str, Any]) -> Dict[str, Any]:
        out = dict(payload)
        out["writeSecret"] = self.write_secret
        return out

    def start_ingest_run(
        self,
        run_id: str,
        started_at: int,
        enabled_platforms: List[str],
    ) -> Any:
        self.require_ready()
        return self._mutator(
            self.convex_url,
            "research_ops:startIngestRun",
            self._args(
                {
                    "runId": run_id,
                    "startedAt": started_at,
                    "enabledPlatforms": enabled_platforms,
                }
            ),
        )

    def finish_ingest_run(
        self,
        run_id: str,
        finished_at: int,
        status: str,
        *,
        news_inserted: int = 0,
        news_updated: int = 0,
        signals_inserted: int = 0,
        unresolved_mentions: int = 0,
        error: Optional[str] = None,
    ) -> Any:
        self.require_ready()
        payload: Dict[str, Any] = {
            "runId": run_id,
            "finishedAt": finished_at,
            "status": status,
            "newsInserted": news_inserted,
            "newsUpdated": news_updated,
            "signalsInserted": signals_inserted,
            "unresolvedMentions": unresolved_mentions,
        }
        if error is not None:
            payload["error"] = error
        return self._mutator(
            self.convex_url,
            "research_ops:finishIngestRun",
            self._args(payload),
        )

    def upsert_news_item(self, item: Dict[str, Any]) -> Any:
        self.require_ready()
        return self._mutator(
            self.convex_url,
            "research_news:upsertItem",
            self._args(item),
        )

    def upsert_signal(self, signal: Dict[str, Any]) -> Any:
        self.require_ready()
        return self._mutator(
            self.convex_url,
            "research_signals:upsert",
            self._args(signal),
        )

    def resolve_alias(self, alias: str) -> Optional[Dict[str, Any]]:
        self.require_ready()
        return self._querier(
            self.convex_url,
            "companies:resolveAlias",
            self._args({"alias": alias}),
        )

    def record_parity_run(self, payload: Dict[str, Any]) -> Any:
        self.require_ready()
        return self._mutator(
            self.convex_url,
            "research_ops:recordParityRun",
            self._args(payload),
        )

    def latest_parity(self) -> Any:
        self.require_ready()
        return self._querier(
            self.convex_url,
            "research_ops:latestParity",
            self._args({}),
        )

    def upsert_industry_proposal(self, payload: Dict[str, Any]) -> Any:
        self.require_ready()
        return self._mutator(
            self.convex_url,
            "companies:upsertIndustryProposal",
            self._args(payload),
        )

    def list_industry_proposals(self, status: Optional[str] = None) -> List[Dict[str, Any]]:
        self.require_ready()
        payload: Dict[str, Any] = {}
        if status:
            payload["status"] = status
        result = self._querier(
            self.convex_url,
            "companies:listIndustryProposals",
            self._args(payload),
        )
        return result if isinstance(result, list) else []

    def set_industry_proposal_research_state(self, payload: Dict[str, Any]) -> Any:
        self.require_ready()
        return self._mutator(
            self.convex_url,
            "companies:setIndustryProposalResearchState",
            self._args(payload),
        )

    def list_industry_evidence_sources(
        self,
        *,
        proposal_id: Optional[str] = None,
        company_key: Optional[str] = None,
    ) -> List[Dict[str, Any]]:
        self.require_ready()
        payload: Dict[str, Any] = {}
        if proposal_id:
            payload["proposalId"] = proposal_id
        if company_key:
            payload["companyKey"] = company_key
        result = self._querier(
            self.convex_url,
            "companies:listIndustryEvidenceSources",
            self._args(payload),
        )
        return result if isinstance(result, list) else []

    def upsert_industry_evidence_source(self, payload: Dict[str, Any]) -> Any:
        self.require_ready()
        return self._mutator(
            self.convex_url,
            "companies:upsertIndustryEvidenceSource",
            self._args(payload),
        )

    def list_due_industry_evidence_sources(
        self,
        now: int,
        limit: int = 50,
    ) -> List[Dict[str, Any]]:
        self.require_ready()
        result = self._querier(
            self.convex_url,
            "companies:listDueIndustryEvidenceSources",
            self._args({"now": now, "limit": limit}),
        )
        return result if isinstance(result, list) else []

    def mark_industry_evidence_profiles_checking(
        self,
        profiles: List[Dict[str, str]],
    ) -> Any:
        self.require_ready()
        unique: List[Dict[str, str]] = []
        seen = set()
        for profile in profiles:
            key = (
                str(profile.get("companyKey") or ""),
                str(profile.get("verdictRevisionId") or ""),
            )
            if not all(key) or key in seen:
                continue
            seen.add(key)
            unique.append(
                {
                    "companyKey": key[0],
                    "verdictRevisionId": key[1],
                }
            )
        return self._mutator(
            self.convex_url,
            "companies:markIndustryEvidenceProfilesChecking",
            self._args({"profiles": unique}),
        )

    def record_industry_evidence_freshness_check(
        self,
        payload: Dict[str, Any],
    ) -> Any:
        self.require_ready()
        return self._mutator(
            self.convex_url,
            "companies:recordIndustryEvidenceFreshnessCheck",
            self._args(payload),
        )
