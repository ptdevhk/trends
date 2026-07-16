/**
 * System teams — stable product seats. `hr` is sacred for prod upgrade
 * (candidate_status, prefs). Do not rename keys.
 */
export const WORKSPACE_TEAMS = {
  dev: { name: "Development" },
  hr: { name: "HR Team" },
} as const;

/** System workspace slugs only (`dev` | `hr`). */
export type SystemWorkspaceSlug = keyof typeof WORKSPACE_TEAMS;

/**
 * Any valid workspace seat: system teams or personal/dynamic format slugs.
 * Personal seats are membership-backed; format validation is the shared gate.
 */
export type WorkspaceSlug = SystemWorkspaceSlug | (string & {});

/** Reserved names: cannot be usernames or personal workspace slugs. */
export const RESERVED_WORKSPACE_SLUGS: readonly string[] = [
  "hr",
  "dev",
  "admin",
  "login",
  "api",
  "system",
  "public",
  "s",
  "resumes",
  "auth",
  "settings",
  "workspace",
  "workspaces",
  "user",
  "users",
  "null",
  "undefined",
  "www",
  "app",
  "static",
  "assets",
  "health",
  // Block prototype pollution footguns as route slugs
  "constructor",
  "prototype",
  "tostring",
  "valueof",
  "hasownproperty",
] as const;

const PERSONAL_SLUG_RE = /^[a-z][a-z0-9-]{0,46}[a-z0-9]$|^[a-z]$/;

export function isSystemWorkspace(slug: string): slug is SystemWorkspaceSlug {
  return Object.prototype.hasOwnProperty.call(WORKSPACE_TEAMS, slug);
}

export function isReservedWorkspaceSlug(slug: string): boolean {
  const normalized = slug.trim().toLowerCase();
  if (!normalized) return true;
  return RESERVED_WORKSPACE_SLUGS.includes(normalized);
}

/**
 * Normalize a local username into a personal workspace slug.
 * Empty result means the username cannot form a valid personal slug.
 */
export function slugifyUsernameForWorkspace(username: string): string {
  const slug = username
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48)
    .replace(/-+$/g, "");
  return slug;
}

export function isPersonalWorkspaceSlugFormat(slug: string): boolean {
  if (!slug || slug.length > 48) return false;
  if (!PERSONAL_SLUG_RE.test(slug)) return false;
  if (slug.includes("--")) return false;
  return true;
}

/**
 * Valid workspace for routing / membership seats:
 * - system teams (`dev`, `hr`), or
 * - personal format slug that is not reserved.
 */
export function isValidWorkspace(slug: string): slug is WorkspaceSlug {
  if (isSystemWorkspace(slug)) return true;
  if (isReservedWorkspaceSlug(slug)) return false;
  return isPersonalWorkspaceSlugFormat(slug);
}

/** System team slugs only (registry order). */
export function listSystemWorkspaceSlugs(): SystemWorkspaceSlug[] {
  return (Object.keys(WORKSPACE_TEAMS) as SystemWorkspaceSlug[]).filter(isSystemWorkspace);
}

/** @deprecated Prefer listSystemWorkspaceSlugs — kept for callers listing system teams. */
export function listWorkspaceSlugs(): SystemWorkspaceSlug[] {
  return listSystemWorkspaceSlugs();
}

export function formatWorkspaceSlugList(): string {
  return listSystemWorkspaceSlugs().join(", ");
}

export function getWorkspaceDisplayName(slug: string): string {
  if (isSystemWorkspace(slug)) {
    return WORKSPACE_TEAMS[slug].name;
  }
  // Title-ish label from slug for personal seats
  return slug
    .split("-")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}
