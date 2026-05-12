import { Fragment } from 'react'

/**
 * Highlight matching segments of `text` that match any of the provided `terms`.
 * Returns React elements with `<mark>` tags around matched substrings.
 * Case-insensitive matching. If terms is empty or text is falsy, returns the raw text.
 */
export function highlightTerms(
  text: string | null | undefined,
  terms: string[],
): React.ReactNode {
  if (!text || terms.length === 0) return text ?? null

  const escaped = terms
    .filter((t) => t.trim().length > 0)
    .map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))

  if (escaped.length === 0) return text

  const pattern = new RegExp(`(${escaped.join('|')})`, 'i')
  const parts = text.split(pattern)

  if (parts.length === 1) return text

  return parts.map((part, i) => {
    if (!part) return null
    return pattern.test(part) ? (
      <mark key={i} className="bg-yellow-200/70 rounded-sm px-0.5">
        {part}
      </mark>
    ) : (
      <Fragment key={i}>{part}</Fragment>
    )
  })
}
