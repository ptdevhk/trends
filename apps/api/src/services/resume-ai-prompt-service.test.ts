import { describe, expect, it } from "vitest";

import { resumeAiPromptService } from "./resume-ai-prompt-service";

describe("resumeAiPromptService.renderUserPromptTemplate", () => {
  it("allows extra values and only requires placeholders used by the template", () => {
    const rendered = resumeAiPromptService.renderUserPromptTemplate(
      "Hello {candidateName}, role {jobTitle}",
      {
        candidateName: "Alice",
        jobTitle: "Sales Engineer",
        workExperience: "5",
        education: "本科",
        companies: "Foo Corp",
      },
    );

    expect(rendered).toBe("Hello Alice, role Sales Engineer");
  });

  it("throws when a placeholder is missing from the provided values", () => {
    expect(() =>
      resumeAiPromptService.renderUserPromptTemplate("Hello {candidateName}, role {jobTitle}", {
        candidateName: "Alice",
      }),
    ).toThrow(/jobTitle/);
  });
});
