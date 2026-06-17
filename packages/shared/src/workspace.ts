export const WORKSPACE_TEAMS = {
  dev: { name: "Development" },
  hr: { name: "HR Team" },
} as const;

export type WorkspaceSlug = keyof typeof WORKSPACE_TEAMS;

export function isValidWorkspace(slug: string): slug is WorkspaceSlug {
  return Object.prototype.hasOwnProperty.call(WORKSPACE_TEAMS, slug);
}

export function listWorkspaceSlugs(): WorkspaceSlug[] {
  return Object.keys(WORKSPACE_TEAMS).filter(isValidWorkspace);
}

export function formatWorkspaceSlugList(): string {
  return listWorkspaceSlugs().join(", ");
}
