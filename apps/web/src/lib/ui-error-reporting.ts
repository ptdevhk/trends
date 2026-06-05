export function reportUiError(message: string, error?: unknown, ...details: unknown[]) {
  if (!import.meta.env.DEV) {
    return
  }

  if (error === undefined && details.length === 0) {
    console.error(message)
    return
  }

  console.error(message, error, ...details)
}
