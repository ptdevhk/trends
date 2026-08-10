import { randomUUID } from "node:crypto";

import { isRecord } from "@trends/shared";

import { config } from "./config.js";
import {
  callConvexAction,
  callConvexMutation,
  callConvexQuery,
} from "./convex-utils.js";
import { SkillsKnowledgeService } from "./skills-knowledge.js";

export type CompanyIndustryRecomputeStatus =
  | "queued"
  | "running"
  | "waiting"
  | "completed"
  | "partial_failed"
  | "failed"
  | "superseded";

export interface CompanyIndustryRecomputeFailure {
  resumeId?: string;
  stage: string;
  message: string;
  occurredAt: number;
}

export interface CompanyIndustryRecomputeRun {
  runId: string;
  workspaceSlug: string;
  companyKey: string;
  targetRevisionId: string;
  proposalId?: string;
  requestedBy?: string;
  status: CompanyIndustryRecomputeStatus;
  attempt: number;
  cursor?: string;
  sourceDone: boolean;
  pageCount: number;
  affectedCount: number;
  alreadyCurrentCount: number;
  scheduledCount: number;
  readyCount: number;
  failureCount: number;
  batchCount: number;
  failures: CompanyIndustryRecomputeFailure[];
  lastError?: string;
  supersededByRevisionId?: string;
  createdAt: number;
  startedAt?: number;
  completedAt?: number;
  updatedAt: number;
  operatorSummary: string;
}

interface CompanyIndustryRecomputeBatch {
  batchId: string;
  runId: string;
  status:
    | "planned"
    | "dispatched"
    | "completed"
    | "partial_failed"
    | "failed";
  resumeIds: string[];
  dispatchedAt?: number;
  expectedSkillsVersion?: number;
}

type QueryFunction = (
  path: string,
  args: Record<string, unknown>,
) => Promise<unknown>;
type MutationFunction = (
  path: string,
  args: Record<string, unknown>,
) => Promise<unknown>;
type ActionFunction = (
  path: string,
  args: Record<string, unknown>,
) => Promise<unknown>;

export interface CompanyIndustryRecomputeDependencies {
  query: QueryFunction;
  mutate: MutationFunction;
  action: ActionFunction;
  createRunId: () => string;
  getSkillsVersion: () => number;
}

const terminalStatuses = new Set<CompanyIndustryRecomputeStatus>([
  "completed",
  "partial_failed",
  "failed",
  "superseded",
]);
const runStatuses = new Set<CompanyIndustryRecomputeStatus>([
  "queued",
  "running",
  "waiting",
  "completed",
  "partial_failed",
  "failed",
  "superseded",
]);
const batchStatuses = new Set<CompanyIndustryRecomputeBatch["status"]>([
  "planned",
  "dispatched",
  "completed",
  "partial_failed",
  "failed",
]);

function nonEmptyString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed || undefined;
}

function finiteNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined;
}

function nonNegativeInteger(value: unknown): number | undefined {
  const number = finiteNumber(value);
  return number !== undefined && Number.isInteger(number) && number >= 0
    ? number
    : undefined;
}

function parseFailure(
  value: unknown,
): CompanyIndustryRecomputeFailure | null {
  if (!isRecord(value)) return null;
  const stage = nonEmptyString(value.stage);
  const message = nonEmptyString(value.message);
  const occurredAt = finiteNumber(value.occurredAt);
  if (!stage || !message || occurredAt === undefined) return null;
  return {
    ...(nonEmptyString(value.resumeId)
      ? { resumeId: nonEmptyString(value.resumeId)! }
      : {}),
    stage,
    message,
    occurredAt,
  };
}

