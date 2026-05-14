export function getScoreClassName(score: number): string {
  if (score >= 90) return 'bg-emerald-100 text-emerald-700 border-emerald-200'
  if (score >= 70) return 'bg-sky-100 text-sky-700 border-sky-200'
  if (score >= 50) return 'bg-amber-100 text-amber-700 border-amber-200'
  return 'bg-zinc-100 text-zinc-600 border-zinc-200'
}
