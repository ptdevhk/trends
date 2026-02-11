
import logging
import sys
import os

# Add project root to path
sys.path.append(os.getcwd())

# Configure logging
logging.basicConfig(level=logging.INFO)

from apps.worker.scheduler import create_scheduler

def test_scheduler_loading():
    print("Creating scheduler...")
    scheduler = create_scheduler()
    
    print("Loading profiles...")
    scheduler.load_profile_jobs()
    
    jobs = scheduler.scheduler.get_jobs()
    print(f"Total jobs loaded: {len(jobs)}")
    
    for job in jobs:
        print(f"Job: {job.id}, Next Run: {job.next_run_time}")
        
    # Check if we have at least one profile job
    profile_jobs = [j for j in jobs if j.id.startswith("crawl_profile_")]
    if profile_jobs:
        print("SUCCESS: Profile jobs loaded correctly")
    else:
        print("WARNING: No profile jobs found (check if config/search-profiles has enabled yaml files)")

if __name__ == "__main__":
    test_scheduler_loading()