function operatorSummary(run: Omit<CompanyIndustryRecomputeRun, "operatorSummary">) {
  const progress = `${run.readyCount}/${run.affectedCount} ready`;
  const scheduled = `${run.scheduledCount} scheduled`;
  const failures =
    run.failureCount > 0 ? `, ${run.failureCount} failed` : "";
  if (run.status === "superseded") {
    return `Superseded by ${run.supersededByRevisionId ?? "a newer revision"}; ${progress}, ${scheduled}${failures}.`;
  }
  if (run.status === "completed") {
    return `Completed; ${progress}, ${scheduled}.`;
  }
  if (run.status === "partial_failed" || run.status === "failed") {
    return `${run.status === "partial_failed" ? "Partially completed" : "Failed"}; ${progress}, ${scheduled}${failures}. Retry is available while revision ${run.targetRevisionId} remains current.`;
  }
  return `${run.status}; ${progress}, ${scheduled}${failures}.`;
}

export function parseCompanyIndustryRecomputeRun(
  value: unknown,
): CompanyIndustryRecomputeRun {
  if (!isRecord(value)) {
    throw new Error("Invalid company industry recompute run");
  }
  const runId = nonEmptyString(value.runId);
  const workspaceSlug = nonEmptyString(value.workspaceSlug);
  const companyKey = nonEmptyString(value.companyKey);
  const targetRevisionId = nonEmptyString(value.targetRevisionId);
  const status = nonEmptyString(value.status) as
    | CompanyIndustryRecomputeStatus
    | undefined;
  const attempt = nonNegativeInteger(value.attempt);
  const pageCount = nonNegativeInteger(value.pageCount);
  const affectedCount = nonNegativeInteger(value.affectedCount);
  const alreadyCurrentCount = nonNegativeInteger(value.alreadyCurrentCount);
  const scheduledCount = nonNegativeInteger(value.scheduledCount);
  const readyCount = nonNegativeInteger(value.readyCount);
  const failureCount = nonNegativeInteger(value.failureCount);
  const batchCount = nonNegativeInteger(value.batchCount);
  const createdAt = finiteNumber(value.createdAt);
  const updatedAt = finiteNumber(value.updatedAt);
  if (
    !runId ||
    !workspaceSlug ||
    !companyKey ||
    !targetRevisionId ||
    !status ||
    !runStatuses.has(status) ||
    attempt === undefined ||
    pageCount === undefined ||
    affectedCount === undefined ||
    alreadyCurrentCount === undefined ||
    scheduledCount === undefined ||
    readyCount === undefined ||
    failureCount === undefined ||
    batchCount === undefined ||
    typeof value.sourceDone !== "boolean" ||
    !Array.isArray(value.failures) ||
    createdAt === undefined ||
    updatedAt === undefined
  ) {
    throw new Error("Invalid company industry recompute run");
  }
  const failures = value.failures.map(parseFailure);
  if (failures.some((failure) => failure === null)) {
    throw new Error("Invalid company industry recompute failure");
  }
  const parsed: Omit<CompanyIndustryRecomputeRun, "operatorSummary"> = {
    runId,
    workspaceSlug,
    companyKey,
    targetRevisionId,
    ...(nonEmptyString(value.proposalId)
      ? { proposalId: nonEmptyString(value.proposalId)! }
      : {}),
    ...(nonEmptyString(value.requestedBy)
      ? { requestedBy: nonEmptyString(value.requestedBy)! }
      : {}),
    status,
    attempt,
    ...(typeof value.cursor === "string" ? { cursor: value.cursor } : {}),
    sourceDone: value.sourceDone,
    pageCount,
    affectedCount,
    alreadyCurrentCount,
    scheduledCount,
    readyCount,
    failureCount,
    batchCount,
    failures: failures as CompanyIndustryRecomputeFailure[],
    ...(nonEmptyString(value.lastError)
      ? { lastError: nonEmptyString(value.lastError)! }
      : {}),
    ...(nonEmptyString(value.supersededByRevisionId)
      ? {
          supersededByRevisionId: nonEmptyString(
            value.supersededByRevisionId,
          )!,
        }
      : {}),
    createdAt,
    ...(finiteNumber(value.startedAt) !== undefined
      ? { startedAt: finiteNumber(value.startedAt)! }
      : {}),
    ...(finiteNumber(value.completedAt) !== undefined
      ? { completedAt: finiteNumber(value.completedAt)! }
      : {}),
    updatedAt,
  };
  return { ...parsed, operatorSummary: operatorSummary(parsed) };
}

