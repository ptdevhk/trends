/**
 * FastAPI Worker Client
 *
 * Proxies requests to the Python FastAPI worker service.
 * Falls back to mock data when worker is unavailable.
 */

import { config } from "./config.js";

// ============================================
// Worker Response Types (snake_case from Python)
// ============================================

export interface WorkerResponse<T> {
  success: boolean;
  data?: T;
  error?: {
    code: string;
    message: string;
    suggestion?: string;
  };
}

export interface WorkerTrendItem {
  title: string;
  platform: string;
  platform_name: string;
  rank: number;
  timestamp?: string | null;
  date?: string | null;
  url?: string | null;
  mobile_url?: string | null;
}

export interface WorkerTrendsResponse {
  success: boolean;
  total: number;
  data: WorkerTrendItem[];
}

export interface WorkerTrendDetailResponse {
  success: boolean;
  data: WorkerTrendItem;
}

export interface WorkerSearchResultItem {
  title: string;
  platform: string;
  platform_name: string;
  ranks: number[];
  count: number;
  avg_rank: number;
  url: string;
  mobile_url: string;
  date: string;
}

export interface WorkerSearchResponse {
  success: boolean;
  total: number;
  total_found: number;
  results: WorkerSearchResultItem[];
  statistics: {
    keyword?: string;
    avg_rank?: number;
    platform_distribution?: Record<string, number>;
  };
}

export interface WorkerHealthResponse {
  status: string;
  timestamp: string;
  version: string;
}

class WorkerClient {
  private baseUrl: string;
  private timeout: number;

  constructor(baseUrl: string, timeout = 10000) {
    this.baseUrl = baseUrl;
    this.timeout = timeout;
  }

  async get<T>(path: string, params?: Record<string, string | number | boolean | undefined>): Promise<WorkerResponse<T>> {
    const url = new URL(path, this.baseUrl);

    if (params) {
      Object.entries(params).forEach(([key, value]) => {
        if (value !== undefined) {
          url.searchParams.set(key, String(value));
        }
      });
    }

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), this.timeout);

      const response = await fetch(url.toString(), {
        method: "GET",
        headers: {
          Accept: "application/json",
        },
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({})) as { message?: string };
        return {
          success: false,
          error: {
            code: `HTTP_${response.status}`,
            message: errorData.message || response.statusText,
          },
        };
      }

      const data = await response.json() as T;
      return { success: true, data };
    } catch (error) {
      if (error instanceof Error) {
        if (error.name === "AbortError") {
          return {
            success: false,
            error: { code: "TIMEOUT", message: "Request timed out" },
          };
        }
        return {
          success: false,
          error: { code: "NETWORK_ERROR", message: error.message },
        };
      }
      return {
        success: false,
        error: { code: "UNKNOWN_ERROR", message: "Unknown error occurred" },
      };
    }
  }

  async isHealthy(): Promise<boolean> {
    try {
      const result = await this.get<WorkerHealthResponse>("/health");
      return result.success && result.data?.status === "ok";
    } catch {
      return false;
    }
  }

  // ============================================
  // Typed Helper Methods
  // ============================================

  async getTrends(params: {
    platform?: string | string[];
    date?: string;
    limit?: number;
    include_url?: boolean;
  }): Promise<WorkerResponse<WorkerTrendsResponse>> {
    const queryParams: Record<string, string | number | boolean | undefined> = {
      limit: params.limit,
      include_url: params.include_url,
      date: params.date,
    };

    // Handle platform array - FastAPI expects multiple platform params
    if (params.platform) {
      const platforms = Array.isArray(params.platform) ? params.platform : [params.platform];
      // For multiple platforms, we need to build the URL manually
      const url = new URL("/trends", this.baseUrl);
      platforms.forEach(p => url.searchParams.append("platform", p));
      if (params.limit) url.searchParams.set("limit", String(params.limit));
      if (params.include_url) url.searchParams.set("include_url", String(params.include_url));
      if (params.date) url.searchParams.set("date", params.date);

      return this.getRaw<WorkerTrendsResponse>(url.toString());
    }

    return this.get<WorkerTrendsResponse>("/trends", queryParams);
  }

  async getTrendById(id: string, date?: string): Promise<WorkerResponse<WorkerTrendDetailResponse>> {
    const queryParams: Record<string, string | undefined> = { date };
    return this.get<WorkerTrendDetailResponse>(`/trends/${encodeURIComponent(id)}`, queryParams);
  }

  async searchNews(params: {
    q: string;
    platform?: string | string[];
    start_date?: string;
    end_date?: string;
    limit?: number;
  }): Promise<WorkerResponse<WorkerSearchResponse>> {
    const url = new URL("/search", this.baseUrl);
    url.searchParams.set("q", params.q);
    if (params.limit) url.searchParams.set("limit", String(params.limit));
    if (params.start_date) url.searchParams.set("start_date", params.start_date);
    if (params.end_date) url.searchParams.set("end_date", params.end_date);

    // Handle platform array
    if (params.platform) {
      const platforms = Array.isArray(params.platform) ? params.platform : [params.platform];
      platforms.forEach(p => url.searchParams.append("platform", p));
    }

    return this.getRaw<WorkerSearchResponse>(url.toString());
  }

  async getHealth(): Promise<WorkerResponse<WorkerHealthResponse>> {
    return this.get<WorkerHealthResponse>("/health");
  }

  // Helper for raw URL requests (when we need to handle array params)
  private async getRaw<T>(url: string): Promise<WorkerResponse<T>> {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), this.timeout);

      const response = await fetch(url, {
        method: "GET",
        headers: {
          Accept: "application/json",
        },
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({})) as { message?: string };
        return {
          success: false,
          error: {
            code: `HTTP_${response.status}`,
            message: errorData.message || response.statusText,
          },
        };
      }

      const data = await response.json() as T;
      return { success: true, data };
    } catch (error) {
      if (error instanceof Error) {
        if (error.name === "AbortError") {
          return {
            success: false,
            error: { code: "TIMEOUT", message: "Request timed out" },
          };
        }
        return {
          success: false,
          error: { code: "NETWORK_ERROR", message: error.message },
        };
      }
      return {
        success: false,
        error: { code: "UNKNOWN_ERROR", message: "Unknown error occurred" },
      };
    }
  }
}

export const workerClient = new WorkerClient(config.workerUrl);
