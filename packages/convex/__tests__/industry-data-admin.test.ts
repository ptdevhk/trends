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

describe("industry data admin CRUD + change log", () => {
  it("runs the full lifecycle: upsert -> append change -> list -> update -> set gitSha -> list newest-first -> delete", async () => {
    const t = createTest();

    const created = await t.mutation(api.companies.upsertIndustryDataEntry, {
      entryType: "company",
      entryId: "company-acme",
      data: { key: "acme", name: "Acme Manufacturing" },
      sortOrder: 10,
      actor: "admin@test",
      writeSecret: WRITE_SECRET,
    });
    expect(created.entryId).toBe("company-acme");

    await t.mutation(api.companies.appendIndustryDataChange, {
      changeId: "change-1",
      entryType: "company",
      entryId: "company-acme",
      action: "create",
      actor: "admin@test",
      after: { key: "acme", name: "Acme Manufacturing" },
      companyKey: "acme",
      writeSecret: WRITE_SECRET,
    });

    const entry = await t.query(api.companies.getIndustryDataEntry, {
      entryId: "company-acme",
      writeSecret: WRITE_SECRET,
    });
    expect(entry).not.toBeNull();
    expect(entry?.entryType).toBe("company");
    expect(entry?.data).toEqual({ key: "acme", name: "Acme Manufacturing" });
    expect(entry?.sortOrder).toBe(10);
    expect(entry?.updatedBy).toBe("admin@test");
    expect(entry?.createdAt).toBeTypeOf("number");
    expect(entry?.updatedAt).toBeTypeOf("number");

    const listed = await t.query(api.companies.listIndustryDataEntries, {
      entryType: "company",
      writeSecret: WRITE_SECRET,
    });
    expect(listed).toHaveLength(1);
    expect(listed[0].entryId).toBe("company-acme");

    // Upsert with the same entryId patches in place (no duplicate row).
    const updated = await t.mutation(api.companies.upsertIndustryDataEntry, {
      entryType: "company",
      entryId: "company-acme",
      data: { key: "acme", name: "Acme Manufacturing Sdn Bhd" },
      sortOrder: 5,
      actor: "editor@test",
      writeSecret: WRITE_SECRET,
    });
    expect(updated.entryId).toBe("company-acme");

    const afterUpdate = await t.query(api.companies.getIndustryDataEntry, {
      entryId: "company-acme",
      writeSecret: WRITE_SECRET,
    });
    expect(afterUpdate?.data).toEqual({
      key: "acme",
      name: "Acme Manufacturing Sdn Bhd",
    });
    expect(afterUpdate?.sortOrder).toBe(5);
    expect(afterUpdate?.updatedBy).toBe("editor@test");
    expect(afterUpdate?.updatedAt).toBeGreaterThanOrEqual(
      afterUpdate?.createdAt ?? 0,
    );

    await t.mutation(api.companies.appendIndustryDataChange, {
      changeId: "change-2",
      entryType: "company",
      entryId: "company-acme",
      action: "update",
      actor: "editor@test",
      before: { key: "acme", name: "Acme Manufacturing" },
      after: { key: "acme", name: "Acme Manufacturing Sdn Bhd" },
      companyKey: "acme",
      writeSecret: WRITE_SECRET,
    });

    const shaResult = await t.mutation(
      api.companies.setIndustryDataChangeGitSha,
      {
        changeId: "change-2",
        gitSha: "abc123def",
        writeSecret: WRITE_SECRET,
      },
    );
    expect(shaResult.ok).toBe(true);

    const changes = await t.query(api.companies.listIndustryDataChanges, {
      entryId: "company-acme",
      writeSecret: WRITE_SECRET,
    });
    expect(changes).toHaveLength(2);
    // Newest-first: "change-2" was appended last, so it sorts first.
    expect(changes[0].changeId).toBe("change-2");
    expect(changes[0].action).toBe("update");
    expect(changes[0].gitSha).toBe("abc123def");
    expect(changes[1].changeId).toBe("change-1");
    expect(changes[1].action).toBe("create");
    expect(changes[1].gitSha).toBeUndefined();

    // Filter by companyKey.
    const byCompany = await t.query(api.companies.listIndustryDataChanges, {
      companyKey: "acme",
      writeSecret: WRITE_SECRET,
    });
    expect(byCompany).toHaveLength(2);

    await t.mutation(api.companies.appendIndustryDataChange, {
      changeId: "change-3",
      entryType: "company",
      entryId: "company-acme",
      action: "delete",
      actor: "admin@test",
      before: { key: "acme", name: "Acme Manufacturing Sdn Bhd" },
      companyKey: "acme",
      writeSecret: WRITE_SECRET,
    });

    const deleted = await t.mutation(api.companies.deleteIndustryDataEntry, {
      entryId: "company-acme",
      actor: "admin@test",
      writeSecret: WRITE_SECRET,
    });
    expect(deleted.ok).toBe(true);

    const afterDelete = await t.query(api.companies.getIndustryDataEntry, {
      entryId: "company-acme",
      writeSecret: WRITE_SECRET,
    });
    expect(afterDelete).toBeNull();

    const listedAfterDelete = await t.query(
      api.companies.listIndustryDataEntries,
      { entryType: "company", writeSecret: WRITE_SECRET },
    );
    expect(listedAfterDelete).toHaveLength(0);

    // Change log survives the entry delete and stays newest-first.
    const changesAfterDelete = await t.query(
      api.companies.listIndustryDataChanges,
      { entryId: "company-acme", writeSecret: WRITE_SECRET },
    );
    expect(changesAfterDelete).toHaveLength(3);
    expect(changesAfterDelete[0].changeId).toBe("change-3");
    expect(changesAfterDelete[0].action).toBe("delete");
  });

  it("lists entries across types and by type filter", async () => {
    const t = createTest();
    await t.mutation(api.companies.upsertIndustryDataEntry, {
      entryType: "keyword",
      entryId: "keyword-cnc",
      data: { keyword: "cnc", label: "CNC" },
      actor: "admin@test",
      writeSecret: WRITE_SECRET,
    });
    await t.mutation(api.companies.upsertIndustryDataEntry, {
      entryType: "brand",
      entryId: "brand-haas",
      data: { brand: "Haas" },
      actor: "admin@test",
      writeSecret: WRITE_SECRET,
    });

    const all = await t.query(api.companies.listIndustryDataEntries, {
      writeSecret: WRITE_SECRET,
    });
    expect(all).toHaveLength(2);

    const keywords = await t.query(api.companies.listIndustryDataEntries, {
      entryType: "keyword",
      writeSecret: WRITE_SECRET,
    });
    expect(keywords).toHaveLength(1);
    expect(keywords[0].entryId).toBe("keyword-cnc");
  });

  it("rejects writes without the write secret", async () => {
    const t = createTest();
    await expect(
      t.mutation(api.companies.upsertIndustryDataEntry, {
        entryType: "company",
        entryId: "company-nope",
        data: { key: "nope" },
        actor: "admin@test",
      }),
    ).rejects.toThrow();
    await expect(
      t.mutation(api.companies.deleteIndustryDataEntry, {
        entryId: "company-nope",
        actor: "admin@test",
      }),
    ).rejects.toThrow();
    await expect(
      t.mutation(api.companies.appendIndustryDataChange, {
        changeId: "change-nope",
        entryType: "company",
        entryId: "company-nope",
        action: "create",
        actor: "admin@test",
      }),
    ).rejects.toThrow();
    await expect(
      t.mutation(api.companies.setIndustryDataChangeGitSha, {
        changeId: "change-nope",
        gitSha: "abc",
      }),
    ).rejects.toThrow();
    await expect(
      t.mutation(api.companies.setIndustryMaintenanceSchedulePaused, {
        paused: true,
      }),
    ).rejects.toThrow();
  });

  it("toggles the industry maintenance schedule-pause flag false -> true", async () => {
    const t = createTest();

    // Missing setting row defaults to not-paused.
    const initial = await t.query(
      api.companies.getIndustryMaintenanceSchedulePaused,
      { writeSecret: WRITE_SECRET },
    );
    expect(initial.paused).toBe(false);

    const setResult = await t.mutation(
      api.companies.setIndustryMaintenanceSchedulePaused,
      { paused: true, writeSecret: WRITE_SECRET },
    );
    expect(setResult.paused).toBe(true);

    const after = await t.query(
      api.companies.getIndustryMaintenanceSchedulePaused,
      { writeSecret: WRITE_SECRET },
    );
    expect(after.paused).toBe(true);

    const unsetResult = await t.mutation(
      api.companies.setIndustryMaintenanceSchedulePaused,
      { paused: false, writeSecret: WRITE_SECRET },
    );
    expect(unsetResult.paused).toBe(false);

    const final = await t.query(
      api.companies.getIndustryMaintenanceSchedulePaused,
      { writeSecret: WRITE_SECRET },
    );
    expect(final.paused).toBe(false);
  });
});
