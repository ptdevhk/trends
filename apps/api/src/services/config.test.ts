import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// config.ts reads process.env at module load. To exercise the
// AUTH_ADMIN_RESET_ENABLED default semantics (default true; opt-out
// only via explicit "false"), reset the module registry between cases
// so each sees a fresh env on import.
async function loadConfig() {
  vi.resetModules();
  const { config } = await import("./config.js");
  return config as {
    auth: { adminResetEnabled: boolean };
    industryMaintenanceWorkerTimeoutMs: number;
    industryEvidenceTargetedQueueEnabled: boolean;
    industryEvidenceResearchMaxBatch: number;
  };
}

const ENV_KEY = "AUTH_ADMIN_RESET_ENABLED";

describe("AUTH_ADMIN_RESET_ENABLED default", () => {
  const original = process.env[ENV_KEY];

  beforeEach(() => {
    delete process.env[ENV_KEY];
  });

  afterEach(() => {
    if (original === undefined) {
      delete process.env[ENV_KEY];
    } else {
      process.env[ENV_KEY] = original;
    }
  });

  it("defaults to true when unset", async () => {
    const config = await loadConfig();
    expect(config.auth.adminResetEnabled).toBe(true);
  });

  it("is true when set to 'true'", async () => {
    process.env[ENV_KEY] = "true";
    const config = await loadConfig();
    expect(config.auth.adminResetEnabled).toBe(true);
  });

  it("is false only when explicitly set to 'false'", async () => {
    process.env[ENV_KEY] = "false";
    const config = await loadConfig();
    expect(config.auth.adminResetEnabled).toBe(false);
  });

  it("is true for any non-'false' value (e.g. '1')", async () => {
    process.env[ENV_KEY] = "1";
    const config = await loadConfig();
    expect(config.auth.adminResetEnabled).toBe(true);
  });
});

describe("industry maintenance worker timeout", () => {
  const original = process.env.INDUSTRY_MAINTENANCE_WORKER_TIMEOUT_MS;

  afterEach(() => {
    if (original === undefined) {
      delete process.env.INDUSTRY_MAINTENANCE_WORKER_TIMEOUT_MS;
    } else {
      process.env.INDUSTRY_MAINTENANCE_WORKER_TIMEOUT_MS = original;
    }
  });

  it("defaults to five minutes", async () => {
    delete process.env.INDUSTRY_MAINTENANCE_WORKER_TIMEOUT_MS;
    const config = await loadConfig();
    expect(config.industryMaintenanceWorkerTimeoutMs).toBe(300_000);
  });

  it("accepts a bounded operator override", async () => {
    process.env.INDUSTRY_MAINTENANCE_WORKER_TIMEOUT_MS = "180000";
    const config = await loadConfig();
    expect(config.industryMaintenanceWorkerTimeoutMs).toBe(180_000);
  });

  it("keeps invalid or unsafe values within the bounded defaults", async () => {
    process.env.INDUSTRY_MAINTENANCE_WORKER_TIMEOUT_MS = "not-a-number";
    const invalid = await loadConfig();
    expect(invalid.industryMaintenanceWorkerTimeoutMs).toBe(300_000);

    process.env.INDUSTRY_MAINTENANCE_WORKER_TIMEOUT_MS = "999999";
    const capped = await loadConfig();
    expect(capped.industryMaintenanceWorkerTimeoutMs).toBe(300_000);

    process.env.INDUSTRY_MAINTENANCE_WORKER_TIMEOUT_MS = "1";
    const floored = await loadConfig();
    expect(floored.industryMaintenanceWorkerTimeoutMs).toBe(30_000);
  });
});

describe("targeted industry evidence queue rollout controls", () => {
  const originalFlag = process.env.INDUSTRY_EVIDENCE_TARGETED_QUEUE_ENABLED;
  const originalBatch = process.env.INDUSTRY_EVIDENCE_RESEARCH_MAX_BATCH;

  afterEach(() => {
    if (originalFlag === undefined) delete process.env.INDUSTRY_EVIDENCE_TARGETED_QUEUE_ENABLED;
    else process.env.INDUSTRY_EVIDENCE_TARGETED_QUEUE_ENABLED = originalFlag;
    if (originalBatch === undefined) delete process.env.INDUSTRY_EVIDENCE_RESEARCH_MAX_BATCH;
    else process.env.INDUSTRY_EVIDENCE_RESEARCH_MAX_BATCH = originalBatch;
  });

  it("defaults the server authorization gate off and caps the batch", async () => {
    delete process.env.INDUSTRY_EVIDENCE_TARGETED_QUEUE_ENABLED;
    delete process.env.INDUSTRY_EVIDENCE_RESEARCH_MAX_BATCH;
    const config = await loadConfig();
    expect(config.industryEvidenceTargetedQueueEnabled).toBe(false);
    expect(config.industryEvidenceResearchMaxBatch).toBe(20);
  });

  it("accepts an explicit flag and clamps an unsafe batch", async () => {
    process.env.INDUSTRY_EVIDENCE_TARGETED_QUEUE_ENABLED = "true";
    process.env.INDUSTRY_EVIDENCE_RESEARCH_MAX_BATCH = "999";
    const config = await loadConfig();
    expect(config.industryEvidenceTargetedQueueEnabled).toBe(true);
    expect(config.industryEvidenceResearchMaxBatch).toBe(50);
  });
});
