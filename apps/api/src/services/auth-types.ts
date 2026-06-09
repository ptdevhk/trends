export type AuthProvider = "local" | "casdoor";
export type WorkspaceRole = "user" | "admin";

export type AuthUser = {
  id: string;
  email?: string;
  displayName?: string;
  status: "active" | "disabled";
};

export type WorkspaceMembership = {
  userId: string;
  workspaceSlug: string;
  role: WorkspaceRole;
};

export type AuthContext = {
  user: AuthUser;
  memberships: WorkspaceMembership[];
  sessionId: string;
  csrfToken: string;
};

export type StoredOidcState = {
  state: string;
  provider: "casdoor";
  codeVerifier: string;
  nonce?: string;
  redirectTo?: string;
  expiresAt: string;
};

export function hasWorkspaceRole(
  memberships: WorkspaceMembership[],
  workspaceSlug: string,
  roles: readonly WorkspaceRole[],
): boolean {
  return memberships.some((membership) => (
    membership.workspaceSlug === workspaceSlug && roles.includes(membership.role)
  ));
}
