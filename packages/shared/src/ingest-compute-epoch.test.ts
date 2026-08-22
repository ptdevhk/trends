import { describe, expect, it } from "vitest";
import {
  CURRENT_INGEST_COMPUTE_EPOCH,
  INGEST_COMPUTE_EPOCH_HISTORY,
  SEARCH_FRESHNESS_GOLDEN_QUERIES,
  isComputeStale,
  isEvidenceProjectionStale,
  isIngestStale,
  isSkillsStale,
  shouldSelectForReingest,
} from "./ingest-compute-epoch.js";

describe("ingest-compute-epoch", () => {
  it("exposes a positive current epoch from the registry tail", () => {
    expect(CURRENT_INGEST_COMPUTE_EPOCH).toBeGreaterThanOrEqual(1);
    expect(INGEST_COMPUTE_EPOCH_HISTORY.at(-1)?.epoch).toBe(CURRENT_INGEST_COMPUTE_EPOCH);
  });

  it("treats missing ingestData and missing epoch as compute-stale", () => {
    expect(isComputeStale(undefined)).toBe(true);
    expect(isComputeStale(null)).toBe(true);
    expect(isComputeStale({ skillsVersion: 9 })).toBe(true);
    expect(isComputeStale({ skillsVersion: 9, ingestComputeEpoch: null })).toBe(true);
  });

  it("skillsVersion current but epoch lagging is compute-stale and not skills-stale", () => {
    const row = {
      skillsVersion: 9,
      ingestComputeEpoch: CURRENT_INGEST_COMPUTE_EPOCH - 1,
    };
    // When current is 1, lag with 0
    const lagging = {
      skillsVersion: 9,
      ingestComputeEpoch: 0,
    };
    expect(isComputeStale(lagging, CURRENT_INGEST_COMPUTE_EPOCH)).toBe(true);
    expect(isSkillsStale(lagging, 9)).toBe(false);
    expect(isIngestStale(lagging, 9)).toBe(true);
    expect(shouldSelectForReingest(lagging, "compute", 9)).toBe(true);
    expect(shouldSelectForReingest(lagging, "skills", 9)).toBe(false);
    expect(shouldSelectForReingest(lagging, "any", 9)).toBe(true);

    if (CURRENT_INGEST_COMPUTE_EPOCH > 1) {
      expect(isComputeStale(row)).toBe(true);
    }
  });

  it("current epoch is not compute-stale", () => {
    const row = {
      skillsVersion: 9,
      ingestComputeEpoch: CURRENT_INGEST_COMPUTE_EPOCH,
    };
    expect(isComputeStale(row)).toBe(false);
    expect(shouldSelectForReingest(row, "compute", 9)).toBe(false);
    expect(shouldSelectForReingest(row, "any", 9)).toBe(false);
  });

  it("skills-stale rows are selected for skills and any modes", () => {
    const row = {
      skillsVersion: 1,
      ingestComputeEpoch: CURRENT_INGEST_COMPUTE_EPOCH,
    };
    expect(isSkillsStale(row, 9)).toBe(true);
    expect(isComputeStale(row)).toBe(false);
    expect(shouldSelectForReingest(row, "skills", 9)).toBe(true);
    expect(shouldSelectForReingest(row, "compute", 9)).toBe(false);
    expect(shouldSelectForReingest(row, "any", 9)).toBe(true);
  });

  it("appends epoch 2 for the global verified-only role-year projection change", () => {
    expect(INGEST_COMPUTE_EPOCH_HISTORY).toContainEqual(
      expect.objectContaining({
        epoch: 2,
        introduced: "2026-07-28",
      }),
    );
  });

  it("appends epoch 3 for revision-backed evidence projections", () => {
    expect(CURRENT_INGEST_COMPUTE_EPOCH).toBeGreaterThanOrEqual(3);
    expect(INGEST_COMPUTE_EPOCH_HISTORY).toContainEqual(
      expect.objectContaining({
        epoch: 3,
        introduced: "2026-07-29",
      }),
    );
  });

  it("appends epoch 4 for CJK search digest materialization", () => {
    expect(CURRENT_INGEST_COMPUTE_EPOCH).toBeGreaterThanOrEqual(4);
    expect(INGEST_COMPUTE_EPOCH_HISTORY.at(-1)).toMatchObject({
      epoch: 4,
      introduced: "2026-08-19",
    });
    expect(INGEST_COMPUTE_EPOCH_HISTORY.at(-1)?.reason).toContain("CJK");
  });

  it("tracks evidence projection freshness independently from compute and skills versions", () => {
    const current = {
      skillsVersion: 9,
      ingestComputeEpoch: CURRENT_INGEST_COMPUTE_EPOCH,
      evidenceProjectionVersion: 1,
    };

    expect(isEvidenceProjectionStale(current, 1)).toBe(false);
    expect(isEvidenceProjectionStale({ ...current, evidenceProjectionVersion: 0 }, 1)).toBe(true);
    expect(isEvidenceProjectionStale({ ...current, evidenceProjectionVersion: undefined }, 1)).toBe(true);
    expect(isEvidenceProjectionStale(undefined, 1)).toBe(true);
  });

  it("drops the MY search floor to semantic availability while keeping a high CN floor", () => {
    const my = SEARCH_FRESHNESS_GOLDEN_QUERIES.find((query) => query.id === "my-cnc-sales-minRoleYears");
    const cn = SEARCH_FRESHNESS_GOLDEN_QUERIES.find((query) => query.id === "cn-cnc-sales-minRoleYears");

    expect(my?.minTotalFloor).toBe(1);
    expect(cn?.minTotalFloor).toBe(100);
  });
});
