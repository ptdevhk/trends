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

export default crons;
