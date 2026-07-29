import { describe, expect, it } from "vitest";
import { isMeaningfulSeekWorkHistoryDescription } from "../seek-work-history-quality";

describe("isMeaningfulSeekWorkHistoryDescription", () => {
  it.each([
    "RESPONSIBILITIES: ACCOMPLISHMENT:",
    "Responsibilities:\nAccomplishments:",
    "KEY RESPONSIBILITIES / ACHIEVEMENTS",
    "DUTIES:",
  ])("rejects section-label-only text: %s", (value) => {
    expect(isMeaningfulSeekWorkHistoryDescription(value)).toBe(false);
  });

  it.each([
    "Responsibilities: Managed regional sales and distributor accounts.",
    "Accomplishment: Increased annual revenue by 30%.",
    "Take the lead role in sales and marketing of Orthopedics Implants.",
  ])("accepts real work detail: %s", (value) => {
    expect(isMeaningfulSeekWorkHistoryDescription(value)).toBe(true);
  });
});
