import { describe, expect, it, vi } from "vitest";

import {
  CompanyIndustryRecomputeService,
  type CompanyIndustryRecomputeDependencies,
  type CompanyIndustryRecomputeRun,
} from "./company-industry-recompute-service.js";

function run(
  overrides: Partial<CompanyIndustryRecomputeRun> = {},
): CompanyIndustryRecomputeRun {
  return {
    runId: "run-1",
    workspaceSlug: "hr",
    companyKey: "acme-cnc",
    targetRevisionId: "revision-2",
    status: "queued",
    attempt: 1,
    pageCount: 0,
    affectedCount: 0,
    alreadyCurrentCount: 0,
    scheduledCount: 0,
    readyCount: 0,
    failureCount: 0,
    batchCount: 0,
    sourceDone: false,
    failures: [],
    createdAt: 100,
    updatedAt: 100,
    operatorSummary: "queued; 0/0 ready, 0 scheduled.",
    ...overrides,
  };
}

function dependencies(
  overrides: Partial<CompanyIndustryRecomputeDependencies> = {},
): CompanyIndustryRecomputeDependencies {
  return {
    createRunId: () => "run-1",
    getSkillsVersion: () => 7,
    query: vi.fn(),
    mutate: vi.fn(),
    action: vi.fn(),
    ...overrides,
  };
}

function backfillCompleted(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    status: "completed",
    companyKey: "acme-cnc",
    scannedRows: 0,
    matchedRows: 0,
    linkedRows: 0,
    cursor: null,
    isDone: true,
    ...overrides,
  };
}

