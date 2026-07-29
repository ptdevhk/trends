import { describe, expect, it } from "vitest";

import {
  buildMyBootstrapPlan,
  buildMyBootstrapRollbackPacket,
} from "./my-bootstrap-plan.js";

const input = {
  companyKey: " ACME CNC SDN BHD ",
  employerName: "ACME CNC Sdn. Bhd.",
  industryClass: "cnc" as const,
  verificationLevel: "verified" as const,
  evidenceSummary: "Official product catalog confirms CNC machine tools.",
  decisionReason: "Reviewed official primary source.",
  taxonomyVersion: "industry-v1",
  sources: [
    {
      url: "https://acme.example:443/products/cnc",
      sourceType: "official_site" as const,
      trustTier: "primary" as const,
      title: "CNC products",
    },
  ],
};

describe("MY bootstrap planning", () => {
  it("creates deterministic proposal, source, and immutable revision IDs", () => {
    const first = buildMyBootstrapPlan([input], "2026-07-29T00:00:00.000Z");
    const second = buildMyBootstrapPlan([input], "2026-07-30T00:00:00.000Z");

    expect(first.companies[0]).toMatchObject({
      companyKey: "acme-cnc-sdn-bhd",
      proposalId: expect.stringMatching(/^my-bootstrap-[a-f0-9]{24}$/),
      revisionId: expect.stringMatching(/^my-rev-[a-f0-9]{24}$/),
      sources: [
        expect.objectContaining({
          sourceId: expect.stringMatching(/^my-src-[a-f0-9]{24}$/),
          url: "https://acme.example/products/cnc",
          sourceDomain: "acme.example",
        }),
      ],
    });
    expect(second.companies[0]?.proposalId).toBe(
      first.companies[0]?.proposalId,
    );
    expect(second.companies[0]?.revisionId).toBe(
      first.companies[0]?.revisionId,
    );
  });

  it("rejects unsafe, discovery-only, duplicate, and source-less approvals", () => {
    expect(() =>
      buildMyBootstrapPlan([
        {
          ...input,
          sources: [{ ...input.sources[0], url: "http://127.0.0.1/private" }],
        },
      ]),
    ).toThrow("Invalid public evidence URL");

    expect(() =>
      buildMyBootstrapPlan([
        {
          ...input,
          sources: [
            {
              ...input.sources[0],
              sourceType: "search_result" as never,
              trustTier: "discovery" as never,
            },
          ],
        },
      ]),
    ).toThrow("discovery source type");

    expect(() => buildMyBootstrapPlan([{ ...input, sources: [] }])).toThrow(
      "requires at least one approved source",
    );
    expect(() => buildMyBootstrapPlan([input, input])).toThrow(
      "Duplicate bootstrap companyKey",
    );
  });

  it("produces a non-destructive rollback packet that preserves prior truth", () => {
    const plan = buildMyBootstrapPlan([input], "2026-07-29T00:00:00.000Z");
    const company = plan.companies[0]!;
    const packet = buildMyBootstrapRollbackPacket(
      plan,
      [
        {
          companyKey: company.companyKey,
          currentRevisionId: "revision-before",
          profile: { verificationLevel: "verified" },
        },
      ],
      [
        {
          companyKey: company.companyKey,
          proposalId: company.proposalId,
          revisionId: company.revisionId,
          sourceIds: company.sources.map((source) => source.sourceId),
          success: true,
        },
      ],
      "2026-07-29T01:00:00.000Z",
    );

    expect(packet.mode).toBe("compensating_revision_required");
    expect(packet.warning).toContain("immutable");
    expect(packet.entries[0]).toMatchObject({
      previousCurrentRevisionId: "revision-before",
      importedRevisionId: company.revisionId,
      applySucceeded: true,
    });
  });
});
