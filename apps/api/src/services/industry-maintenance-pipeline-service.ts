import { config } from "./config.js";
import { logger } from "./logger.js";
import { callConvexMutation, callConvexQuery } from "./convex-utils.js";
import type { IndustryMaintenanceRunMode } from "@trends/shared";

/**
 * Industry maintenance trigger pipeline.
 *
 * Orchestrates maintenance runs from three trigger sources (restore, approval,
 * manual) with run coalescing: if a run is already queued/running for the
 * workspace, the new trigger appends its context onto it instead of spawning a
 * duplicate. Mirrors the APScheduler `coalesce: True` philosophy.
 *
 * The pipeline is API-side (not Convex reactions) so orchestration is explicit
 * and immediate, and so it can reuse the run-history surface. A run row is
 * created in Convex, then the worker is POSTed with the runId; the worker does
 * the actual research/freshness work and finishes the run. If the worker is
 * unreachable, the pipeline itself finishes the run as `failed`.
 */

export type MaintenanceTriggerSource = "schedule" | "restore" | "approval" | "manual";

export interface EnqueueMaintenanceInput {
  workspaceSlug: string;
  triggerSource: MaintenanceTriggerSource;
  triggerContext?: string;
  mode?: IndustryMaintenanceRunMode;
  proposalIds?: string[];
  requestIds?: string[];
}

export interface EnqueueMaintenanceResult {
  runId: string | null;
  coalesced: boolean;
}

export interface MaintenancePipelineDeps {
  findActiveRun: (workspaceSlug: string) => Promise<{ runId: string; mode?: IndustryMaintenanceRunMode } | null>;
  startRun: (input: {
    workspaceSlug: string;
    triggerSource: MaintenanceTriggerSource;
    triggerContext?: string;
    mode?: IndustryMaintenanceRunMode;
    proposalIds?: string[];
    requestIds?: string[];
    limit?: number;
  }) => Promise<{
    runId: string;
    proposalIds?: string[];
    requests?: Array<{ requestId: string; proposalId: string; leaseId: string }>;
  }>;
  patchTriggerContext: (input: {
    runId: string;
    triggerContext: string;
  }) => Promise<unknown>;
  postToWorker: (
    path: string,
    body: Record<string, unknown>,
  ) => Promise<{ ok: boolean; status: number }>;
  finishRun: (input: {
    runId: string;
    status: "completed" | "failed" | "skipped";
    failureMessage?: string;
    operatorSummary: string;
  }) => Promise<unknown>;
  releaseRequests?: (input: {
    runId: string;
    requests: Array<{ requestId: string; proposalId?: string; leaseId: string }>;
    failureCode: "worker_unreachable" | "timeout";
    outcome: string;
  }) => Promise<unknown>;
}

function generateRunId(): string {
  // Lightweight uuid v4 without a dependency.
  return "run-" + Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}

/**
 * Default production deps: real Convex HTTP + worker fetch.
 */