describe("CompanyIndustryRecomputeService", () => {
  it("pages the exact affected company/workspace set and schedules only stale resume IDs", async () => {
    const query = vi.fn(async (path: string, args: Record<string, unknown>) => {
      if (path === "companies:getIndustryRecomputeRun") {
        return run();
      }
      if (path === "companies:getNextIndustryRecomputeBatch") {
        return null;
      }
      if (path === "companies:getIndustryRecomputeRevisionState") {
        return {
          currentRevisionId: "revision-2",
          matchesTargetRevision: true,
        };
      }
      if (path === "companies:listAffectedResumesByCompany") {
        expect(args).toMatchObject({
          workspaceSlug: "hr",
          companyKey: "acme-cnc",
          limit: 200,
        });
        return {
          items: [
            {
              resumeId: "resume-stale",
              currentVerdictRevisionId: "revision-1",
            },
            {
              resumeId: "resume-current",
              currentVerdictRevisionId: "revision-2",
            },
          ],
          continueCursor: "cursor-2",
          isDone: true,
        };
      }
      throw new Error(`Unexpected query: ${path}`);
    });
    const mutate = vi.fn(async (path: string, args: Record<string, unknown>) => {
      if (path === "companies:startIndustryRecomputeRun") {
        return run();
      }
      if (path === "companies:reserveIndustryRecomputePage") {
        expect(args.items).toEqual([
          {
            resumeId: "resume-stale",
            currentVerdictRevisionId: "revision-1",
          },
          {
            resumeId: "resume-current",
            currentVerdictRevisionId: "revision-2",
          },
        ]);
        return run({
          status: "running",
          sourceDone: true,
          affectedCount: 2,
          alreadyCurrentCount: 1,
        });
      }
      throw new Error(`Unexpected mutation: ${path}`);
    });
    const action = vi.fn(async (path: string) => {
      if (path === "companies:backfillCompanyResumeLinksByCompanySync") {
        return backfillCompleted();
      }
      throw new Error(`Unexpected action: ${path}`);
    });
    const service = new CompanyIndustryRecomputeService(
      dependencies({ query, mutate, action }),
    );

    const result = await service.start({
      workspaceSlug: "hr",
      companyKey: "acme-cnc",
      targetRevisionId: "revision-2",
      proposalId: "proposal-1",
      requestedBy: "operator@example.com",
      advance: true,
    });

    expect(result).toMatchObject({
      runId: "run-1",
      affectedCount: 2,
      alreadyCurrentCount: 1,
    });
    expect(action).toHaveBeenCalledWith(
      "companies:backfillCompanyResumeLinksByCompanySync",
      expect.objectContaining({
        companyKey: "acme-cnc",
        writeSecret: expect.any(String),
      }),
    );
    expect(query).not.toHaveBeenCalledWith(
      "companies:listAffectedResumesByCompany",
      expect.objectContaining({ workspaceSlug: "other" }),
    );
  });

  it("dispatches reserved batches through synchronous exact reingest and records durable dispatch metadata", async () => {
    const query = vi.fn(async (path: string) => {
      if (path === "companies:getIndustryRecomputeRun") {
        return run({ status: "running", sourceDone: true });
      }
      if (path === "companies:getNextIndustryRecomputeBatch") {
        return {
          batchId: "run-1:1:1",
          runId: "run-1",
          status: "planned",
          resumeIds: ["resume-1", "resume-2"],
          createdAt: 101,
          updatedAt: 101,
        };
      }
      if (path === "companies:getIndustryRecomputeRevisionState") {
        return {
          currentRevisionId: "revision-2",
          matchesTargetRevision: true,
        };
      }
      throw new Error(`Unexpected query: ${path}`);
    });
    let actionCalledAt = 0;
    const action = vi.fn(async (path: string) => {
      if (path === "ingest_agent:runExactReingestSync") {
        actionCalledAt = Date.now();
        return { processed: 2, error: null, requested: 2 };
      }
      throw new Error(`Unexpected action: ${path}`);
    });
    const mutate = vi.fn(async (path: string, args: Record<string, unknown>) => {
      if (path === "companies:recordIndustryRecomputeBatchDispatch") {
        expect(typeof args.dispatchedAt).toBe("number");
        expect(args.dispatchedAt).toBeLessThanOrEqual(actionCalledAt);
        return run({
          status: "waiting",
          scheduledCount: 2,
          batchCount: 1,
        });
      }
      throw new Error(`Unexpected mutation: ${path}`);
    });
    const service = new CompanyIndustryRecomputeService(
      dependencies({ query, mutate, action }),
    );

    const result = await service.advance("run-1");

    expect(action).toHaveBeenCalledWith(
      "ingest_agent:runExactReingestSync",
      expect.objectContaining({
        workspaceSlug: "hr",
        resumeIds: ["resume-1", "resume-2"],
        writeSecret: expect.any(String),
      }),
    );
    expect(mutate).toHaveBeenCalledWith(
      "companies:recordIndustryRecomputeBatchDispatch",
      expect.objectContaining({
        batchId: "run-1:1:1",
        dispatchedAt: expect.any(Number),
        expectedSkillsVersion: 7,
      }),
    );
    expect(result.status).toBe("waiting");
  });

  it("reports partial readiness failures without redispatching a dispatched batch", async () => {
    const query = vi.fn(async (path: string) => {
      if (path === "companies:getIndustryRecomputeRun") {
        return run({ status: "waiting", sourceDone: true, scheduledCount: 2 });
      }
      if (path === "companies:getNextIndustryRecomputeBatch") {
        return {
          batchId: "run-1:1:1",
          runId: "run-1",
          status: "dispatched",
          resumeIds: ["resume-ready", "resume-invalid"],
          dispatchedAt: 150,
          expectedSkillsVersion: 7,
          createdAt: 101,
          updatedAt: 150,
        };
      }
      if (path === "companies:getIndustryRecomputeRevisionState") {
        return {
          currentRevisionId: "revision-2",
          matchesTargetRevision: true,
        };
      }
      if (path === "ingest_agent:getExactReingestReadiness") {
        return {
          allReady: false,
          ready: 1,
          pending: 0,
          invalid: 1,
          checkedAt: 200,
          dispatchedAt: 150,
          expectedSkillsVersion: 7,
          targets: [
            {
              currentResumeId: "resume-ready",
              state: "ready",
              phase2FieldsPresent: true,
              reasons: [],
            },
            {
              currentResumeId: "resume-invalid",
              state: "invalid",
              phase2FieldsPresent: false,
              reasons: ["resume_missing"],
            },
          ],
        };
      }
      throw new Error(`Unexpected query: ${path}`);
    });
    const mutate = vi.fn(async (path: string, args: Record<string, unknown>) => {
      if (path === "companies:recordIndustryRecomputeBatchReadiness") {
        expect(args).toMatchObject({
          readyResumeIds: ["resume-ready"],
          failures: [
            {
              resumeId: "resume-invalid",
              stage: "readiness",
              message: "resume_missing",
            },
          ],
        });
        return run({
          status: "running",
          sourceDone: true,
          readyCount: 1,
          failureCount: 1,
        });
      }
      if (path === "companies:finalizeIndustryRecomputeRun") {
        return run({
          status: "partial_failed",
          sourceDone: true,
          readyCount: 1,
          failureCount: 1,
        });
      }
      throw new Error(`Unexpected mutation: ${path}`);
    });
    const service = new CompanyIndustryRecomputeService(
      dependencies({ query, mutate }),
    );

    const result = await service.advance("run-1");

    expect(result.status).toBe("partial_failed");
    expect(mutate).not.toHaveBeenCalledWith(
      "ingest_agent:runExactReingestSync",
      expect.anything(),
    );
  });

  it("returns the same run for idempotent start and exposes retry state", async () => {
    const action = vi.fn(async () => {
      throw new Error(`Unexpected action`);
    });
    const mutate = vi.fn(async (path: string) => {
      if (path === "companies:startIndustryRecomputeRun") {
        return run({ runId: "existing-run", status: "waiting" });
      }
      if (path === "companies:retryIndustryRecomputeRun") {
        return run({
          runId: "existing-run",
          status: "queued",
          attempt: 2,
        });
      }
      throw new Error(`Unexpected mutation: ${path}`);
    });
    const service = new CompanyIndustryRecomputeService(
      dependencies({ mutate, action }),
    );

    const started = await service.start({
      workspaceSlug: "hr",
      companyKey: "acme-cnc",
      targetRevisionId: "revision-2",
      advance: false,
    });
    const retried = await service.retry("existing-run", {
      requestedBy: "operator@example.com",
      advance: false,
    });

    expect(started.runId).toBe("existing-run");
    expect(retried).toMatchObject({ runId: "existing-run", attempt: 2 });
    expect(action).not.toHaveBeenCalled();
  });

  it("marks a run superseded instead of dispatching when the current revision changed", async () => {
    const query = vi.fn(async (path: string) => {
      if (path === "companies:getIndustryRecomputeRun") {
        return run({ status: "running" });
      }
      if (path === "companies:getIndustryRecomputeRevisionState") {
        return {
          currentRevisionId: "revision-3",
          matchesTargetRevision: false,
        };
      }
      throw new Error(`Unexpected query: ${path}`);
    });
    const mutate = vi.fn(async (path: string) => {
      if (path === "companies:markIndustryRecomputeRunSuperseded") {
        return run({ status: "superseded" });
      }
      throw new Error(`Unexpected mutation: ${path}`);
    });
    const service = new CompanyIndustryRecomputeService(
      dependencies({ query, mutate }),
    );

    const result = await service.advance("run-1");

    expect(result.status).toBe("superseded");
    expect(mutate).not.toHaveBeenCalledWith(
      "ingest_agent:runExactReingestSync",
      expect.anything(),
    );
  });

  it("backfills company resume links by looping with cursor threading and accumulating counters", async () => {
    const action = vi.fn(async (path: string, args: Record<string, unknown>) => {
      if (path !== "companies:backfillCompanyResumeLinksByCompanySync") {
        throw new Error(`Unexpected action: ${path}`);
      }
      if (args.cursor === undefined) {
        return backfillCompleted({
          status: "continued",
          cursor: "c1",
          isDone: false,
          scannedRows: 100,
          matchedRows: 40,
          linkedRows: 30,
        });
      }
      if (args.cursor === "c1") {
        return backfillCompleted({
          scannedRows: 50,
          matchedRows: 10,
          linkedRows: 5,
        });
      }
      throw new Error(`Unexpected cursor: ${String(args.cursor)}`);
    });
    const service = new CompanyIndustryRecomputeService(
      dependencies({ action }),
    );

    const result = await service.backfillCompanyResumeLinks("acme-cnc");

    expect(action).toHaveBeenCalledTimes(2);
    expect(action).toHaveBeenNthCalledWith(
      1,
      "companies:backfillCompanyResumeLinksByCompanySync",
      expect.objectContaining({
        companyKey: "acme-cnc",
        writeSecret: expect.any(String),
      }),
    );
    expect(action).toHaveBeenNthCalledWith(
      2,
      "companies:backfillCompanyResumeLinksByCompanySync",
      expect.objectContaining({
        companyKey: "acme-cnc",
        cursor: "c1",
      }),
    );
    expect(result).toEqual({
      status: "completed",
      scannedRows: 150,
      matchedRows: 50,
      linkedRows: 35,
      iterations: 2,
    });
  });

  it("throws when the backfill iteration cap is exceeded", async () => {
    const action = vi.fn(async (path: string) => {
      if (path === "companies:backfillCompanyResumeLinksByCompanySync") {
        return backfillCompleted({ status: "continued", cursor: "c1", isDone: false });
      }
      throw new Error(`Unexpected action: ${path}`);
    });
    const service = new CompanyIndustryRecomputeService(
      dependencies({ action }),
    );

    await expect(
      service.backfillCompanyResumeLinks("acme-cnc", { maxIterations: 5 }),
    ).rejects.toThrow(/exceeded 5 iterations/);
    expect(action).toHaveBeenCalledTimes(5);
  });

  it("records a dispatch failure when synchronous exact reingest returns inconsistent targets", async () => {
    const query = vi.fn(async (path: string) => {
      if (path === "companies:getIndustryRecomputeRun") {
        return run({ status: "running", sourceDone: true });
      }
      if (path === "companies:getNextIndustryRecomputeBatch") {
        return {
          batchId: "run-1:1:1",
          runId: "run-1",
          status: "planned",
          resumeIds: ["resume-1", "resume-2"],
          createdAt: 101,
          updatedAt: 101,
        };
      }
      if (path === "companies:getIndustryRecomputeRevisionState") {
        return {
          currentRevisionId: "revision-2",
          matchesTargetRevision: true,
        };
      }
      throw new Error(`Unexpected query: ${path}`);
    });
    const action = vi.fn(async (path: string) => {
      if (path === "ingest_agent:runExactReingestSync") {
        return { processed: 1, error: null, requested: 2 };
      }
      throw new Error(`Unexpected action: ${path}`);
    });
    const mutate = vi.fn(async (path: string, args: Record<string, unknown>) => {
      if (path === "companies:recordIndustryRecomputeBatchFailure") {
        expect(args).toMatchObject({
          runId: "run-1",
          batchId: "run-1:1:1",
          stage: "dispatch",
          message: "Exact reingest returned inconsistent targets",
        });
        return run({ status: "failed", failureCount: 1 });
      }
      throw new Error(`Unexpected mutation: ${path}`);
    });
    const service = new CompanyIndustryRecomputeService(
      dependencies({ query, mutate, action }),
    );

    const result = await service.advance("run-1");

    expect(result.status).toBe("failed");
    expect(mutate).not.toHaveBeenCalledWith(
      "companies:recordIndustryRecomputeBatchDispatch",
      expect.anything(),
    );
  });

  it("returns immediately when the first advance reaches a terminal status", async () => {
    const query = vi.fn(async (path: string) => {
      if (path === "companies:getIndustryRecomputeRun") {
        return run({ status: "completed", sourceDone: true, readyCount: 3 });
      }
      throw new Error(`Unexpected query: ${path}`);
    });
    const service = new CompanyIndustryRecomputeService(
      dependencies({ query }),
    );

    const result = await service.advanceToTerminal("run-1");

    expect(result.status).toBe("completed");
    expect(query).toHaveBeenCalledTimes(1);
  });

  it("advances repeatedly until the run reaches a terminal status", async () => {
    let getCalls = 0;
    const query = vi.fn(async (path: string) => {
      if (path === "companies:getIndustryRecomputeRun") {
        getCalls += 1;
        if (getCalls === 1) {
          return run();
        }
        return run({ status: "running", sourceDone: true, affectedCount: 1 });
      }
      if (path === "companies:getIndustryRecomputeRevisionState") {
        return {
          currentRevisionId: "revision-2",
          matchesTargetRevision: true,
        };
      }
      if (path === "companies:getNextIndustryRecomputeBatch") {
        return null;
      }
      if (path === "companies:listAffectedResumesByCompany") {
        return { items: [], continueCursor: "", isDone: true };
      }
      throw new Error(`Unexpected query: ${path}`);
    });
    const mutate = vi.fn(async (path: string) => {
      if (path === "companies:reserveIndustryRecomputePage") {
        return run({
          status: "running",
          sourceDone: true,
          affectedCount: 1,
          pageCount: 1,
        });
      }
      if (path === "companies:finalizeIndustryRecomputeRun") {
        return run({
          status: "completed",
          sourceDone: true,
          affectedCount: 1,
          readyCount: 1,
        });
      }
      throw new Error(`Unexpected mutation: ${path}`);
    });
    const service = new CompanyIndustryRecomputeService(
      dependencies({ query, mutate }),
    );

    const result = await service.advanceToTerminal("run-1");

    expect(result.status).toBe("completed");
    expect(getCalls).toBe(2);
    expect(mutate).toHaveBeenCalledWith(
      "companies:finalizeIndustryRecomputeRun",
      expect.objectContaining({ runId: "run-1" }),
    );
  });

  it("stops after two consecutive no-progress iterations without error", async () => {
    let getCalls = 0;
    const query = vi.fn(async (path: string) => {
      if (path === "companies:getIndustryRecomputeRun") {
        getCalls += 1;
        return run();
      }
      if (path === "companies:getIndustryRecomputeRevisionState") {
        return {
          currentRevisionId: "revision-2",
          matchesTargetRevision: true,
        };
      }
      if (path === "companies:getNextIndustryRecomputeBatch") {
        return null;
      }
      if (path === "companies:listAffectedResumesByCompany") {
        return { items: [], continueCursor: "", isDone: true };
      }
      throw new Error(`Unexpected query: ${path}`);
    });
    const mutate = vi.fn(async (path: string) => {
      if (path === "companies:reserveIndustryRecomputePage") {
        return run();
      }
      throw new Error(`Unexpected mutation: ${path}`);
    });
    const service = new CompanyIndustryRecomputeService(
      dependencies({ query, mutate }),
    );

    const result = await service.advanceToTerminal("run-1");

    expect(result.status).toBe("queued");
    expect(getCalls).toBe(2);
  });

  it("backfills resume links before advancing when start advances by default", async () => {
    const events: string[] = [];
    const action = vi.fn(async (path: string) => {
      if (path === "companies:backfillCompanyResumeLinksByCompanySync") {
        events.push("backfill");
        return backfillCompleted();
      }
      throw new Error(`Unexpected action: ${path}`);
    });
    const query = vi.fn(async (path: string) => {
      if (path === "companies:getIndustryRecomputeRun") {
        events.push("advance");
        return run({ status: "completed", sourceDone: true });
      }
      throw new Error(`Unexpected query: ${path}`);
    });
    const mutate = vi.fn(async (path: string) => {
      if (path === "companies:startIndustryRecomputeRun") {
        events.push("start");
        return run();
      }
      throw new Error(`Unexpected mutation: ${path}`);
    });
    const service = new CompanyIndustryRecomputeService(
      dependencies({ query, mutate, action }),
    );

    await service.start({
      workspaceSlug: "hr",
      companyKey: "acme-cnc",
      targetRevisionId: "revision-2",
    });

    expect(events).toEqual(["start", "backfill", "advance"]);
  });

  it("skips backfill and advance when start is called with advance false", async () => {
    const action = vi.fn(async (path: string) => {
      throw new Error(`Unexpected action: ${path}`);
    });
    const query = vi.fn(async (path: string) => {
      throw new Error(`Unexpected query: ${path}`);
    });
    const mutate = vi.fn(async (path: string) => {
      if (path === "companies:startIndustryRecomputeRun") {
        return run();
      }
      throw new Error(`Unexpected mutation: ${path}`);
    });
    const service = new CompanyIndustryRecomputeService(
      dependencies({ query, mutate, action }),
    );

    const result = await service.start({
      workspaceSlug: "hr",
      companyKey: "acme-cnc",
      targetRevisionId: "revision-2",
      advance: false,
    });

    expect(result.runId).toBe("run-1");
    expect(action).not.toHaveBeenCalled();
    expect(query).not.toHaveBeenCalled();
  });
});
