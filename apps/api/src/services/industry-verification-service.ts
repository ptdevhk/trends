/**
 * Final industry verification service.
 *
 * Wraps the deterministic IndustryDataService lexical matcher with a tiered
 * verdict model that distinguishes verified / candidate / rejected based on
 * employer-name strength + duty evidence.
 *
 * The lexical matcher (industry-data-service) stays focused on seed matching;
 * this service owns the final badge/gate truth decision.
 */

import { IndustryDataService, type CompanyEntry } from "./industry-data-service.js";

export type IndustryVerdict = "verified" | "candidate" | "rejected";

export type EmployerEvidenceStrength = "strong" | "weak" | "none";

export type EmployerSource =
  | "known_company"
  | "reviewed_alias"
  | "reviewed_profile"
  | "keyword_match"
  | "brand_match"
  | "pattern_match"
  | "none";

export type DutyEvidence = "positive" | "neutral" | "negative";

export interface IndustryVerdictResult {
  verdict: IndustryVerdict;
  strength: EmployerEvidenceStrength;
  employerSource: EmployerSource;
  dutyEvidence: DutyEvidence;
  confidence: number;
  companyKey?: string;
  matchedKeywords: string[];
  reasonSummary: string[];
  needsReview: boolean;
  /** Original lexical matcher result, preserved for diagnostics. */
  seedMatchType: "known_company" | "keyword_match" | "none";
  /** Resolved company entry when the seed matcher found a known company. */
  company?: CompanyEntry;
}

// --- Duty evidence cue lists (v1: small and explicit) ---

const POSITIVE_DUTY_CUES = [
  // CNC / machining
  "cnc", "数控", "加工中心", "车床", "铣床", "磨床",
  "机床", "机械加工", "金加工", "金属加工",
  "模具", "夹具", "量具", "刀具",
  "三坐标", "测量", "metrology", "cmm",
  "automation", "自动化", "plc", "伺服",
  "machining", "machine tool", "precision machining",
  "机械", "machinery",
  // Sales of CNC/machinery equipment
  "机床销售", "设备销售", "机械销售",
  "machine tool sales", "equipment sales",
];

const NEGATIVE_DUTY_CUES = [
  // Medical device (orthopedics, implants, surgical)
  "orthopedic", "orthopaedic", "植入物", "医疗器械", "医疗",
  "medical device", "surgical", "手术", "骨科",
  "dental", "牙科",
  // FMCG / retail / food
  "fmcg", "fast moving consumer", "消费品",
  "retail", "零售", "超市", "便利店",
  "food", "beverage", "食品", "饮料", "餐饮",
  "sports", "运动用品", "体育",
  // Telecom / ISP / mobile
  "telecom", "telecommunications", "通信", "电信", "运营商",
  "mobile", "手机", "智能手机",
  // Real estate / construction (non-industrial)
  "real estate", "房地产", "物业",
  "construction", "建筑", "建材",
  // Logistics / courier (non-industrial)
  "logistics", "freight", "快递", "物流",
  "courier", "express delivery",
  // Financial / insurance
  "insurance", "保险", "银行", "banking",
  "financial services", "金融服务",
  // Automotive (non-industrial sales)
  "automotive sales", "汽车销售", "4s店",
  "car dealership",
];

// Employers whose name alone is ambiguous but duty text can disambiguate.
const AMBIGUOUS_SHORT_ALIASES = new Set([
  "star", "omm", "vision", "bestari", "symmetry",
]);

export class IndustryVerificationService {
  constructor(
    private readonly industryDataService: IndustryDataService,
  ) {}

