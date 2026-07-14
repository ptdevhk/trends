import { apiClient } from './api-client'

export type QueryParams = Record<string, string | number | boolean | undefined>

export type ApiResult<T> = {
  data?: T
  error?: unknown
  response?: { status?: number }
}

export type ApiClientLike = {
  GET: <T>(path: string, options?: { params?: { query?: QueryParams }; signal?: AbortSignal }) => Promise<ApiResult<T>>
  POST: <T>(path: string, options?: { params?: { query?: QueryParams }; body?: unknown; signal?: AbortSignal }) => Promise<ApiResult<T>>
  PUT: <T>(path: string, options?: { params?: { query?: QueryParams }; body?: unknown; signal?: AbortSignal }) => Promise<ApiResult<T>>
  DELETE: <T>(path: string, options?: { params?: { query?: QueryParams }; signal?: AbortSignal }) => Promise<ApiResult<T>>
  PATCH: <T>(path: string, options?: { params?: { query?: QueryParams }; body?: unknown; signal?: AbortSignal }) => Promise<ApiResult<T>>
}

export const rawApiClient = apiClient as unknown as ApiClientLike
