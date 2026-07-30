import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { api } from "../convex/_generated/api.js";
import { createTest } from "./test-helpers.js";

const WRITE_SECRET = "test-secret";
const originalWriteSecret = process.env.CONVEX_WRITE_SECRET;

beforeEach(() => {
  process.env.CONVEX_WRITE_SECRET = WRITE_SECRET;
});

afterEach(() => {
  if (originalWriteSecret === undefined) {
    delete process.env.CONVEX_WRITE_SECRET;
  } else {
    process.env.CONVEX_WRITE_SECRET = originalWriteSecret;
  }
});

describe("industry maintenance run registry", () => {
  it("runs the full lifecycle: start -> claim -> append ledger -> finish -> list -> get", async () => {
    const t = createTest();

    await t.mutation(api.companies.startIndustryMaintenanceRun, {
      runId: "run-t1",
      workspaceSlug: "dev",
      triggerSource: "manual",
      triggerContext: "operator smoke test",
      writeSecret: WRITE_SECRET,
    });

    const claimed = await t.mutation(
      api.companies.claimNextIndustryMaintenanceRun,
      { runId: "run-t1", writeSecret: WRITE_SECRET },
    );
    expect(claimed).toBe(true);

    // Re-claiming an already-running run returns false (coalescing guard).
    const reclaimed = await t.mutation(
      api.companies.claimNextIndustryMaintenanceRun,
      { runId: "run-t1", writeSecret: WRITE_SECRET },
    );
    expect(reclaimed).toBe(false);

    await t.mutation(api.companies.appendIndustryMaintenanceLedger, {
      runId: "run-t1",
      proposalId: "p-1",
      companyKey: "acme",
      action: "ready",
      reason: "ready_for_review",
      writeSecret: WRITE_SECRET,
    });
    await t.mutation(api.companies.appendIndustryMaintenanceLedger, {
      runId: "run-t1",
      proposalId: "p-2",
      companyKey: "acme-2",
      action: "demoted",
      reason: "homepage-only evidence, demoted pre-fetch",
      writeSecret: WRITE_SECRET,
    });

    await t.mutation(api.companies.finishIndustryMaintenanceRun, {
      runId: "run-t1",
      status: "completed",
      counts: {
        proposalsResearched: 2,
        readyCreated: 1,
        sourcesDemoted: 1,
        freshnessChecked: 0,
        freshnessRefreshed: 0,
        errors: 0,
      },
      operatorSummary: "completed; 1 ready, 1 demoted.",
      writeSecret: WRITE_SECRET,
    });

    const run = await t.query(api.companies.getIndustryMaintenanceRun, {
      runId: "run-t1",
      writeSecret: WRITE_SECRET,
    });
    expect(run).not.toBeNull();
    expect(run?.status).toBe("completed");
    expect(run?.triggerSource).toBe("manual");
    expect(run?.finishedAt).toBeTypeOf("number");
    expect(run?.counts.readyCreated).toBe(1);

    const ledger = await t.query(api.companies.listIndustryMaintenanceLedger, {
      runId: "run-t1",
      writeSecret: WRITE_SECRET,
    });
    expect(ledger).toHaveLength(2);
    // Newest-first: "demoted" was appended last, so it sorts first.
    expect(ledger[0].action).toBe("demoted");
    expect(ledger[1].action).toBe("ready");

    const listed = await t.query(api.companies.listIndustryMaintenanceRuns, {
      workspaceSlug: "dev",
      writeSecret: WRITE_SECRET,
    });
    expect(listed).toHaveLength(1);
    expect(listed[0].runId).toBe("run-t1");
  });

  it("lists ledger rows by proposalId across runs", async () => {
    const t = createTest();
    for (const runId of ["run-a", "run-b"]) {
      await t.mutation(api.companies.startIndustryMaintenanceRun, {
        runId,
        workspaceSlug: "dev",
        triggerSource: "restore",
        writeSecret: WRITE_SECRET,
      });
      await t.mutation(api.companies.claimNextIndustryMaintenanceRun, {
        runId,
        writeSecret: WRITE_SECRET,
      });
      await t.mutation(api.companies.appendIndustryMaintenanceLedger, {
        runId,
        proposalId: "shared-proposal",
        action: "researched",
        reason: "no candidate sources -> discovery",
        writeSecret: WRITE_SECRET,
      });
      await t.mutation(api.companies.finishIndustryMaintenanceRun, {
        runId,
        status: "completed",
        operatorSummary: "completed.",
        writeSecret: WRITE_SECRET,
      });
    }

    const rows = await t.query(api.companies.listIndustryMaintenanceLedger, {
      proposalId: "shared-proposal",
      writeSecret: WRITE_SECRET,
    });
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.proposalId === "shared-proposal")).toBe(true);
  });

  it("findActiveIndustryMaintenanceRun returns the newest queued/running run or null", async () => {
    const t = createTest();
    expect(
      await t.query(api.companies.findActiveIndustryMaintenanceRun, {
        workspaceSlug: "dev",
        writeSecret: WRITE_SECRET,
      }),
    ).toBeNull();

    await t.mutation(api.companies.startIndustryMaintenanceRun, {
      runId: "run-active",
      workspaceSlug: "dev",
      triggerSource: "schedule",
      writeSecret: WRITE_SECRET,
    });
    const active = await t.query(api.companies.findActiveIndustryMaintenanceRun, {
      workspaceSlug: "dev",
      writeSecret: WRITE_SECRET,
    });
    expect(active?.runId).toBe("run-active");
    expect(active?.status).toBe("queued");
  });

  it("rejects writes without the write secret", async () => {
    const t = createTest();
    await expect(
      t.mutation(api.companies.startIndustryMaintenanceRun, {
        runId: "run-secret",
        workspaceSlug: "dev",
        triggerSource: "manual",
      }),
    ).rejects.toThrow();
  });

  it("records a skipped run when maintenance mode is active", async () => {
    const t = createTest();
    await t.mutation(api.companies.startIndustryMaintenanceRun, {
      runId: "run-skip",
      workspaceSlug: "dev",
      triggerSource: "schedule",
      writeSecret: WRITE_SECRET,
    });
    await t.mutation(api.companies.finishIndustryMaintenanceRun, {
      runId: "run-skip",
      status: "skipped",
      failureMessage: "maintenance mode active",
      operatorSummary: "skipped; maintenance mode active",
      writeSecret: WRITE_SECRET,
    });
    const run = await t.query(api.companies.getIndustryMaintenanceRun, {
      runId: "run-skip",
      writeSecret: WRITE_SECRET,
    });
    expect(run?.status).toBe("skipped");
    expect(run?.failureMessage).toBe("maintenance mode active");
  });
});
