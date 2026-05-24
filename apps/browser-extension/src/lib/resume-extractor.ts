// @ts-nocheck
import type { Selectors } from "./types";

export interface ResumeWorkHistoryItem {
  raw: string;
  company?: string;
  duration?: string;
  position?: string;
}

export interface ResumeEducationItem {
  institution?: string;
  qualification?: string;
  endDate?: string;
}

export interface ResumeData {
  name: string;
  profileUrl: string;
  activityStatus: string;
  age?: number;
  experience?: string;
  education?: string;
  location?: string;
  jobIntention: string;
  expectedSalary: string;
  selfIntro: string;
  workHistory: ResumeWorkHistoryItem[];
  profileEducation?: ResumeEducationItem[];
  extractedAt: string;
  source: string;
}

export interface ResumeExtractorDeps {
  SELECTORS: Selectors;
  JOB5156_HOST: string;
  doc: Document;
  getCurrentSourceKey: () => string;
  SOURCE_KEYS: Record<string, string>;
  extractProfileUrl: (card: Element, apiRow: any) => string;
  parseJob5156BasicInfoItems: (items: string[], locationOverride: string) => {
    age?: number;
    experience?: string;
    education?: string;
    location?: string;
  };
  buildJob5156WorkHistoryItem: (item: Element) => ResumeWorkHistoryItem | null;
  buildJob5156EducationItem: (item: Element) => ResumeEducationItem | null;
  // Detail page extraction deps
  isJob51DetailPage: () => boolean;
  isJob5156DetailPage: () => boolean;
  isJob51DetailReady: () => boolean;
  isJob5156DetailReady: () => boolean;
  getJob51DetailRoot: () => Element | null;
  getJob5156DetailRoot: () => Element | null;
  getJob51ResumePayload: () => any;
  getJob5156ResumePayload: () => any;
  getApiRowForIndex: (index: number) => any;
  normalizeResumeText: (text: string) => string;
  normalizeResumeMultilineText: (text: string) => string;
  applyCollectionGuards: (resume: any, guardFieldNames: Set<string>) => any;
  parseGuardFieldNames: (csv: string) => Set<string>;
  GUARD_FIELD_NAMES: Set<string>;
  DEFAULT_COLLECTION_GUARDS: Record<string, string>;
}

