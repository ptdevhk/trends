/** Cooldown between automatic on-open company research refreshes. */
export const RESEARCH_COMPANY_REFRESH_COOLDOWN_MS = 5 * 60 * 1000

export function researchCompanyRefreshStorageKey(companyKey: string): string {
  return `research.refresh.${companyKey}`
}

/**
 * Whether the company page may fire an automatic ingest after first paint.
 */
export function shouldAutoRefreshCompany(opts: {
  enabled: boolean
  companyKey: string
  now: number
  lastRefreshAt: number | null
  cooldownMs?: number
}): boolean {
  if (!opts.enabled) return false
  const key = opts.companyKey.trim()
  if (!key) return false
  const cooldown = opts.cooldownMs ?? RESEARCH_COMPANY_REFRESH_COOLDOWN_MS
  if (opts.lastRefreshAt == null) return true
  return opts.now - opts.lastRefreshAt >= cooldown
}

export function readLastCompanyRefreshAt(
  companyKey: string,
  storage?: Storage | null,
): number | null {
  const store = storage ?? (typeof sessionStorage !== 'undefined' ? sessionStorage : null)
  if (!store) return null
  try {
    const raw = store.getItem(researchCompanyRefreshStorageKey(companyKey))
    if (!raw) return null
    const n = Number(raw)
    return Number.isFinite(n) ? n : null
  } catch {
    return null
  }
}

export function writeLastCompanyRefreshAt(
  companyKey: string,
  at: number,
  storage?: Storage | null,
): void {
  const store = storage ?? (typeof sessionStorage !== 'undefined' ? sessionStorage : null)
  if (!store) return
  try {
    store.setItem(researchCompanyRefreshStorageKey(companyKey), String(at))
  } catch {
    /* ignore quota */
  }
}

/** Vite env flag: set VITE_RESEARCH_COMPANY_ON_OPEN_REFRESH=1 to enable. */
export function isCompanyOnOpenRefreshEnabled(
  env: Record<string, string | boolean | undefined> = import.meta.env as Record<
    string,
    string | boolean | undefined
  >,
): boolean {
  const raw = env.VITE_RESEARCH_COMPANY_ON_OPEN_REFRESH
  if (raw === true) return true
  const s = String(raw ?? '')
    .trim()
    .toLowerCase()
  return s === '1' || s === 'true' || s === 'yes' || s === 'on'
}
