import type { ConvexResumeItem } from '@/hooks/useConvexResumes'
import type { SearchHistoryItem } from '@/hooks/useSession'
import type { CandidateStatus } from '@/types/resume'
import type { CandidateStatusRecord } from '@/hooks/useCandidateStatus'

export type SearchSortValue = 'relevance' | 'newest' | 'experience'

export type FacetValueCount = {
  value: string
  count: number
}

export type FacetCounts = {
  tags: FacetValueCount[]
  companies: FacetValueCount[]
  experienceLevels: FacetValueCount[]
  education: FacetValueCount[]
  statuses: FacetValueCount[]
  minScoreOptions: FacetValueCount[]
}

export type ResumeSearchResultItem = {
  key: string
  identityKey: string
  resume: ConvexResumeItem
  blocked: boolean
  score?: number
  status: CandidateStatus
  statusMeta?: CandidateStatusRecord
}

export type ResumeSearchRecentItem = SearchHistoryItem
