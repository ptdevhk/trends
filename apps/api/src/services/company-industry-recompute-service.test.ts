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
    const service = new CompanyIndustryRecomputeService(
      dependencies({ query, mutate }),
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
    expect(query).not.toHaveBeenCalledWith(
      "companies:listAffectedResumesByCompany",
      expect.objectContaining({ workspaceSlug: "other" }),
    );
  });

  it("dispatches reserved batches through exact reingest and records durable dispatch metadata", async () => {
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
    const mutate = vi.fn(async (path: string) => {
      if (path === "ingest_agent:scheduleExactReingest") {
        return {
          requested: 2,
          resolved: 2,
          scheduled: 2,
          batches: 1,
          resumeIds: ["resume-1", "resume-2"],
          dispatchedAt: 150,
        };
      }
      if (path === "companies:recordIndustryRecomputeBatchDispatch") {
        return run({
          status: "waiting",
          scheduledCount: 2,
          batchCount: 1,
        });
      }
      throw new Error(`Unexpected mutation: ${path}`);
    });
    const service = new CompanyIndustryRecomputeService(
      dependencies({ query, mutate }),
    );

    const result = await service.advance("run-1");

    expect(mutate).toHaveBeenCalledWith(
      "ingest_agent:scheduleExactReingest",
      expect.objectContaining({
        workspaceSlug: "hr",
        resumeIds: ["resume-1", "resume-2"],
      }),
    );
    expect(mutate).toHaveBeenCalledWith(
      "companies:recordIndustryRecomputeBatchDispatch",
      expect.objectContaining({
        batchId: "run-1:1:1",
        dispatchedAt: 150,
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
      "ingest_agent:scheduleExactReingest",
      expect.anything(),
    );
  });

  it("returns the same run for idempotent start and exposes retry state", async () => {
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
      dependencies({ mutate }),
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
      "ingest_agent:scheduleExactReingest",
      expect.anything(),
    );
  });
});
