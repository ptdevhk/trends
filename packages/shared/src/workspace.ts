export const WORKSPACE_TEAMS = {
  dev: { name: "Development", accessLevel: "admin" as const },
  hr: { name: "HR Team", accessLevel: "user" as const },
} as const;

export type WorkspaceSlug = keyof typeof WORKSPACE_TEAMS;
export type AccessLevel = "admin" | "user";

export function isValidWorkspace(slug: string): slug is WorkspaceSlug {
  return Object.prototype.hasOwnProperty.call(WORKSPACE_TEAMS, slug);
}

export function listWorkspaceSlugs(): WorkspaceSlug[] {
  return Object.keys(WORKSPACE_TEAMS).filter(isValidWorkspace);
}

export function formatWorkspaceSlugList(): string {
  return listWorkspaceSlugs().join(", ");
}

export function getAccessLevel(slug: string): AccessLevel | null {
  if (!isValidWorkspace(slug)) {
    return null;
  }
  return WORKSPACE_TEAMS[slug].accessLevel;
}
