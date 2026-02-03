import { serve } from "@hono/node-server";
import { OpenAPIHono } from "@hono/zod-openapi";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import { prettyJSON } from "hono/pretty-json";

import { healthRoutes, trendsRoutes, topicsRoutes, searchRoutes, rssRoutes, resumesRoutes } from "./routes/index.js";
import { config } from "./services/config.js";

// Create main app
const app = new OpenAPIHono();

// Middleware
app.use("*", cors());
app.use("*", logger());
app.use("*", prettyJSON());

// Mount routes
app.route("/", healthRoutes);
app.route("/", trendsRoutes);
app.route("/", topicsRoutes);
app.route("/", searchRoutes);
app.route("/", rssRoutes);
app.route("/", resumesRoutes);

// OpenAPI documentation endpoint
app.doc("/doc", {
  openapi: "3.1.0",
  info: {
    title: "热点追踪 API",
    version: config.version,
    description: "BFF API for Chinese news hot topic aggregator",
  },
  tags: [
    { name: "health", description: "Health check endpoints" },
    { name: "trends", description: "Trending news and topics" },
    { name: "topics", description: "Trending topics aggregation" },
    { name: "search", description: "Search functionality" },
    { name: "rss", description: "RSS feed data" },
    { name: "resumes", description: "Resume sample data" },
  ],
});

// OpenAPI JSON endpoint (alternative path)
app.get("/openapi.json", (c) => {
  return c.json(app.getOpenAPI31Document({
    openapi: "3.1.0",
    info: {
      title: "热点追踪 API",
      version: config.version,
      description: "BFF API for Chinese news hot topic aggregator",
    },
  }));
});

// Root endpoint
app.get("/", (c) => {
  return c.json({
    name: "热点追踪 API",
    version: config.version,
    docs: "/doc",
    health: "/health",
    endpoints: {
      trends: "/api/trends",
      topics: "/api/topics",
      search: "/api/search",
      rss: "/api/rss",
      resumes: "/api/resumes",
      resume_samples: "/api/resumes/samples",
    },
  });
});

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
