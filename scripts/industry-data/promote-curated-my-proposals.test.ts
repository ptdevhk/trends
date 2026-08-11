import { describe, expect, it } from "vitest";

import {
  buildCatalogSourceRecords,
  buildCuratedSourceRecords,
  buildPromotionPlan,
  selectPromotionTargets,
  type CatalogEntry,
  type RawProposal,
} from "./promote-curated-my-proposals.js";
import {
  CURATED,
  fnv1aHex,
  normalizeCompanyKey,
  proposalIdFor,
} from "./curated-my-cohort.js";

/** The 12 curated companies stuck at needs_more_evidence on preview. */
const PINNED_CURATED_PROPOSAL_IDS = [
  "curated-my-nsl-precision-engineering-services-sdn-bhd",
  "curated-my-edge-precision-technology-sdn-bhd",
  "curated-my-leesonmech-engineering-m-sdn-bhd",
  "curated-my-midas-precision-sdn-bhd",
  "curated-my-sfe-machinery-sdn-bhd",
  "curated-my-seng-heng-precision-tools-sdnbhd",
  "curated-my-robo-tech-machinery-sdn-bhd",
  "curated-my-yd-laser-technologies-co-ltd",
  "curated-my-redstar-engineering",
  "curated-my-tem-engineering-jb-sdn-bhd",
  "curated-my-prosdata-engineering",
  "curated-my-cooltech-engineering-sdn-bhd",
];

/** The 5 my-bootstrap-* companyKeys stuck at needs_more_evidence on preview. */
const CATALOG_COHORT_KEYS = [
  "newbillion-precision-metal-sdn-bhd",
  "haas-automation",
  "empower-new-m-sdn-bhd",
  "anoz-aluminiumsuzhoucoltd",
  "adastream-sdn-bhd",
];

function curatedCompanyKey(employer: (typeof CURATED)[number]): string {
  return normalizeCompanyKey(employer.employerName.replace(/,/g, ""));
}

function catalogFixture(): Map<string, CatalogEntry> {
  return new Map(
    CATALOG_COHORT_KEYS.map((key, index) => [
      normalizeCompanyKey(key),
      {
        companyKey: key,
        employerName: `Fixture employer ${index}`,
        sources: [
          {
            url: `https://example.com/source-${index}`,
            sourceType: "registry",
            trustTier: "corroborating",
            title: `Fixture source ${index}`,
            evidenceExcerpt: `Fixture excerpt ${index}`,
          },
        ],
      },
    ]),
  );
}

