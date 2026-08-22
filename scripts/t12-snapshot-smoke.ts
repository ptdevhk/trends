/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * p12 live round-trip verification (hr-ops + full profiles, replace + merge modes).
 * Usage: set -a; source .env; set +a && bunx tsx scripts/t12-snapshot-smoke.ts
 * Requires CONVEX_WRITE_SECRET in the environment (gated mutations).
 */
import { ConvexHttpClient } from "convex/browser";
import { api } from "../packages/convex/convex/_generated/api.js";

async function main() {
  const writeSecret = process.env.CONVEX_WRITE_SECRET;
  if (!writeSecret) {
    throw new Error("CONVEX_WRITE_SECRET is not set — source .env before running");
  }
  const client = new ConvexHttpClient("http://127.0.0.1:3210");
  // Dedicated scratch workspace so the smoke never touches dev data.
  const workspaceSlug = "p12-smoke-ws";
  const results: string[] = [];
  let failed = false;
  const check = (name: string, ok: boolean, detail = "") => {
    results.push(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
    if (!ok) failed = true;
  };
  const gated = { writeSecret };

  // 1. Seed a candidate_status + candidate_blocks + workspace_config row.
  await client.mutation(api.candidate_status.upsert as any, {
    workspaceSlug,
    identityKey: "snapshot-smoke-identity-1",
    status: "shortlisted",
    notes: "p12 smoke",
    updatedBy: "p12-smoke",
    ...gated,
  });
  await client.mutation(api.candidate_status.upsert as any, {
    workspaceSlug,
    identityKey: "snapshot-smoke-identity-1",
    status: "hired",
    notes: "p12 smoke update",
    updatedBy: "p12-smoke",
    ...gated,
  });
  await client.mutation(api.candidate_blocks.upsert as any, {
    workspaceSlug,
    identityKey: "snapshot-smoke-identity-2",
    reason: "p12 smoke",
    blockedBy: "p12-smoke",
    ...gated,
  });
  await client.mutation(api.workspace_config.upsert as any, {
    workspaceSlug,
    configKey: "p12-smoke-config",
    configValue: { hello: "world" },
  });
  // Secret-like key must never export nor import.
  await client.mutation(api.workspace_config.upsert as any, {
    workspaceSlug,
    configKey: "p12-smoke-secret-api_token",
    configValue: "should-never-leak",
  });

  // 2. Export hr-ops: must contain status + blocks, no config.
  const hrOps = (await client.query(api.workspace_snapshots.exportWorkspaceSnapshot as any, {
    workspaceSlug,
    profile: "hr-ops",
  })) as any;
  check(
    "hr-ops export contains candidateStatus",
    Array.isArray(hrOps.tables.candidateStatus) && hrOps.tables.candidateStatus.some((r: any) => r.identityKey === "snapshot-smoke-identity-1"),
    `rows=${hrOps.tables.candidateStatus.length}`,
  );
  check(
    "hr-ops export contains candidateBlocks",
    hrOps.tables.candidateBlocks.some((r: any) => r.identityKey === "snapshot-smoke-identity-2"),
  );
  check("hr-ops export excludes workspaceConfig", hrOps.tables.workspaceConfig.length === 0 && hrOps.tables.searchProfiles.length === 0);

  // 3. Export full: config included, secret key stripped.
  const full = (await client.query(api.workspace_snapshots.exportWorkspaceSnapshot as any, {
    workspaceSlug,
    profile: "full",
  })) as any;
  check(
    "full export includes p12-smoke-config",
    full.tables.workspaceConfig.some((r: any) => r.configKey === "p12-smoke-config"),
  );
  check(
    "full export strips secret-like key",
    !full.tables.workspaceConfig.some((r: any) => r.configKey === "p12-smoke-secret-api_token"),
    `configRows=${full.tables.workspaceConfig.length}`,
  );

  // 4. Mutate rows (simulate divergence); replace mode must overwrite them.
  await client.mutation(api.candidate_status.upsert as any, {
    workspaceSlug,
    identityKey: "snapshot-smoke-identity-1",
    status: "rejected",
    notes: "diverged",
    updatedBy: "p12-smoke",
    ...gated,
  });
  await client.mutation(api.workspace_config.upsert as any, {
    workspaceSlug,
    configKey: "p12-smoke-config",
    configValue: { diverged: true },
  });

  // 5. Replace-mode import of the hr-ops envelope.
  const replaceResult = (await client.mutation(api.workspace_snapshots.importWorkspaceSnapshot as any, {
    workspaceSlug,
    profile: "hr-ops",
    mode: "replace",
    tables: {
      candidateStatus: hrOps.tables.candidateStatus,
      candidateBlocks: hrOps.tables.candidateBlocks,
      searchProfiles: [],
      workspaceConfig: [],
    },
  })) as any;
  check("replace import applied rows", replaceResult.applied.candidateStatus >= 1 && replaceResult.applied.candidateBlocks >= 1, JSON.stringify(replaceResult.applied));

  const afterReplace = (await client.query(api.workspace_snapshots.exportWorkspaceSnapshot as any, {
    workspaceSlug,
    profile: "hr-ops",
  })) as any;
  const restored = afterReplace.tables.candidateStatus.find((r: any) => r.identityKey === "snapshot-smoke-identity-1");
  check("replace import restored status", restored?.status === "hired" && restored?.notes === "p12 smoke update", `status=${restored?.status}`);

  // 6. Full-profile replace import also overwrites workspace_config.
  const fullReplace = (await client.mutation(api.workspace_snapshots.importWorkspaceSnapshot as any, {
    workspaceSlug,
    profile: "full",
    mode: "replace",
    tables: full.tables,
  })) as any;
  check("full replace applied", fullReplace.applied.workspaceConfig >= 1 && fullReplace.applied.candidateStatus >= 1);
  const configAfterFull = (await client.query(api.workspace_config.get as any, {
    workspaceSlug,
    configKey: "p12-smoke-config",
  })) as any;
  check("full replace restored config value", configAfterFull?.configValue?.hello === "world", JSON.stringify(configAfterFull?.configValue));
  const secretAfterReplace = (await client.query(api.workspace_config.get as any, {
    workspaceSlug,
    configKey: "p12-smoke-secret-api_token",
  })) as any;
  check("replace import wipes local secret-like row", secretAfterReplace === null, "replace mode replaces the whole table; export-side stripping is what keeps secrets out of envelopes");

  // 6b. A malformed replace-mode envelope must NOT wipe local rows (mutation atomicity).
  await client.mutation(api.candidate_status.upsert as any, {
    workspaceSlug,
    identityKey: "snapshot-smoke-identity-3",
    status: "new",
    updatedBy: "p12-smoke",
    ...gated,
  });
  let malformedReplaceThrew = false;
  try {
    await client.mutation(api.workspace_snapshots.importWorkspaceSnapshot as any, {
      workspaceSlug,
      profile: "hr-ops",
      mode: "replace",
      tables: {
        candidateStatus: [{ status: "hired", updatedAt: Date.now() }],
        candidateBlocks: [],
        searchProfiles: [],
        workspaceConfig: [],
      },
    });
  } catch {
    malformedReplaceThrew = true;
  }
  check("malformed replace import throws", malformedReplaceThrew);
  const afterMalformed = (await client.query(api.workspace_snapshots.exportWorkspaceSnapshot as any, {
    workspaceSlug,
    profile: "hr-ops",
  })) as any;
  check(
    "malformed replace leaves local rows intact",
    afterMalformed.tables.candidateStatus.some((r: any) => r.identityKey === "snapshot-smoke-identity-3"),
    `rows=${afterMalformed.tables.candidateStatus.length}`,
  );

  // 7. Merge mode: insert a new row and re-import the original envelope; new row must survive.
  await client.mutation(api.candidate_status.upsert as any, {
    workspaceSlug,
    identityKey: "snapshot-smoke-merge-extra",
    status: "new",
    updatedBy: "p12-smoke",
    ...gated,
  });
  // Divert the conflict row again so the merge overwrite is provable (the DB
  // row must actually change, not merely already match the envelope).
  await client.mutation(api.candidate_status.upsert as any, {
    workspaceSlug,
    identityKey: "snapshot-smoke-identity-1",
    status: "contacted",
    notes: "diverged again",
    updatedBy: "p12-smoke",
    ...gated,
  });
  // Re-seed the secret-like row; merge mode must preserve local rows not in the envelope.
  await client.mutation(api.workspace_config.upsert as any, {
    workspaceSlug,
    configKey: "p12-smoke-secret-api_token",
    configValue: "should-never-leak",
  });
  const mergeResult = (await client.mutation(api.workspace_snapshots.importWorkspaceSnapshot as any, {
    workspaceSlug,
    profile: "hr-ops",
    mode: "merge",
    tables: {
      candidateStatus: hrOps.tables.candidateStatus,
      candidateBlocks: hrOps.tables.candidateBlocks,
      searchProfiles: [],
      workspaceConfig: [],
    },
  })) as any;
  check("merge import applied", mergeResult.applied.candidateStatus >= 1);
  const afterMerge = (await client.query(api.workspace_snapshots.exportWorkspaceSnapshot as any, {
    workspaceSlug,
    profile: "hr-ops",
  })) as any;
  const extra = afterMerge.tables.candidateStatus.find((r: any) => r.identityKey === "snapshot-smoke-merge-extra");
  check("merge preserves non-conflicting rows", extra?.status === "new");
  const identity1Rows = afterMerge.tables.candidateStatus.filter((r: any) => r.identityKey === "snapshot-smoke-identity-1");
  const identity2Rows = afterMerge.tables.candidateBlocks.filter((r: any) => r.identityKey === "snapshot-smoke-identity-2");
  check(
    "merge overwrites conflicting rows exactly once",
    identity1Rows.length === 1 && identity1Rows[0]?.status === "hired",
    `identity1Count=${identity1Rows.length} status=${identity1Rows[0]?.status}`,
  );
  check("merge keeps blocks exactly once", identity2Rows.length === 1, `identity2Count=${identity2Rows.length}`);
  // Idempotency: re-importing the same envelope must not grow row counts.
  await client.mutation(api.workspace_snapshots.importWorkspaceSnapshot as any, {
    workspaceSlug,
    profile: "hr-ops",
    mode: "merge",
    tables: {
      candidateStatus: hrOps.tables.candidateStatus,
      candidateBlocks: hrOps.tables.candidateBlocks,
      searchProfiles: [],
      workspaceConfig: [],
    },
  });
  const afterReMerge = (await client.query(api.workspace_snapshots.exportWorkspaceSnapshot as any, {
    workspaceSlug,
    profile: "hr-ops",
  })) as any;
  const identity1AfterRe = afterReMerge.tables.candidateStatus.filter((r: any) => r.identityKey === "snapshot-smoke-identity-1");
  check(
    "merge re-import is idempotent",
    identity1AfterRe.length === 1 && afterReMerge.tables.candidateStatus.length === afterMerge.tables.candidateStatus.length,
    `identity1=${identity1AfterRe.length} total=${afterMerge.tables.candidateStatus.length}->${afterReMerge.tables.candidateStatus.length}`,
  );
  const secretAfterMerge = (await client.query(api.workspace_config.get as any, {
    workspaceSlug,
    configKey: "p12-smoke-secret-api_token",
  })) as any;
  check("merge preserves local secret-like row", secretAfterMerge !== null, "merge never deletes local rows absent from the envelope");

  // 8. Secret-key import refusal + hr-ops-with-full-tables refusal.
  let refusedSecret = false;
  try {
    await client.mutation(api.workspace_snapshots.importWorkspaceSnapshot as any, {
      workspaceSlug,
      profile: "full",
      mode: "merge",
      tables: {
        candidateStatus: [],
        candidateBlocks: [],
        searchProfiles: [],
        workspaceConfig: [{ configKey: "p12-smoke-secret-api_token", configValue: "x", updatedAt: Date.now() }],
      },
    });
  } catch {
    refusedSecret = true;
  }
  check("import refuses secret-like config key", refusedSecret);

  let refusedHrOpsFull = false;
  try {
    await client.mutation(api.workspace_snapshots.importWorkspaceSnapshot as any, {
      workspaceSlug,
      profile: "hr-ops",
      mode: "merge",
      tables: {
        candidateStatus: [],
        candidateBlocks: [],
        searchProfiles: [{ name: "x" }],
        workspaceConfig: [],
      },
    });
  } catch {
    refusedHrOpsFull = true;
  }
  check("hr-ops import refuses full-only tables", refusedHrOpsFull);

  // 9. Cleanup: unblock seeded identities, clear scratch statuses, remove config keys.
  for (const identityKey of ["snapshot-smoke-identity-1", "snapshot-smoke-identity-2", "snapshot-smoke-merge-extra", "snapshot-smoke-identity-3"]) {
    await client.mutation(api.candidate_blocks.remove as any, { workspaceSlug, identityKey, ...gated }).catch(() => undefined);
  }
  await client.mutation(api.candidate_status.clearWorkspace as any, { workspaceSlug, ...gated }).catch((error: unknown) => {
    results.push(`WARN cleanup clearWorkspace — ${String(error)}`);
  });
  await client.mutation(api.workspace_config.remove as any, { workspaceSlug, configKey: "p12-smoke-config" }).catch(() => undefined);
  await client.mutation(api.workspace_config.remove as any, { workspaceSlug, configKey: "p12-smoke-secret-api_token" }).catch(() => undefined);

  console.log(results.join("\n"));
  console.log(`\nSMOKE_${failed ? "FAIL" : "PASS"}`);
  if (failed) process.exitCode = 1;
}

main().catch((error) => {
  console.error("SMOKE_ERROR", error);
  process.exitCode = 1;
});