function defaultDeps(): MaintenancePipelineDeps {
  return {
    findActiveRun: async (workspaceSlug) => {
      const result = await callConvexQuery(
        "companies:findActiveIndustryMaintenanceRun",
        {
          workspaceSlug,
          writeSecret: config.auth.convexWriteSecret,
        },
      );
      const parsed = result as { runId?: string; mode?: IndustryMaintenanceRunMode } | null;
      return parsed?.runId ? { runId: parsed.runId, ...(parsed.mode ? { mode: parsed.mode } : {}) } : null;
    },
    startRun: async (input) => {
      const runId = generateRunId();
      if (input.mode === "targeted") {
        const result = await callConvexMutation(
          "companies:startAndClaimIndustryEvidenceMaintenanceRun",
          {
            runId,
            workspaceSlug: input.workspaceSlug,
            triggerSource: input.triggerSource,
            ...(input.triggerContext ? { triggerContext: input.triggerContext } : {}),
            mode: input.mode,
            ...(input.proposalIds?.length ? { proposalIds: input.proposalIds } : {}),
            ...(input.requestIds?.length ? { requestIds: input.requestIds } : {}),
            limit: Math.max(input.proposalIds?.length ?? 0, input.requestIds?.length ?? 0, 1),
            writeSecret: config.auth.convexWriteSecret,
          },
        );
        const parsed = result as {
          runId?: string;
          proposalIds?: string[];
          requests?: Array<{ requestId: string; proposalId: string; leaseId: string }>;
        };
        return {
          runId: parsed.runId ?? runId,
          proposalIds: parsed.proposalIds ?? [],
          requests: parsed.requests ?? [],
        };
      }
      await callConvexMutation("companies:startIndustryMaintenanceRun", {
        runId,
        workspaceSlug: input.workspaceSlug,
        triggerSource: input.triggerSource,
        ...(input.triggerContext ? { triggerContext: input.triggerContext } : {}),
        writeSecret: config.auth.convexWriteSecret,
      });
      return { runId };
    },
    patchTriggerContext: async (input) => {
      return callConvexMutation("companies:patchIndustryMaintenanceRunContext", {
        runId: input.runId,
        triggerContext: input.triggerContext,
        writeSecret: config.auth.convexWriteSecret,
      });
    },
    postToWorker: async (path, body) => {
      const response = await fetch(`${config.workerUrl}${path}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(config.industryMaintenanceWorkerTimeoutMs),
      });
      return { ok: response.ok, status: response.status };
    },
    finishRun: async (input) =>
      callConvexMutation("companies:finishIndustryMaintenanceRun", {
        runId: input.runId,
        status: input.status,
        ...(input.failureMessage ? { failureMessage: input.failureMessage } : {}),
        operatorSummary: input.operatorSummary,
        writeSecret: config.auth.convexWriteSecret,
      }),
    releaseRequests: async (input) =>
      callConvexMutation("companies:releaseIndustryEvidenceResearchRequests", {
        runId: input.runId,
        requests: input.requests.map((request) => ({
          requestId: request.requestId,
          leaseId: request.leaseId,
        })),
        failureCode: input.failureCode,
        outcome: input.outcome,
        writeSecret: config.auth.convexWriteSecret,
      }),
  };
}

/**
 * Enqueue a maintenance run. Coalesces onto an active run when one exists.
 * Fire-and-forget advance: claims the run, POSTs to the worker, and finishes
 * the run `failed` if the worker is unreachable. Never throws to the caller.
 */
export async function enqueueIndustryMaintenance(
  input: EnqueueMaintenanceInput,
  deps: MaintenancePipelineDeps = defaultDeps(),
): Promise<EnqueueMaintenanceResult> {
  try {
    const active = await deps.findActiveRun(input.workspaceSlug);
    // Targeted requests must retain their exact proposal/lease payload. A
    // broad legacy run cannot safely absorb them because the worker would
    // otherwise lose the target selector. Start a bounded targeted run even
    // when a sweep is already active; Convex coalescing still deduplicates the
    // individual request row and only one run can claim its lease.
    if (active && input.mode !== "targeted" && active.mode !== "targeted") {
      if (input.triggerContext) {
        try {
          await deps.patchTriggerContext({
            runId: active.runId,
            triggerContext: input.triggerContext,
          });
        } catch (error) {
          logger.warn(
            "Failed to coalesce maintenance trigger context",
            { route: "industry-maintenance-pipeline", error: String(error) },
          );
        }
      }
      return { runId: active.runId, coalesced: true };
    }

    const started = await deps.startRun({
      workspaceSlug: input.workspaceSlug,
      triggerSource: input.triggerSource,
      ...(input.triggerContext ? { triggerContext: input.triggerContext } : {}),
      ...(input.mode ? { mode: input.mode } : {}),
      ...(input.proposalIds ? { proposalIds: input.proposalIds } : {}),
      ...(input.requestIds ? { requestIds: input.requestIds } : {}),
    });
    const runId = started.runId;

    // Fire-and-forget advance; never blocks the caller or throws.
    void advanceRun(runId, input, deps, started);

    return { runId, coalesced: false };
  } catch (error) {
    logger.error(
      "Failed to enqueue industry maintenance run",
      error,
      { route: "industry-maintenance-pipeline" },
    );
    return { runId: null, coalesced: false };
  }
}

async function advanceRun(
  runId: string,
  input: EnqueueMaintenanceInput,
  deps: MaintenancePipelineDeps,
  started: {
    proposalIds?: string[];
    requests?: Array<{ requestId: string; proposalId: string; leaseId: string }>;
  },
): Promise<void> {
  try {
    const result = await deps.postToWorker("/worker/industry/maintenance", {
      runId,
      trigger: input.triggerSource,
      ...(input.mode ? { mode: input.mode } : {}),
      ...(started.proposalIds?.length ? { proposalIds: started.proposalIds } : {}),
      ...(started.requests?.length ? { requests: started.requests } : {}),
    });
    if (!result.ok) {
      if (started.requests?.length && deps.releaseRequests) {
        await deps.releaseRequests({
          runId,
          requests: started.requests,
          failureCode: "worker_unreachable",
          outcome: `worker responded ${result.status}`,
        });
      }
      await deps.finishRun({
        runId,
        status: "failed",
        failureMessage: `worker responded ${result.status}`,
        operatorSummary: `failed; worker HTTP ${result.status}.`,
      });
    }
    // On success the worker itself finishes the run with counts + summary.
  } catch (error) {
    logger.error(
      "Industry maintenance worker advance failed",
      error,
      { route: "industry-maintenance-pipeline", runId },
    );
    try {
      if (started.requests?.length && deps.releaseRequests) {
        await deps.releaseRequests({
          runId,
          requests: started.requests,
          failureCode: "worker_unreachable",
          outcome: error instanceof Error ? error.message : String(error),
        });
      }
      await deps.finishRun({
        runId,
        status: "failed",
        failureMessage: error instanceof Error ? error.message : String(error),
        operatorSummary: "failed; worker unreachable.",
      });
    } catch (finishError) {
      logger.error(
        "Failed to mark industry maintenance run as failed",
        finishError,
        { route: "industry-maintenance-pipeline", runId },
      );
    }
  }
}
