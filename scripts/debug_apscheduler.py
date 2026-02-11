
from apscheduler.schedulers.blocking import BlockingScheduler
from apscheduler.triggers.interval import IntervalTrigger
from datetime import datetime

def dummy_job():
    pass

scheduler = BlockingScheduler()
job = scheduler.add_job(dummy_job, trigger=IntervalTrigger(minutes=10), id="test")

print(f"Job IDs: {job.id}")
print(f"Job state: {job.__getstate__()}")

try:
    print(f"next_run_time: {job.next_run_time}")
except AttributeError:
    print("next_run_time is missing from Job instance (likely because scheduler is not running or job not yet scheduled by the scheduler loop)")

print("\nStarting scheduler in a non-blocking way is hard with BlockingScheduler.")
print("But let's see if adding it to a running scheduler helps.")
