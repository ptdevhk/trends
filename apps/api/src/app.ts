import { OpenAPIHono } from "@hono/zod-openapi";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import { prettyJSON } from "hono/pretty-json";
import { secureHeaders } from "hono/secure-headers";
import { bodyLimit } from "hono/body-limit";

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
  publicSharesRoutes,
  actionsRoutes,
  blocksRoutes,
  companiesRoutes,
  researchRoutes,
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
  resumesDiagnosticsRoutes,
  resumesImportRoutes,
  resumesPacketsRoutes,
  resumesFeedbackBatchRoutes,
  resumesAdminRoutes,
  resumesSearchRoutes,
  resumesMatchRoutes,
  systemRoutes,
} from "./routes/index.js";
import { createAuthRoutes } from "./routes/auth.js";
import { createAdminUserRoutes } from "./routes/admin_users.js";
import { config } from "./services/config.js";
import type { AuthEventStorage } from "./services/auth-event-storage.js";
import type { AuthStorage } from "./services/auth-storage.js";
import type { AuthContext } from "./services/auth-types.js";
import { workspaceMiddleware } from "./middleware/workspace.js";
import { createAuthMiddleware } from "./middleware/auth.js";
import { serverTimingMiddleware } from "./middleware/server-timing.js";
import { rateLimit } from "./middleware/rate-limit.js";
import { maintenanceGuard } from "./middleware/maintenance.js";

const LOCAL_DEV_ORIGINS = new Set([
  "http://localhost:3000",
  "http://localhost:3001",
  "http://localhost:5173",
  "http://localhost:5174",
  "http://127.0.0.1:3000",
  "http://127.0.0.1:3001",
  "http://127.0.0.1:5173",
  "http://127.0.0.1:5174",
]);

function resolveCorsOrigin(origin: string): string | null {
  if (config.auth.allowedOrigins.includes(origin)) {
    return origin;
  }
  if (process.env.NODE_ENV !== "production" && config.auth.allowedOrigins.length === 0 && LOCAL_DEV_ORIGINS.has(origin)) {
    return origin;
  }
  return null;
}

type CreateAppOptions = {
  authStorage?: AuthStorage;
  authEventStorage?: AuthEventStorage;
  authContext?: AuthContext;
  authTtlSeconds?: number;
};

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
    { name: "public-shares", description: "Public immutable resume search snapshots" },
    { name: "actions", description: "Candidate actions" },
    { name: "blocks", description: "Candidate blocklist management" },
    { name: "companies", description: "Company registry and company policy management" },
    { name: "candidate-status", description: "Candidate interview status tracking" },
    { name: "Search Profiles", description: "Search profile management" },
    { name: "Search Analytics", description: "Search quality telemetry and suggestions" },
    { name: "Scoring Evaluation", description: "Scoring quality analysis, auto-tuning, and rollback" },
    { name: "Filter Presets", description: "Filter preset management" },
    { name: "Config", description: "Runtime configuration management" },
    { name: "Summaries", description: "Workspace summary previews and delivery" },
  ],
};

export function createApp(options: CreateAppOptions = {}) {
  const app = new OpenAPIHono();
  const authMiddleware = createAuthMiddleware({
    storage: options.authStorage,
    eventStorage: options.authEventStorage,
    ttlSeconds: options.authTtlSeconds,
  });

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
      origin: resolveCorsOrigin,
      credentials: true,
      exposeHeaders: ["Content-Disposition", "Content-Length"],
    })
  );
  app.use("*", logger());
  app.use("*", prettyJSON());
  app.use("*", workspaceMiddleware);
  if (options.authContext) {
    app.use("*", async (c, next) => {
      c.set("auth", options.authContext);
      await next();
    });
  }
  if (options.authEventStorage) {
    app.use("*", async (c, next) => {
      c.set("authEventStorage", options.authEventStorage);
      await next();
    });
  }
  app.use("*", authMiddleware.optionalAuth);

  // Rate limiting on public API routes.
  // Search endpoints: 30 req/min (expensive backend operations)
  // Other public routes: 100 req/min (standard protection)
  // All environments — localhost dev uses "unknown" key which is fine for low-traffic dev.
  // Use /* only: in Hono, use("/api/search/*") matches both "/api/search" and "/api/search/sub",
  // while use("/api/search") matches the exact path only. Using /* avoids double-counting.
  app.use("/api/search/*", rateLimit({ limit: 30, windowMs: 60_000 }));
  app.use("/api/trends/*", rateLimit({ limit: 100, windowMs: 60_000 }));
  app.use("/api/topics/*", rateLimit({ limit: 100, windowMs: 60_000 }));
  app.use("/api/rss/*", rateLimit({ limit: 100, windowMs: 60_000 }));
  app.use("/api/industry/*", rateLimit({ limit: 100, windowMs: 60_000 }));
  app.use("/api/system/*", rateLimit({ limit: 100, windowMs: 60_000 }));

  // General rate limit for all other API routes (100 req/min, production only)
  if (process.env.NODE_ENV === "production") {
    app.use("/api/*", rateLimit({ limit: 100, windowMs: 60_000 }));
  }

  // Body size limit on API routes (10 MiB default — manual-import has its own larger limit)
  app.use(
    "/api/*",
    async (c, next) => {
      // Skip for manual-import which has its own larger body limit
      if (c.req.path === "/api/resumes/manual-import") {
        return next();
      }
      return bodyLimit({
        maxSize: 10 * 1024 * 1024,
        onError: (c) => {
          return c.json({ success: false, error: "Request body exceeds 10 MiB limit" }, 413);
        },
      })(c, next);
    },
  );
  app.use("/api/*", async (c, next) => {
    if (c.req.path === "/api/web-vitals/report") {
      return next();
    }
    return authMiddleware.requireCsrf(c, next);
  });

  // Maintenance mode guard — block write methods (POST/PUT/PATCH/DELETE) on API
  // routes when the Convex `maintenanceMode` system flag is active.
  // Registered before route mounts so it runs first; GETs pass through.
  app.use("*", maintenanceGuard);

  // Mount routes
  app.route("/", healthRoutes);
  app.route("/", createAuthRoutes({
    storage: options.authStorage,
    eventStorage: options.authEventStorage,
    ttlSeconds: options.authTtlSeconds,
  }));
  app.route("/", createAdminUserRoutes({
    storage: options.authStorage,
    eventStorage: options.authEventStorage,
    adminResetEnabled: config.auth.adminResetEnabled,
    authMiddleware,
  }));
  app.route("/", aiSummaryRoutes);
  app.route("/", taxonomyRoutes);
  app.route("/", trendsRoutes);
  app.route("/", topicsRoutes);
  app.route("/", searchRoutes);
  app.route("/", rssRoutes);
  app.route("/", resumesDiagnosticsRoutes);
  app.route("/", resumesImportRoutes);
  app.route("/", resumesPacketsRoutes);
  app.route("/", resumesFeedbackBatchRoutes);
  app.route("/", resumesSearchRoutes);
  app.route("/", resumesMatchRoutes);
  app.route("/", resumesRoutes);
  app.route("/", resumesAdminRoutes);
  app.route("/", resumeSubmitRoutes);
  app.route("/", industryRoutes);
  app.route("/", jobDescriptionsRoutes);
  app.route("/", sessionsRoutes);
  app.route("/", publicSharesRoutes);
  app.route("/", actionsRoutes);
  app.route("/", blocksRoutes);
  app.route("/", companiesRoutes);
  app.route("/", researchRoutes);
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
  app.route("/", systemRoutes);

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
        public_shares: "/api/public-shares",
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
