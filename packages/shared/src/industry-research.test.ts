import { describe, expect, it } from "vitest";

import {
  INDUSTRY_RESEARCH_ORIGIN_PRIORITIES,
  mapIndustryResearchUiState,
  isIndustryEvidenceResearchFailureCode,
  isIndustryEvidenceResearchOrigin,
  isIndustryEvidenceResearchState,
} from "./industry-research.js";

describe("industry research queue contract", () => {
  it("accepts only the shared origin/state/failure vocabulary", () => {
    expect(isIndustryEvidenceResearchOrigin("resume_detail")).toBe(true);
    expect(isIndustryEvidenceResearchOrigin("client_priority")).toBe(false);
    expect(isIndustryEvidenceResearchState("retry_wait")).toBe(true);
    expect(isIndustryEvidenceResearchState("new")).toBe(false);
    expect(isIndustryEvidenceResearchFailureCode("provider_limited")).toBe(true);
    expect(isIndustryEvidenceResearchFailureCode("secret_leaked")).toBe(false);
  });

  it("maps delivery state separately from proposal lifecycle", () => {
    expect(mapIndustryResearchUiState({ proposalStatus: "new" })).toBe("idle");
    expect(mapIndustryResearchUiState({ requestState: "queued" })).toBe("queued");
    expect(mapIndustryResearchUiState({ requestState: "leased" })).toBe("researching");
    expect(
      mapIndustryResearchUiState({
        requestState: "completed",
        proposalStatus: "ready_for_review",
      }),
    ).toBe("ready_for_review");
    expect(
      mapIndustryResearchUiState({
        requestState: "failed",
        lastErrorCode: "proposal_terminal",
      }),
    ).toBe("terminal_failure");
  });

  it("keeps direct requests above background sweeps", () => {
    expect(INDUSTRY_RESEARCH_ORIGIN_PRIORITIES.resume_detail).toBeGreaterThan(
      INDUSTRY_RESEARCH_ORIGIN_PRIORITIES.scheduled_sweep,
    );
  });
});
