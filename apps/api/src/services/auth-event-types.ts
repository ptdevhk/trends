export type AuthEventType =
  | "login_success"
  | "login_failure"
  | "login_throttled"
  | "logout"
  | "sessions_revoked"
  | "password_reset_completed"
  | "login_lockout_cleared"
  | "csrf_reject"
  | "workspace_access_denied"
  | "admin_access_denied"
  | "oidc_state_invalid"
  | "provider_membership_preapproved"
  | "provider_membership_revoked"
  | "workspace_membership_granted"
  | "workspace_membership_revoked"
  | "public_share_created"
  | "public_share_read"
  | "public_share_unavailable";

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
