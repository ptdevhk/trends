import {
  hasActiveOverride,
  isCompanyWorkflowBlocked,
  primaryCompanyPolicyHit,
  type CandidatePolicyOverride,
  type CompanyPolicyMatchHit,
} from '@trends/shared'

export type ResumeEmployerInput = {
  workHistory?: Array<
    { companyName?: string; raw?: string; companyKey?: string } | null | undefined
  > | null
  companyHits?: string[] | null
  identityKey?: string
  /** Resume source market key (schema field); routes the per-market index (T5). */
  sourceKey?: string | null
}

export type ResumeCompanyPolicyState = {
  hits: CompanyPolicyMatchHit[]
  hidden: boolean
  workflowBlocked: boolean
  primary: CompanyPolicyMatchHit | null
  overriddenCompanyKeys: string[]
}

export function getResumeCompanyPolicyState(
  input: ResumeEmployerInput,
  matchResume: (input: ResumeEmployerInput) => CompanyPolicyMatchHit[],
  overrides?: CandidatePolicyOverride[] | undefined,
  resumeIdentity?: string | undefined,
): ResumeCompanyPolicyState {
  const hits = matchResume(input)
  const identity = (resumeIdentity ?? input.identityKey)?.trim() ?? ''

  const hiddenCompanies = hits.filter((hit) => hit.effects.visibility === 'hide')
  const hiddenCompanyKeys = hiddenCompanies.map((hit) => hit.companyKey)
  const overriddenHiddenKeys = hiddenCompanies
    .filter((hit) => hasActiveOverride(overrides, identity, hit.companyKey))
    .map((hit) => hit.companyKey)

  const blockedCompanies = hits.filter((hit) => hit.effects.workflow === 'blocked')
  const overriddenBlockedKeys = blockedCompanies
    .filter((hit) => hasActiveOverride(overrides, identity, hit.companyKey))
    .map((hit) => hit.companyKey)

  const overriddenCompanyKeys = Array.from(
    new Set([...overriddenBlockedKeys, ...overriddenHiddenKeys]),
  )

  const allBlockedOverridden =
    blockedCompanies.length > 0 && overriddenBlockedKeys.length === blockedCompanies.length

  const hidden =
    hiddenCompanyKeys.length > 0 && overriddenHiddenKeys.length < hiddenCompanyKeys.length

  return {
    hits,
    hidden,
    workflowBlocked: isCompanyWorkflowBlocked(hits) && !allBlockedOverridden,
    primary: primaryCompanyPolicyHit(hits),
    overriddenCompanyKeys,
  }
}

export function filterItemsByCompanyPolicyHide<T>(
  items: T[],
  resolve: (item: T) => ResumeEmployerInput,
  matchResume: (input: ResumeEmployerInput) => CompanyPolicyMatchHit[],
  showHidden: boolean,
  overrides?: CandidatePolicyOverride[] | undefined,
): { visible: T[]; hiddenCount: number } {
  const visible: T[] = []
  let hiddenCount = 0
  for (const item of items) {
    const resolved = resolve(item)
    const state = getResumeCompanyPolicyState(resolved, matchResume, overrides, resolved.identityKey)
    if (state.hidden) {
      hiddenCount += 1
      if (showHidden) {
        visible.push(item)
      }
      continue
    }
    visible.push(item)
  }
  return { visible, hiddenCount }
}

export function toastCompanyPolicyWorkflowBlocked(
  t: (key: string, options?: Record<string, unknown>) => string,
  displayName?: string,
): string {
  return t('settings.policies.runtime.workflowBlockedToast', {
    defaultValue: 'Blocked by company policy (No-hire): {{name}}.',
    name: displayName ?? 'company',
  })
}

