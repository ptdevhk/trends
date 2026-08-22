import type {
  BrandOrigin,
  ProductClass,
  ResumeDigitalIdentity,
  ResumeIndustry,
  ResumeLanguageDetail,
  ResumeLicenceDetail,
  ResumeProfileEducationItem,
  ResumeRightToWork,
  ResumeSkillDetail,
  ResumeSnippet,
  ResumeWorkHistoryItem,
  VerifiedIndustryEvidenceSummary,
  LocationHierarchy,
} from "@trends/shared";

export type {
  ResumeDigitalIdentity,
  ResumeIndustry,
  ResumeLanguageDetail,
  ResumeLicenceDetail,
  ResumeProfileEducationItem,
  ResumeRightToWork,
  ResumeSkillDetail,
  ResumeSnippet,
  ResumeWorkHistoryItem,
  VerifiedIndustryEvidenceSummary,
};

export type ResumeIngestBrandHit = {
  brand: string;
  role: string;
  source: string;
  context: string;
  companyId?: number;
  origin?: BrandOrigin;
  productClass?: ProductClass;
};

export type ResumeIngestMatchedWorkEntry = {
  companyName?: string;
  companyKey?: string;
  jobTitle?: string;
  years: number;
  industryVerified: boolean;
  verdictRevisionId?: string;
  workEntryFingerprint?: string;
  matchedSignals: string[];
  directRoleMatch?: boolean;
};

export type ResumeIngestRoleSignal = {
  type: string;
  matchedSignals: string[];
  signalCount: number;
  occurrences: number;
  years: number;
  industryVerifiedYears?: number;
  roleRelevantYears?: number;
  industryVerifiedRelevantYears?: number;
  matchedWorkEntries?: ResumeIngestMatchedWorkEntry[];
  verifyIn: string;
};

export type ResumeIngestData = {
  industryTags?: string[];
  synonymHits?: string[];
  evidenceText?: string;
  brandHits?: ResumeIngestBrandHit[];
  /** Candidate-level brand origin aggregate; analysis/debug signal only */
  brandOrigin?: BrandOrigin;
  /** Candidate-level machine origin (verified profile > employer surface > brandHits fallback) */
  machineOrigin?: "international" | "domestic" | "unknown";
  /** Candidate-level product class aggregate; analysis/debug signal only */
  productClass?: ProductClass;
  companyHits?: string[];
  industryDbV2Raw?: number;
  roleSignals?: ResumeIngestRoleSignal[];
  verifiedRoleYears?: Record<string, number>;
  ruleScores?: Record<string, number>;
  experienceLevel?: string;
  market?: string;
  computedAt?: number;
  skillsVersion?: number;
  ingestComputeEpoch?: number;
  evidenceProjectionVersion?: number;
  verifiedIndustryEvidenceSummaries?: VerifiedIndustryEvidenceSummary[];
  industryEvidenceCatalogState?: "ready" | "degraded";
};

export type ResumeItem = {
  name: string;
  profileUrl: string;
  source?: string;
  sourceKey?: string;
  companyKeyProjection?: {
    epoch?: number;
    companyKeys?: string[];
    companyTokens?: string[];
  };
  activityStatus: string;
  age: string;
  experience: string;
  education: string;
  location: string;
  locationHierarchy?: LocationHierarchy;
  selfIntro: string;
  jobIntention: string;
  expectedSalary: string;
  workHistory: ResumeWorkHistoryItem[];
  projectExperience?: ResumeWorkHistoryItem[];
  profileEducation?: ResumeProfileEducationItem[];
  skills?: Array<string | ResumeSkillDetail>;
  languages?: Array<string | ResumeLanguageDetail>;
  licences?: Array<string | ResumeLicenceDetail>;
  resumeSnippet?: string | ResumeSnippet;
  currentIndustry?: string | ResumeIndustry;
  currentSubindustry?: string | ResumeIndustry;
  rightToWork?: string | boolean | ResumeRightToWork;
  digitalIdentity?: string | ResumeDigitalIdentity;
  noticePeriodDays?: number;
  ingestData?: ResumeIngestData;
  extractedAt: string;
  resumeId?: string;
  perUserId?: string;
  profileId?: string;
  profileType?: string;
  externalId?: string;
  identityKey?: string;
  searchText?: string;
};

export type ResumeSampleFile = {
  name: string;
  filename: string;
  updatedAt: string;
  size: number;
};
