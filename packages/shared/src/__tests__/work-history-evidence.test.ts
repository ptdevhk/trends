import { describe, expect, it } from "vitest";

import {
  buildLatestWorkHistoryEvidence,
  buildWorkHistoryEvidence,
  selectLatestWorkHistory,
} from "../work-history-evidence";

describe("work-history evidence helpers", () => {
  it("selects the latest three entries by recency", () => {
    const selected = selectLatestWorkHistory([
      { raw: "2018-01 Legacy Co.", startDate: "2018-01", endDate: "2019-01", companyName: "Legacy Co." },
      { raw: "2024-05 Current Co.", startDate: "2024-05", endDate: "至今", companyName: "Current Co." },
      { raw: "2021-03 Mid Co.", startDate: "2021-03", endDate: "2023-12", companyName: "Mid Co." },
      { raw: "2024-01 Recent Co.", startDate: "2024-01", endDate: "2024-04", companyName: "Recent Co." },
      { raw: "2020-02 Older Co.", startDate: "2020-02", endDate: "2021-02", companyName: "Older Co." },
    ]);

    expect(selected.map((entry) => entry.companyName)).toEqual([
      "Current Co.",
      "Recent Co.",
      "Mid Co.",
    ]);
  });

  it("keeps input order as a stable fallback when dates are missing", () => {
    const selected = selectLatestWorkHistory([
      { raw: "First Co.", companyName: "First Co." },
      { raw: "Second Co.", companyName: "Second Co." },
      { raw: "Third Co.", companyName: "Third Co." },
      { raw: "Fourth Co.", companyName: "Fourth Co." },
    ]);

    expect(selected.map((entry) => entry.companyName)).toEqual([
      "First Co.",
      "Second Co.",
      "Third Co.",
    ]);
  });

  it("builds latest-work-history evidence without mutating full evidence behavior", () => {
    const workHistory = [
      { raw: "2018-01 Legacy Co.", startDate: "2018-01", endDate: "2019-01", companyName: "Legacy Co.", jobTitle: "Operator" },
      { raw: "2024-05 Current Co.", startDate: "2024-05", endDate: "至今", companyName: "Current Co.", jobTitle: "Manager" },
      { raw: "2021-03 Mid Co.", startDate: "2021-03", endDate: "2023-12", companyName: "Mid Co.", jobTitle: "Engineer" },
      { raw: "2024-01 Recent Co.", startDate: "2024-01", endDate: "2024-04", companyName: "Recent Co.", jobTitle: "Sales" },
    ];

    expect(buildWorkHistoryEvidence(workHistory).lines).toHaveLength(4);
    expect(buildLatestWorkHistoryEvidence(workHistory).lines).toEqual([
      "2024-05 ~ 至今 Current Co. Manager",
      "2024-01 ~ 2024-04 Recent Co. Sales",
      "2021-03 ~ 2023-12 Mid Co. Engineer",
    ]);
  });
});
