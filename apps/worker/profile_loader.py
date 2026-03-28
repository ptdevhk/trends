import logging
from typing import Any, Dict, List, Optional

from apps.worker.tasks import _request_json, _worker_api_base_url

logger = logging.getLogger(__name__)


class ProfileLoader:
    def __init__(self, api_base_url: Optional[str] = None):
        self.api_base_url = _worker_api_base_url(api_base_url)

    def load_profiles(self) -> List[Dict[str, Any]]:
        """
        Load enabled scheduled search profiles from the API runtime view.

        Returns profile payloads that match the existing worker dispatch contract.
        """

        response = _request_json(f"{self.api_base_url}/api/search-profiles/runtime")
        if response.get("success") is not True:
            raise RuntimeError(f"Search profile runtime request failed: {response}")

        raw_items = response.get("items")
        if not isinstance(raw_items, list):
            raise RuntimeError("Search profile runtime payload is missing items[]")

        profiles: List[Dict[str, Any]] = []
        for raw_item in raw_items:
            if not isinstance(raw_item, dict):
                continue

            workspace_slug = str(raw_item.get("workspaceSlug") or "").strip()
            profile = raw_item.get("profile")
            cron = str(raw_item.get("cron") or "").strip()
            if not workspace_slug or not cron or not isinstance(profile, dict):
                continue

            profile_id = str(profile.get("id") or raw_item.get("profileId") or "").strip()
            name = str(profile.get("name") or raw_item.get("name") or profile_id).strip()
            location = str(profile.get("location") or "").strip()
            keywords = profile.get("keywords")
            schedule = profile.get("schedule")

            if not profile_id or not name or not location or not isinstance(keywords, list) or not isinstance(schedule, dict):
                continue

            normalized_profile = dict(profile)
            normalized_profile["id"] = profile_id
            normalized_profile["name"] = name
            normalized_profile["cron"] = cron
            normalized_profile["workspaceSlug"] = workspace_slug
            profiles.append(normalized_profile)
            logger.info("Loaded runtime profile: %s (%s)", profile_id, cron)

        return profiles
