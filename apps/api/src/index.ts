import { serve } from "@hono/node-server";
import { app } from "./app.js";
import { config } from "./services/config.js";
import { logger } from "./services/logger.js";

// Start server
logger.info(`Starting 热点追踪 API server on port ${config.port}...`);
logger.info("Mode: sqlite (direct output/*.db)");
logger.info(`Project root: ${config.projectRoot ?? "(auto-detected)"}`);
logger.info(`Worker URL (optional): ${config.workerUrl}`);

serve({
  fetch: app.fetch,
  port: config.port,
  // The lag-scan endpoint (/api/resumes/search-freshness) does a full-corpus
  // dry-run that can take 300–400 s on a prod-restored ~9 k-row Convex SQLite.
  // Node's default http.Server requestTimeout is 300 s, which kills the
  // connection mid-scan and forces the doctor's fallback path. Raise it to
  // 600 s so the preferred scan path completes.
  serverOptions: {
    requestTimeout: 600_000,
  },
}, (info) => {
  logger.info(`Server running at http://localhost:${info.port}`);
  logger.info(`API docs at http://localhost:${info.port}/doc`);
});

export default app;
