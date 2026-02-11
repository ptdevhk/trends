
import glob
import logging
import os
import yaml
from typing import List, Dict, Any, Optional

logger = logging.getLogger(__name__)

class ProfileLoader:
    def __init__(self, config_dir: str = "config/search-profiles"):
        self.config_dir = config_dir

    def load_profiles(self) -> List[Dict[str, Any]]:
        """
        Load all enabled search profiles from the config directory.
        Returns a list of profile dictionaries containing:
        - id: Profile ID
        - schedule: Cron expression
        - limit: Max resumes to collect
        - location: Target location
        - keywords: Search keywords
        """
        profiles = []
        pattern = os.path.join(self.config_dir, "*.yaml")
        
        for filepath in glob.glob(pattern):
            try:
                with open(filepath, "r") as f:
                    data = yaml.safe_load(f)
                    
                if not data:
                    continue
                    
                # Skip if no schedule or disabled
                schedule = data.get("schedule", {})
                if not schedule.get("enabled", False):
                    continue
                    
                cron = schedule.get("cron")
                if not cron:
                    logger.warning(f"Profile {filepath} enabled but missing cron expression")
                    continue
                    
                profile = {
                    "id": data.get("id"),
                    "name": data.get("name"),
                    "cron": cron,
                    "limit": schedule.get("limit", 50),
                    "location": data.get("location"),
                    "keywords": data.get("keywords", []),
                    "job_description": data.get("jobDescription"),
                    "filepath": filepath
                }
                profiles.append(profile)
                logger.info(f"Loaded profile: {profile['id']} (Cron: {cron})")
                
            except Exception as e:
                logger.error(f"Failed to load profile {filepath}: {e}")
                
        return profiles
