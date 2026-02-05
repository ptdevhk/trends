import { serve } from "@hono/node-server";
import { app } from "./app.js";
import { config } from "./services/config.js";

// Start server
console.log(`Starting 热点追踪 API server on port ${config.port}...`);
console.log("Mode: sqlite (direct output/*.db)");
console.log(`Project root: ${config.projectRoot ?? "(auto-detected)"}`);
console.log(`Worker URL (optional): ${config.workerUrl}`);

serve({
  fetch: app.fetch,
  port: config.port,
}, (info) => {
  console.log(`Server running at http://localhost:${info.port}`);
  console.log(`API docs at http://localhost:${info.port}/doc`);
});

export default app;
