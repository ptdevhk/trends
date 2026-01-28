# coding=utf-8
"""
TrendRadar Worker

This package provides:
1. REST API wrapper (FastAPI) for the TrendRadar data service
2. Scheduled task runner (APScheduler) for crawl/analyze tasks

Usage:
    # REST API server
    uv run uvicorn apps.worker.api:app --port 8000

    # Scheduler (python -m apps.worker)
    uv run python -m apps.worker
"""

__version__ = "0.1.0"
