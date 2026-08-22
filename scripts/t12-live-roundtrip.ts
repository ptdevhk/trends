/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * p12f live round-trip phases (Convex-side seed/verify/cleanup).
 * Usage: set -a; source .env; set +a && bunx tsx scripts/t12-live-roundtrip.ts seed|verify <ws>|cleanup
 * Requires CONVEX_WRITE_SECRET in the environment (gated mutations).
 */
import { ConvexHttpClient } from "convex/browser";
import { api } from "../packages/convex/convex/_generated/api.js";

const client = new ConvexHttpClient("http://127.0.0.1:3210");
const writeSecret = process.env.CONVEX_WRITE_SECRET;
if (!writeSecret) {
  throw new Error("CONVEX_WRITE_SECRET is not set — source .env before running");
}
const gated = { writeSecret };

const phase = process.argv[2];
const target = process.argv[3];

async function seed() {
  const ws = process.argv[3] ?? "p12-live-ws";
  await client.mutation(api.candidate_status.upsert as any, {
    workspaceSlug: ws,
    identityKey: "live-identity-1",
    status: "hired",
    notes: "p12f live round-trip",
    updatedBy: "p12f",
    ...gated,
  });
  await client.mutation(api.candidate_blocks.upsert as any, {
    workspaceSlug: ws,
    identityKey: "live-identity-2",
    reason: "p12f live round-trip block",
    blockedBy: "p12f",
    ...gated,
  });
  await client.mutation(api.workspace_config.upsert as any, {
    workspaceSlug: ws,
    configKey: "p12f-live-config",
    configValue: { live: true },
  });
  await client.mutation(api.workspace_config.upsert as any, {
    workspaceSlug: ws,
    configKey: "p12f-secret-api_token",
    configValue: "must-never-leak",
  });
  console.log("SEED_OK", ws);
}

async function verify() {
  if (!target) {
    throw new Error("verify requires a workspace slug");
  }
  const expectConfig = process.argv[4] === "full";
  const hrOps = (await client.query(api.workspace_snapshots.exportWorkspaceSnapshot as any, {
    workspaceSlug: target,
    profile: "hr-ops",
  })) as any;
  const status = hrOps.tables.candidateStatus.find((r: any) => r.identityKey === "live-identity-1");
  const block = hrOps.tables.candidateBlocks.find((r: any) => r.identityKey === "live-identity-2");
  if (status?.status !== "hired" || !block) {
    throw new Error(`VERIFY_FAIL hr-ops rows missing in ${target}: status=${status?.status} block=${Boolean(block)}`);
  }
  const full = (await client.query(api.workspace_snapshots.exportWorkspaceSnapshot as any, {
    workspaceSlug: target,
    profile: "full",
  })) as any;
  const config = full.tables.workspaceConfig.find((r: any) => r.configKey === "p12f-live-config");
  const secret = full.tables.workspaceConfig.some((r: any) => r.configKey === "p12f-secret-api_token");
  if (expectConfig ? !config : config) {
    throw new Error(`VERIFY_FAIL config in ${target}: config=${Boolean(config)} secret=${secret}`);
  }
  if (secret) {
    throw new Error(`VERIFY_FAIL secret leaked into ${target}`);
  }
  console.log("VERIFY_OK", target, {
    candidateStatus: hrOps.tables.candidateStatus.length,
    candidateBlocks: hrOps.tables.candidateBlocks.length,
    workspaceConfig: full.tables.workspaceConfig.length,
  });
}

async function cleanup() {
  // Scratch workspaces are dedicated to the round-trip: full wipe is fine.
  for (const ws of ["p12-live-ws", "p12-live-target", "p12-live-target2"]) {
    await client.mutation(api.candidate_blocks.remove as any, { workspaceSlug: ws, identityKey: "live-identity-2", ...gated }).catch(() => undefined);
    await client.mutation(api.candidate_status.clearWorkspace as any, { workspaceSlug: ws, ...gated }).catch(() => undefined);
    await client.mutation(api.workspace_config.remove as any, { workspaceSlug: ws, configKey: "p12f-live-config" }).catch(() => undefined);
    await client.mutation(api.workspace_config.remove as any, { workspaceSlug: ws, configKey: "p12f-secret-api_token" }).catch(() => undefined);
  }
  // dev is a real workspace: remove only the rows this script seeded. Never
  // clearWorkspace on dev — it deletes every candidate_status +
  // resume_digest_statuses row for the workspace.
  await client.mutation(api.candidate_status.remove as any, { workspaceSlug: "dev", identityKey: "live-identity-1", ...gated }).catch(() => undefined);
  await client.mutation(api.candidate_blocks.remove as any, { workspaceSlug: "dev", identityKey: "live-identity-2", ...gated }).catch(() => undefined);
  await client.mutation(api.workspace_config.remove as any, { workspaceSlug: "dev", configKey: "p12f-live-config" }).catch(() => undefined);
  await client.mutation(api.workspace_config.remove as any, { workspaceSlug: "dev", configKey: "p12f-secret-api_token" }).catch(() => undefined);
  console.log("CLEANUP_OK");
}

async function main() {
  if (phase === "seed") {
    await seed();
  } else if (phase === "verify") {
    await verify();
  } else if (phase === "cleanup") {
    await cleanup();
  } else {
    throw new Error(`unknown phase: ${phase}`);
  }
}

main().catch((error) => {
  console.error("PHASE_ERROR", error);
  process.exitCode = 1;
});
