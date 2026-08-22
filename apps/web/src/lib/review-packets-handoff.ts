/**
 * review-packets-handoff - sessionStorage bridge between the search bulk bar
 * and the review-packets page (avoids URL-length limits for the 2,000-ID cap).
 */

export const REVIEW_PACKET_HANDOFF_KEY = 'reviewPacketHandoff'
export const REVIEW_PACKET_HANDOFF_TTL_MS = 30 * 60 * 1000

export function writeReviewPacketHandoff(resumeIds: string[]): void {
  const payload = { ids: resumeIds, at: Date.now() }
  window.sessionStorage.setItem(REVIEW_PACKET_HANDOFF_KEY, JSON.stringify(payload))
}

export function readReviewPacketHandoff(): string[] | null {
  const raw = window.sessionStorage.getItem(REVIEW_PACKET_HANDOFF_KEY)
  if (!raw) {
    return null
  }
  try {
    const payload: unknown = JSON.parse(raw)
    if (
      typeof payload !== 'object' ||
      payload === null ||
      !Array.isArray((payload as { ids?: unknown }).ids)
    ) {
      return null
    }
    const { ids, at } = payload as { ids: unknown[]; at?: unknown }
    const fresh = typeof at === 'number' && Date.now() - at < REVIEW_PACKET_HANDOFF_TTL_MS
    const parsed = ids.filter((id): id is string => typeof id === 'string' && id.trim().length > 0)
    return fresh && parsed.length > 0 ? parsed : null
  } catch {
    return null
  }
}

export function clearReviewPacketHandoff(): void {
  window.sessionStorage.removeItem(REVIEW_PACKET_HANDOFF_KEY)
}
