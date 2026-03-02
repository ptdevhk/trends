export const WORKSPACE_TEAMS = {
  dev: { name: "Development", accessLevel: "admin" as const },
  hr: { name: "HR Team", accessLevel: "user" as const },
} as const;

export type WorkspaceSlug = keyof typeof WORKSPACE_TEAMS;
export type AccessLevel = "admin" | "user";

export function isValidWorkspace(slug: string): slug is WorkspaceSlug {
  return slug in WORKSPACE_TEAMS;
}

export function getAccessLevel(slug: string): AccessLevel | null {
  if (!isValidWorkspace(slug)) {
    return null;
  }
  return WORKSPACE_TEAMS[slug].accessLevel;
}
