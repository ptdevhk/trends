#!/usr/bin/env node
// Deterministic re-seed of the reviewed company-industry catalog on a preview
// Convex backend, replaying the bootstrap plan produced by the July attended
// review (company-industry-seed-plan.json).
//
// Runs INSIDE the preview Convex container (docker exec) where CONVEX_URL
// points at the local backend (127.0.0.1:3210) and the write secret comes
// from the deployment's own env (npx convex env get — never echoed by the
// wrapper). Uses the same mutation chain as the attended bootstrap:
// companies:upsert -> companies:upsertIndustryProposal ->
// companies:upsertIndustryEvidenceSource -> companies:approveIndustryProposal.
//
// Idempotent: a re-run against an already-seeded backend no-ops (a closed
// proposal is skipped, the identical revision is not re-approved, approved
// evidence sources are patched with identical values) and ends with SEED_OK.
// Any divergence fails loudly with SEED_FATAL.
//
// Output contract: prints exactly one terminal line — SEED_OK with counts,
// or SEED_FATAL with step/companyKey/reason. The write secret is never
// printed.
import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";

const require = createRequire(import.meta.url);
const { ConvexClient } = require("convex/browser");

const REVIEWER = "restore-helper";
const ACK_REASON =
  "Preview restore re-seed (fallback B): deterministic replay of the reviewed bootstrap catalog";

const planPath = process.argv[2];
if (!planPath) {
  console.error("SEED_FATAL: usage: seed-company-industry.mjs <plan.json>");
  process.exit(2);
}
const { CONVEX_URL, CONVEX_WRITE_SECRET: WS } = process.env;
if (!CONVEX_URL || !WS) {
  console.error(
    "SEED_FATAL: CONVEX_URL and CONVEX_WRITE_SECRET env vars are required",
  );
  process.exit(2);
}

let plan;
try {
  plan = JSON.parse(await readFile(planPath, "utf8"));
} catch (err) {
  console.error(`SEED_FATAL: cannot read plan ${planPath}: ${err.message}`);
  process.exit(2);
}
const companies = plan?.companies;
if (!Array.isArray(companies) || companies.length === 0) {
  console.error("SEED_FATAL: plan has no companies array");
  process.exit(2);
}

const client = new ConvexClient(CONVEX_URL);
let seededSources = 0;

try {
  for (const company of companies) {
    const {
      companyKey,
      employerName,
      industryClass,
      proposalId,
      revisionId,
      verificationLevel,
      decisionReason,
      taxonomyVersion,
      nextReviewAt,
      evidenceSummary,
      sources,
    } = company;

    // 1) Company row (upsert — idempotent).
    await client.mutation("companies:upsert", {
      companyKey,
      displayName: employerName,
      status: "confirmed",
      createdBy: REVIEWER,
      writeSecret: WS,
    });

    // 2) Review proposal. A closed proposal on a re-run throws
    //    "proposalId already exists" — that is the idempotent case; the
    //    approval below then no-ops (identical revision) or fails loudly.
    try {
      await client.mutation("companies:upsertIndustryProposal", {
        proposalId,
        companyKey,
        triggerReasons: ["missing_approved_profile"],
        priority: 100,
        suggestedIndustryClass: industryClass,
        suggestedVerificationLevel: "verified",
        requestedBy: REVIEWER,
        writeSecret: WS,
      });
    } catch (err) {
      const message = String(err?.message ?? err);
      if (!message.includes("proposalId already exists")) {
        throw err;
      }
    }

    // 3) Evidence sources (upsert — identical values on a re-run patch
    //    nothing material; approved rows stay approved).
    for (const source of sources) {
      const args = {
        sourceId: source.sourceId,
        companyKey,
        proposalId,
        url: source.url,
        sourceType: source.sourceType,
        trustTier: source.trustTier,
        fetchStatus: "fetched",
        suggestedIndustryClass: industryClass,
        writeSecret: WS,
      };
      if (source.title) {
        args.title = source.title;
      }
      if (source.evidenceExcerpt) {
        args.evidenceExcerpt = source.evidenceExcerpt;
      }
      await client.mutation("companies:upsertIndustryEvidenceSource", args);
      seededSources += 1;
    }

    // 4) Approve the verdict (idempotent for the identical revision).
    await client.mutation("companies:approveIndustryProposal", {
      proposalId,
      revisionId,
      verificationLevel,
      industryClass,
      approvedSourceIds: sources.map((source) => source.sourceId),
      evidenceSummary,
      reviewer: REVIEWER,
      decisionReason,
      taxonomyVersion,
      nextReviewAt,
      reviewAttestation: {
        schemaVersion: "industry-review-attestation.v1",
        inputFingerprint: `seed-${revisionId}`,
        decisionMode: "standard",
        acknowledgedRiskFlags: [],
        cncEvidenceAcknowledged: industryClass === "cnc",
        acknowledgementReason: ACK_REASON,
      },
      writeSecret: WS,
    });
  }

  // Smoke: the catalog must be visible through the same read path the
  // cockpit uses (requires the write secret server-side).
  const profiles = await client.query("companies:listIndustryProfiles", {
    writeSecret: WS,
  });
  if (!Array.isArray(profiles) || profiles.length !== companies.length) {
    console.error(
      `SEED_FATAL: smoke companies:listIndustryProfiles expected ${companies.length} profiles, got ${
        Array.isArray(profiles) ? profiles.length : typeof profiles
      }`,
    );
    process.exit(1);
  }
  console.log(`SEED_OK companies=${profiles.length} sources=${seededSources}`);
  process.exit(0);
} catch (err) {
  console.error(`SEED_FATAL: run: ${String(err?.message ?? err)}`);
  process.exit(1);
} finally {
  await client.close();
}
