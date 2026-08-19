import { useMemo, useState } from 'react'
import type { CandidatePolicyOverride } from '@trends/shared'
import { useCompanyPolicyIndex } from '@/hooks/useCompanyPolicyIndex'
import {
  filterItemsByCompanyPolicyHide,
  type ResumeEmployerInput,
} from '@/lib/company-policy-runtime'

/**
 * Filter a list of items by company-policy visibility=hide.
 * Default: hide no-hire matches; toggle recovers them.
 */
export function useCompanyPolicyListFilter<T>(
  items: T[],
  resolveResume: (item: T) => ResumeEmployerInput,
  overrides?: CandidatePolicyOverride[] | undefined,
) {
  const { matchResume } = useCompanyPolicyIndex(true)
  const [showHidden, setShowHidden] = useState(false)

  const { visible, hiddenCount } = useMemo(
    () => filterItemsByCompanyPolicyHide(items, resolveResume, matchResume, showHidden, overrides),
    [items, matchResume, resolveResume, showHidden, overrides],
  )

  return {
    visibleItems: visible,
    hiddenCount,
    showHidden,
    setShowHidden,
  }
}
