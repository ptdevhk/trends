
import logging
import subprocess
import sys
import os
from typing import Dict, Any

logger = logging.getLogger(__name__)

def run_resume_crawl_task(profile: Dict[str, Any]) -> bool:
    """
    Execute a resume crawl for a specific profile.
    This wraps the scripts/refresh_sample.py logic via subprocess.
    """
    profile_id = profile.get("id")
    location = profile.get("location")
    # Join keywords with spaces if list, otherwise use as string
    keywords = profile.get("keywords", [])
    if isinstance(keywords, list):
        keyword_str = " ".join(keywords)
    else:
        keyword_str = str(keywords)
        
    limit = profile.get("limit", 50)
    
    logger.info(f"[Task] Starting crawl for profile: {profile_id}")
    logger.info(f"       Location: {location}, Keywords: {keyword_str}, Limit: {limit}")
    
    # Path to the refresh_sample.py script
    # Assuming we are running from project root or apps/worker
    # Use absolute path resolution relative to this file
    base_dir = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
    script_path = os.path.join(base_dir, "scripts", "refresh_sample.py")
    
    cmd = [
        sys.executable,  # Use current python interpreter
        script_path,
        "--keyword", keyword_str,
        "--limit", str(limit),
        "--sample", f"profile-{profile_id}"  # Save to separate sample file? Or trigger immediate seeding?
    ]
    
    if location:
        cmd.extend(["--location", location])
        
    try:
        # Run the script and capture output
        result = subprocess.run(
            cmd,
            check=True,
            text=True,
            capture_output=True
        )
        logger.info(f"[Task] Crawl success for {profile_id}")
        logger.debug(result.stdout)
        
        # TODO: Trigger seeding or AI analysis here?
        # For now, let's just log success.
        return True
        
    except subprocess.CalledProcessError as e:
        logger.error(f"[Task] Crawl failed for {profile_id}: {e}")
        logger.error(e.stderr)
        return False
    except Exception as e:
        logger.error(f"[Task] Unexpected error running crawl for {profile_id}: {e}")
        return False
