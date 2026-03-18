import type {
  ResumeDigitalIdentity,
  ResumeIndustry,
  ResumeLanguageDetail,
  ResumeLicenceDetail,
  ResumeProfileEducationItem,
  ResumeRightToWork,
  ResumeSkillDetail,
  ResumeSnippet,
  ResumeWorkHistoryItem,
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
};

export type ResumeIngestBrandHit = {
  brand: string;
  role: string;
  source: string;
  context: string;
  companyId?: number;
};

export type ResumeIngestMatchedWorkEntry = {
  companyName?: string;
  jobTitle?: string;
  years: number;
  industryVerified: boolean;
  matchedSignals: string[];
};

export type ResumeIngestRoleSignal = {
  type: string;
  matchedSignals: string[];
  years: number;
  industryVerifiedYears?: number;
  roleRelevantYears?: number;
  industryVerifiedRelevantYears?: number;
  matchedWorkEntries?: ResumeIngestMatchedWorkEntry[];
};

export type ResumeIngestData = {
  industryTags?: string[];
  brandHits?: ResumeIngestBrandHit[];
  companyHits?: string[];
  industryDbV2Raw?: number;
  roleSignals?: ResumeIngestRoleSignal[];
};

export type ResumeItem = {
  name: string;
  profileUrl: string;
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
};

export type ResumeSampleFile = {
  name: string;
  filename: string;
  updatedAt: string;
  size: number;
};
