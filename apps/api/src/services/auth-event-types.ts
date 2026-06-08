export type AuthEventType =
  | "login_success"
  | "login_failure"
  | "logout"
  | "csrf_reject"
  | "workspace_access_denied"
  | "admin_access_denied"
  | "oidc_state_invalid"
  | "workspace_membership_granted"
  | "workspace_membership_revoked";

export type AuthEventInput = {
  type: AuthEventType;
  userId?: string;
  provider?: "local" | "casdoor";
  workspaceSlug?: string;
  sessionId?: string;
  reason?: string;
  metadata?: Record<string, string | number | boolean | null>;
  ipHash?: string;
  userAgent?: string;
};

export type AuthEvent = AuthEventInput & {
  id: string;
  createdAt: string;
};

export type AuthEventListOptions = {
  limit?: number;
  type?: AuthEventType;
  userId?: string;
  workspaceSlug?: string;
};
