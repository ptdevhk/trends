import { OpenAPIHono } from "@hono/zod-openapi";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import { prettyJSON } from "hono/pretty-json";
import { secureHeaders } from "hono/secure-headers";

import {
  healthRoutes,
  aiSummaryRoutes,
  taxonomyRoutes,
  trendsRoutes,
  topicsRoutes,
  searchRoutes,
  rssRoutes,
  resumesRoutes,
  resumeSubmitRoutes,
  industryRoutes,
  jobDescriptionsRoutes,
  sessionsRoutes,
  actionsRoutes,
  blocksRoutes,
  candidateStatusRoutes,
  searchProfilesRoutes,
  searchAnalyticsRoutes,
  scoringEvaluationRoutes,
  filterPresetsRoutes,
  configRoutes,
  notificationRoutes,
  workerRoutes,
  summariesRoutes,
  webVitalsRoutes,
  searchAlertsRoutes,
  resumesAdminRoutes,
} from "./routes/index.js";
import { config } from "./services/config.js";
import { workspaceMiddleware } from "./middleware/workspace.js";
import { serverTimingMiddleware } from "./middleware/server-timing.js";
import { rateLimit } from "./middleware/rate-limit.js";

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
    { name: "blocks", description: "Candidate blocklist management" },
    { name: "candidate-status", description: "Candidate interview status tracking" },
    { name: "Search Profiles", description: "Search profile management" },
    { name: "Search Analytics", description: "Search quality telemetry and suggestions" },
    { name: "Scoring Evaluation", description: "Scoring quality analysis, auto-tuning, and rollback" },
    { name: "Filter Presets", description: "Filter preset management" },
    { name: "Config", description: "Runtime configuration management" },
    { name: "Summaries", description: "Workspace summary previews and delivery" },
  ],
};

export function createApp() {
  const app = new OpenAPIHono();

  // Middleware
  app.use("*", serverTimingMiddleware);
  app.use("*", secureHeaders({
    contentSecurityPolicyReportOnly: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", "data:", "blob:"],
      connectSrc: ["'self'", "*.convex.cloud"],
      objectSrc: ["'none'"],
      frameAncestors: ["'none'"],
      baseUri: ["'self'"],
      formAction: ["'self'"],
    },
    xFrameOptions: "DENY",
    xContentTypeOptions: "nosniff",
    referrerPolicy: "strict-origin-when-cross-origin",
  }));
  app.use(
    "*",
    cors({
      origin: "*",
      exposeHeaders: ["Content-Disposition", "Content-Length"],
    })
  );
  app.use("*", logger());
  app.use("*", prettyJSON());
  app.use("*", workspaceMiddleware);

  // Rate limiting on API routes (100 req/min per IP)
  app.use("/api/*", rateLimit({ limit: 100, windowMs: 60_000 }));

  // Mount routes
  app.route("/", healthRoutes);
  app.route("/", aiSummaryRoutes);
  app.route("/", taxonomyRoutes);
  app.route("/", trendsRoutes);
  app.route("/", topicsRoutes);
  app.route("/", searchRoutes);
  app.route("/", rssRoutes);
  app.route("/", resumesRoutes);
  app.route("/", resumesAdminRoutes);
  app.route("/", resumeSubmitRoutes);
  app.route("/", industryRoutes);
  app.route("/", jobDescriptionsRoutes);
  app.route("/", sessionsRoutes);
  app.route("/", actionsRoutes);
  app.route("/", blocksRoutes);
  app.route("/", candidateStatusRoutes);
  app.route("/worker", workerRoutes);
  app.route("/api/worker", workerRoutes);
  app.route("/api/search-profiles", searchProfilesRoutes);
  app.route("/api/search-analytics", searchAnalyticsRoutes);
  app.route("/api/scoring-evaluation", scoringEvaluationRoutes);
  app.route("/api/filter-presets", filterPresetsRoutes);
  app.route("/api/config", configRoutes);
  app.route("/api/notifications", notificationRoutes);
  app.route("/api/summaries", summariesRoutes);
  app.route("/api/web-vitals", webVitalsRoutes);
  app.route("/api/search-alerts", searchAlertsRoutes);

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
        resume_match_stream: "/api/resumes/match-stream",
        resume_match_runs: "/api/resumes/match-runs",
        resume_matches_rescore: "/api/resumes/matches/rescore",
        sessions: "/api/sessions",
        actions: "/api/actions",
        blocks: "/api/blocks",
        candidate_status: "/api/candidate-status",
        industry_stats: "/api/industry/stats",
        industry_companies: "/api/industry/companies",
        industry_verify: "/api/industry/verify",
        job_descriptions: "/api/job-descriptions",
        search_profiles: "/api/search-profiles",
        search_analytics: "/api/search-analytics",
        scoring_evaluation: "/api/scoring-evaluation/report",
        config: "/api/config",
        summaries: "/api/summaries/preview",
      },
    });
  });

  return app;
}

export const app = createApp();
