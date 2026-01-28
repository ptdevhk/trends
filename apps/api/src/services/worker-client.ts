/**
 * FastAPI Worker Client
 *
 * Proxies requests to the Python FastAPI worker service.
 * Falls back to mock data when worker is unavailable.
 */

import { config } from "./config";

interface WorkerResponse<T> {
  success: boolean;
  data?: T;
  error?: {
    code: string;
    message: string;
    suggestion?: string;
  };
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
      const result = await this.get<{ status: string }>("/health");
      return result.success && result.data?.status === "healthy";
    } catch {
      return false;
    }
  }
}

export const workerClient = new WorkerClient(config.workerUrl);
