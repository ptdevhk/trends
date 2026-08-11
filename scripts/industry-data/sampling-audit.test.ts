import { describe, expect, it } from "vitest";

import { deterministicSample, riskWeight } from "./sampling-audit.js";

function revision(overrides: Record<string, unknown> = {}) {
  return {
    revisionId: "auto-abc123",
    companyKey: "acme-cnc",
    industryClass: "cnc",
    verificationLevel: "verified",
    approvedSourceIds: ["source-1", "source-2"],
    evidenceSummary: "Registry evidence.",
    reviewedBy: "auto-verify-bot",
    reviewedAt: 1,
    decisionReason: "Governed Lane A auto-approval: structured registry evidence with explicit CNC text.",
    taxonomyVersion: "industry-v1",
    createdAt: 1,
    ...overrides,
  };
}

describe("sampling-audit risk weighting", () => {
  it("weights single-source and corroborating-only revisions higher", () => {
    const multiSource = revision({ approvedSourceIds: ["source-1", "source-2"] });
    const singleSource = revision({ approvedSourceIds: ["source-1"] });
    const corroborating = revision({
      decisionReason: "corroborating registry evidence",
    });

    expect(riskWeight(singleSource)).toBeGreaterThan(riskWeight(multiSource));
    expect(riskWeight(corroborating)).toBeGreaterThan(riskWeight(multiSource));
  });
});

describe("sampling-audit deterministic sample", () => {
  it("samples ~10% of revisions deterministically", () => {
    const revisions = Array.from({ length: 100 }, (_, i) =>
      revision({ revisionId: `auto-${i}`, createdAt: i }),
    );
    const first = deterministicSample(revisions, 0.1);
    const second = deterministicSample(revisions, 0.1);

    expect(first.length).toBe(10);
    expect(second.map((r) => r.revisionId)).toEqual(
      first.map((r) => r.revisionId),
    );
  });

  it("always samples at least one revision when revisions exist", () => {
    const revisions = [revision()];
    expect(deterministicSample(revisions, 0.1)).toHaveLength(1);
  });

  it("returns an empty sample for an empty revision list", () => {
    expect(deterministicSample([], 0.1)).toEqual([]);
  });
});
