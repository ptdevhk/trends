"""
TrendRadar FastAPI Worker - Application Entry Point

Usage:
    # Development
    uv run uvicorn apps.worker.main:app --reload --port 8000

    # Production
    uv run uvicorn apps.worker.main:app --host 0.0.0.0 --port 8000
"""

import sys
from pathlib import Path

# Add project root to Python path for imports
project_root = Path(__file__).parent.parent.parent
sys.path.insert(0, str(project_root))

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from apps.worker.api import router

app = FastAPI(
    title="TrendRadar API",
    description="REST API for TrendRadar - Chinese news hot topic aggregator",
    version="0.1.0",
    docs_url="/docs",
    redoc_url="/redoc",
)

# CORS middleware for frontend access
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Include API routes
app.include_router(router)


@app.get("/")
async def root():
    """Root endpoint with API info."""
    return {
        "name": "TrendRadar API",
        "version": "0.1.0",
        "docs": "/docs",
        "health": "/health",
    }


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="0.0.0.0", port=8000)
