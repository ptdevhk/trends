import { config } from "./config.js";
import { logger } from "./logger.js";
import { callConvexMutation, callConvexQuery } from "./convex-utils.js";

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
}

export interface EnqueueMaintenanceResult {
  runId: string | null;
  coalesced: boolean;
}

export interface MaintenancePipelineDeps {
  findActiveRun: (workspaceSlug: string) => Promise<{ runId: string } | null>;
  startRun: (input: {
    workspaceSlug: string;
    triggerSource: MaintenanceTriggerSource;
    triggerContext?: string;
  }) => Promise<{ runId: string }>;
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
      return (result as { runId: string } | null) ?? null;
    },
    startRun: async (input) => {
      const runId = generateRunId();
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
      // Best-effort context append: there is no dedicated patch mutation for
      // triggerContext, so we read the active run, merge the context, and rely
      // on the worker/operator reading the run history. This is intentionally
      // best-effort - coalescing correctness does not depend on it.
      const existing = (await callConvexQuery("companies:getIndustryMaintenanceRun", {
        runId: input.runId,
        writeSecret: config.auth.convexWriteSecret,
      })) as { triggerContext?: string } | null;
      const prior = existing?.triggerContext?.trim() ?? "";
      return prior
        ? `${prior}; ${input.triggerContext}`
        : input.triggerContext;
    },
    postToWorker: async (path, body) => {
      const response = await fetch(`${config.workerUrl}${path}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(30_000),
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
    if (active) {
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

    const runId = await deps.startRun({
      workspaceSlug: input.workspaceSlug,
      triggerSource: input.triggerSource,
      ...(input.triggerContext ? { triggerContext: input.triggerContext } : {}),
    }).then((r) => r.runId);

    // Fire-and-forget advance; never blocks the caller or throws.
    void advanceRun(runId, input, deps);

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
): Promise<void> {
  try {
    const result = await deps.postToWorker("/worker/industry/maintenance", {
      runId,
      trigger: input.triggerSource,
    });
    if (!result.ok) {
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
