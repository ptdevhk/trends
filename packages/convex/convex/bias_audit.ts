import { internalAction, internalMutation, internalQuery, query } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Doc } from "./_generated/dataModel";
import { v } from "convex/values";
import {
    computeDemographicParity,
    computeEqualizedOdds,
    computeDisparateImpactRatio,
    computePSI,
    type GroupOutcome,
    type GroupConfusion,
} from "./lib/bias_metrics.js";

// ---------------------------------------------------------------------------
// Internal query: listWorkspaceSlugsWithAuditLogs — distinct workspace slugs
// ---------------------------------------------------------------------------

export const listWorkspaceSlugsWithAuditLogs = internalQuery({
    args: {},
    handler: async (ctx) => {
        // Use full table scan — this runs infrequently (weekly cron) and
        // workspace count is small. Extract distinct slugs from audit logs.
        const logs = await ctx.db
            .query("analysis_audit_log")
            .take(10000);
        const slugs = new Set<string>();
        for (const log of logs) {
            slugs.add(log.workspaceSlug);
        }
        return [...slugs];
    },
});

// ---------------------------------------------------------------------------
// Internal action: computeBiasMetricsForAllWorkspaces — cron entry point
// ---------------------------------------------------------------------------

export const computeBiasMetricsForAllWorkspaces = internalAction({
    args: {},
    handler: async (ctx) => {
        const workspaceSlugs = await ctx.runQuery(internal.bias_audit.listWorkspaceSlugsWithAuditLogs) as string[];
        const results: Array<{ workspaceSlug: string; status: string; anomalyDetected?: boolean }> = [];

        for (const workspaceSlug of workspaceSlugs) {
            try {
                const result = await ctx.runAction(internal.bias_audit.computeBiasMetrics, {
                    workspaceSlug,
                    decisionType: "score",
                }) as BiasMetricsResult | { status: string };

                if ("anomalyFlags" in result) {
                    const { statisticalParityViolation, disparateImpactViolation, scoreDriftDetected } = result.anomalyFlags;
                    const hasAnomaly = statisticalParityViolation || disparateImpactViolation || scoreDriftDetected;

                    if (hasAnomaly) {
                        const flags: string[] = [];
                        if (statisticalParityViolation) flags.push("statistical_parity_violation");
                        if (disparateImpactViolation) flags.push("disparate_impact_violation");
                        if (scoreDriftDetected) flags.push("score_drift_detected");

                        await ctx.runMutation(internal.bias_audit.storeAnomalyAlert, {
                            workspaceSlug,
                            flags,
                            computedAt: result.computedAt,
                            psiValue: result.scoreDrift.psi,
                            disparityRatio: result.demographicParity.disparityRatio,
                        });
                    }

                    results.push({ workspaceSlug, status: result.status, anomalyDetected: hasAnomaly });
                } else {
                    results.push({ workspaceSlug, status: result.status });
                }
            } catch (error) {
                results.push({ workspaceSlug, status: `error: ${error instanceof Error ? error.message : String(error)}` });
            }
        }

        return results;
    },
});

// ---------------------------------------------------------------------------
// Internal query: queryAuditLogs — fetches audit logs for bias computation
// ---------------------------------------------------------------------------

export const queryAuditLogs = internalQuery({
    args: {
        workspaceSlug: v.string(),
        decisionType: v.string(),
    },
    handler: async (ctx, args) => {
        return await ctx.db
            .query("analysis_audit_log")
            .withIndex("by_workspace_decision", (q) =>
                q.eq("workspaceSlug", args.workspaceSlug).eq("decisionType", args.decisionType as "score" | "tag" | "rank" | "filter" | "confirm")
            )
            .collect();
    },
});

// ---------------------------------------------------------------------------
// Internal action: computeBiasMetrics — scheduled or on-demand
// ---------------------------------------------------------------------------

interface BiasMetricsResult {
    status: "ok";
    workspaceSlug: string;
    decisionType: string;
    scoreThreshold: number;
    totalAuditRecords: number;
    groupCount: number;
    demographicParity: {
        disparityRatio: number;
        maxDifference: number;
        passing: boolean;
        groupRates: Array<{ groupKey: string; rate: number }>;
    };
    disparateImpact: Array<{ groupKey: string; ratio: number; referenceGroupKey: string }>;
    overrideRate: {
        tprDifference: number;
        fprDifference: number;
        passing: boolean;
    };
    scoreDrift: {
        psi: number;
        driftDetected: boolean;
    };
    anomalyFlags: {
        statisticalParityViolation: boolean;
        disparateImpactViolation: boolean;
        scoreDriftDetected: boolean;
    };
    computedAt: number;
}

