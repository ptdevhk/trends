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
from datetime import datetime, timedelta
from typing import Optional, Dict, Any, Callable

from apscheduler.schedulers.blocking import BlockingScheduler
from apscheduler.triggers.cron import CronTrigger
from apscheduler.triggers.interval import IntervalTrigger
from apscheduler.events import (
    EVENT_JOB_EXECUTED,
    EVENT_JOB_ERROR,
    EVENT_JOB_MISSED,
    EVENT_SCHEDULER_STARTED,
    EVENT_SCHEDULER_SHUTDOWN,
    JobExecutionEvent,
    SchedulerEvent,
)

from apps.worker.tasks import (
    run_crawl_analyze,
    run_research_ingest,
    health_check,
    list_summary_profiles_runtime,
    run_skills_version_check,
    run_scoring_auto_tune,
    normalize_summary_period,
    run_workspace_summary,
)
from apps.worker.research_ingest import research_ingest_enabled
from apps.worker.timezone import bootstrap_worker_timezone, resolve_worker_timezone
from apps.worker.profile_loader import ProfileLoader
from apps.worker.resume_tasks import run_resume_crawl_task
from apps.worker.status_store import resolve_worker_status_path
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
        self.scheduler.add_listener(self._on_scheduler_started, EVENT_SCHEDULER_STARTED)
        self.scheduler.add_listener(self._on_scheduler_shutdown, EVENT_SCHEDULER_SHUTDOWN)

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
        
        try:
            stats = self.get_stats()
            # Serialize dates
            if stats.get("last_run"):
                stats["last_run"] = stats["last_run"].isoformat()
            if stats.get("last_success"):
                stats["last_success"] = stats["last_success"].isoformat()
            if stats.get("last_failure"):
                stats["last_failure"] = stats["last_failure"].isoformat()

            output_path = resolve_worker_status_path()
            output_path.parent.mkdir(parents=True, exist_ok=True)
            with open(output_path, "w", encoding="utf-8") as f:
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

    def _on_scheduler_started(self, event: SchedulerEvent) -> None:
        """Persist scheduler state as soon as the scheduler loop is running."""
        logger.info("Scheduler started (event code: %s)", event.code)
        self._save_stats()

    def _on_scheduler_shutdown(self, event: SchedulerEvent) -> None:
        """Persist scheduler state on shutdown."""
        logger.info("Scheduler stopped (event code: %s)", event.code)
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

    def add_research_ingest_job(self) -> None:
        """Add Research Eng native ingest when RESEARCH_INGEST_ENABLED is set."""
        if not research_ingest_enabled():
            logger.info("Research ingest job disabled; set RESEARCH_INGEST_ENABLED=1 to enable")
            return

        job_kwargs = {"config_overrides": self.config_overrides}
        if self.cron_expression:
            trigger = CronTrigger.from_crontab(self.cron_expression, timezone=self.timezone)
        else:
            trigger = IntervalTrigger(minutes=self.interval_minutes, timezone=self.timezone)

        self.scheduler.add_job(
            run_research_ingest,
            trigger=trigger,
            id="research_ingest",
            name="Research Ingest",
            kwargs=job_kwargs,
            replace_existing=True,
        )
        logger.info(
            "Scheduled research ingest job (interval=%s min or cron=%s)",
            self.interval_minutes,
            self.cron_expression,
        )

    def add_custom_job(
        self,
        func: Callable,
        job_id: str,
        interval_minutes: Optional[int] = None,
        cron_expression: Optional[str] = None,
        job_name: Optional[str] = None,
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

        add_job_kwargs = {
            "id": job_id,
            "kwargs": kwargs,
            "replace_existing": True,
        }
        if job_name is not None:
            add_job_kwargs["name"] = job_name

        self.scheduler.add_job(
            func,
            trigger=trigger,
            **add_job_kwargs,
        )
        logger.info(f"Added custom job: {job_id}")

    def load_profile_jobs(self) -> None:
        """Load and schedule jobs from search profiles."""
        if os.environ.get("ENABLE_HEADLESS_COLLECTOR") != "true":
            logger.info("Headless collector disabled; skipping profile job registration")
            return

        try:
            loader = ProfileLoader()
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

    def add_skills_version_check_job(self) -> None:
        """Schedule periodic skills version checks for automatic re-ingest."""
        reingest_limit_env = os.environ.get("SKILLS_REINGEST_LIMIT", "").strip()
        try:
            reingest_limit = int(reingest_limit_env) if reingest_limit_env else 200
        except ValueError:
            logger.warning("Invalid SKILLS_REINGEST_LIMIT=%s, using 200", reingest_limit_env)
            reingest_limit = 200

        self.add_custom_job(
            func=run_skills_version_check,
            job_id="skills_version_check",
            interval_minutes=360,
            reingest_limit=reingest_limit,
        )
        logger.info("Scheduled skills version check every 6 hours")

    def add_scoring_auto_tune_job(self) -> None:
        """Schedule nightly scoring auto-tune analysis and optional weight updates."""
        cron_expression = os.environ.get("SCORING_AUTO_TUNE_CRON", "").strip() or "0 3 * * *"

        dry_run_env = os.environ.get("SCORING_AUTO_TUNE_DRY_RUN", "").strip().lower()
        dry_run = dry_run_env in {"1", "true", "yes", "on"}

        period_days_env = os.environ.get("SCORING_AUTO_TUNE_PERIOD_DAYS", "").strip()
        top_k_env = os.environ.get("SCORING_AUTO_TUNE_K", "").strip()
        min_labeled_env = os.environ.get("SCORING_AUTO_TUNE_MIN_LABELED", "").strip()
        threshold_env = os.environ.get("SCORING_AUTO_TUNE_NDCG_THRESHOLD", "").strip()

        try:
            period_days = int(period_days_env) if period_days_env else 14
        except ValueError:
            logger.warning("Invalid SCORING_AUTO_TUNE_PERIOD_DAYS=%s, using 14", period_days_env)
            period_days = 14

        try:
            top_k = int(top_k_env) if top_k_env else 10
        except ValueError:
            logger.warning("Invalid SCORING_AUTO_TUNE_K=%s, using 10", top_k_env)
            top_k = 10

        try:
            min_labeled = int(min_labeled_env) if min_labeled_env else 20
        except ValueError:
            logger.warning("Invalid SCORING_AUTO_TUNE_MIN_LABELED=%s, using 20", min_labeled_env)
            min_labeled = 20

        try:
            ndcg_threshold = float(threshold_env) if threshold_env else 0.02
        except ValueError:
            logger.warning("Invalid SCORING_AUTO_TUNE_NDCG_THRESHOLD=%s, using 0.02", threshold_env)
            ndcg_threshold = 0.02

        self.add_custom_job(
            func=run_scoring_auto_tune,
            job_id="scoring_auto_tune",
            cron_expression=cron_expression,
            dry_run=dry_run,
            period_days=max(1, period_days),
            top_k=max(1, top_k),
            min_labeled_actions=max(1, min_labeled),
            ndcg_improvement_threshold=ndcg_threshold,
        )
        logger.info("Scheduled scoring auto-tune job with cron: %s (dry_run=%s)", cron_expression, dry_run)

    def add_workspace_summary_job(self) -> None:
        """Schedule an optional workspace summary trigger."""
        cron_expression = os.environ.get("WORKER_SUMMARY_CRON", "").strip()
        if not cron_expression:
            logger.info("Workspace summary job disabled; set WORKER_SUMMARY_CRON to enable it")
            return

        workspace_slug = os.environ.get("WORKER_SUMMARY_WORKSPACE", "").strip() or "dev"
        channel = os.environ.get("WORKER_SUMMARY_CHANNEL", "").strip() or "telegram"
        period = normalize_summary_period(os.environ.get("WORKER_SUMMARY_PERIOD"))
        dry_run_env = os.environ.get("WORKER_SUMMARY_DRY_RUN", "").strip().lower()
        dry_run = dry_run_env in {"1", "true", "yes", "on"}
        template_id = os.environ.get("WORKER_SUMMARY_TEMPLATE_ID", "").strip() or None
        end_at = os.environ.get("WORKER_SUMMARY_END_AT", "").strip() or None

        self.add_custom_job(
            func=run_workspace_summary,
            job_id="workspace_summary",
            job_name=f"Workspace Summary ({workspace_slug})",
            cron_expression=cron_expression,
            workspace_slug=workspace_slug,
            period=period,
            channel=channel,
            dry_run=dry_run,
            trigger_source="worker_schedule",
            template_id=template_id,
            end_at=end_at,
        )
        logger.info(
            "Scheduled workspace summary job with cron: %s (workspace=%s, period=%s, channel=%s, dry_run=%s)",
            cron_expression,
            workspace_slug,
            period,
            channel,
            dry_run,
        )

    def add_summary_profile_jobs(self, api_base_url: Optional[str] = None) -> None:
        """Load and schedule summary profile jobs from the API runtime view."""
        try:
            runtime_items = list_summary_profiles_runtime(api_base_url=api_base_url)
            for item in runtime_items:
                workspace_slug = item["workspaceSlug"]
                profile_id = item["profileId"]
                cron = item["cron"]
                job_id = f"workspace_summary:{workspace_slug}:{profile_id}"
                self.add_custom_job(
                    func=run_workspace_summary,
                    job_id=job_id,
                    job_name=f"Summary Profile: {workspace_slug} / {item['name']}",
                    cron_expression=cron,
                    workspace_slug=workspace_slug,
                    period=item["period"],
                    channel=item["channel"],
                    dry_run=bool(item["dryRun"]),
                    trigger_source="worker_schedule",
                    template_id=item.get("templateId"),
                    to=item.get("to"),
                    subject=item.get("subject"),
                )
                logger.info(
                    "Scheduled summary profile job: %s (%s, channel=%s, period=%s)",
                    job_id,
                    cron,
                    item["channel"],
                    item["period"],
                )
        except Exception as e:
            logger.error(f"Failed to load summary profile jobs: {e}")

    def start(self) -> None:
        """Start the scheduler."""
        logger.info("Starting Worker Scheduler")
        logger.info(f"Timezone: {self.timezone}")

        # Add the main job
        self.add_crawl_job()
        self.add_research_ingest_job()
        
        # Load dynamic profile jobs
        self.load_profile_jobs()
        self.add_skills_version_check_job()
        self.add_scoring_auto_tune_job()
        self.add_summary_profile_jobs()
        self.add_workspace_summary_job()

        # Persist the rebuilt job list before any startup crawl can block status visibility.
        self._save_stats()

        # Run immediately if requested
        if self.run_immediately:
            logger.info("Running initial crawl immediately...")
            try:
                started = get_configured_time(self.timezone)
                succeeded = run_crawl_analyze(config_overrides=self.config_overrides)
                self.stats["last_run"] = started
                if succeeded:
                    self.stats["jobs_executed"] += 1
                    self.stats["last_success"] = started
                else:
                    self.stats["jobs_failed"] += 1
                    self.stats["last_failure"] = started
            except Exception as e:
                failed_at = get_configured_time(self.timezone)
                self.stats["jobs_failed"] += 1
                self.stats["last_run"] = failed_at
                self.stats["last_failure"] = failed_at
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

    def _get_schedule_type(self) -> str:
        """Return the configured primary schedule type for the crawl job."""
        if self.cron_expression:
            return self.SCHEDULE_CRON
        return self.SCHEDULE_INTERVAL

    def _get_schedule_value(self) -> str:
        """Return a human-readable schedule value for the crawl job."""
        if self.cron_expression:
            return self.cron_expression
        return f"{self.interval_minutes} minutes"

    def _cron_trigger_to_crontab(self, trigger: CronTrigger) -> str:
        """Convert APScheduler CronTrigger fields to a 5-part crontab expression."""
        field_map = {field.name: str(field) for field in trigger.fields}
        minute = field_map.get("minute", "*")
        hour = field_map.get("hour", "*")
        day = field_map.get("day", "*")
        month = field_map.get("month", "*")
        day_of_week = field_map.get("day_of_week", "*")
        return f"{minute} {hour} {day} {month} {day_of_week}"

    def _format_interval(self, interval: timedelta) -> str:
        """Format interval duration as compact string (e.g. 30m, 6h)."""
        total_seconds = int(interval.total_seconds())
        if total_seconds <= 0:
            return "0s"

        if total_seconds % 86400 == 0:
            return f"{total_seconds // 86400}d"
        if total_seconds % 3600 == 0:
            return f"{total_seconds // 3600}h"
        if total_seconds % 60 == 0:
            return f"{total_seconds // 60}m"
        return f"{total_seconds}s"

    def _format_job_trigger(self, trigger: Any) -> Optional[str]:
        """Serialize APScheduler trigger into a compact, user-facing format."""
        if isinstance(trigger, IntervalTrigger):
            return f"interval:{self._format_interval(trigger.interval)}"
        if isinstance(trigger, CronTrigger):
            return f"cron:{self._cron_trigger_to_crontab(trigger)}"

        if trigger is None:
            return None

        return str(trigger)

    def get_stats(self) -> Dict[str, Any]:
        """Get scheduler statistics."""
        jobs_info = []
        for job in self.scheduler.get_jobs():
            next_run = getattr(job, 'next_run_time', None)
            jobs_info.append({
                "id": job.id,
                "name": job.name,
                "next_run": next_run.isoformat() if next_run else None,
                "trigger": self._format_job_trigger(getattr(job, "trigger", None)),
            })
            
        return {
            **self.stats,
            "schedule_type": self._get_schedule_type(),
            "schedule_value": self._get_schedule_value(),
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
    - WORKER_STATUS_PATH: Optional override for status.json output path

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
