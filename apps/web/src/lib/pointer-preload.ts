export function shouldPreloadOnPointerDown(pointerType: string | undefined): boolean {
  const normalized = pointerType?.trim().toLowerCase()
  return normalized === 'touch' || normalized === 'pen'
}
