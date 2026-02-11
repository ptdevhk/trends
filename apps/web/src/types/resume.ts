export type ResumeFilters = {
  minExperience?: number
  maxExperience?: number
  education?: string[]
  skills?: string[]
  locations?: string[]
  minSalary?: number
  maxSalary?: number
  minMatchScore?: number
  recommendation?: Recommendation[]
  sortBy?: 'score' | 'name' | 'experience' | 'extractedAt'
  sortOrder?: 'asc' | 'desc'
}

export type Recommendation = 'strong_match' | 'match' | 'potential' | 'no_match'

export type MatchingResult = {
  resumeId: string
  jobDescriptionId?: string
  score: number
  scoreSource?: 'rule' | 'ai'
  recommendation: Recommendation
  highlights: string[]
  concerns: string[]
  summary: string
  matchedAt: string
  sessionId?: string
  userId?: string
  breakdown?: Record<string, number>
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
