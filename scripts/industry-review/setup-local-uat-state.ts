export type ExistingUatState = {
  namespace?: string
}

export function existingUatStateShouldSkip(
  stateFileExists: boolean,
  existing: ExistingUatState | null,
  fixtureNamespace: string,
): boolean {
  return Boolean(stateFileExists && existing?.namespace === fixtureNamespace)
}

export function skippedExistingUatStateReport(stateFile: string, namespace: string) {
  return {
    status: "skipped" as const,
    reason: "state-file-exists",
    stateFile,
    namespace,
  }
}