export const computeBiasMetrics = internalAction({
    args: {
        workspaceSlug: v.string(),
        decisionType: v.optional(v.union(
            v.literal("score"),
            v.literal("tag"),
            v.literal("rank"),
            v.literal("filter"),
            v.literal("confirm"),
        )),
        scoreThreshold: v.optional(v.number()),
    },
    handler: async (ctx, args): Promise<BiasMetricsResult | { status: string; count: number; minimumRequired: number; message: string }> => {
        const workspaceSlug = args.workspaceSlug;
        const decisionType = args.decisionType ?? "score";
        const threshold = args.scoreThreshold ?? 70;

        // 1. Fetch all audit logs for this workspace + decision type
        const auditLogs = await ctx.runQuery(internal.bias_audit.queryAuditLogs, {
            workspaceSlug,
            decisionType,
        }) as Array<{ protectedAttributeHashes?: { ageBracketHash?: string }; output: { score?: number }; outcome?: string }>;

        if (auditLogs.length < 30) {
            return {
                status: "insufficient_data",
                count: auditLogs.length,
                minimumRequired: 30,
                message: "Not enough audit records for statistically significant bias analysis.",
            };
        }

        // 2. Group by ageBracketHash
        const groupMap = new Map<string, {
            total: number;
            positive: number;
            scores: number[];
            outcomes: { accepted: number; overridden: number; pending: number };
        }>();

        for (const log of auditLogs) {
            const ageHash = log.protectedAttributeHashes?.ageBracketHash ?? "unknown";
            const group = groupMap.get(ageHash) ?? {
                total: 0, positive: 0, scores: [], outcomes: { accepted: 0, overridden: 0, pending: 0 },
            };
            group.total++;
            const score = log.output.score;
            if (typeof score === "number") {
                group.scores.push(score);
                if (score >= threshold) {
                    group.positive++;
                }
            }
            if (log.outcome === "accepted") group.outcomes.accepted++;
            else if (log.outcome === "overridden") group.outcomes.overridden++;
            else group.outcomes.pending++;
            groupMap.set(ageHash, group);
        }

        // 3. Compute demographic parity
        const groups: GroupOutcome[] = [...groupMap.entries()].map(([key, g]) => {
            const avgScore = g.scores.length > 0
                ? g.scores.reduce((a, b) => a + b, 0) / g.scores.length
                : 0;
            const variance = g.scores.length > 1
                ? g.scores.reduce((sum, s) => sum + (s - avgScore) ** 2, 0) / (g.scores.length - 1)
                : 0;
            return {
                groupKey: key,
                total: g.total,
                positive: g.positive,
                avgScore,
                scoreStdDev: Math.sqrt(variance),
            };
        });

        const demographicParity = computeDemographicParity(groups);

        // 4. Compute disparate impact (pairwise, largest group as reference)
        const referenceGroup = groups.reduce((max, g) => g.total > max.total ? g : max, groups[0]);
        const disparateImpact = groups
            .filter((g) => g.groupKey !== referenceGroup.groupKey)
            .map((g) => ({
                groupKey: g.groupKey,
                ratio: computeDisparateImpactRatio(g, referenceGroup),
                referenceGroupKey: referenceGroup.groupKey,
            }));

        // 5. Compute override rate by group
        const confusionGroups: GroupConfusion[] = [...groupMap.entries()].map(([key, g]) => ({
            groupKey: key,
            truePositives: g.outcomes.accepted,
            falsePositives: g.outcomes.overridden,
            trueNegatives: 0,
            falseNegatives: 0,
        }));
        const equalizedOdds = computeEqualizedOdds(confusionGroups);

        // 6. Compute PSI (Population Stability Index) for score drift
        // Split audit logs into baseline (first half by time) and current (second half)
        const allScores = auditLogs
            .map((log) => log.output.score)
            .filter((s): s is number => typeof s === "number");
        const midPoint = Math.floor(allScores.length / 2);
        // Use earlier half as baseline, later half as current
        const baselineScores = allScores.slice(0, Math.max(midPoint, 1));
        const currentScores = allScores.slice(Math.max(midPoint, 1));
        const psiResult = baselineScores.length >= 10 && currentScores.length >= 10
            ? computePSI(baselineScores, currentScores)
            : { psi: 0, driftDetected: false, baselineCounts: [], currentCounts: [] };

        // 7. Compute anomaly flags
        const statisticalParityViolation = !demographicParity.passing;
        const disparateImpactViolation = disparateImpact.some((di) => di.ratio < 0.8);
        const scoreDriftDetected = psiResult.driftDetected;

        // 8. Store results
        const metrics: BiasMetricsResult = {
            status: "ok",
            workspaceSlug,
            decisionType,
            scoreThreshold: threshold,
            totalAuditRecords: auditLogs.length,
            groupCount: groups.length,
            demographicParity: {
                disparityRatio: demographicParity.disparityRatio,
                maxDifference: demographicParity.maxDifference,
                passing: demographicParity.passing,
                groupRates: demographicParity.groupRates,
            },
            disparateImpact,
            overrideRate: {
                tprDifference: equalizedOdds.tprDifference,
                fprDifference: equalizedOdds.fprDifference,
                passing: equalizedOdds.passing,
            },
            scoreDrift: {
                psi: psiResult.psi,
                driftDetected: psiResult.driftDetected,
            },
            anomalyFlags: {
                statisticalParityViolation,
                disparateImpactViolation,
                scoreDriftDetected,
            },
            computedAt: Date.now(),
        };

        await ctx.runMutation(internal.bias_audit.storeBiasReport, {
            workspaceSlug,
            report: metrics,
        });

        return metrics;
    },
});