function parseBatch(value: unknown): CompanyIndustryRecomputeBatch | null {
  if (value === null) return null;
  if (!isRecord(value)) {
    throw new Error("Invalid company industry recompute batch");
  }
  const batchId = nonEmptyString(value.batchId);
  const runId = nonEmptyString(value.runId);
  const status = nonEmptyString(value.status) as
    | CompanyIndustryRecomputeBatch["status"]
    | undefined;
  if (
    !batchId ||
    !runId ||
    !status ||
    !batchStatuses.has(status) ||
    !Array.isArray(value.resumeIds) ||
    value.resumeIds.some((resumeId) => typeof resumeId !== "string")
  ) {
    throw new Error("Invalid company industry recompute batch");
  }
  return {
    batchId,
    runId,
    status,
    resumeIds: value.resumeIds,
    ...(finiteNumber(value.dispatchedAt) !== undefined
      ? { dispatchedAt: finiteNumber(value.dispatchedAt)! }
      : {}),
    ...(nonNegativeInteger(value.expectedSkillsVersion) !== undefined
      ? {
          expectedSkillsVersion: nonNegativeInteger(
            value.expectedSkillsVersion,
          )!,
        }
      : {}),
  };
}

function defaultDependencies(): CompanyIndustryRecomputeDependencies {
  const skillsKnowledgeService = new SkillsKnowledgeService(config.projectRoot);
  return {
    query: callConvexQuery,
    mutate: callConvexMutation,
    action: callConvexAction,
    createRunId: randomUUID,
    getSkillsVersion: () => skillsKnowledgeService.getVersion(),
  };
}

export class CompanyIndustryRecomputeService {
  constructor(
    private readonly dependencies: CompanyIndustryRecomputeDependencies =
      defaultDependencies(),
  ) {}

  private query(path: string, args: Record<string, unknown>) {
    return this.dependencies.query(path, {
      ...args,
      writeSecret: config.auth.convexWriteSecret,
    });
  }

  private mutate(path: string, args: Record<string, unknown>) {
    return this.dependencies.mutate(path, {
      ...args,
      writeSecret: config.auth.convexWriteSecret,
    });
  }

  private action(path: string, args: Record<string, unknown>) {
    return this.dependencies.action(path, {
      ...args,
      writeSecret: config.auth.convexWriteSecret,
    });
  }

  async start(input: {
    workspaceSlug: string;
    companyKey: string;
    targetRevisionId: string;
    proposalId?: string;
    requestedBy?: string;
    advance?: boolean;
  }): Promise<CompanyIndustryRecomputeRun> {
    const workspaceSlug = input.workspaceSlug.trim();
    const companyKey = input.companyKey.trim().toLowerCase();
    const targetRevisionId = input.targetRevisionId.trim();
    if (!workspaceSlug || !companyKey || !targetRevisionId) {
      throw new Error(
        "Company industry recompute requires workspace, company, and revision",
      );
    }
    const started = parseCompanyIndustryRecomputeRun(
      await this.mutate("companies:startIndustryRecomputeRun", {
        runId: this.dependencies.createRunId(),
        workspaceSlug,
        companyKey,
        targetRevisionId,
        ...(input.proposalId?.trim()
          ? { proposalId: input.proposalId.trim() }
          : {}),
        ...(input.requestedBy?.trim()
          ? { requestedBy: input.requestedBy.trim() }
          : {}),
      }),
    );
    if (input.advance === false) return started;
    // Resume links must exist before the run lists affected resumes.
    await this.backfillCompanyResumeLinks(companyKey);
    return this.advanceToTerminal(started.runId);
  }

