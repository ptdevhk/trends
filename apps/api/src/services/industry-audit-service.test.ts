import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  query: vi.fn(),
}));

vi.mock("./convex-utils.js", () => ({
  callConvexQuery: mocks.query,
}));

vi.mock("./config.js", () => ({
  config: { auth: { convexWriteSecret: "test-secret" } },
}));

import {
  defaultListLedger,
  listTimeline,
  type AuditServiceDeps,
} from "./industry-audit-service.js";

describe("listTimeline (unified audit merge)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("merges data_edit + maintenance kinds, newest-first", async () => {
    const deps: AuditServiceDeps = {
      listChanges: async () => [
        {
          changeId: "chg-1",
          entryType: "brand",
          entryId: "brand-1",
          action: "update",
          actor: "admin-1",
          companyKey: "acme",
          gitSha: "abc123",
          createdAt: 1000,
        },
      ],
      listLedger: async () => [
        {
          runId: "run-1",
          proposalId: "p-1",
          companyKey: "acme",
          action: "needs_more_evidence",
          reason: "Research found 0 sources",
          _creationTime: 2000,
        },
      ],
    };

    const items = await listTimeline(
      { companyKey: "acme", workspaceSlug: "hr", limit: 50 },
      deps,
    );

    expect(items).toHaveLength(2);
    // Newest first: maintenance at 2000, then data_edit at 1000
    expect(items[0].kind).toBe("maintenance");
    expect(items[0].runId).toBe("run-1");
    expect(items[0].action).toBe("needs_more_evidence");
    expect(items[0].companyKey).toBe("acme");
    expect(items[1].kind).toBe("data_edit");
    expect(items[1].changeId).toBe("chg-1");
    expect(items[1].gitSha).toBe("abc123");
    expect(items[1].actor).toBe("admin-1");
  });

  it("forwards workspaceSlug into listLedger (required by Convex runs query)", async () => {
    const listLedger = vi.fn(async () => []);
    const listChanges = vi.fn(async () => []);
    await listTimeline(
      { workspaceSlug: "hr", companyKey: "lung-kee" },
      { listChanges, listLedger },
    );
    expect(listLedger).toHaveBeenCalledWith({
      companyKey: "lung-kee",
      limit: 50,
      workspaceSlug: "hr",
    });
    expect(listChanges).toHaveBeenCalledWith({
      companyKey: "lung-kee",
      limit: 50,
    });
  });

  it("rejects empty workspaceSlug", async () => {
    await expect(
      listTimeline({ workspaceSlug: "  " }, {
        listChanges: async () => [],
        listLedger: async () => [],
      }),
    ).rejects.toThrow(/workspaceSlug/);
  });
});

describe("defaultListLedger (production path via callConvexQuery)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("calls listIndustryMaintenanceRuns WITH workspaceSlug, then ledger per run", async () => {
    mocks.query.mockImplementation(async (path: string, args: Record<string, unknown>) => {
      if (path === "companies:listIndustryMaintenanceRuns") {
        expect(args.workspaceSlug).toBe("hr");
        expect(args.writeSecret).toBe("test-secret");
        return [{ runId: "run-a" }, { runId: "run-b" }];
      }
      if (path === "companies:listIndustryMaintenanceLedger") {
        if (args.runId === "run-a") {
          return [
            {
              runId: "run-a",
              proposalId: "p-1",
              companyKey: "acme",
              action: "ready",
              reason: "two sources",
              _creationTime: 3000,
            },
            {
              runId: "run-a",
              proposalId: "p-2",
              companyKey: "other",
              action: "demoted",
              reason: "homepage only",
              _creationTime: 2500,
            },
          ];
        }
        return [
          {
            runId: "run-b",
            proposalId: "p-3",
            companyKey: "acme",
            action: "needs_more_evidence",
            reason: "0 sources",
            _creationTime: 1000,
          },
        ];
      }
      throw new Error(`unexpected path ${path}`);
    });

    const rows = await defaultListLedger({
      companyKey: "acme",
      limit: 50,
      workspaceSlug: "hr",
    });

    // Filtered to acme only (other dropped)
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.companyKey === "acme")).toBe(true);
    // Newest first
    expect(rows[0].runId).toBe("run-a");
    expect(rows[0].action).toBe("ready");
    expect(rows[1].runId).toBe("run-b");

    const runCalls = mocks.query.mock.calls.filter(
      (c) => c[0] === "companies:listIndustryMaintenanceRuns",
    );
    expect(runCalls).toHaveLength(1);
    expect(runCalls[0][1]).toMatchObject({
      workspaceSlug: "hr",
      writeSecret: "test-secret",
      limit: 50,
    });

    const ledgerCalls = mocks.query.mock.calls.filter(
      (c) => c[0] === "companies:listIndustryMaintenanceLedger",
    );
    expect(ledgerCalls).toHaveLength(2);
    expect(ledgerCalls.map((c) => c[1].runId).sort()).toEqual(["run-a", "run-b"]);
  });

  it("end-to-end default deps: listTimeline merges via real defaultListLedger + listChanges", async () => {
    mocks.query.mockImplementation(async (path: string, args: Record<string, unknown>) => {
      if (path === "companies:listIndustryDataChanges") {
        return [
          {
            changeId: "chg-x",
            entryType: "company",
            entryId: "company-1",
            action: "create",
            actor: "admin",
            companyKey: "acme",
            createdAt: 500,
            gitSha: "deadbeef",
          },
        ];
      }
      if (path === "companies:listIndustryMaintenanceRuns") {
        // THIS is the regression guard for the skeptic bug:
        // workspaceSlug must be present or Convex ArgumentValidationError.
        if (typeof args.workspaceSlug !== "string" || !args.workspaceSlug) {
          throw new Error(
            "ArgumentValidationError: workspaceSlug is required",
          );
        }
        return [{ runId: "run-z" }];
      }
      if (path === "companies:listIndustryMaintenanceLedger") {
        return [
          {
            runId: "run-z",
            proposalId: "p-z",
            companyKey: "acme",
            action: "researched",
            reason: "ok",
            _creationTime: 900,
          },
        ];
      }
      return [];
    });

    // No injected deps → production defaultDeps path (callConvexQuery).
    const items = await listTimeline({
      workspaceSlug: "hr",
      companyKey: "acme",
    });

    expect(items.map((i) => i.kind).sort()).toEqual(["data_edit", "maintenance"]);
    expect(items[0].kind).toBe("maintenance"); // 900 > 500
    expect(items[1].kind).toBe("data_edit");
    expect(items[1].gitSha).toBe("deadbeef");

    const runsCall = mocks.query.mock.calls.find(
      (c) => c[0] === "companies:listIndustryMaintenanceRuns",
    );
    expect(runsCall?.[1]).toMatchObject({ workspaceSlug: "hr" });
  });
});
