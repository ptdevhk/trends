/**
 * Human-readable labels for research signal kinds (HR desk, ZH-first).
 * Shared by hub showcase cards and company brand panel so kind chips
 * never show raw API tokens like `hiring_signal`.
 */
export const RESEARCH_SIGNAL_KIND_LABEL_ZH: Record<string, string> = {
  company_mention: '提及',
  hiring_signal: '招聘',
  market_move: '市场',
  sales_trigger: '销售',
}

export function researchSignalKindLabel(kind: string): string {
  return RESEARCH_SIGNAL_KIND_LABEL_ZH[kind] ?? kind
}
