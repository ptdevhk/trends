export const RESEARCH_RECENT_KEY = 'trends.research.recentCompanies.v1'
export const RESEARCH_RECENT_MAX = 8

export type ResearchRecentCompany = {
  companyKey: string
  nameCn: string
  nameEn?: string
  openedAt: number
}

function getStore(storage?: Storage): Storage | null {
  if (storage) return storage
  try {
    if (typeof localStorage !== 'undefined') return localStorage
  } catch {
    /* private mode */
  }
  return null
}

export function loadResearchRecentCompanies(storage?: Storage): ResearchRecentCompany[] {
  const store = getStore(storage)
  if (!store) return []
  try {
    const raw = store.getItem(RESEARCH_RECENT_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return []
    return parsed
      .filter((row): row is ResearchRecentCompany =>
        !!row && typeof row === 'object'
        && typeof (row as ResearchRecentCompany).companyKey === 'string'
        && typeof (row as ResearchRecentCompany).nameCn === 'string'
        && typeof (row as ResearchRecentCompany).openedAt === 'number',
      )
      .slice(0, RESEARCH_RECENT_MAX)
  } catch {
    return []
  }
}

export function upsertResearchRecentCompany(
  entry: { companyKey: string; nameCn: string; nameEn?: string; openedAt?: number },
  storage?: Storage,
): ResearchRecentCompany[] {
  const store = getStore(storage)
  const openedAt = entry.openedAt ?? Date.now()
  const next: ResearchRecentCompany = {
    companyKey: entry.companyKey,
    nameCn: entry.nameCn,
    ...(entry.nameEn ? { nameEn: entry.nameEn } : {}),
    openedAt,
  }
  const prev = loadResearchRecentCompanies(storage).filter((r) => r.companyKey !== next.companyKey)
  const list = [next, ...prev].slice(0, RESEARCH_RECENT_MAX)
  try {
    store?.setItem(RESEARCH_RECENT_KEY, JSON.stringify(list))
  } catch {
    /* ignore quota */
  }
  return list
}
