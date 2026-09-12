import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();

crons.interval(
    "cleanup ai summary cache",
    { hours: 1 },
    internal.ai_summary_cache.cleanupExpired,
    {},
);

crons.daily(
    "sweep stuck analysis tasks",
    { hourUTC: 3, minuteUTC: 0 },
    internal.analysis_tasks.sweepStuckTasks,
    {},
);

crons.daily(
    "sweep stuck collection tasks",
    { hourUTC: 3, minuteUTC: 15 },
    internal.resume_tasks.sweepStuckTasks,
    {},
);

crons.weekly(
    "compute bias audit metrics",
    { dayOfWeek: "monday", hourUTC: 4, minuteUTC: 0 },
    internal.bias_audit.computeBiasMetricsForAllWorkspaces,
    {},
);

crons.interval(
    "incremental embedding backfill",
    { hours: 1 },
    internal.embeddings.scheduledBackfill,
    {},
);

crons.daily(
    "cleanup expired audit logs",
    { hourUTC: 5, minuteUTC: 0 },
    internal.audit.cleanupExpiredAuditLogs,
    {},
);

// Self-healing stale-compute drain (epoch 6): any resume whose stored
// ingestComputeEpoch lags CURRENT_INGEST_COMPUTE_EPOCH is re-ingested so its
// digest roleYearsByType is rebuilt under the current gate semantics. Adaptive
// backpressure (FIX-C) caps a saturated epoch-bump window to 50 rows/pass so
// the 15-min cron does not turn a bump into ~11h of 200-row Tantivy churn;
// mixed/finishing windows still schedule up to `limit`. Skips in maintenance.
crons.interval(
    "reingest stale compute rows",
    { minutes: 15 },
    internal.ingest_agent.reIngestStaleResumes,
    { limit: 200, mode: "compute", adaptive: true },
);

export default crons;
