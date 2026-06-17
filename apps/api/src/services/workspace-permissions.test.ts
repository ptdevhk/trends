import { describe, expect, it } from "vitest";

import { createAuthContext } from "../routes/test-auth-helpers";
import { hasWorkspacePermission, type PublicSharePrincipal } from "./workspace-permissions";

describe("hasWorkspacePermission", () => {
  it("grants anonymous resume search for the hr workspace", () => {
    expect(hasWorkspacePermission({
      workspaceSlug: "hr",
      permission: "resume:search",
    })).toBe(true);
  });

  it("does not grant anonymous resume search for the dev workspace", () => {
    expect(hasWorkspacePermission({
      workspaceSlug: "dev",
      permission: "resume:search",
    })).toBe(false);
  });

  it("grants resume search to authenticated members of the selected workspace", () => {
    expect(hasWorkspacePermission({
      auth: createAuthContext({ workspaceSlug: "dev", role: "user" }),
      workspaceSlug: "dev",
      permission: "resume:search",
    })).toBe(true);
  });

  it("does not grant resume search to authenticated users outside the selected workspace", () => {
    expect(hasWorkspacePermission({
      auth: createAuthContext({ workspaceSlug: "hr", role: "user" }),
      workspaceSlug: "dev",
      permission: "resume:search",
    })).toBe(false);
  });

  it("keeps operational candidate permissions authenticated and workspace-scoped", () => {
    expect(hasWorkspacePermission({
      workspaceSlug: "hr",
      permission: "candidate:status:read",
    })).toBe(false);

    expect(hasWorkspacePermission({
      auth: createAuthContext({ workspaceSlug: "hr", role: "user" }),
      workspaceSlug: "hr",
      permission: "candidate:status:read",
    })).toBe(true);
  });

  it("grants member session and analysis scopes to authenticated workspace members", () => {
    const auth = createAuthContext({ workspaceSlug: "hr", role: "user" });

    for (const permission of [
      "resume:session:create",
      "resume:session:read",
      "resume:analysis:run",
      "resume:analysis:snapshot:create",
    ] as const) {
      expect(hasWorkspacePermission({
        auth,
        workspaceSlug: "hr",
        permission,
      })).toBe(true);
    }
  });

  it("grants public share creation by scope to workspace admins only", () => {
    expect(hasWorkspacePermission({
      auth: createAuthContext({ workspaceSlug: "hr", role: "admin" }),
      workspaceSlug: "hr",
      permission: "resume:share:public:create",
    })).toBe(true);

    expect(hasWorkspacePermission({
      auth: createAuthContext({ workspaceSlug: "hr", role: "user" }),
      workspaceSlug: "hr",
      permission: "resume:share:public:create",
    })).toBe(false);
  });

  it("represents public-token reads as token-scoped principals", () => {
    const principal: PublicSharePrincipal = {
      type: "public-token",
      shareId: "share-1",
      workspaceSlug: "hr",
    };

    expect(hasWorkspacePermission({
      principal,
      workspaceSlug: "hr",
      permission: "resume:share:public:read",
    })).toBe(true);

    expect(hasWorkspacePermission({
      principal,
      workspaceSlug: "hr",
      permission: "resume:search",
    })).toBe(true);

    expect(hasWorkspacePermission({
      principal,
      workspaceSlug: "dev",
      permission: "resume:share:public:read",
    })).toBe(false);

    expect(hasWorkspacePermission({
      principal,
      workspaceSlug: "hr",
      permission: "candidate:action:read",
    })).toBe(false);
  });
});
