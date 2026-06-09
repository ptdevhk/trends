import { describe, expect, it } from "vitest";

import { createAuthContext } from "../routes/test-auth-helpers";
import { hasWorkspacePermission } from "./workspace-permissions";

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
});
