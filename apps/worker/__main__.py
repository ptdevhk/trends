# coding=utf-8
"""
TrendRadar Worker - Module entry point

Allows running the worker with: python -m apps.worker
"""

from apps.worker.main import main

if __name__ == "__main__":
    exit(main())
