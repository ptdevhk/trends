export const RESUME_HOME_RESET_STATE: { readonly resetResumeSearch: true } = {
  resetResumeSearch: true,
}

export function isResumeHomeResetState(value: unknown): value is { resetResumeSearch: true } {
  return typeof value === 'object'
    && value !== null
    && 'resetResumeSearch' in value
    && value.resetResumeSearch === true
}
