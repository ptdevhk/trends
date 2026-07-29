/**
 * Integration tests for web_research.ts (provider quota ledger).
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

describe("web_research quota (convex-test)", () => {
  it("rejects getQuota without write secret", async () => {
    const t = createTest();
    await expect(
      t.query(api.web_research.getQuota, {
        provider: "duckduckgo",
        month: "2026-07",
        writeSecret: "wrong-secret",
      }),
    ).rejects.toThrow("Unauthorized Convex read");
  });

  it("returns default quota for an unseen provider+month", async () => {
    const t = createTest();
    const quota = await t.query(api.web_research.getQuota, {
      provider: "duckduckgo",
      month: "2026-07",
      writeSecret: WRITE_SECRET,
    });
    expect(quota).toEqual({ used: 0, cap: 1000, month: "2026-07" });
  });

  it("rejects recordUse without write secret", async () => {
    const t = createTest();
    await expect(
      t.mutation(api.web_research.recordUse, {
        provider: "tavily",
        month: "2026-07",
        credits: 3,
        writeSecret: "wrong-secret",
      }),
    ).rejects.toThrow("Unauthorized Convex write");
  });

  it("inserts a new row then increments on repeat recordUse", async () => {
    const t = createTest();
    const first = await t.mutation(api.web_research.recordUse, {
      provider: "tavily",
      month: "2026-07",
      credits: 3,
      writeSecret: WRITE_SECRET,
    });
    expect(first).toEqual({ used: 3, cap: 1000, month: "2026-07" });

    const second = await t.mutation(api.web_research.recordUse, {
      provider: "tavily",
      month: "2026-07",
      credits: 2,
      writeSecret: WRITE_SECRET,
    });
    expect(second).toEqual({ used: 5, cap: 1000, month: "2026-07" });

    const quota = await t.query(api.web_research.getQuota, {
      provider: "tavily",
      month: "2026-07",
      writeSecret: WRITE_SECRET,
    });
    expect(quota).toEqual({ used: 5, cap: 1000, month: "2026-07" });
  });

  it("tracks different months for the same provider independently", async () => {
    const t = createTest();
    await t.mutation(api.web_research.recordUse, {
      provider: "brave",
      month: "2026-07",
      credits: 10,
      writeSecret: WRITE_SECRET,
    });
    await t.mutation(api.web_research.recordUse, {
      provider: "brave",
      month: "2026-08",
      credits: 4,
      writeSecret: WRITE_SECRET,
    });

    const july = await t.query(api.web_research.getQuota, {
      provider: "brave",
      month: "2026-07",
      writeSecret: WRITE_SECRET,
    });
    expect(july).toEqual({ used: 10, cap: 1000, month: "2026-07" });

    const august = await t.query(api.web_research.getQuota, {
      provider: "brave",
      month: "2026-08",
      writeSecret: WRITE_SECRET,
    });
    expect(august).toEqual({ used: 4, cap: 1000, month: "2026-08" });
  });
});