  async backfillCompanyResumeLinks(
    companyKey: string,
    options: { maxIterations?: number } = {},
  ): Promise<{
    status: string;
    scannedRows: number;
    matchedRows: number;
    linkedRows: number;
    iterations: number;
  }> {
    const companyKeyValue = companyKey.trim().toLowerCase();
    const maxIterations = Math.max(
      1,
      Math.floor(options.maxIterations ?? 200),
    );
    let cursor: string | null = null;
    let scannedRows = 0;
    let matchedRows = 0;
    let linkedRows = 0;
    let status = "";
    let iterations = 0;
    for (let iteration = 0; iteration < maxIterations; iteration += 1) {
      iterations += 1;
      const value = await this.action(
        "companies:backfillCompanyResumeLinksByCompanySync",
        {
          companyKey: companyKeyValue,
          ...(cursor ? { cursor } : {}),
        },
      );
      if (
        !isRecord(value) ||
        typeof value.isDone !== "boolean" ||
        (value.cursor !== null && typeof value.cursor !== "string") ||
        nonNegativeInteger(value.scannedRows) === undefined ||
        nonNegativeInteger(value.matchedRows) === undefined ||
        nonNegativeInteger(value.linkedRows) === undefined ||
        !nonEmptyString(value.status)
      ) {
        throw new Error("Invalid company resume link backfill result");
      }
      status = nonEmptyString(value.status)!;
      scannedRows += nonNegativeInteger(value.scannedRows)!;
      matchedRows += nonNegativeInteger(value.matchedRows)!;
      linkedRows += nonNegativeInteger(value.linkedRows)!;
      if (value.isDone) {
        return { status, scannedRows, matchedRows, linkedRows, iterations };
      }
      cursor = typeof value.cursor === "string" ? value.cursor : null;
      if (!cursor) {
        throw new Error(
          "Company resume link backfill continued without a cursor",
        );
      }
    }
    throw new Error(
      `Company resume link backfill exceeded ${maxIterations} iterations (scanned ${scannedRows} rows, matched ${matchedRows}, linked ${linkedRows})`,
    );
  }

  async advanceToTerminal(
    runId: string,
    options: { maxIterations?: number } = {},
  ): Promise<CompanyIndustryRecomputeRun> {
    const runIdValue = runId.trim();
    const maxIterations = Math.max(
      1,
      Math.floor(options.maxIterations ?? 1000),
    );
    let previousStatus: CompanyIndustryRecomputeStatus | null = null;
    let previousSignature = "";
    let current: CompanyIndustryRecomputeRun | null = null;
    for (let iteration = 0; iteration < maxIterations; iteration += 1) {
      current = await this.advance(runIdValue);
      if (terminalStatuses.has(current.status)) return current;
      const signature = [
        current.status,
        current.affectedCount,
        current.readyCount,
        current.scheduledCount,
        current.failureCount,
        current.batchCount,
        current.pageCount,
      ].join(":");
      // No-progress guard: two consecutive iterations with the same progress
      // signature mean the run is stalled (e.g. readiness pending with no
      // scheduler to resolve it) — stop rather than burn the iteration cap.
      if (
        previousStatus !== null &&
        previousStatus === current.status &&
        previousSignature === signature
      ) {
        return current;
      }
      previousStatus = current.status;
      previousSignature = signature;
    }
    if (!current) {
      throw new Error(`Unknown company industry recompute run: ${runIdValue}`);
    }
    return current;
  }

  async get(runId: string): Promise<CompanyIndustryRecomputeRun | null> {
    const value = await this.query("companies:getIndustryRecomputeRun", {
      runId: runId.trim(),
    });
    return value === null ? null : parseCompanyIndustryRecomputeRun(value);
  }

  async list(input: {
    workspaceSlug: string;
    companyKey: string;
    limit?: number;
  }): Promise<CompanyIndustryRecomputeRun[]> {
    const value = await this.query("companies:listIndustryRecomputeRuns", {
      workspaceSlug: input.workspaceSlug.trim(),
      companyKey: input.companyKey.trim().toLowerCase(),
      limit: Math.min(100, Math.max(1, Math.floor(input.limit ?? 20))),
    });
    if (!Array.isArray(value)) {
      throw new Error("Invalid company industry recompute run list");
    }
    return value.map(parseCompanyIndustryRecomputeRun);
  }

