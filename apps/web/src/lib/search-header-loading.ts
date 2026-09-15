/**
 * Decide whether SearchHeader should show the in-flight label.
 *
 * useDeferredValue(filteredResults) can lag one render behind an eager
 * non-empty list after loading clears. Without this guard the header
 * briefly looks settled-empty (0 条结果) during that lag — the UAT false
 * CNC-empty flash after SearchHeader already hides 0 while loading=true.
 */
export function shouldShowSearchHeaderLoading(input: {
  loading: boolean
  isFilterPending?: boolean
  eagerCount: number
  deferredCount: number
}): boolean {
  if (input.loading || input.isFilterPending) {
    return true
  }
  return input.eagerCount > 0 && input.deferredCount === 0
}
