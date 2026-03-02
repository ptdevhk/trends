let currentWorkspaceSlug = 'dev'

export const workspaceRef = {
  get(): string {
    return currentWorkspaceSlug
  },
  set(slug: string): void {
    currentWorkspaceSlug = slug
  },
}

export function withWorkspaceHeaders(headers?: HeadersInit): Headers {
  const nextHeaders = new Headers(headers)
  nextHeaders.set('X-Workspace-Slug', workspaceRef.get())
  return nextHeaders
}
