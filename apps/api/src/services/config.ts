/**
 * API Configuration
 *
 * Environment variables:
 * - PORT: HTTP server port (default: 3000)
 * - WORKER_URL: FastAPI worker URL (default: http://localhost:8000)
 * - PROJECT_ROOT: TrendRadar project root (auto-detected if unset)
 * - TIMEZONE: Global timezone override (default from config/config.yaml or Asia/Hong_Kong)
 */

import path from "node:path";

import { findProjectRoot } from "./db.js";
import { ensureProcessTimezone, resolveTimezone } from "./timezone.js";

const projectRoot = process.env.PROJECT_ROOT
  ? path.resolve(process.env.PROJECT_ROOT)
  : findProjectRoot();

const timezone = resolveTimezone({
  envTimezone: process.env.TIMEZONE,
  projectRoot,
});
ensureProcessTimezone(timezone);

export const config = {
  port: parseInt(process.env.PORT || "3000", 10),
  workerUrl: process.env.WORKER_URL || "http://localhost:8000",
  projectRoot,
  timezone,
  version: "0.1.0",
};
