"""
TrendRadar FastAPI Worker - Route Handlers

Endpoints:
    GET /health          - Health check
    GET /trends          - Get trending topics (params: platform, date)
    GET /trends/{id}     - Get trend details
    GET /search          - Search news (params: q)
"""

from datetime import datetime
from typing import List, Optional

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, Field

from mcp_server.services.data_service import DataService
from mcp_server.utils.errors import DataNotFoundError

router = APIRouter()

# Initialize data service
data_service = DataService()


# ============================================
# Response Models
# ============================================


class HealthResponse(BaseModel):
    """Health check response."""

    status: str = "ok"
    timestamp: str
    version: str = "0.1.0"


class PlatformInfo(BaseModel):
    """Platform information."""

    id: str
    name: str


class TrendItem(BaseModel):
    """Single trending item."""

    title: str
    platform: str
    platform_name: str
    rank: int
    timestamp: Optional[str] = None
    date: Optional[str] = None
    url: Optional[str] = None
    mobile_url: Optional[str] = None


class TrendsResponse(BaseModel):
    """Trends list response."""

    success: bool = True
    total: int
    data: List[TrendItem]


class TrendDetailResponse(BaseModel):
    """Single trend detail response."""

    success: bool = True
    data: TrendItem


class SearchResultItem(BaseModel):
    """Search result item."""

    title: str
    platform: str
    platform_name: str
    ranks: List[int]
    count: int
    avg_rank: float
    url: str
    mobile_url: str
    date: str


class SearchResponse(BaseModel):
    """Search response."""

    success: bool = True
    total: int
    total_found: int
    results: List[SearchResultItem]
    statistics: dict


class ErrorResponse(BaseModel):
    """Error response."""

    success: bool = False
    error: dict


# ============================================
# Endpoints
# ============================================


@router.get("/health", response_model=HealthResponse, tags=["System"])
async def health_check():
    """
    Health check endpoint.

    Returns:
        Health status with timestamp and version.
    """
    return HealthResponse(
        status="ok",
        timestamp=datetime.now().isoformat(),
        version="0.1.0",
    )


@router.get("/trends", response_model=TrendsResponse, tags=["Trends"])
async def get_trends(
    platform: Optional[List[str]] = Query(
        default=None,
        description="Filter by platform IDs (e.g., zhihu, weibo, baidu)",
    ),
    date: Optional[str] = Query(
        default=None,
        description="Date in YYYY-MM-DD format (default: today)",
    ),
    limit: int = Query(
        default=50,
        ge=1,
        le=500,
        description="Maximum number of results to return",
    ),
    include_url: bool = Query(
        default=False,
        description="Include URL links in response",
    ),
):
    """
    Get trending topics.

    Retrieves the latest trending news from various Chinese platforms.

    Args:
        platform: Filter by specific platforms (optional)
        date: Specific date to query (optional, default: today)
        limit: Maximum results to return
        include_url: Include URL links

    Returns:
        List of trending topics with metadata.
    """
    try:
        if date:
            # Query by specific date
            target_date = datetime.strptime(date, "%Y-%m-%d")
            news_list = data_service.get_news_by_date(
                target_date=target_date,
                platforms=platform,
                limit=limit,
                include_url=include_url,
            )
        else:
            # Get latest news
            news_list = data_service.get_latest_news(
                platforms=platform,
                limit=limit,
                include_url=include_url,
            )

        # Convert to response model
        items = [
            TrendItem(
                title=item["title"],
                platform=item["platform"],
                platform_name=item["platform_name"],
                rank=item["rank"],
                timestamp=item.get("timestamp"),
                date=item.get("date"),
                url=item.get("url") if include_url else None,
                mobile_url=item.get("mobileUrl") if include_url else None,
            )
            for item in news_list
        ]

        return TrendsResponse(
            success=True,
            total=len(items),
            data=items,
        )

    except DataNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except ValueError as e:
        raise HTTPException(status_code=400, detail=f"Invalid date format: {e}")
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/trends/{trend_id}", response_model=TrendDetailResponse, tags=["Trends"])
async def get_trend_detail(
    trend_id: str,
    date: Optional[str] = Query(
        default=None,
        description="Date in YYYY-MM-DD format (default: today)",
    ),
):
    """
    Get trend details by ID.

    Note: The trend_id is the URL-encoded title of the news item.

    Args:
        trend_id: URL-encoded title of the trend
        date: Date to search in (optional)

    Returns:
        Detailed information about a specific trend.
    """
    from urllib.parse import unquote

    title = unquote(trend_id)

    try:
        # Search for the specific title
        if date:
            target_date = datetime.strptime(date, "%Y-%m-%d")
            start_date = target_date
            end_date = target_date
        else:
            end_date = datetime.now()
            start_date = end_date

        result = data_service.search_news_by_keyword(
            keyword=title,
            date_range=(start_date, end_date),
            platforms=None,
            limit=1,
        )

        if not result.get("results"):
            raise HTTPException(status_code=404, detail=f"Trend not found: {title}")

        item = result["results"][0]

        return TrendDetailResponse(
            success=True,
            data=TrendItem(
                title=item["title"],
                platform=item["platform"],
                platform_name=item["platform_name"],
                rank=item["ranks"][0] if item["ranks"] else 0,
                date=item["date"],
                url=item.get("url"),
                mobile_url=item.get("mobileUrl"),
            ),
        )

    except DataNotFoundError:
        raise HTTPException(status_code=404, detail=f"Trend not found: {title}")
    except ValueError as e:
        raise HTTPException(status_code=400, detail=f"Invalid date format: {e}")
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/search", response_model=SearchResponse, tags=["Search"])
async def search_news(
    q: str = Query(
        ...,
        min_length=1,
        description="Search keyword",
    ),
    platform: Optional[List[str]] = Query(
        default=None,
        description="Filter by platform IDs",
    ),
    start_date: Optional[str] = Query(
        default=None,
        description="Start date in YYYY-MM-DD format",
    ),
    end_date: Optional[str] = Query(
        default=None,
        description="End date in YYYY-MM-DD format",
    ),
    limit: Optional[int] = Query(
        default=50,
        ge=1,
        le=500,
        description="Maximum number of results",
    ),
):
    """
    Search news by keyword.

    Searches across all platforms and dates for matching news titles.

    Args:
        q: Search keyword (required)
        platform: Filter by specific platforms
        start_date: Start of date range
        end_date: End of date range
        limit: Maximum results to return

    Returns:
        Search results with statistics.
    """
    try:
        # Parse date range
        date_range = None
        if start_date or end_date:
            start = datetime.strptime(start_date, "%Y-%m-%d") if start_date else datetime.now()
            end = datetime.strptime(end_date, "%Y-%m-%d") if end_date else datetime.now()
            date_range = (start, end)

        result = data_service.search_news_by_keyword(
            keyword=q,
            date_range=date_range,
            platforms=platform,
            limit=limit,
        )

        # Convert to response model
        items = [
            SearchResultItem(
                title=item["title"],
                platform=item["platform"],
                platform_name=item["platform_name"],
                ranks=item["ranks"],
                count=item["count"],
                avg_rank=item["avg_rank"],
                url=item.get("url", ""),
                mobile_url=item.get("mobileUrl", ""),
                date=item["date"],
            )
            for item in result.get("results", [])
        ]

        return SearchResponse(
            success=True,
            total=result.get("total", len(items)),
            total_found=result.get("total_found", len(items)),
            results=items,
            statistics=result.get("statistics", {}),
        )

    except DataNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except ValueError as e:
        raise HTTPException(status_code=400, detail=f"Invalid date format: {e}")
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