  /**
   * Resolve a final industry verdict for a work-history entry.
   *
   * @param companyName - Employer name extracted from work history
   * @param dutyText - Concatenated job title + description + raw text
   */
  resolveVerdict(
    companyName: string | undefined,
    dutyText: string | undefined,
  ): IndustryVerdictResult {
    const employerName = (companyName ?? "").trim();
    const duty = (dutyText ?? "").trim().toLowerCase();
    const reasonSummary: string[] = [];
    const dutyEvidence = this.classifyDutyEvidence(duty);

    // Empty employer name: always rejected regardless of duty text.
    if (!employerName) {
      return {
        verdict: "rejected",
        strength: "none",
        employerSource: "none",
        dutyEvidence,
        confidence: 0,
        matchedKeywords: [],
        reasonSummary: ["empty employer name -> rejected"],
        needsReview: false,
        seedMatchType: "none",
      };
    }

    // 1. Run the deterministic seed matcher.
    const seed = this.industryDataService.verifyCompanyIndustry(employerName);
    const { strength, employerSource } = this.classifyEmployerEvidence(
      employerName,
      seed,
    );
    const companyKey = seed.company
      ? this.industryDataService.getCompanyKey(seed.company)
      : undefined;

    reasonSummary.push(`employer_source=${employerSource}`);
    reasonSummary.push(`employer_strength=${strength}`);
    reasonSummary.push(`duty_evidence=${dutyEvidence}`);

    // 2. Resolve final verdict via promotion/veto rules.
    let verdict: IndustryVerdict;
    let needsReview = false;

    if (strength === "none" && dutyEvidence === "negative") {
      verdict = "rejected";
      reasonSummary.push("no employer evidence + negative duty -> rejected");
    } else if (strength === "none") {
      // No employer evidence, non-negative duty: queue for review, do not verify.
      verdict = "candidate";
      needsReview = true;
      reasonSummary.push("no employer evidence + non-negative duty -> candidate (needs review)");
    } else if (dutyEvidence === "negative") {
      // Strong or weak employer evidence but duty clearly describes another domain.
      verdict = "rejected";
      reasonSummary.push(`${strength} employer evidence + negative duty -> rejected`);
    } else if (strength === "strong") {
      // Strong employer evidence + non-negative duty.
      verdict = "verified";
      reasonSummary.push("strong employer evidence + non-negative duty -> verified");
    } else if (strength === "weak" && dutyEvidence === "positive") {
      // Weak employer evidence but duty clearly describes CNC/machinery work.
      verdict = "verified";
      reasonSummary.push("weak employer evidence + positive duty -> promoted to verified");
    } else {
      // Weak employer evidence + neutral duty.
      verdict = "candidate";
      needsReview = true;
      reasonSummary.push("weak employer evidence + neutral duty -> candidate (needs review)");
    }

    // Ambiguous short aliases should never auto-verify by substring alone.
    if (
      verdict === "verified" &&
      employerSource !== "known_company" &&
      employerSource !== "reviewed_alias" &&
      employerSource !== "reviewed_profile" &&
      AMBIGUOUS_SHORT_ALIASES.has(employerName.toLowerCase().trim())
    ) {
      verdict = "candidate";
      needsReview = true;
      reasonSummary.push("ambiguous short alias downgraded to candidate");
    }

    return {
      verdict,
      strength,
      employerSource,
      dutyEvidence,
      confidence: seed.confidence,
      ...(companyKey ? { companyKey } : {}),
      matchedKeywords: seed.matchedKeywords,
      reasonSummary,
      needsReview,
      seedMatchType: seed.matchType,
      ...(seed.company ? { company: seed.company } : {}),
    };
  }

  private classifyEmployerEvidence(
    employerName: string,
    seed: { verified: boolean; confidence: number; matchType: string; company?: CompanyEntry },
  ): { strength: EmployerEvidenceStrength; employerSource: EmployerSource } {
    if (!employerName.trim()) {
      return { strength: "none", employerSource: "none" };
    }

    // Tier 1: known company (exact or qualified partial match against seed data).
    if (seed.matchType === "known_company" && seed.verified) {
      return { strength: "strong", employerSource: "known_company" };
    }

    // Tier 2: keyword match in company name (e.g. "CNC", "机床").
    if (seed.matchType === "keyword_match" && seed.verified) {
      // High-confidence keyword match (confidence >= 0.5) = brand match.
      if (seed.confidence >= 0.5) {
        return { strength: "weak", employerSource: "brand_match" };
      }
      // Lower-confidence keyword match.
      return { strength: "weak", employerSource: "keyword_match" };
    }

    return { strength: "none", employerSource: "none" };
  }

  private classifyDutyEvidence(dutyText: string): DutyEvidence {
    if (!dutyText) {
      return "neutral";
    }

    const hasPositive = POSITIVE_DUTY_CUES.some((cue) =>
      dutyText.includes(cue.toLowerCase()),
    );
    const hasNegative = NEGATIVE_DUTY_CUES.some((cue) =>
      dutyText.includes(cue.toLowerCase()),
    );

    if (hasPositive && !hasNegative) {
      return "positive";
    }
    if (hasNegative && !hasPositive) {
      return "negative";
    }
    // Both present or neither: neutral.
    return "neutral";
  }
}
