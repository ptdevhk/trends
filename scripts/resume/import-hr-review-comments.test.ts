import { describe, expect, it } from "vitest";

type ImportHrReviewModule = typeof import("./import-hr-review-comments.mjs");

async function loadModule(): Promise<ImportHrReviewModule> {
  return await import("./import-hr-review-comments.mjs");
}

describe("import HR review comments helper", () => {
  it("defaults imports to the hr workspace and accepts an explicit workspace", async () => {
    const { parseCliOptions } = await loadModule();

    expect(parseCliOptions(["--xlsx", "review.xlsx"]).workspaceSlug).toBe("hr");
    expect(parseCliOptions(["--xlsx", "review.xlsx", "--workspace", "sales-team"]).workspaceSlug).toBe("sales-team");
  });

  it("suggests status changes from HR comment text", async () => {
    const { suggestCandidateStatus } = await loadModule();

    expect(suggestCandidateStatus("跟进中，已加微信")).toBe("shortlist");
    expect(suggestCandidateStatus("电话无法接通/空号")).toBe("block");
    expect(suggestCandidateStatus("对机床设备不了解，不考虑")).toBe("reject");
    expect(suggestCandidateStatus("江西区域，暂无需求。")).toBe("reject");
  });

  it("formats suggestion rows as the requested table shape", async () => {
    const { buildSuggestionRows, formatSuggestionRows } = await loadModule();

    const rows = buildSuggestionRows([
      {
        rowNumber: 2,
        resumeId: "resume-1",
        name: "程先生",
        comment: "跟进中，已加微信",
        exportedStatus: "new",
        exportedUserComment: "",
        profileUrl: "https://example.test/resume-1",
      },
      {
        rowNumber: 3,
        resumeId: "resume-2",
        name: "潘先生",
        comment: "电话无法接通/空号",
        exportedStatus: "new",
        exportedUserComment: "",
        profileUrl: "https://example.test/resume-2",
      },
    ]);

    expect(rows).toEqual([
      { resumeId: "resume-1", name: "程先生", status: "shortlist" },
      { resumeId: "resume-2", name: "潘先生", status: "block" },
    ]);
    expect(formatSuggestionRows(rows, "markdown")).toBe([
      "| Resume ID | Name | Status |",
      "| --- | --- | --- |",
      "| resume-1 | 程先生 | shortlist |",
      "| resume-2 | 潘先生 | block |",
    ].join("\n"));
  });
});
