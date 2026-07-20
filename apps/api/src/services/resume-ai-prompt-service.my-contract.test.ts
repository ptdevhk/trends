/**
 * Characterization / contract test: MY market AI-scoring prompt contract.
 *
 * Locks the MY market scoring rule across both resume AI prompt locale files
 * (config/resume/ai-prompts.md zh-Hans master + config/resume/ai-prompts.en.md
 * English variant) so a future prompt edit cannot silently drift the MY
 * 40/50 industry_db rule, the market/verifiedCompanies/brandHits hydration
 * slots, the verified:0 domain-relevant rule, or the final-score formula.
 *
 * This is a LOCK test — it starts green (the MY contract shipped in PR #1333 /
 * 2026-07-02-my-authoritative-scoring-parity) and catches silent drift. It is
 * NOT a TDD red phase; the behavior under test already exists. See
 * projects/trends/work/2026-07-20-my-scoring-prompt-body-contract-test/spec.md
 * § TDD Honesty Note.
 *
 * Gap-closure cycle 1 of the MY scoring gap-closure sequence (gap #4).
 */
import { describe, expect, it } from "vitest";

import { ResumeAiPromptService } from "./resume-ai-prompt-service";

const svc = new ResumeAiPromptService();

type LocaleNeedles = {
  /** Locale code accepted by loadPromptVariant. */
  locale: string;
  /** Substring identifying the MY market condition line in the user prompt template. */
  myMarketMarker: string;
  /** Substring for the verified:0 "does NOT mean cross-industry" clause. */
  verifiedZeroNotCrossIndustry: string;
  /** Substring for the "score normally / do not hard-cap to 15" clause. */
  verifiedZeroNoHardCap: string;
};

const LOCALES: LocaleNeedles[] = [
  {
    locale: "zh-Hans",
    myMarketMarker: "市场 = MY",
    verifiedZeroNotCrossIndustry: "不代表",
    verifiedZeroNoHardCap: "不应硬性扣到 15",
  },
  {
    locale: "en",
    myMarketMarker: "Market = MY",
    verifiedZeroNotCrossIndustry: "does NOT mean",
    verifiedZeroNoHardCap: "do not hard-cap to 15",
  },
];

// Final-score formula needle — locale-agnostic shape (both files use the same
// `round(related_exp × 0.5)` expression). Tolerates × (U+00D7) vs ASCII x.
const FINAL_SCORE_FORMULA = /round\(related_exp\s*[×x]\s*0\.5\)/;

describe("MY market AI-scoring prompt contract", () => {
  describe.each(LOCALES)(
    "locale: $locale",
    ({ locale, myMarketMarker, verifiedZeroNotCrossIndustry, verifiedZeroNoHardCap }) => {
      // Load once per locale; loadPromptVariant resolves the on-disk file.
      const doc = svc.loadPromptVariant(locale);
      const userPrompt = doc.sections.userPromptTemplate;
      const raw = doc.rawMarkdown;

      describe("MY industry_db 40/50 rule (user prompt template)", () => {
        it("declares a MY-market-specific industry_db rule with floor 40 and both-hit 50", () => {
          // Locate the MY rule line once; 40 (no-hit floor / either-hit) and
          // 50 (both-hit) are clauses of the same rule sentence.
          const myLine = userPrompt
            .split("\n")
            .find((line) => line.includes(myMarketMarker));
          expect(myLine).toBeTruthy();
          expect(myLine).toContain("40");
          expect(myLine).toContain("50");
        });
      });

      describe("MY hydration slots (user prompt template)", () => {
        it("exposes {market}", () => {
          expect(userPrompt).toContain("{market}");
        });

        it("exposes {verifiedCompanies}", () => {
          expect(userPrompt).toContain("{verifiedCompanies}");
        });

        it("exposes {brandHits}", () => {
          expect(userPrompt).toContain("{brandHits}");
        });
      });

      describe("verified:0 domain-relevant rule (raw markdown)", () => {
        it("states verified:0 does NOT mean cross-industry", () => {
          expect(raw).toContain("verified:0");
          expect(raw).toContain(verifiedZeroNotCrossIndustry);
        });

        it("states domain-relevant unverified sales should not be hard-capped to 15", () => {
          expect(raw).toContain(verifiedZeroNoHardCap);
        });
      });

      describe("final-score formula (raw markdown)", () => {
        it("states Final AI Score = round(related_exp × 0.5) + system industry_db", () => {
          expect(raw).toMatch(FINAL_SCORE_FORMULA);
          expect(raw).toContain("industry_db");
        });
      });
    },
  );
});
