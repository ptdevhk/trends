/**
 * API Configuration
 *
 * Environment variables:
 * - PORT: HTTP server port (default: 3000)
 * - WORKER_URL: FastAPI worker URL (default: http://localhost:8000)
 * - USE_MOCK: Use mock data instead of worker (default: false in production)
 */

export const config = {
  port: parseInt(process.env.PORT || "3000", 10),
  workerUrl: process.env.WORKER_URL || "http://localhost:8000",
  useMock: process.env.USE_MOCK === "true" || process.env.NODE_ENV !== "production",
  version: "0.1.0",
};
