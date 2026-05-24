import { internalAction, internalMutation, internalQuery, query } from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";
import {
    computeDemographicParity,
    computeEqualizedOdds,
    computeDisparateImpactRatio,
    type GroupOutcome,
    type GroupConfusion,
} from "./lib/bias_metrics.js";

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

        // 6. Store results
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
// Internal mutation: storeBiasReport
// ---------------------------------------------------------------------------

export const storeBiasReport = internalMutation({
    args: {
        workspaceSlug: v.string(),
        report: v.any(),
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
                configValue: args.report,
                updatedAt: Date.now(),
            });
        } else {
            await ctx.db.insert("workspace_config", {
                workspaceSlug: args.workspaceSlug,
                configKey: "bias_audit_report",
                configValue: args.report,
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
