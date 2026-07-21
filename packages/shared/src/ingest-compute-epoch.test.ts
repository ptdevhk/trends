import { describe, expect, it } from "vitest";
import {
  CURRENT_INGEST_COMPUTE_EPOCH,
  INGEST_COMPUTE_EPOCH_HISTORY,
  isComputeStale,
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
});
