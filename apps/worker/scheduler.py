# coding=utf-8
"""
TrendRadar Worker - APScheduler setup

This module configures and manages the APScheduler instance for
running scheduled tasks.
"""

import logging
import os
import signal
import sys
from datetime import datetime
from typing import Optional, Dict, Any, Callable

from apscheduler.schedulers.blocking import BlockingScheduler
from apscheduler.triggers.cron import CronTrigger
from apscheduler.triggers.interval import IntervalTrigger
from apscheduler.events import (
    EVENT_JOB_EXECUTED,
    EVENT_JOB_ERROR,
    EVENT_JOB_MISSED,
    JobExecutionEvent,
)

from apps.worker.tasks import run_crawl_analyze, health_check
from apps.worker.timezone import bootstrap_worker_timezone, resolve_worker_timezone
from apps.worker.profile_loader import ProfileLoader
from apps.worker.resume_tasks import run_resume_crawl_task
from trendradar.utils.time import get_configured_time

logger = logging.getLogger(__name__)


class WorkerScheduler:
    """
    Manages the APScheduler instance and job lifecycle.

    Features:
    - Configurable schedule via environment variables or config
    - Graceful shutdown handling
    - Job execution logging and error handling
    - Optional job store persistence (memory by default)
    """

    # Default schedule: every 30 minutes
    DEFAULT_INTERVAL_MINUTES = 30

    # Supported schedule types
    SCHEDULE_CRON = "cron"
    SCHEDULE_INTERVAL = "interval"

    def __init__(
        self,
        interval_minutes: Optional[int] = None,
        cron_expression: Optional[str] = None,
        run_immediately: bool = False,
        config_overrides: Optional[Dict[str, Any]] = None,
        timezone: Optional[str] = None,
    ):
        """
        Initialize the scheduler.

        Args:
            interval_minutes: Run every N minutes (default: 30)
            cron_expression: Cron expression for custom schedules (overrides interval)
            run_immediately: Whether to run a job immediately on start
            config_overrides: Config overrides to pass to tasks
        """
        self.timezone = timezone or bootstrap_worker_timezone()

        self.scheduler = BlockingScheduler(
            timezone=self.timezone,
            job_defaults={
                "coalesce": True,  # Combine missed runs into one
                "max_instances": 1,  # Only one instance of each job at a time
                "misfire_grace_time": 300,  # 5 minutes grace for missed jobs
            },
        )

        self.run_immediately = run_immediately
        self.config_overrides = config_overrides or {}

        # Determine schedule from environment or parameters
        self.interval_minutes = self._get_interval(interval_minutes)
        self.cron_expression = self._get_cron(cron_expression)

        # Track job statistics
        self.stats = {
            "jobs_executed": 0,
            "jobs_failed": 0,
            "jobs_missed": 0,
            "last_run": None,
            "last_success": None,
            "last_failure": None,
        }

        # Set up event listeners
        self._setup_listeners()

        # Set up signal handlers for graceful shutdown
        self._setup_signal_handlers()

    def _get_interval(self, interval_minutes: Optional[int]) -> int:
        """Get interval from parameter or environment."""
        if interval_minutes is not None:
            return interval_minutes

        env_interval = os.environ.get("WORKER_INTERVAL_MINUTES", "").strip()
        if env_interval:
            try:
                return int(env_interval)
            except ValueError:
                logger.warning(f"Invalid WORKER_INTERVAL_MINUTES: {env_interval}, using default")

        return self.DEFAULT_INTERVAL_MINUTES

    def _get_cron(self, cron_expression: Optional[str]) -> Optional[str]:
        """Get cron expression from parameter or environment."""
        if cron_expression is not None:
            return cron_expression

        return os.environ.get("WORKER_CRON", "").strip() or None

    def _setup_listeners(self) -> None:
        """Set up APScheduler event listeners."""
        self.scheduler.add_listener(self._on_job_executed, EVENT_JOB_EXECUTED)
        self.scheduler.add_listener(self._on_job_error, EVENT_JOB_ERROR)
        self.scheduler.add_listener(self._on_job_missed, EVENT_JOB_MISSED)

    def _setup_signal_handlers(self) -> None:
        """Set up signal handlers for graceful shutdown."""
        signal.signal(signal.SIGTERM, self._handle_shutdown)
        signal.signal(signal.SIGINT, self._handle_shutdown)

    def _handle_shutdown(self, signum: int, frame) -> None:
        """Handle shutdown signals gracefully."""
        sig_name = signal.Signals(signum).name
        logger.info(f"Received {sig_name}, shutting down scheduler...")
        self.stop()

    def _save_stats(self) -> None:
        """Save scheduler statistics to file for API access."""
        import json
        from pathlib import Path
        
        try:
            stats = self.get_stats()
            # Serialize dates
            if stats.get("last_run"):
                stats["last_run"] = stats["last_run"].isoformat()
            if stats.get("last_success"):
                stats["last_success"] = stats["last_success"].isoformat()
            if stats.get("last_failure"):
                stats["last_failure"] = stats["last_failure"].isoformat()
                
            output_path = Path("apps/worker/status.json")
            with open(output_path, "w") as f:
                json.dump(stats, f, indent=2)
        except Exception as e:
            logger.error(f"Failed to save stats: {e}")

    def _on_job_executed(self, event: JobExecutionEvent) -> None:
        """Handle successful job execution."""
        self.stats["jobs_executed"] += 1
        current_time = get_configured_time(self.timezone)
        self.stats["last_run"] = current_time
        self.stats["last_success"] = current_time
        logger.info(f"Job '{event.job_id}' executed successfully")
        self._save_stats()

    def _on_job_error(self, event: JobExecutionEvent) -> None:
        """Handle job execution error."""
        self.stats["jobs_failed"] += 1
        current_time = get_configured_time(self.timezone)
        self.stats["last_run"] = current_time
        self.stats["last_failure"] = current_time
        logger.error(f"Job '{event.job_id}' failed with exception: {event.exception}")
        self._save_stats()

    def _on_job_missed(self, event: JobExecutionEvent) -> None:
        """Handle missed job execution."""
        self.stats["jobs_missed"] += 1
        logger.warning(f"Job '{event.job_id}' was missed")
        self._save_stats()

    def add_crawl_job(self) -> None:
        """Add the main crawl/analyze job to the scheduler."""
        job_kwargs = {"config_overrides": self.config_overrides}

        if self.cron_expression:
            # Use cron trigger
            trigger = CronTrigger.from_crontab(self.cron_expression, timezone=self.timezone)
            logger.info(f"Adding crawl job with cron schedule: {self.cron_expression}")
        else:
            # Use interval trigger
            trigger = IntervalTrigger(minutes=self.interval_minutes, timezone=self.timezone)
            logger.info(f"Adding crawl job with interval: every {self.interval_minutes} minutes")

        self.scheduler.add_job(
            run_crawl_analyze,
            trigger=trigger,
            id="crawl_analyze",
            name="Crawl & Analyze",
            kwargs=job_kwargs,
            replace_existing=True,
        )

    def add_custom_job(
        self,
        func: Callable,
        job_id: str,
        interval_minutes: Optional[int] = None,
        cron_expression: Optional[str] = None,
        **kwargs,
    ) -> None:
        """
        Add a custom job to the scheduler.

        Args:
            func: The function to execute
            job_id: Unique job identifier
            interval_minutes: Run every N minutes
            cron_expression: Cron expression (overrides interval)
            **kwargs: Additional arguments passed to the job function
        """
        if cron_expression:
            trigger = CronTrigger.from_crontab(cron_expression, timezone=self.timezone)
        elif interval_minutes:
            trigger = IntervalTrigger(minutes=interval_minutes, timezone=self.timezone)
        else:
            raise ValueError("Either interval_minutes or cron_expression must be specified")

        self.scheduler.add_job(
            func,
            trigger=trigger,
            id=job_id,
            kwargs=kwargs,
            replace_existing=True,
        )
        logger.info(f"Added custom job: {job_id}")

    def load_profile_jobs(self) -> None:
        """Load and schedule jobs from search profiles."""
        try:
            # Determine config directory (relative to project root)
            # Assuming CWD is project root
            loader = ProfileLoader(config_dir="config/search-profiles")
            profiles = loader.load_profiles()
            
            for profile in profiles:
                job_id = f"crawl_profile_{profile['id']}"
                self.add_custom_job(
                    func=run_resume_crawl_task,
                    job_id=job_id,
                    cron_expression=profile['cron'],
                    profile=profile
                )
                logger.info(f"Scheduled profile job: {job_id} ({profile['cron']})")
                
        except Exception as e:
            logger.error(f"Failed to load profile jobs: {e}")

    def start(self) -> None:
        """Start the scheduler."""
        logger.info("Starting Worker Scheduler")
        logger.info(f"Timezone: {self.timezone}")

        # Add the main job
        self.add_crawl_job()
        
        # Load dynamic profile jobs
        self.load_profile_jobs()

        # Run immediately if requested
        if self.run_immediately:
            logger.info("Running initial crawl immediately...")
            try:
                run_crawl_analyze(config_overrides=self.config_overrides)
            except Exception as e:
                logger.error(f"Initial crawl failed: {e}")

        # Print next run time
        jobs = self.scheduler.get_jobs()
        if jobs:
            try:
                # Some Job versions/states might not have next_run_time yet
                next_run = getattr(jobs[0], 'next_run_time', None)
                if next_run:
                    logger.info(f"Next scheduled run: {next_run}")
                else:
                    logger.info("Next scheduled run: not yet determined")
            except Exception as e:
                logger.warning(f"Could not determine next run time: {e}")
            
        # Save initial stats
        self._save_stats()

        # Start the scheduler (blocks until stopped)
        try:
            self.scheduler.start()
        except (KeyboardInterrupt, SystemExit):
            logger.info("Scheduler interrupted")

    def stop(self) -> None:
        """Stop the scheduler gracefully."""
        if self.scheduler.running:
            self.scheduler.shutdown(wait=True)
            logger.info("Scheduler stopped")

    def get_stats(self) -> Dict[str, Any]:
        """Get scheduler statistics."""
        jobs_info = []
        for job in self.scheduler.get_jobs():
            next_run = getattr(job, 'next_run_time', None)
            jobs_info.append({
                "id": job.id,
                "name": job.name,
                "next_run": next_run.isoformat() if next_run else None,
            })
            
        return {
            **self.stats,
            "running": self.scheduler.running,
            "jobs": jobs_info,
        }


def create_scheduler(
    interval_minutes: Optional[int] = None,
    cron_expression: Optional[str] = None,
    run_immediately: bool = False,
    config_overrides: Optional[Dict[str, Any]] = None,
    timezone: Optional[str] = None,
) -> WorkerScheduler:
    """
    Factory function to create a configured scheduler instance.

    Environment variables:
    - WORKER_INTERVAL_MINUTES: Default interval in minutes (default: 30)
    - WORKER_CRON: Cron expression (overrides interval)
    - WORKER_RUN_IMMEDIATELY: Set to "true" to run on start

    Args:
        interval_minutes: Override interval (minutes)
        cron_expression: Override cron expression
        run_immediately: Override run immediately flag
        config_overrides: Config overrides for tasks

    Returns:
        Configured WorkerScheduler instance
    """
    # Check environment for run_immediately override
    if not run_immediately:
        env_immediate = os.environ.get("WORKER_RUN_IMMEDIATELY", "").lower()
        run_immediately = env_immediate in ("true", "1", "yes")

    return WorkerScheduler(
        interval_minutes=interval_minutes,
        cron_expression=cron_expression,
        run_immediately=run_immediately,
        config_overrides=config_overrides,
        timezone=timezone or resolve_worker_timezone(),
    )
