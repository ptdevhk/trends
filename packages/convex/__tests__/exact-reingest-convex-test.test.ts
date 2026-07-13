import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { api } from "../convex/_generated/api.js";
import { createTest, MINIMAL_INGEST_DATA, seedResume } from "./test-helpers.js";

const WRITE_SECRET = "test-exact-reingest-secret";

function target(overrides: Record<string, unknown>) {
  return {
    referenceResumeId: "old-reference-id",
    ...overrides,
  };
}

describe("exact target re-ingest", () => {
  beforeEach(() => {
    process.env.CONVEX_WRITE_SECRET = WRITE_SECRET;
  });

  afterEach(() => {
    delete process.env.CONVEX_WRITE_SECRET;
  });

  it("resolves every stable selector to the same current resume", async () => {
    const t = createTest();
    const resumeId = await seedResume(t, {
      externalId: "51job:resume:123456",
      identityKey: "profileUrl:ehire.51job.com/revision/talent/resume/detail?contenttype=&resumeid=123456",
      content: {
        name: "Not an identity selector",
        profileUrl: "https://ehire.51job.com/Revision/talent/resume/detail?resumeId=123456&contentType=",
        resumeId: "123456",
      },
      source: "ehire.51job.com",
      workspaceSlug: "dev",
    });

    const result = await t.action(api.ingest_agent.resolveExactReingestTargets, {
      workspaceSlug: "dev",
      writeSecret: WRITE_SECRET,
      targets: [target({
        profileUrl: "https://ehire.51job.com/Revision/talent/resume/detail?contentType=&resumeId=123456&utm_source=uat",
        profileResumeId: "123456",
        externalId: "51JOB:RESUME:123456",
        identityKey: "profileUrl:https://ehire.51job.com/Revision/talent/resume/detail?resumeId=123456&contentType=",
      })],
    });

    expect(result.requested).toBe(1);
    expect(result.resolved).toBe(1);
    expect(result.resumeIds).toEqual([String(resumeId)]);
    expect(result.targets).toEqual([
      expect.objectContaining({
        referenceResumeId: "old-reference-id",
        currentResumeId: String(resumeId),
        profileResumeId: "123456",
        externalId: "51job:resume:123456",
        canonicalIdentityKey: "profileUrl:ehire.51job.com/revision/talent/resume/detail?contenttype=&resumeid=123456",
      }),
    ]);
  });

  it("preserves manifest order while deduplicating scheduled IDs", async () => {
    const t = createTest();
    const firstId = await seedResume(t, {
      externalId: "external-first",
      identityKey: "profileUrl:example.com/candidates/first",
      content: { profileUrl: "https://example.com/candidates/first", resumeId: "100001" },
    });
    const secondId = await seedResume(t, {
      externalId: "external-second",
      identityKey: "profileUrl:example.com/candidates/second",
      content: { profileUrl: "https://example.com/candidates/second", resumeId: "100002" },
    });

    const result = await t.action(api.ingest_agent.resolveExactReingestTargets, {
      workspaceSlug: "dev",
      writeSecret: WRITE_SECRET,
      targets: [
        target({ referenceResumeId: "ref-second", externalId: "external-second" }),
        target({ referenceResumeId: "ref-first", profileResumeId: "100001" }),
        target({ referenceResumeId: "ref-second-duplicate", currentResumeId: String(secondId) }),
      ],
    });

    expect(result.targets.map((item) => item.referenceResumeId)).toEqual([
      "ref-second",
      "ref-first",
      "ref-second-duplicate",
    ]);
    expect(result.targets.map((item) => item.currentResumeId)).toEqual([
      String(secondId),
      String(firstId),
      String(secondId),
    ]);
    expect(result.resumeIds).toEqual([String(secondId), String(firstId)]);
    expect(result.resolved).toBe(2);
  });

  it.each([
    {
      label: "missing selectors",
      build: () => [target({})],
      expected: /missing a stable selector/i,
    },
    {
      label: "zero matches",
      build: () => [target({ externalId: "does-not-exist" })],
      expected: /did not match any resume/i,
    },
  ])("fails closed for $label", async ({ build, expected }) => {
    const t = createTest();
    await expect(t.action(api.ingest_agent.resolveExactReingestTargets, {
      workspaceSlug: "dev",
      writeSecret: WRITE_SECRET,
      targets: build(),
    })).rejects.toThrow(expected);
  });

  it("fails closed when supplied selectors resolve to different resumes", async () => {
    const t = createTest();
    await seedResume(t, {
      externalId: "external-a",
      identityKey: "profileUrl:example.com/candidates/a",
      content: { profileUrl: "https://example.com/candidates/a" },
    });
    await seedResume(t, {
      externalId: "external-b",
      identityKey: "profileUrl:example.com/candidates/b",
      content: { profileUrl: "https://example.com/candidates/b" },
    });

    await expect(t.action(api.ingest_agent.resolveExactReingestTargets, {
      workspaceSlug: "dev",
      writeSecret: WRITE_SECRET,
      targets: [target({
        profileUrl: "https://example.com/candidates/a",
        externalId: "external-b",
      })],
    })).rejects.toThrow(/selectors conflict/i);
  });

  it("fails closed when one selector matches multiple resumes", async () => {
    const t = createTest();
    await seedResume(t, {
      externalId: "ambiguous-a",
      identityKey: "profileUrl:example.com/candidates/a?resumeid=900001",
      content: { profileUrl: "https://example.com/candidates/a?resumeId=900001" },
    });
    await seedResume(t, {
      externalId: "ambiguous-b",
      identityKey: "profileUrl:example.com/candidates/b?resumeid=900001",
      content: { profileUrl: "https://example.com/candidates/b?resumeId=900001" },
    });

    await expect(t.action(api.ingest_agent.resolveExactReingestTargets, {
      workspaceSlug: "dev",
      writeSecret: WRITE_SECRET,
      targets: [target({ profileResumeId: "900001" })],
    })).rejects.toThrow(/matched multiple resumes/i);
  });

  it("rejects archived and explicitly cross-workspace targets", async () => {
    const t = createTest();
    await seedResume(t, {
      externalId: "archived-target",
      isArchived: true,
    });
    await seedResume(t, {
      externalId: "hr-target",
      workspaceSlug: "hr",
    });

    await expect(t.action(api.ingest_agent.resolveExactReingestTargets, {
      workspaceSlug: "dev",
      writeSecret: WRITE_SECRET,
      targets: [target({ externalId: "archived-target" })],
    })).rejects.toThrow(/archived/i);

    await expect(t.action(api.ingest_agent.resolveExactReingestTargets, {
      workspaceSlug: "dev",
      writeSecret: WRITE_SECRET,
      targets: [target({ externalId: "hr-target" })],
    })).rejects.toThrow(/workspace/i);
  });

  it("requires the configured write secret for resolution and scheduling", async () => {
    const t = createTest();
    const resumeId = await seedResume(t, { externalId: "secret-target" });

    await expect(t.action(api.ingest_agent.resolveExactReingestTargets, {
      workspaceSlug: "dev",
      targets: [target({ externalId: "secret-target" })],
    })).rejects.toThrow(/Unauthorized Convex write/);

    await expect(t.mutation(api.ingest_agent.scheduleExactReingest, {
      workspaceSlug: "dev",
      writeSecret: "wrong-secret",
      resumeIds: [resumeId],
    })).rejects.toThrow(/Unauthorized Convex write/);

    await expect(t.query(api.ingest_agent.getExactReingestReadiness, {
      workspaceSlug: "dev",
      resumeIds: [resumeId],
      dispatchedAt: 1_000,
      expectedSkillsVersion: 3,
    })).rejects.toThrow(/Unauthorized Convex write/);
  });

  it("schedules only the validated deduplicated set in batches of 50", async () => {
    const t = createTest();
    const ids = [];
    for (let index = 0; index < 51; index += 1) {
      ids.push(await seedResume(t, {
        externalId: `batch-${index}`,
        identityKey: `externalId:batch-${index}`,
      }));
    }

    const result = await t.mutation(api.ingest_agent.scheduleExactReingest, {
      workspaceSlug: "dev",
      writeSecret: WRITE_SECRET,
      resumeIds: [...ids, ids[0]],
    });

    expect(result).toMatchObject({
      requested: 52,
      resolved: 51,
      scheduled: 51,
      batches: 2,
      resumeIds: ids.map(String),
    });
    expect(result.dispatchedAt).toEqual(expect.any(Number));

    const scheduled = await t.run((ctx) => ctx.db.system.query("_scheduled_functions").collect());
    expect(scheduled).toHaveLength(2);
    expect(scheduled.map((entry) => entry.name)).toEqual([
      "ingest_agent:processNewResumes",
      "ingest_agent:processNewResumes",
    ]);
    expect(scheduled[0].args[0]).toEqual({ resumeIds: ids.slice(0, 50) });
    expect(scheduled[1].args[0]).toEqual({ resumeIds: ids.slice(50) });
  });

  it("revalidates every target before scheduling any batch", async () => {
    const t = createTest();
    const activeId = await seedResume(t, { externalId: "active-target" });
    const archivedId = await seedResume(t, { externalId: "archived-target", isArchived: true });

    await expect(t.mutation(api.ingest_agent.scheduleExactReingest, {
      workspaceSlug: "dev",
      writeSecret: WRITE_SECRET,
      resumeIds: [activeId, archivedId],
    })).rejects.toThrow(/archived/i);

    const scheduled = await t.run((ctx) => ctx.db.system.query("_scheduled_functions").collect());
    expect(scheduled).toEqual([]);
  });

  it("reports target readiness by dispatch time, skills version, and Phase 2 fields", async () => {
    const t = createTest();
    const readyId = await seedResume(t, {
      externalId: "ready-target",
      ingestData: {
        ...MINIMAL_INGEST_DATA,
        computedAt: 2_000,
        skillsVersion: 3,
        brandOrigin: "international",
        productClass: "complete_machine",
      },
    });
    const pendingId = await seedResume(t, {
      externalId: "pending-target",
      ingestData: {
        ...MINIMAL_INGEST_DATA,
        computedAt: 900,
        skillsVersion: 2,
      },
    });

    const first = await t.query(api.ingest_agent.getExactReingestReadiness, {
      workspaceSlug: "dev",
      writeSecret: WRITE_SECRET,
      resumeIds: [readyId, pendingId],
      dispatchedAt: 1_000,
      expectedSkillsVersion: 3,
    });

    expect(first).toMatchObject({
      allReady: false,
      ready: 1,
      pending: 1,
      invalid: 0,
      dispatchedAt: 1_000,
      expectedSkillsVersion: 3,
    });
    expect(first.targets).toEqual([
      expect.objectContaining({ currentResumeId: String(readyId), state: "ready", reasons: [] }),
      expect.objectContaining({
        currentResumeId: String(pendingId),
        state: "pending",
        reasons: ["computed_before_dispatch", "skills_version_mismatch", "phase_2_fields_missing"],
      }),
    ]);

    await t.run(async (ctx) => {
      await ctx.db.patch(pendingId, {
        ingestData: {
          ...MINIMAL_INGEST_DATA,
          computedAt: 2_100,
          skillsVersion: 3,
          brandOrigin: "domestic",
          productClass: "industrial_component",
        },
      });
    });
    const second = await t.query(api.ingest_agent.getExactReingestReadiness, {
      workspaceSlug: "dev",
      writeSecret: WRITE_SECRET,
      resumeIds: [readyId, pendingId],
      dispatchedAt: 1_000,
      expectedSkillsVersion: 3,
    });
    expect(second).toMatchObject({ allReady: true, ready: 2, pending: 0, invalid: 0 });
  });

  it("reports deleted, archived, and cross-workspace readiness targets as invalid", async () => {
    const t = createTest();
    const deletedId = await seedResume(t, { externalId: "deleted-readiness" });
    const archivedId = await seedResume(t, { externalId: "archived-readiness", isArchived: true });
    const wrongWorkspaceId = await seedResume(t, { externalId: "wrong-workspace-readiness", workspaceSlug: "hr" });
    await t.run(async (ctx) => ctx.db.delete(deletedId));

    const result = await t.query(api.ingest_agent.getExactReingestReadiness, {
      workspaceSlug: "dev",
      writeSecret: WRITE_SECRET,
      resumeIds: [deletedId, archivedId, wrongWorkspaceId],
      dispatchedAt: 1_000,
      expectedSkillsVersion: 3,
    });

    expect(result).toMatchObject({ allReady: false, ready: 0, pending: 0, invalid: 3 });
    expect(result.targets.map((item) => item.reasons)).toEqual([
      ["resume_missing"],
      ["resume_archived"],
      ["workspace_mismatch"],
    ]);
  });
});
