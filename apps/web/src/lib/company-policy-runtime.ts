import {
  isCompanyPolicyHidden,
  isCompanyWorkflowBlocked,
  primaryCompanyPolicyHit,
  type CompanyPolicyMatchHit,
} from '@trends/shared'

export type ResumeEmployerInput = {
  workHistory?: Array<{ companyName?: string; raw?: string } | null | undefined> | null
  companyHits?: string[] | null
}

export type ResumeCompanyPolicyState = {
  hits: CompanyPolicyMatchHit[]
  hidden: boolean
  workflowBlocked: boolean
  primary: CompanyPolicyMatchHit | null
}

export function getResumeCompanyPolicyState(
  input: ResumeEmployerInput,
  matchResume: (input: ResumeEmployerInput) => CompanyPolicyMatchHit[],
): ResumeCompanyPolicyState {
  const hits = matchResume(input)
  return {
    hits,
    hidden: isCompanyPolicyHidden(hits),
    workflowBlocked: isCompanyWorkflowBlocked(hits),
    primary: primaryCompanyPolicyHit(hits),
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
    defaultValue:
      'Blocked by company policy (No-hire): {{name}}. Operational only — AI score unchanged.',
    name: displayName ?? 'company',
  })
}
