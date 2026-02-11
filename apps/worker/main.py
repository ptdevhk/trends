# coding=utf-8
"""
TrendRadar Worker - Scheduler Entry Point

This module provides the CLI interface for running the worker scheduler.

Usage:
    # Start with default settings (every 30 minutes)
    python -m apps.worker

    # Start with custom interval
    python -m apps.worker --interval 15

    # Start with cron expression
    python -m apps.worker --cron "*/15 * * * *"

    # Run immediately on start
    python -m apps.worker --run-now

    # Health check
    python -m apps.worker --health

Environment Variables:
    WORKER_INTERVAL_MINUTES: Default interval in minutes
    WORKER_CRON: Cron expression (overrides interval)
    WORKER_RUN_IMMEDIATELY: Set to "true" to run on start
"""

import argparse
import logging
import sys
from typing import Optional

from apps.worker.timezone import bootstrap_worker_timezone

# Ensure process timezone is applied before configuring log timestamps.
WORKER_TIMEZONE = bootstrap_worker_timezone()

# Set up logging before imports
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)
logger = logging.getLogger(__name__)


def setup_logging(verbose: bool = False, quiet: bool = False) -> None:
    """Configure logging based on verbosity flags."""
    if quiet:
        level = logging.WARNING
    elif verbose:
        level = logging.DEBUG
    else:
        level = logging.INFO

    logging.getLogger().setLevel(level)

    # Also set level for apscheduler loggers
    logging.getLogger("apscheduler").setLevel(level)


def run_health_check() -> int:
    """Run health check and return exit code."""
    from apps.worker.tasks import health_check

    logger.info("Running health check...")
    if health_check():
        logger.info("Health check passed")
        return 0
    else:
        logger.error("Health check failed")
        return 1


def run_once() -> int:
    """Run a single crawl/analyze cycle and exit."""
    from apps.worker.tasks import run_crawl_analyze

    logger.info("Running single crawl/analyze cycle...")
    if run_crawl_analyze():
        logger.info("Crawl/analyze completed successfully")
        return 0
    else:
        logger.error("Crawl/analyze failed")
        return 1


def run_scheduler(
    interval_minutes: Optional[int] = None,
    cron_expression: Optional[str] = None,
    run_immediately: bool = False,
) -> int:
    """Start the scheduler and run until interrupted."""
    from apps.worker.scheduler import create_scheduler

    try:
        scheduler = create_scheduler(
            interval_minutes=interval_minutes,
            cron_expression=cron_expression,
            run_immediately=run_immediately,
        )
        scheduler.start()
        return 0
    except Exception as e:
        logger.error(f"Scheduler error: {e}")
        return 1


def parse_args() -> argparse.Namespace:
    """Parse command line arguments."""
    parser = argparse.ArgumentParser(
        description="Worker - Scheduled task runner",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  python -m apps.worker                    Start with default interval (30 min)
  python -m apps.worker --interval 15      Run every 15 minutes
  python -m apps.worker --cron "0 * * * *" Run at the start of every hour
  python -m apps.worker --run-now          Run immediately, then schedule
  python -m apps.worker --once             Run once and exit
  python -m apps.worker --health           Check health and exit

Environment Variables:
  WORKER_INTERVAL_MINUTES   Default interval in minutes (default: 30)
  WORKER_CRON               Cron expression (overrides interval)
  WORKER_RUN_IMMEDIATELY    Set to "true" to run on start
        """,
    )

    # Scheduling options
    schedule_group = parser.add_argument_group("Scheduling")
    schedule_group.add_argument(
        "--interval",
        type=int,
        metavar="MINUTES",
        help="Run every N minutes (default: 30)",
    )
    schedule_group.add_argument(
        "--cron",
        type=str,
        metavar="EXPR",
        help="Cron expression for custom schedule (overrides --interval)",
    )
    schedule_group.add_argument(
        "--run-now",
        action="store_true",
        help="Run immediately on start, then continue with schedule",
    )

    # One-shot modes
    oneshot_group = parser.add_argument_group("One-shot modes")
    oneshot_group.add_argument(
        "--once",
        action="store_true",
        help="Run a single crawl/analyze cycle and exit",
    )
    oneshot_group.add_argument(
        "--health",
        action="store_true",
        help="Run health check and exit",
    )

    # Logging options
    logging_group = parser.add_argument_group("Logging")
    logging_group.add_argument(
        "-v", "--verbose",
        action="store_true",
        help="Enable verbose (debug) logging",
    )
    logging_group.add_argument(
        "-q", "--quiet",
        action="store_true",
        help="Suppress informational messages",
    )

    return parser.parse_args()


def main() -> int:
    """Main entry point."""
    args = parse_args()

    # Configure logging
    setup_logging(verbose=args.verbose, quiet=args.quiet)

    # One-shot modes
    if args.health:
        return run_health_check()

    if args.once:
        return run_once()

    # Scheduler mode
    logger.info("Worker starting...")
    logger.info(f"Worker timezone: {WORKER_TIMEZONE}")
    return run_scheduler(
        interval_minutes=args.interval,
        cron_expression=args.cron,
        run_immediately=args.run_now,
    )


if __name__ == "__main__":
    sys.exit(main())
