const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export type AuthUserLabelInput = {
  id: string
  displayName?: string
  email?: string
}

/**
 * Human-friendly account label for chrome (header chip, etc.).
 * Never surfaces raw UUIDs — those are not meaningful to operators.
 */
export function formatAuthUserLabel(user: AuthUserLabelInput): string {
  const displayName = user.displayName?.trim()
  if (displayName) return displayName

  const email = user.email?.trim()
  if (email) return email

  const id = user.id?.trim()
  if (id && !UUID_RE.test(id)) return id

  return 'Account'
}
