/**
 * Integration tests for daily_reports Convex mutations/queries.
 */
import { createTest } from "./test-helpers.js";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { api } from "../convex/_generated/api.js";

const WRITE_SECRET = "test-secret";
const originalWriteSecret = process.env.CONVEX_WRITE_SECRET;

beforeEach(() => {
  process.env.CONVEX_WRITE_SECRET = WRITE_SECRET;
});

afterEach(() => {
  if (originalWriteSecret === undefined) {
    delete process.env.CONVEX_WRITE_SECRET;
    return;
  }
  process.env.CONVEX_WRITE_SECRET = originalWriteSecret;
});

describe("daily_reports (convex-test)", () => {
  it("rejects upsert without write secret", async () => {
    const t = createTest();
    await expect(
      t.mutation(api.daily_reports.upsertReport, {
        date: "2026-09-23",
        packJson: "{}",
        html: "<html></html>",
        source: "live",
        builtAt: Date.now(),
      }),
    ).rejects.toThrow("Unauthorized Convex write");
  });

  it("creates a report on first upsert", async () => {
    const t = createTest();
    const builtAt = Date.now();
    const result = await t.mutation(api.daily_reports.upsertReport, {
      writeSecret: WRITE_SECRET,
      date: "2026-09-23",
      packJson: '{"meta":"live"}',
      html: "<html>live</html>",
      source: "live",
      builtAt,
    });
    expect(result.created).toBe(true);

    const row = await t.query(api.daily_reports.getByDate, {
      writeSecret: WRITE_SECRET,
      date: "2026-09-23",
    });
    expect(row).not.toBeNull();
    expect(row!.date).toBe("2026-09-23");
    expect(row!.packJson).toBe('{"meta":"live"}');
    expect(row!.html).toBe("<html>live</html>");
    expect(row!.source).toBe("live");
    expect(row!.builtAt).toBe(builtAt);
  });

  it("patches an existing report idempotently by date", async () => {
    const t = createTest();
    const builtAtFirst = Date.now();
    const first = await t.mutation(api.daily_reports.upsertReport, {
      writeSecret: WRITE_SECRET,
      date: "2026-09-22",
      packJson: '{"meta":"first"}',
      html: "<html>first</html>",
      source: "live",
      builtAt: builtAtFirst,
    });
    expect(first.created).toBe(true);

    const builtAtSecond = builtAtFirst + 1000;
    const second = await t.mutation(api.daily_reports.upsertReport, {
      writeSecret: WRITE_SECRET,
      date: "2026-09-22",
      packJson: '{"meta":"second"}',
      html: "<html>second</html>",
      source: "frozen",
      fallbackFromDate: "2026-09-20",
      builtAt: builtAtSecond,
    });
    expect(second.created).toBe(false);
    expect(second.id).toBe(first.id);

    const row = await t.query(api.daily_reports.getByDate, {
      writeSecret: WRITE_SECRET,
      date: "2026-09-22",
    });
    expect(row).not.toBeNull();
    expect(row!.packJson).toBe('{"meta":"second"}');
    expect(row!.html).toBe("<html>second</html>");
    expect(row!.source).toBe("frozen");
    expect(row!.fallbackFromDate).toBe("2026-09-20");
    expect(row!.builtAt).toBe(builtAtSecond);
  });

  it("rejects read queries without read secret", async () => {
    const t = createTest();
    await expect(
      t.query(api.daily_reports.getByDate, {
        date: "2026-09-23",
      }),
    ).rejects.toThrow("Unauthorized Convex read");

    await expect(t.query(api.daily_reports.listDates, {})).rejects.toThrow(
      "Unauthorized Convex read",
    );
  });

  it("returns null for getByDate when no report exists", async () => {
    const t = createTest();
    const row = await t.query(api.daily_reports.getByDate, {
      writeSecret: WRITE_SECRET,
      date: "2025-01-01",
    });
    expect(row).toBeNull();
  });

  it("lists dates sorted descending with source and builtAt", async () => {
    const t = createTest();
    await t.mutation(api.daily_reports.upsertReport, {
      writeSecret: WRITE_SECRET,
      date: "2026-09-21",
      packJson: "{}",
      html: "<html>21</html>",
      source: "frozen",
      builtAt: 1,
    });
    await t.mutation(api.daily_reports.upsertReport, {
      writeSecret: WRITE_SECRET,
      date: "2026-09-23",
      packJson: "{}",
      html: "<html>23</html>",
      source: "live",
      builtAt: 3,
    });
    await t.mutation(api.daily_reports.upsertReport, {
      writeSecret: WRITE_SECRET,
      date: "2026-09-22",
      packJson: "{}",
      html: "<html>22</html>",
      source: "live",
      builtAt: 2,
    });

    const list = await t.query(api.daily_reports.listDates, {
      writeSecret: WRITE_SECRET,
    });
    expect(list.map((r) => r.date)).toEqual(["2026-09-23", "2026-09-22", "2026-09-21"]);
    expect(list[0]).toEqual({
      date: "2026-09-23",
      source: "live",
      builtAt: 3,
    });
  });
});
