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
// digest roleYearsByType is rebuilt under the current gate semantics. Bounded
// to 200 rows a run (the operator trigger reIngestStaleResumes caps each pass
// the same way); a high-frequency interval keeps a post-bump corpus from
// lingering stale for a full day.
crons.interval(
    "reingest stale compute rows",
    { minutes: 15 },
    internal.ingest_agent.reIngestStaleResumes,
    { limit: 200, mode: "compute" },
);

export default crons;
