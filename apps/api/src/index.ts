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
}, (info) => {
  logger.info(`Server running at http://localhost:${info.port}`);
  logger.info(`API docs at http://localhost:${info.port}/doc`);
});

export default app;
