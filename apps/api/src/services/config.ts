/**
 * API Configuration
 *
 * Environment variables:
 * - PORT: HTTP server port (default: 3000)
 * - WORKER_URL: FastAPI worker URL (default: http://localhost:8000)
 * - PROJECT_ROOT: TrendRadar project root (auto-detected if unset)
 */

export const config = {
  port: parseInt(process.env.PORT || "3000", 10),
  workerUrl: process.env.WORKER_URL || "http://localhost:8000",
  projectRoot: process.env.PROJECT_ROOT,
  version: "0.1.0",
};