  async retry(
    runId: string,
    options: { requestedBy?: string; advance?: boolean } = {},
  ): Promise<CompanyIndustryRecomputeRun> {
    const retried = parseCompanyIndustryRecomputeRun(
      await this.mutate("companies:retryIndustryRecomputeRun", {
        runId: runId.trim(),
        ...(options.requestedBy?.trim()
          ? { requestedBy: options.requestedBy.trim() }
          : {}),
      }),
    );
    return options.advance === false ? retried : this.advance(retried.runId);
  }

  async reset(
    runId: string,
    options: { requestedBy?: string } = {},
  ): Promise<CompanyIndustryRecomputeRun> {
    return parseCompanyIndustryRecomputeRun(
      await this.mutate("companies:resetIndustryRecomputeRun", {
        runId: runId.trim(),
        ...(options.requestedBy?.trim()
          ? { requestedBy: options.requestedBy.trim() }
          : {}),
      }),
    );
  }

  async advance(runId: string): Promise<CompanyIndustryRecomputeRun> {
    const current = await this.get(runId);
    if (!current) {
      throw new Error(`Unknown company industry recompute run: ${runId}`);
    }
    if (terminalStatuses.has(current.status)) return current;

    const revisionState = await this.query(
      "companies:getIndustryRecomputeRevisionState",
      {
        companyKey: current.companyKey,
        targetRevisionId: current.targetRevisionId,
      },
    );
    if (
      !isRecord(revisionState) ||
      typeof revisionState.matchesTargetRevision !== "boolean"
    ) {
      throw new Error("Invalid company industry recompute revision state");
    }
    if (!revisionState.matchesTargetRevision) {
      return parseCompanyIndustryRecomputeRun(
        await this.mutate("companies:markIndustryRecomputeRunSuperseded", {
          runId: current.runId,
          ...(nonEmptyString(revisionState.currentRevisionId)
            ? {
                observedRevisionId: nonEmptyString(
                  revisionState.currentRevisionId,
                )!,
              }
            : {}),
        }),
      );
    }

    const batch = parseBatch(
      await this.query("companies:getNextIndustryRecomputeBatch", {
        runId: current.runId,
      }),
    );
    if (batch?.status === "planned") {
      return this.dispatchBatch(current, batch);
    }
    if (batch?.status === "dispatched") {
      return this.checkBatchReadiness(current, batch);
    }
    if (current.sourceDone) {
      return parseCompanyIndustryRecomputeRun(
        await this.mutate("companies:finalizeIndustryRecomputeRun", {
          runId: current.runId,
        }),
      );
    }

    const pageValue = await this.query(
      "companies:listAffectedResumesByCompany",
      {
        workspaceSlug: current.workspaceSlug,
        companyKey: current.companyKey,
        cursor: current.cursor,
        limit: 200,
      },
    );
    if (
      !isRecord(pageValue) ||
      !Array.isArray(pageValue.items) ||
      typeof pageValue.continueCursor !== "string" ||
      typeof pageValue.isDone !== "boolean"
    ) {
      throw new Error("Invalid affected-resume page");
    }
    const items = pageValue.items.map((item) => {
      if (!isRecord(item) || !nonEmptyString(item.resumeId)) {
        throw new Error("Invalid affected-resume link");
      }
      return {
        resumeId: nonEmptyString(item.resumeId)!,
        ...(nonEmptyString(item.currentVerdictRevisionId)
          ? {
              currentVerdictRevisionId: nonEmptyString(
                item.currentVerdictRevisionId,
              )!,
            }
          : {}),
      };
    });
    return parseCompanyIndustryRecomputeRun(
      await this.mutate("companies:reserveIndustryRecomputePage", {
        runId: current.runId,
        expectedCursor: current.cursor ?? "",
        items,
        continueCursor: pageValue.continueCursor,
        isDone: pageValue.isDone,
      }),
    );
  }

