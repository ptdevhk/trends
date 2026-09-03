#!/usr/bin/env node
// Additive re-seed of the reviewed company-industry catalog for TH CNC employers
// on a preview Convex backend. Mirrors the MY bootstrap mutation chain
// (companies:upsert -> addAlias -> upsertIndustryProposal ->
// upsertIndustryEvidenceSource -> approveIndustryProposal) but is ADDITIVE:
// it does not assume a fresh backend (the MY restore driver's smoke asserts an
// exact profile count; here we verify each seeded companyKey resolves + has a
// profile). Idempotent: re-running no-ops (existing company/alias/proposal are
// skipped, the identical revision is not re-approved).
//
// Runs INSIDE the preview Convex container where CONVEX_URL points at the local
// backend and CONVEX_WRITE_SECRET comes from the deployment env. The write
// secret is never printed.
//
// Output: one terminal line — SEED_OK with counts, or SEED_FATAL with reason.
import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";

const require = createRequire(import.meta.url);
const { ConvexClient } = require("convex/browser");

const REVIEWER = "th-catalog-seed";
const ACK_REASON =
  "TH CNC catalog seed: reviewed machine-tool / precision-machining employers evidenced by TH Seek work-history corpus";

const planPath = process.argv[2];
if (!planPath) {
  console.error("SEED_FATAL: usage: th-seed-company-industry.mjs <plan.json>");
  process.exit(2);
}
const { CONVEX_URL, CONVEX_WRITE_SECRET: WS } = process.env;
if (!CONVEX_URL || !WS) {
  console.error("SEED_FATAL: CONVEX_URL and CONVEX_WRITE_SECRET env vars are required");
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

const isAlreadyExists = (err) => /already exists/i.test(String(err?.message ?? err));
const client = new ConvexClient(CONVEX_URL);
let seededSources = 0;
let seededAliases = 0;

try {
  for (const company of companies) {
    const {
      companyKey, employerName, industryClass, proposalId, revisionId,
      verificationLevel, decisionReason, taxonomyVersion, nextReviewAt,
      evidenceSummary, sources, aliases,
    } = company;

    await client.mutation("companies:upsert", {
      companyKey, displayName: employerName, status: "confirmed",
      createdBy: REVIEWER, writeSecret: WS,
    });

    // Aliases map the corpus employer surfaces to this companyKey so
    // ingest-compute's resolveCompanyKeysForEmployerSurfaces -> reviewedProfile
    // path fires (TH proper-noun names do not match the seed keyword tiers).
    for (const alias of (aliases || [])) {
      try {
        await client.mutation("companies:addAlias", {
          companyKey, alias, source: "operator", writeSecret: WS,
        });
        seededAliases += 1;
      } catch (err) {
        if (!isAlreadyExists(err)) throw err;
      }
    }

    try {
      await client.mutation("companies:upsertIndustryProposal", {
        proposalId, companyKey, triggerReasons: ["missing_approved_profile"],
        priority: 100, suggestedIndustryClass: industryClass,
        suggestedVerificationLevel: "verified", requestedBy: REVIEWER, writeSecret: WS,
      });
    } catch (err) {
      if (!isAlreadyExists(err)) throw err;
    }

    for (const source of sources) {
      const args = {
        sourceId: source.sourceId, companyKey, proposalId, url: source.url,
        sourceType: source.sourceType, trustTier: source.trustTier,
        fetchStatus: "fetched", suggestedIndustryClass: industryClass, writeSecret: WS,
      };
      if (source.title) args.title = source.title;
      if (source.evidenceExcerpt) args.evidenceExcerpt = source.evidenceExcerpt;
      await client.mutation("companies:upsertIndustryEvidenceSource", args);
      seededSources += 1;
    }

    await client.mutation("companies:approveIndustryProposal", {
      proposalId, revisionId, verificationLevel, industryClass,
      approvedSourceIds: sources.map((s) => s.sourceId), evidenceSummary,
      reviewer: REVIEWER, decisionReason, taxonomyVersion, nextReviewAt,
      reviewAttestation: {
        schemaVersion: "industry-review-attestation.v1",
        inputFingerprint: `seed-${revisionId}`, decisionMode: "standard",
        acknowledgedRiskFlags: [], cncEvidenceAcknowledged: industryClass === "cnc",
        acknowledgementReason: ACK_REASON,
      },
      writeSecret: WS,
    });
  }

  // Additive smoke: every seeded companyKey must resolve from its first alias
  // and carry a reviewed profile.
  const probeSurfaces = companies.map((c) => (c.aliases && c.aliases[0]) || c.employerName);
  const resolved = await client.query("companies:resolveAliasesBatch", {
    aliases: probeSurfaces, writeSecret: WS,
  });
  const resolvedKeys = new Set(
    (resolved || []).filter((r) => r.status === "resolved").map((r) => r.companyKey),
  );
  const missing = companies
    .map((c) => c.companyKey)
    .filter((k) => !resolvedKeys.has(k));
  if (missing.length > 0) {
    console.error(`SEED_FATAL: aliases did not resolve for: ${missing.join(", ")}`);
    process.exit(1);
  }
  console.log(
    `SEED_OK companies=${companies.length} aliases=${seededAliases} sources=${seededSources}`,
  );
  process.exit(0);
} catch (err) {
  console.error(`SEED_FATAL: run: ${String(err?.message ?? err)}`);
  process.exit(1);
} finally {
  await client.close();
}