export function createResumeExtractor(deps: ResumeExtractorDeps) {
  const {
    SELECTORS,
    JOB5156_HOST,
    doc,
    getCurrentSourceKey,
    SOURCE_KEYS,
    extractProfileUrl,
    parseJob5156BasicInfoItems,
    buildJob5156WorkHistoryItem,
    buildJob5156EducationItem,
    isJob51DetailPage,
    isJob5156DetailPage,
    isJob51DetailReady,
    isJob5156DetailReady,
    getJob51DetailRoot,
    getJob5156DetailRoot,
    getJob51ResumePayload,
    getJob5156ResumePayload,
    getApiRowForIndex,
    normalizeResumeText,
    normalizeResumeMultilineText,
    applyCollectionGuards,
    parseGuardFieldNames,
    GUARD_FIELD_NAMES,
    DEFAULT_COLLECTION_GUARDS,
  } = deps;

  function extractSingleResume(card: Element, apiRow: any = null): ResumeData {
    const getText = (selector: string, root: Element = card): string => {
      const el = root.querySelector(selector);
      return el ? el.textContent?.trim() || "" : "";
    };

    const pickText = (selectors: string[]): string => {
      for (const selector of selectors) {
        const text = getText(selector);
        if (text) return text;
      }
      return "";
    };

    // Extract basic info (age, experience, education, location)
    const basicInfoContainer =
      card.querySelector(SELECTORS.basicInfoRow) ||
      card.querySelector(".list-content__li__down-left-center");
    const locationFromCard =
      getText(SELECTORS.locationItem, basicInfoContainer || card) ||
      getText(SELECTORS.locationFallbackItem, basicInfoContainer || card);
    const basicInfoSpans = basicInfoContainer
      ? basicInfoContainer.querySelectorAll(
          `${SELECTORS.basicInfoItem}, div:nth-child(2) span, .basic-line span`,
        )
      : ([] as Element[]);

    const basicInfo = Array.from(basicInfoSpans).map(
      (span) => span.textContent || "",
    );
    const { age, experience, education, location } = parseJob5156BasicInfoItems(
      basicInfo,
      locationFromCard,
    );

    // Extract top row (job intention, salary)
    const topRow =
      card.querySelector(SELECTORS.topRowText) ||
      card.querySelector(SELECTORS.topRow);
    const topRowText = topRow
      ? topRow.textContent?.trim().replace(/\s+/g, " ") || ""
      : "";
    const topRowClean = topRowText
      .split("\u4eba\u624d\u6d1e\u5bdf")[0]
      .replace(/\u00b7\s*$/, "")
      .trim();

    let expectedSalary = "";
    const salaryMatch = topRowClean.match(
      /(\d[\d-]*\s*\u5143\/\u6708|\d[\d-]*\s*\u5143|\u9762\u8bae)/,
    );
    if (salaryMatch) expectedSalary = salaryMatch[0].replace(/\s+/g, "");

    let jobIntention = topRowClean.replace(/^\u6c42\u804c\u610f\u5411[:\uff1a]?\s*/, "");
    jobIntention = jobIntention.replace(/\uff08\u901a\u52e4\u8ddd\u79bb[^\uff09]*\uff09/g, "").trim();
    if (expectedSalary) {
      jobIntention = jobIntention
        .replace(expectedSalary, "")
        .replace(/[\u00b7\s]+$/g, "")
        .trim();
    }

    const selfIntro = pickText([
      SELECTORS.selfIntro,
      ".basic-keywords",
      ".basic-keywords span",
    ]);

    // Extract work history
    const workHistoryContainer =
      card.querySelector(SELECTORS.workHistory) ||
      card.querySelector(".list-content__li__down-right-center");
    let workItems: Element[] = [];
    let educationItems: Element[] = [];
    if (workHistoryContainer) {
      const primary = workHistoryContainer.querySelectorAll(SELECTORS.workItem);
      if (primary.length > 0) {
        workItems = Array.from(primary);
        educationItems = Array.from(
          workHistoryContainer.querySelectorAll(".school-item"),
        );
      } else {
        workItems = Array.from(
          workHistoryContainer.querySelectorAll('div[class*="history"]'),
        );
      }
    }

    const seenWorkHistory = new Set<string>();
    const workHistory = workItems
      .map((item) => buildJob5156WorkHistoryItem(item))
      .filter((item): item is NonNullable<typeof item> => item && item.raw.length > 5)
      .filter((item) => {
        if (!item || seenWorkHistory.has(item.raw)) return false;
        seenWorkHistory.add(item.raw);
        return true;
      });

    const seenEducation = new Set<string>();
    const profileEducation = educationItems
      .map((item) => buildJob5156EducationItem(item))
      .filter(
        (item): item is NonNullable<typeof item> =>
          item &&
          [item.institution, item.qualification, item.endDate].some(Boolean),
      )
      .filter((item) => {
        const signature = [
          item.institution || "",
          item.qualification || "",
          item.endDate || "",
        ].join("|");
        if (seenEducation.has(signature)) return false;
        seenEducation.add(signature);
        return true;
      });

    return {
      name: getText(SELECTORS.name),
      profileUrl: extractProfileUrl(card, apiRow),
      activityStatus: getText(SELECTORS.activityStatus),
      age,
      experience,
      education,
      location,
      jobIntention,
      expectedSalary,
      selfIntro,
      workHistory,
      profileEducation:
        profileEducation.length > 0 ? profileEducation : undefined,
      extractedAt: new Date().toISOString(),
      source: JOB5156_HOST,
    };
  }

  return {
    extractSingleResume,
  };
}
