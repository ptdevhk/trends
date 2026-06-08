import { describe, expect, it } from "vitest";

import { createLiteBackupPayload } from "./create-lite-backup.ts";

describe("createLiteBackupPayload", () => {
  it("keeps the first count resumes and matching candidate metadata", () => {
    const payload = {
      metadata: {
        workspace: "dev",
        generatedBy: "test",
      },
      resumes: [
        {
          _id: "convex-1",
          resumeId: "resume-1",
          externalId: "external-1",
          content: { profileUrl: "https://example.com/1" },
        },
        {
          id: "local-2",
          content: { resumeId: "resume-2", profileUrl: "https://example.com/2" },
        },
        {
          _id: "convex-3",
          resumeId: "resume-3",
          externalId: "external-3",
          content: { profileUrl: "https://example.com/3" },
        },
      ],
      candidateActions: [
        { resumeId: "convex-1", action: "star" },
        { resume_id: "resume-2", action: "note" },
        { resumeKey: "external-3", action: "archive" },
        { profileUrl: "https://example.com/2", action: "shortlist" },
      ],
      candidateStatus: [
        { convexResumeId: "local-2", status: "shortlisted" },
        { resumeId: "resume-3", status: "rejected" },
      ],
    };

    const result = createLiteBackupPayload(payload, {
      count: 2,
      sourcePath: "output/resume-backups/full.tar.gz",
      createdAt: "2026-06-08T05:00:00.000Z",
    });

    expect(result.resumes).toEqual(payload.resumes.slice(0, 2));
    expect(result.candidateActions).toEqual([
      payload.candidateActions[0],
      payload.candidateActions[1],
      payload.candidateActions[3],
    ]);
    expect(result.candidateStatus).toEqual([payload.candidateStatus[0]]);
    expect(result.metadata).toMatchObject({
      workspace: "dev",
      generatedBy: "test",
      liteBackup: {
        sourcePath: "output/resume-backups/full.tar.gz",
        originalResumeCount: 3,
        count: 2,
        createdAt: "2026-06-08T05:00:00.000Z",
      },
    });
  });

  it("rejects non-positive counts", () => {
    expect(() =>
      createLiteBackupPayload(
        { metadata: {}, resumes: [{ resumeId: "resume-1" }] },
        { count: 0, sourcePath: "full.json", createdAt: "2026-06-08T05:00:00.000Z" },
      ),
    ).toThrow("COUNT must be a positive integer");
  });

  it("converts legacy data payloads without carrying the full data array", () => {
    const result = createLiteBackupPayload(
      {
        metadata: {},
        data: [
          { resumeId: "resume-1" },
          { resumeId: "resume-2" },
          { resumeId: "resume-3" },
        ],
      },
      { count: 1, sourcePath: "full.json", createdAt: "2026-06-08T05:00:00.000Z" },
    );

    expect(result.resumes).toEqual([{ resumeId: "resume-1" }]);
    expect(result).not.toHaveProperty("data");
  });
});
