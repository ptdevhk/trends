export type ResumeWorkHistoryItem = {
  raw: string;
};

export type ResumeItem = {
  name: string;
  profileUrl: string;
  activityStatus: string;
  age: string;
  experience: string;
  education: string;
  location: string;
  jobIntention: string;
  expectedSalary: string;
  workHistory: ResumeWorkHistoryItem[];
  extractedAt: string;
  resumeId?: string;
  perUserId?: string;
};

export type ResumeSampleFile = {
  name: string;
  filename: string;
  updatedAt: string;
  size: number;
};
