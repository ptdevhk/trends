import { OpenAPIHono } from "@hono/zod-openapi";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import { prettyJSON } from "hono/pretty-json";

import {
  healthRoutes,
  trendsRoutes,
  topicsRoutes,
  searchRoutes,
  rssRoutes,
  resumesRoutes,
  industryRoutes,
  jobDescriptionsRoutes,
  sessionsRoutes,
  actionsRoutes,
} from "./routes/index.js";
import { config } from "./services/config.js";

export const openApiConfig = {
  openapi: "3.1.0",
  info: {
    title: "Trends API",
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
    { name: "industry", description: "Industry data for verification" },
    { name: "job-descriptions", description: "Job description templates" },
    { name: "sessions", description: "Resume search sessions" },
    { name: "actions", description: "Candidate actions" },
  ],
};

export function createApp() {
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
  app.route("/", industryRoutes);
  app.route("/", jobDescriptionsRoutes);
  app.route("/", sessionsRoutes);
  app.route("/", actionsRoutes);

  // OpenAPI documentation endpoint
  app.doc("/doc", openApiConfig);

  // OpenAPI JSON endpoint (alternative path)
  app.get("/openapi.json", (c) => {
    return c.json(app.getOpenAPI31Document(openApiConfig));
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
        resume_matches: "/api/resumes/matches",
        resume_match: "/api/resumes/match",
        sessions: "/api/sessions",
        actions: "/api/actions",
        industry_stats: "/api/industry/stats",
        industry_companies: "/api/industry/companies",
        industry_verify: "/api/industry/verify",
        job_descriptions: "/api/job-descriptions",
      },
    });
  });

  return app;
}

export const app = createApp();
