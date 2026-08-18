import {
  hasActiveOverride,
  isCompanyPolicyHidden,
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
  const identity = resumeIdentity?.trim() ?? ''
  const blockedCompanies = hits.filter((hit) => hit.effects.workflow === 'blocked')
  const overriddenCompanyKeys = blockedCompanies
    .filter((hit) => hasActiveOverride(overrides, identity, hit.companyKey))
    .map((hit) => hit.companyKey)
  const allBlockedOverridden =
    blockedCompanies.length > 0 && overriddenCompanyKeys.length === blockedCompanies.length
  return {
    hits,
    hidden: isCompanyPolicyHidden(hits),
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
): { visible: T[]; hiddenCount: number } {
  const visible: T[] = []
  let hiddenCount = 0
  for (const item of items) {
    const state = getResumeCompanyPolicyState(resolve(item), matchResume)
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

