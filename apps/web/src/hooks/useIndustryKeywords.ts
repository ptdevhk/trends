import { useCallback, useEffect, useMemo, useState } from 'react'
import { rawApiClient } from '@/lib/api-helpers'

export type KeywordCategory =
  | 'machining'
  | 'lathe'
  | 'edm'
  | 'measurement'
  | 'smt'
  | '3d_printing'

export type IndustryKeyword = {
  id: number
  keyword: string
  english?: string
  category: KeywordCategory
}

type IndustryKeywordsResponse = {
  success: boolean
  data?: IndustryKeyword[]
}

export const CATEGORY_ORDER: KeywordCategory[] = [
  'machining',
  'lathe',
  'edm',
  'measurement',
  'smt',
  '3d_printing',
]

export const CATEGORY_LABELS: Record<KeywordCategory, string> = {
  machining: '加工中心',
  lathe: '车床',
  edm: '火花机/线切割',
  measurement: '测量扫描',
  smt: 'SMT',
  '3d_printing': '3D打印',
}

function createGroupedKeywords(): Record<KeywordCategory, IndustryKeyword[]> {
  return {
    machining: [],
    lathe: [],
    edm: [],
    measurement: [],
    smt: [],
    '3d_printing': [],
  }
}

export function useIndustryKeywords() {
  const [keywords, setKeywords] = useState<IndustryKeyword[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const fetchKeywords = useCallback(async () => {
    setLoading(true)
    setError(null)
    const { data, error: apiError } = await rawApiClient.GET<IndustryKeywordsResponse>(
      '/api/industry/keywords'
    )

    if (apiError || !data?.success) {
      setKeywords([])
      setError('Failed to load industry keywords')
      setLoading(false)
      return
    }

    setKeywords(Array.isArray(data.data) ? data.data : [])
    setLoading(false)
  }, [])

  useEffect(() => {
    void fetchKeywords()
  }, [fetchKeywords])

  const grouped = useMemo(() => {
    const groups = createGroupedKeywords()
    for (const item of keywords) {
      groups[item.category].push(item)
    }
    return groups
  }, [keywords])

  const hotKeywords = useMemo(() => {
    return CATEGORY_ORDER.flatMap((category) => grouped[category].slice(0, 3))
  }, [grouped])

  return {
    keywords,
    grouped,
    hotKeywords,
    loading,
    error,
    refresh: fetchKeywords,
  }
}
