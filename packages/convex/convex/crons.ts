import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();

crons.interval(
    "cleanup ai summary cache",
    { hours: 1 },
    internal.ai_summary_cache.cleanupExpired,
    {},
);

export default crons;