describe("promote curated MY proposals", () => {
  it("derives exactly the pinned proposalIds for the 12 stuck curated companies", () => {
    const derived = new Set(CURATED.map((e) => proposalIdFor(curatedCompanyKey(e))));
    // No duplicate derived ids across the cohort.
    expect(derived.size).toBe(CURATED.length);

    const pinned = new Set(PINNED_CURATED_PROPOSAL_IDS);
    const intersection = [...derived].filter((id) => pinned.has(id)).sort();
    expect(intersection).toEqual([...PINNED_CURATED_PROPOSAL_IDS].sort());
  });

  it("produces deterministic sourceIds that differ across fingerprints", () => {
    const base = {
      employerName: "Acme Precision Sdn Bhd",
      industryClass: "cnc" as const,
      priority: 50,
    };
    const a = buildCuratedSourceRecords(
      { ...base, evidence: { resumeName: "Person A", jobTitle: "Sales", years: 2, workEntryFingerprint: "work-aaa" } },
      "curated-my-acme",
      "acme-precision-sdn-bhd",
      1,
    );
    const b = buildCuratedSourceRecords(
      { ...base, evidence: { resumeName: "Person B", jobTitle: "Sales", years: 3, workEntryFingerprint: "work-bbb" } },
      "curated-my-acme",
      "acme-precision-sdn-bhd",
      1,
    );
    const aAgain = buildCuratedSourceRecords(
      { ...base, evidence: { resumeName: "Person A", jobTitle: "Sales", years: 2, workEntryFingerprint: "work-aaa" } },
      "curated-my-acme",
      "acme-precision-sdn-bhd",
      999,
    );
    expect(a[0].sourceId).toBe("corpus-src-acme-precision-sdn-bhd-work-aaa");
    expect(a[0].sourceId).toBe(aAgain[0].sourceId); // deterministic across `now`
    expect(a[0].sourceId).not.toBe(b[0].sourceId);
    expect(aAgain[0].fetchedAt).toBe(999);
  });

  it("builds curated records with encoded search URLs, exact title/excerpt, and registry/corroborating/fetched", () => {
    const records = buildCuratedSourceRecords(
      {
        employerName: "NSL PRECISION ENGINEERING SERVICES SDN. BHD.",
        industryClass: "cnc",
        priority: 100,
        evidence: {
          resumeName: "Mohammad Zul Afiq Mohd Amin",
          jobTitle: "CNC Milling Machinist and Sales Engineer",
          years: 9.5,
          workEntryFingerprint: "work-466078df",
        },
      },
      "curated-my-nsl-precision-engineering-services-sdn-bhd",
      "nsl-precision-engineering-services-sdn-bhd",
      1786029579251,
    );
    expect(records).toHaveLength(1);
    expect(records[0]).toEqual({
      sourceId: "corpus-src-nsl-precision-engineering-services-sdn-bhd-work-466078df",
      companyKey: "nsl-precision-engineering-services-sdn-bhd",
      proposalId: "curated-my-nsl-precision-engineering-services-sdn-bhd",
      url: "https://hk.employer.seek.com/talentsearch/profiles/search?searchQuery=Mohammad%20Zul%20Afiq%20Mohd%20Amin&market=MY&pageNumber=1",
      sourceType: "registry",
      trustTier: "corroborating",
      title:
        "CNC corpus evidence: CNC Milling Machinist and Sales Engineer (9.5y) at NSL PRECISION ENGINEERING SERVICES SDN. BHD.",
      evidenceExcerpt: "CNC machining industry sales role: CNC Milling Machinist and Sales Engineer, 9.5y",
      fetchedAt: 1786029579251,
      fetchStatus: "fetched",
      contentFingerprint: "corpus-work-466078df",
    });
  });

  it("falls back to fnv1a(resumeName) for sourceId and contentFingerprint when workEntryFingerprint is missing", () => {
    const records = buildCuratedSourceRecords(
      {
        employerName: "Redstar Engineering",
        industryClass: "cnc",
        priority: 90,
        evidence: { resumeName: "Cheng Yee Hoong", jobTitle: "Sales Manager", years: 5.0 },
      },
      "curated-my-redstar-engineering",
      "redstar-engineering",
      123,
    );
    const fp = fnv1aHex("Cheng Yee Hoong");
    expect(records[0].sourceId).toBe(`corpus-src-redstar-engineering-${fp}`);
    expect(records[0].contentFingerprint).toBe(`corpus-${fp}`);
    expect(records[0].url).toContain("searchQuery=Cheng%20Yee%20Hoong");
  });

  it("passes through catalog source fields, overwrites fetchedAt, and falls back to fnv1a(url)", () => {
    const entry: CatalogEntry = {
      companyKey: "haas-automation",
      sources: [
        {
          url: "https://example.com/h1",
          sourceType: "registry",
          trustTier: "corroborating",
          title: "T1",
          evidenceExcerpt: "E1",
          contentFingerprint: "corpus-work-abc",
        },
        {
          url: "https://example.com/h2",
          sourceType: "registry",
          trustTier: "corroborating",
          title: "T2",
        },
      ],
    };
    const records = buildCatalogSourceRecords(entry, "my-bootstrap-haas", "haas-automation", 42);
    expect(records).toHaveLength(2);
    expect(records[0]).toEqual({
      sourceId: "corpus-src-haas-automation-corpus-work-abc",
      companyKey: "haas-automation",
      proposalId: "my-bootstrap-haas",
      url: "https://example.com/h1",
      sourceType: "registry",
      trustTier: "corroborating",
      title: "T1",
      evidenceExcerpt: "E1",
      fetchedAt: 42,
      fetchStatus: "fetched",
      contentFingerprint: "corpus-work-abc",
    });
    expect(records[1].sourceId).toBe(`corpus-src-haas-automation-${fnv1aHex("https://example.com/h2")}`);
    expect(records[1].contentFingerprint).toBeUndefined();
    expect(records[1].fetchedAt).toBe(42);
  });

  it("selects only needs_more_evidence cohort matches and skips other statuses and non-cohort rows", () => {
    const pinned = new Set(PINNED_CURATED_PROPOSAL_IDS);
    const curatedProposals: RawProposal[] = CURATED.filter((e) =>
      pinned.has(proposalIdFor(curatedCompanyKey(e))),
    ).map((e) => {
      const key = curatedCompanyKey(e);
      return { proposalId: proposalIdFor(key), companyKey: key, status: "needs_more_evidence" };
    });
    expect(curatedProposals).toHaveLength(12);

    const catalogProposals: RawProposal[] = CATALOG_COHORT_KEYS.map((key) => ({
      proposalId: `my-bootstrap-${key}`,
      companyKey: key,
      status: "needs_more_evidence",
    }));

    const skipProposals: RawProposal[] = [
      // Cohort proposal but not open for promotion.
      { proposalId: "curated-my-cnc-automobile", companyKey: "cnc-automobile", status: "ready_for_review" },
      { proposalId: "curated-my-seco-tools-sdn-bhd", companyKey: "seco-tools-sdn-bhd", status: "approved" },
      // Non-cohort proposals stuck at needs_more_evidence.
      { proposalId: "corpus-ft-unrelated", companyKey: "unrelated-machinery-sdn-bhd", status: "needs_more_evidence" },
      { proposalId: "my-bootstrap-not-in-catalog", companyKey: "not-in-catalog-sdn-bhd", status: "needs_more_evidence" },
      // Cohort proposal missing its companyKey.
      { proposalId: "curated-my-redstar-engineering", status: "needs_more_evidence" },
    ];

    const targets = selectPromotionTargets(
      [...curatedProposals, ...catalogProposals, ...skipProposals],
      catalogFixture(),
      123,
    );

    expect(targets).toHaveLength(17);
    const curatedTargetIds = targets
      .filter((t) => t.proposal.proposalId.startsWith("curated-my-"))
      .map((t) => t.proposal.proposalId)
      .sort();
    expect(curatedTargetIds).toEqual([...PINNED_CURATED_PROPOSAL_IDS].sort());
    const catalogTargetIds = targets
      .filter((t) => t.proposal.proposalId.startsWith("my-bootstrap-"))
      .map((t) => t.proposal.proposalId)
      .sort();
    expect(catalogTargetIds).toEqual(CATALOG_COHORT_KEYS.map((k) => `my-bootstrap-${k}`).sort());
    for (const target of targets) {
      expect(target.evidenceSourceRecords.length).toBeGreaterThan(0);
    }
  });

  it("dedupes duplicate proposal rows and proposals matching both cohorts", () => {
    const catalog = new Map<string, CatalogEntry>([
      [
        "seng-heng-precision-tools-sdn.bhd",
        {
          companyKey: "seng-heng-precision-tools-sdn.bhd",
          sources: [
            { url: "https://example.com/catalog", sourceType: "registry", trustTier: "corroborating" },
          ],
        },
      ],
    ]);
    const proposals: RawProposal[] = [
      // Matches BOTH the curated cohort (id + key) and the catalog key.
      {
        proposalId: "curated-my-seng-heng-precision-tools-sdnbhd",
        companyKey: "seng-heng-precision-tools-sdn.bhd",
        status: "needs_more_evidence",
      },
      // Exact duplicate row.
      {
        proposalId: "curated-my-seng-heng-precision-tools-sdnbhd",
        companyKey: "seng-heng-precision-tools-sdn.bhd",
        status: "needs_more_evidence",
      },
    ];
    const targets = selectPromotionTargets(proposals, catalog, 7);
    expect(targets).toHaveLength(1);
    // Curated records win over catalog records for the dual-match.
    expect(targets[0].evidenceSourceRecords[0].title).toContain("Mechanical Designer");
  });

  it("builds an ordered promotion plan with source records", () => {
    const plan = buildPromotionPlan(
      [{ proposalId: "my-bootstrap-haas-automation", companyKey: "haas-automation", status: "needs_more_evidence" }],
      catalogFixture(),
      456,
    );
    expect(plan).toEqual([
      {
        proposalId: "my-bootstrap-haas-automation",
        companyKey: "haas-automation",
        status: "needs_more_evidence",
        sources: [
          expect.objectContaining({
            sourceId: expect.stringMatching(/^corpus-src-haas-automation-/),
            fetchedAt: 456,
            fetchStatus: "fetched",
          }),
        ],
      },
    ]);
  });
});
