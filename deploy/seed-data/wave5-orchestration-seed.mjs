#!/usr/bin/env node
// Preview-only fifth-wave MY/TH company-industry approve.
// Same Convex mutation chain as wave1/wave2/wave3/wave4. Reviewer: orchestration-wave5.
// Write secret is never printed. Do not commit unless later owned.
import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";

const require = createRequire(import.meta.url);
const { ConvexClient } = require("convex/browser");

const REVIEWER = "orchestration-wave5";
const ACK_REASON =
  "Preview-only wave5 MY/TH catalog approve: official_site CNC evidence fetched for each employer; machineOrigin unknown unless the official page states import vs domestic.";

const planPath = process.argv[2];
if (!planPath) {
  console.error("SEED_FATAL: usage: wave5-orchestration-seed.mjs <plan.json>");
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
if (!Array.isArray(companies) || companies.length === 0 || companies.length > 10) {
  console.error("SEED_FATAL: plan must contain 1..10 companies");
  process.exit(2);
}

const isAlreadyExists = (err) => /already exists/i.test(String(err?.message ?? err));
const client = new ConvexClient(CONVEX_URL);
let seededSources = 0;
let approved = 0;
let skippedExisting = 0;

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
      machineOrigin,
      sources,
    } = company;

    console.error(`WAVE5_STEP companyKey=${companyKey} class=${industryClass}`);
    if (!Array.isArray(sources) || sources.length === 0) {
      throw new Error(`no sources for ${companyKey}`);
    }
    for (const source of sources) {
      const url = String(source.url || "");
      if (!url.startsWith("https://") || /example\.com/i.test(url)) {
        throw new Error(`forbidden evidence URL for ${companyKey}: ${url}`);
      }
    }

    await client.mutation("companies:upsert", {
      companyKey,
      displayName: employerName,
      status: "confirmed",
      createdBy: REVIEWER,
      writeSecret: WS,
    });

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
      if (!isAlreadyExists(err)) throw err;
    }

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
      if (source.title) args.title = source.title;
      if (source.evidenceExcerpt) args.evidenceExcerpt = source.evidenceExcerpt;
      await client.mutation("companies:upsertIndustryEvidenceSource", args);
      seededSources += 1;
    }

    const approveArgs = {
      proposalId,
      revisionId,
      verificationLevel,
      industryClass,
      approvedSourceIds: sources.map((s) => s.sourceId),
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
    };
    if (machineOrigin) approveArgs.machineOrigin = machineOrigin;

    try {
      await client.mutation("companies:approveIndustryProposal", approveArgs);
      approved += 1;
    } catch (err) {
      const msg = String(err?.message ?? err);
      if (
        isAlreadyExists(err) ||
        /not open for approval.*approved/i.test(msg)
      ) {
        skippedExisting += 1;
      } else {
        throw err;
      }
    }
  }

  const rows = await client.query("companies:list", { writeSecret: WS });
  const keys = new Set((rows || []).map((r) => r.companyKey));
  const missing = companies.map((c) => c.companyKey).filter((k) => !keys.has(k));
  if (missing.length > 0) {
    console.error(`SEED_FATAL: companies:list missing ${missing.join(", ")}`);
    process.exit(1);
  }
  console.log(
    `SEED_OK wave=5 reviewer=${REVIEWER} companies=${companies.length} approved=${approved} skippedExisting=${skippedExisting} sources=${seededSources} catalog=${(rows || []).length}`,
  );
  process.exit(0);
} catch (err) {
  console.error(`SEED_FATAL: run: ${String(err?.message ?? err)}`);
  process.exit(1);
} finally {
  await client.close();
}
