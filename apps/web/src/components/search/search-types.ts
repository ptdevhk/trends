import type { ConvexResumeItem } from '@/hooks/useConvexResumes'
import type { SearchHistoryItem } from '@/hooks/useSession'
import type { CandidateStatus } from '@/types/resume'
import type { CandidateStatusRecord } from '@/hooks/useCandidateStatus'

export type SearchSortValue = 'score' | 'newest' | 'experience'
export type SearchScoreSource = 'ai' | 'rule'

export type FacetValueCount = {
  value: string
  count: number
  label?: string
}

export type FacetCounts = {
  clusters: FacetValueCount[]
  tags: FacetValueCount[]
  brands: FacetValueCount[]
  companies: FacetValueCount[]
  experienceLevels: FacetValueCount[]
  education: FacetValueCount[]
  statuses: FacetValueCount[]
  minScoreOptions: FacetValueCount[]
  sources: FacetValueCount[]
}

export type ResumeSearchResultItem = {
  key: string
  identityKey: string
  resume: ConvexResumeItem
  blocked: boolean
  analysis?: ConvexResumeItem['analysis']
  score?: number
  scoreSource?: SearchScoreSource
  status: CandidateStatus
  statusMeta?: CandidateStatusRecord
}

export type ResumeSearchRecentItem = SearchHistoryItem