  private async dispatchBatch(
    run: CompanyIndustryRecomputeRun,
    batch: CompanyIndustryRecomputeBatch,
  ): Promise<CompanyIndustryRecomputeRun> {
    const expectedSkillsVersion = this.dependencies.getSkillsVersion();
    try {
      // Capture before executing: readiness compares resume `computedAt`
      // against `dispatchedAt`, so the timestamp must predate the reingest.
      const dispatchedAt = Date.now();
      const value = await this.action("ingest_agent:runExactReingestSync", {
        workspaceSlug: run.workspaceSlug,
        resumeIds: batch.resumeIds,
      });
      if (
        !isRecord(value) ||
        value.processed !== batch.resumeIds.length ||
        value.error !== null ||
        value.requested !== batch.resumeIds.length
      ) {
        throw new Error("Exact reingest returned inconsistent targets");
      }
      return parseCompanyIndustryRecomputeRun(
        await this.mutate(
          "companies:recordIndustryRecomputeBatchDispatch",
          {
            runId: run.runId,
            batchId: batch.batchId,
            dispatchedAt,
            expectedSkillsVersion,
          },
        ),
      );
    } catch (error) {
      return parseCompanyIndustryRecomputeRun(
        await this.mutate("companies:recordIndustryRecomputeBatchFailure", {
          runId: run.runId,
          batchId: batch.batchId,
          stage: "dispatch",
          message: error instanceof Error ? error.message : String(error),
        }),
      );
    }
  }

  private async checkBatchReadiness(
    run: CompanyIndustryRecomputeRun,
    batch: CompanyIndustryRecomputeBatch,
  ): Promise<CompanyIndustryRecomputeRun> {
    if (
      batch.dispatchedAt === undefined ||
      batch.expectedSkillsVersion === undefined
    ) {
      return parseCompanyIndustryRecomputeRun(
        await this.mutate("companies:recordIndustryRecomputeBatchFailure", {
          runId: run.runId,
          batchId: batch.batchId,
          stage: "readiness",
          message: "Dispatched batch is missing readiness metadata",
        }),
      );
    }

    let readiness: unknown;
    try {
      readiness = await this.query("ingest_agent:getExactReingestReadiness", {
        workspaceSlug: run.workspaceSlug,
        resumeIds: batch.resumeIds,
        dispatchedAt: batch.dispatchedAt,
        expectedSkillsVersion: batch.expectedSkillsVersion,
        expectedCompanyKey: run.companyKey,
        expectedVerdictRevisionId: run.targetRevisionId,
      });
    } catch (error) {
      return parseCompanyIndustryRecomputeRun(
        await this.mutate("companies:recordIndustryRecomputeBatchFailure", {
          runId: run.runId,
          batchId: batch.batchId,
          stage: "readiness_query",
          message: error instanceof Error ? error.message : String(error),
        }),
      );
    }
    if (
      !isRecord(readiness) ||
      !Array.isArray(readiness.targets) ||
      typeof readiness.pending !== "number"
    ) {
      throw new Error("Invalid exact reingest readiness response");
    }
    if (readiness.pending > 0) {
      return run;
    }

    const readyResumeIds: string[] = [];
    const failures: Array<{
      resumeId: string;
      stage: string;
      message: string;
    }> = [];
    for (const target of readiness.targets) {
      if (
        !isRecord(target) ||
        !nonEmptyString(target.currentResumeId) ||
        (target.state !== "ready" &&
          target.state !== "pending" &&
          target.state !== "invalid") ||
        !Array.isArray(target.reasons)
      ) {
        throw new Error("Invalid exact reingest readiness target");
      }
      const resumeId = nonEmptyString(target.currentResumeId)!;
      if (target.state === "ready") {
        readyResumeIds.push(resumeId);
      } else {
        failures.push({
          resumeId,
          stage: "readiness",
          message:
            target.reasons.filter(
              (reason): reason is string => typeof reason === "string",
            ).join(",") || target.state,
        });
      }
    }

    const recorded = parseCompanyIndustryRecomputeRun(
      await this.mutate("companies:recordIndustryRecomputeBatchReadiness", {
        runId: run.runId,
        batchId: batch.batchId,
        readyResumeIds,
        failures,
      }),
    );
    if (!recorded.sourceDone) return recorded;
    return parseCompanyIndustryRecomputeRun(
      await this.mutate("companies:finalizeIndustryRecomputeRun", {
        runId: run.runId,
      }),
    );
  }
}

export const companyIndustryRecomputeService =
  new CompanyIndustryRecomputeService();
