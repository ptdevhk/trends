export type ResumeFilters = {
  minExperience?: number
  maxExperience?: number
  minRoleYears?: number
  roleFilterType?: string
  minAge?: number
  maxAge?: number
  education?: string[]
  skills?: string[]
  locations?: string[]
  status?: CandidateStatus[]
  showBlocked?: boolean
  showRejected?: boolean
  showArchived?: boolean
  minSalary?: number
  maxSalary?: number
  minMatchScore?: number
  idOrNameSearch?: string
  recommendation?: Recommendation[]
  sortBy?: 'score' | 'name' | 'experience' | 'extractedAt'
  sortOrder?: 'asc' | 'desc'
}

export type TagEnvelopeSource = 'rule' | 'ai'

export type TagEnvelopeEntry = {
  tag: string
  source: TagEnvelopeSource
  confidence: number
  evidence: string[]
  version: number
}

export type TaggingProvenanceStage =
  | 'industry_taxonomy'
  | 'synonym_expansion'
  | 'company_pattern_match'
  | 'role_signal_aggregation'
  | 'experience_signal_detection'
  | 'derived'

export type TaggingEnvelopeEntry = {
  tag: string
  source: TagEnvelopeSource
  confidence: number
  version: number
  provenance: {
    stage: TaggingProvenanceStage
    generatedBy: string
    evidence: string[]
  }
}

export type TaggingEnvelope = {
  schemaVersion: number
  generatedAt: number
  entries: TaggingEnvelopeEntry[]
}

export type Recommendation = 'strong_match' | 'match' | 'potential' | 'no_match'
export type ScoreSource = 'rule' | 'ai'
export type ResumeExportFormat = 'csv' | 'xlsx'
export type CandidateStatus =
  | 'new'
  | 'shortlisted'
  | 'rejected'
  | 'contacted'
  | 'interviewing'
  | 'interviewed_pass'
  | 'interviewed_reject'
  | 'appeal_submitted'
  | 'human_review'
  | 'upheld'
  | 'reversed'
  | 'offer'
  | 'hired'
  | 'withdrawn'

export type MatchBreakdown = Record<string, number>

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
  promptVersion?: number
  locale?: string
}

export type MatchStats = {
  processed: number
  matched: number
  avgScore: number
  processingTimeMs?: number
}

export type AiFeedbackTarget = 'ai_score' | 'ai_summary'
export type AiFeedbackSentiment = 'like' | 'unlike'

export type AiFeedbackState = {
  score?: AiFeedbackSentiment
  summary?: AiFeedbackSentiment
}

export type CandidateActionType =
  | 'star'
  | 'shortlist'
  | 'reject'
  | 'archive'
  | 'note'
  | 'contact'
  | 'rating'
  | 'ai_score_like'
  | 'ai_score_unlike'
  | 'ai_summary_like'
  | 'ai_summary_unlike'

export const AI_FEEDBACK_ACTION_TYPES = {
  ai_score: {
    like: 'ai_score_like',
    unlike: 'ai_score_unlike',
  },
  ai_summary: {
    like: 'ai_summary_like',
    unlike: 'ai_summary_unlike',
  },
} as const satisfies Record<AiFeedbackTarget, Record<AiFeedbackSentiment, CandidateActionType>>

export function actionToAiFeedback(
  actionType: CandidateActionType
): { target: AiFeedbackTarget; sentiment: AiFeedbackSentiment } | null {
  switch (actionType) {
    case 'ai_score_like':
      return { target: 'ai_score', sentiment: 'like' }
    case 'ai_score_unlike':
      return { target: 'ai_score', sentiment: 'unlike' }
    case 'ai_summary_like':
      return { target: 'ai_summary', sentiment: 'like' }
    case 'ai_summary_unlike':
      return { target: 'ai_summary', sentiment: 'unlike' }
    default:
      return null
  }
}

export function aiFeedbackToActionType(
  target: AiFeedbackTarget,
  sentiment: AiFeedbackSentiment
): CandidateActionType {
  return AI_FEEDBACK_ACTION_TYPES[target][sentiment]
}

export type CandidateAction = {
  id: number
  userId?: string
  sessionId?: string
  resumeId: string
  actionType: CandidateActionType
  actionData?: Record<string, unknown>
  createdAt: string
}