// ---------------------------------------------------------------------------
// Validator: biasMetricsReportValidator — typed replacement for v.any()
// ---------------------------------------------------------------------------

export const biasMetricsReportValidator = v.object({
    status: v.literal("ok"),
    workspaceSlug: v.string(),
    decisionType: v.string(),
    scoreThreshold: v.number(),
    totalAuditRecords: v.number(),
    groupCount: v.number(),
    demographicParity: v.object({
        disparityRatio: v.number(),
        maxDifference: v.number(),
        passing: v.boolean(),
        groupRates: v.array(v.object({
            groupKey: v.string(),
            rate: v.number(),
        })),
    }),
    disparateImpact: v.array(v.object({
        groupKey: v.string(),
        ratio: v.number(),
        referenceGroupKey: v.string(),
    })),
    overrideRate: v.object({
        tprDifference: v.number(),
        fprDifference: v.number(),
        passing: v.boolean(),
    }),
    scoreDrift: v.object({
        psi: v.number(),
        driftDetected: v.boolean(),
    }),
    anomalyFlags: v.object({
        statisticalParityViolation: v.boolean(),
        disparateImpactViolation: v.boolean(),
        scoreDriftDetected: v.boolean(),
    }),
    computedAt: v.number(),
});

// ---------------------------------------------------------------------------
// Internal mutation: storeBiasReport
// ---------------------------------------------------------------------------

export const storeBiasReport = internalMutation({
    args: {
        workspaceSlug: v.string(),
        report: biasMetricsReportValidator,
    },
    handler: async (ctx, args) => {
        const existing = await ctx.db
            .query("workspace_config")
            .withIndex("by_workspace_key", (q) =>
                q.eq("workspaceSlug", args.workspaceSlug).eq("configKey", "bias_audit_report")
            )
            .first();

        if (existing) {
            await ctx.db.patch(existing._id, {
                configValue: args.report as Doc<"workspace_config">["configValue"],
                updatedAt: Date.now(),
            });
        } else {
            await ctx.db.insert("workspace_config", {
                workspaceSlug: args.workspaceSlug,
                configKey: "bias_audit_report",
                configValue: args.report as Doc<"workspace_config">["configValue"],
                updatedAt: Date.now(),
            });
        }
    },
});

// ---------------------------------------------------------------------------
// Public query: getLatestBiasReport
// ---------------------------------------------------------------------------

export const getLatestBiasReport = query({
    args: {
        workspaceSlug: v.string(),
    },
    handler: async (ctx, args) => {
        const config = await ctx.db
            .query("workspace_config")
            .withIndex("by_workspace_key", (q) =>
                q.eq("workspaceSlug", args.workspaceSlug).eq("configKey", "bias_audit_report")
            )
            .first();
        return config?.configValue ?? null;
    },
});

// ---------------------------------------------------------------------------
// Internal mutation: storeAnomalyAlert — persists anomaly alert after cron
// ---------------------------------------------------------------------------

export const storeAnomalyAlert = internalMutation({
    args: {
        workspaceSlug: v.string(),
        flags: v.array(v.string()),
        computedAt: v.number(),
        psiValue: v.optional(v.number()),
        disparityRatio: v.optional(v.number()),
    },
    handler: async (ctx, args) => {
        const existing = await ctx.db
            .query("workspace_config")
            .withIndex("by_workspace_key", (q) =>
                q.eq("workspaceSlug", args.workspaceSlug).eq("configKey", "bias_audit_anomaly_alert")
            )
            .first();

        const alertData = {
            workspaceSlug: args.workspaceSlug,
            flags: args.flags,
            psiValue: args.psiValue ?? null,
            disparityRatio: args.disparityRatio ?? null,
            alertedAt: args.computedAt,
        };

        if (existing) {
            await ctx.db.patch(existing._id, {
                configValue: alertData as Doc<"workspace_config">["configValue"],
                updatedAt: Date.now(),
            });
        } else {
            await ctx.db.insert("workspace_config", {
                workspaceSlug: args.workspaceSlug,
                configKey: "bias_audit_anomaly_alert",
                configValue: alertData as Doc<"workspace_config">["configValue"],
                updatedAt: Date.now(),
            });
        }
    },
});

// ---------------------------------------------------------------------------
// Public query: getAnomalyAlerts — fetch active anomaly alerts for workspace
// ---------------------------------------------------------------------------

export const getAnomalyAlerts = query({
    args: {
        workspaceSlug: v.string(),
    },
    handler: async (ctx, args) => {
        const config = await ctx.db
            .query("workspace_config")
            .withIndex("by_workspace_key", (q) =>
                q.eq("workspaceSlug", args.workspaceSlug).eq("configKey", "bias_audit_anomaly_alert")
            )
            .first();
        return config?.configValue ?? null;
    },
});
