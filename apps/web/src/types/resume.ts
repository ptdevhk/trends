export type ResumeFilters = {
  minExperience?: number
  maxExperience?: number
  minSalesYears?: number
  minAge?: number
  maxAge?: number
  education?: string[]
  skills?: string[]
  locations?: string[]
  status?: CandidateStatus[]
  showBlocked?: boolean
  minSalary?: number
  maxSalary?: number
  minMatchScore?: number
  recommendation?: Recommendation[]
  sortBy?: 'score' | 'name' | 'experience' | 'extractedAt'
  sortOrder?: 'asc' | 'desc'
}

export type Recommendation = 'strong_match' | 'match' | 'potential' | 'no_match'
export type ScoreSource = 'rule' | 'ai'
export type CandidateStatus =
  | 'new'
  | 'contacted'
  | 'interviewing'
  | 'interviewed_pass'
  | 'interviewed_reject'
  | 'offer'
  | 'hired'
  | 'withdrawn'

export type MatchBreakdown = {
  skillMatch: number
  roleMatch: number
  experienceMatch: number
  educationMatch: number
  locationMatch: number
  industryMatch: number
  brandRelevance: number
}

export type MatchingResult = {
  resumeId: string
  jobDescriptionId?: string
  score: number
  recommendation: Recommendation
  highlights: string[]
  concerns: string[]
  summary: string
  matchedAt: string
  sessionId?: string
  userId?: string
  breakdown?: MatchBreakdown
  scoreSource?: ScoreSource
}

export type MatchStats = {
  processed: number
  matched: number
  avgScore: number
  processingTimeMs?: number
}

export type CandidateActionType = 'star' | 'shortlist' | 'reject' | 'archive' | 'note' | 'contact'

export type CandidateAction = {
  id: number
  userId?: string
  sessionId?: string
  resumeId: string
  actionType: CandidateActionType
  actionData?: Record<string, unknown>
  createdAt: string
}
