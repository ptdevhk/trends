import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { describe, expect, it, beforeEach, afterEach } from "vitest";

import { IndustryDataService } from "./industry-data-service";
import {
  IndustryVerificationService,
  type ReviewedIndustryProfileSnapshot,
} from "./industry-verification-service";

const TEST_KEYWORDS_STRUCTURED_MD = `
## 重点企业 (Key Companies)

| ID | 公司名称 (Company Name) | 英文名称 (English Name) | 类型 (Type) |
| --- | --- | --- | --- |
| 1 | 北京精雕科技集团有限公司 | JINGDIAO | key_company |
| 3 | 秦川机床集团股份公司 | QINCHUAN | key_company |
| 5 | 润星科技集团 | RUNXING | key_company |
`;

const TEST_BRANDS_JSON = JSON.stringify([
  { id: 1, nameCn: "发那科", nameEn: "FANUC", type: "加工中心/数控车床", origin: "international" },
], null, 2);

describe("IndustryVerificationService", () => {
  let tmpDir: string;
  let industryDataService: IndustryDataService;
  let service: IndustryVerificationService;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "industry-verification-"));
    const industryDataDir = path.join(tmpDir, "config", "industry-data");
    fs.mkdirSync(industryDataDir, { recursive: true });
    fs.writeFileSync(path.join(industryDataDir, "keywords-structured.md"), TEST_KEYWORDS_STRUCTURED_MD);
    fs.writeFileSync(path.join(industryDataDir, "brands.json"), TEST_BRANDS_JSON);
    industryDataService = new IndustryDataService(tmpDir);
    service = new IndustryVerificationService(industryDataService);
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("returns verified for a strong known-company employer with non-negative duty", () => {
    const result = service.resolveVerdict(
      "秦川机床集团",
      "CNC编程工程师",
    );
    expect(result.verdict).toBe("verified");
    expect(result.strength).toBe("strong");
    expect(result.employerSource).toBe("known_company");
    expect(result.dutyEvidence).toBe("positive");
    expect(result.companyKey).toBe("qinchuan");
  });

  it("returns verified for a weak employer-name hit promoted by positive CNC duty evidence", () => {
    // Nicole case: "CNC Mechatronics Sdn. Bhd." has keyword "CNC" in name (weak)
    // but duty text clearly describes CNC work -> promoted to verified.
    const result = service.resolveVerdict(
      "CNC Mechatronics Sdn. Bhd.",
      "CNC Machining Centre Sales Manager",
    );
    expect(result.verdict).toBe("verified");
    expect(result.strength).toBe("weak");
    expect(result.employerSource).toBe("keyword_match");
    expect(result.dutyEvidence).toBe("positive");
  });

  it("returns rejected for a weak employer-name hit with negative (medical device) duty", () => {
    // Terran case: medical-device orthopedics responsibilities.
    const result = service.resolveVerdict(
      "TERRAN LLC.",
      "orthopedic implant sales representative",
    );
    expect(result.verdict).toBe("rejected");
    expect(result.dutyEvidence).toBe("negative");
  });

  it("returns rejected for Symmetry Medical with medical duty evidence", () => {
    // Symmetry Medical Malaysia Sdn. Bhd. - medical responsibilities.
    const result = service.resolveVerdict(
      "Symmetry Medical Malaysia Sdn. Bhd.",
      "Sales Manager for surgical and orthopedic implants",
    );
    expect(result.verdict).toBe("rejected");
    expect(result.dutyEvidence).toBe("negative");
  });

  it("returns candidate for a weak employer-name hit with neutral duty evidence", () => {
    // Bestari case: weak name-only, no clear CNC or medical duty.
    const result = service.resolveVerdict(
      "Bestari Sales & Marketing",
      "account management and client relationship",
    );
    expect(result.verdict).toBe("candidate");
    expect(result.needsReview).toBe(true);
    expect(result.strength).toBe("none");
  });

  it("returns rejected when there is no employer evidence and duty is negative", () => {
    const result = service.resolveVerdict(
      "Some Random Company",
      "retail sales for consumer goods",
    );
    expect(result.verdict).toBe("rejected");
    expect(result.strength).toBe("none");
    expect(result.dutyEvidence).toBe("negative");
  });

  it("returns candidate for a known CNC employer with neutral (non-positive) duty", () => {
    // Strong employer but duty text is ambiguous/neutral.
    const result = service.resolveVerdict(
      "秦川机床集团",
      "general management and administration",
    );
    expect(result.verdict).toBe("verified");
    expect(result.strength).toBe("strong");
    expect(result.dutyEvidence).toBe("neutral");
  });

  it("returns rejected when strong employer evidence is vetoed by negative duty", () => {
    // Known CNC company but duty clearly describes another domain.
    const result = service.resolveVerdict(
      "秦川机床集团",
      "食品零售 sales representative for FMCG products",
    );
    expect(result.verdict).toBe("rejected");
    expect(result.strength).toBe("strong");
    expect(result.dutyEvidence).toBe("negative");
  });

  it("downgrades ambiguous short aliases to candidate even with positive duty", () => {
    // "Star" alone should not auto-verify even if duty mentions CNC.
    const result = service.resolveVerdict(
      "Star",
      "CNC machining centre operator",
    );
    expect(result.verdict).toBe("candidate");
    expect(result.needsReview).toBe(true);
  });

  it("preserves seedMatchType diagnostics from the lexical matcher", () => {
    const knownCompanyResult = service.resolveVerdict(
      "秦川机床集团",
      "CNC编程",
    );
    expect(knownCompanyResult.seedMatchType).toBe("known_company");

    const keywordResult = service.resolveVerdict(
      "CNC Mechatronics",
      "CNC programming",
    );
    expect(keywordResult.seedMatchType).toBe("keyword_match");

    const noneResult = service.resolveVerdict(
      "Some Unknown Company",
      "general office work",
    );
    expect(noneResult.seedMatchType).toBe("none");
  });

  it("handles empty employer name and empty duty text gracefully", () => {
    const result = service.resolveVerdict("", "");
    expect(result.verdict).toBe("rejected");
    expect(result.strength).toBe("none");
    expect(result.employerSource).toBe("none");
    expect(result.dutyEvidence).toBe("neutral");
  });

  it("handles undefined inputs gracefully", () => {
    const result = service.resolveVerdict(undefined, undefined);
    expect(result.verdict).toBe("rejected");
    expect(result.strength).toBe("none");
  });

  it("gives a compatible reviewed verified revision precedence over lexical evidence", () => {
    const reviewedProfile: ReviewedIndustryProfileSnapshot = {
      companyKey: "acme-cnc",
      industryClass: "cnc",
      verificationLevel: "verified",
      verdictRevisionId: "revision-1",
      evidenceSummary: "Official catalog and registry confirm CNC machine tools.",
      reviewedAt: 100,
      reviewedBy: "reviewer-1",
      sourceCount: 2,
      sourcePreviews: [],
    };

    const result = service.resolveVerdict({
      companyName: "Acme",
      dutyText: "general management",
      resolvedCompanyKey: "acme-cnc",
      targetIndustryClass: "cnc",
      reviewedProfile,
      compatibilityMode: "strict-reviewed",
    });

    expect(result).toMatchObject({
      verdict: "verified",
      employerSource: "reviewed_profile",
      companyKey: "acme-cnc",
      verdictRevisionId: "revision-1",
      evidenceSummary: reviewedProfile.evidenceSummary,
      needsReview: false,
    });
  });

  it("treats a reviewed rejection as an authoritative veto", () => {
    const result = service.resolveVerdict({
      companyName: "CNC Mechatronics",
      dutyText: "CNC machine tool sales",
      resolvedCompanyKey: "cnc-mechatronics",
      targetIndustryClass: "cnc",
      reviewedProfile: {
        companyKey: "cnc-mechatronics",
        industryClass: "non_industry",
        verificationLevel: "rejected",
        verdictRevisionId: "revision-rejected-1",
        evidenceSummary: "Reviewed sources show a non-industrial business.",
        reviewedAt: 101,
        sourceCount: 1,
        sourcePreviews: [],
      },
      compatibilityMode: "strict-reviewed",
    });

    expect(result.verdict).toBe("rejected");
    expect(result.employerSource).toBe("reviewed_profile");
    expect(result.verdictRevisionId).toBe("revision-rejected-1");
    expect(result.reasonSummary).toContain("reviewed rejected verdict -> authoritative veto");
  });

  it("does not use a reviewed verified revision for an incompatible target taxonomy", () => {
    const result = service.resolveVerdict({
      companyName: "Acme Automation",
      dutyText: "automation systems",
      resolvedCompanyKey: "acme-automation",
      targetIndustryClass: "cnc",
      reviewedProfile: {
        companyKey: "acme-automation",
        industryClass: "automation",
        verificationLevel: "verified",
        verdictRevisionId: "revision-automation-1",
        evidenceSummary: "Reviewed as industrial automation.",
        reviewedAt: 102,
        sourceCount: 1,
        sourcePreviews: [],
      },
      compatibilityMode: "strict-reviewed",
    });

    expect(result.verdict).toBe("candidate");
    expect(result.needsReview).toBe(true);
    expect(result.reasonSummary).toContain(
      "reviewed verified verdict is incompatible with target taxonomy cnc",
    );
  });

  it("does not promote lexical or duty evidence without a reviewed profile in strict mode", () => {
    const result = service.resolveVerdict({
      companyName: "秦川机床集团",
      dutyText: "CNC编程工程师",
      resolvedCompanyKey: "qinchuan",
      targetIndustryClass: "cnc",
      compatibilityMode: "strict-reviewed",
    });

    expect(result.verdict).toBe("candidate");
    expect(result.needsReview).toBe(true);
    expect(result.employerSource).toBe("known_company");
    expect(result.reasonSummary).toContain(
      "strict-reviewed mode requires an approved revision -> candidate",
    );
  });

  it("preserves legacy seed behavior only when compatibility mode explicitly allows it", () => {
    const result = service.resolveVerdict({
      companyName: "秦川机床集团",
      dutyText: "CNC编程工程师",
      resolvedCompanyKey: "qinchuan",
      targetIndustryClass: "cnc",
      compatibilityMode: "legacy-seed",
    });

    expect(result.verdict).toBe("verified");
    expect(result.employerSource).toBe("known_company");
    expect(result.verdictRevisionId).toBeUndefined();
  });

  it("rejects a reviewed snapshot whose company key does not match canonical resolution", () => {
    const result = service.resolveVerdict({
      companyName: "Acme",
      dutyText: "CNC sales",
      resolvedCompanyKey: "acme-cnc",
      targetIndustryClass: "cnc",
      reviewedProfile: {
        companyKey: "other-company",
        industryClass: "cnc",
        verificationLevel: "verified",
        verdictRevisionId: "revision-wrong-company",
        evidenceSummary: "Wrong company.",
        reviewedAt: 103,
        sourceCount: 1,
        sourcePreviews: [],
      },
      compatibilityMode: "strict-reviewed",
    });

    expect(result.verdict).toBe("candidate");
    expect(result.needsReview).toBe(true);
    expect(result.verdictRevisionId).toBeUndefined();
    expect(result.reasonSummary).toContain(
      "reviewed profile companyKey mismatch -> ignored",
    );
  });
});
