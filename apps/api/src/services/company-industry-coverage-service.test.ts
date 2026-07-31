import { describe, expect, it } from "vitest";

import { parseIndustryCoverageSummary } from "./company-industry-coverage-service.js";

describe("parseIndustryCoverageSummary", () => {
  it("parses a full coverage snapshot", () => {
    const parsed = parseIndustryCoverageSummary({
      generatedAt: 1_700_000_000_000,
      workspaceSlug: "dev",
      proposalsByStatus: {
        new: 427,
        researching: 0,
        ready_for_review: 0,
        needs_more_evidence: 60,
        approved: 16,
        rejected: 3,
        superseded: 3,
      },
      openTotal: 487,
      openWithSources: 0,
      openWithoutSources: 487,
      emptyEvidenceBottleneck: true,
      readyBacklogBottleneck: true,
      resumes: { total: 83, withVerifiedEvidence: 1 },
      profiles: { total: 9, verified: 4, rejected: 5 },
      maintenance: {
        latest: {
          runId: "run-fail",
          status: "failed",
          triggerSource: "restore",
          failureMessage: "fetch failed",
          operatorSummary: "failed; worker unreachable.",
          startedAt: 10,
          counts: {
            proposalsResearched: 0,
            readyCreated: 0,
            sourcesDemoted: 0,
            freshnessChecked: 0,
            freshnessRefreshed: 0,
            errors: 0,
          },
        },
        lastUseful: {
          runId: "run-useful",
          status: "completed",
          triggerSource: "manual",
          operatorSummary: "completed; 0 ready, 0 demoted, 0 refreshed.",
          startedAt: 5,
          counts: {
            proposalsResearched: 20,
            readyCreated: 0,
            sourcesDemoted: 0,
            freshnessChecked: 0,
            freshnessRefreshed: 0,
            errors: 0,
          },
        },
        lastFailed: {
          runId: "run-fail",
          status: "failed",
          triggerSource: "restore",
          failureMessage: "fetch failed",
          operatorSummary: "failed; worker unreachable.",
          startedAt: 10,
          counts: {
            proposalsResearched: 0,
            readyCreated: 0,
            sourcesDemoted: 0,
            freshnessChecked: 0,
            freshnessRefreshed: 0,
            errors: 0,
          },
        },
      },
    });

    expect(parsed).toMatchObject({
      workspaceSlug: "dev",
      openTotal: 487,
      openWithSources: 0,
      emptyEvidenceBottleneck: true,
      readyBacklogBottleneck: true,
      resumes: { total: 83, withVerifiedEvidence: 1 },
      profiles: { verified: 4, rejected: 5 },
      maintenance: {
        lastUseful: {
          runId: "run-useful",
          counts: { proposalsResearched: 20, readyCreated: 0 },
        },
        lastFailed: {
          runId: "run-fail",
          failureMessage: "fetch failed",
        },
      },
    });
    expect(parsed?.proposalsByStatus.new).toBe(427);
  });

  it("rejects invalid payloads", () => {
    expect(parseIndustryCoverageSummary(null)).toBeNull();
    expect(parseIndustryCoverageSummary({ openTotal: 1 })).toBeNull();
  });
});
