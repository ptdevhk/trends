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

export type ResumeItem = {
  name: string;
  profileUrl: string;
  activityStatus: string;
  age: string;
  experience: string;
  education: string;
  location: string;
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
