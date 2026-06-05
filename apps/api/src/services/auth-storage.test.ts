import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { getResumeScreeningDb, resetResumeScreeningDb } from "./database.js";

describe("auth sqlite schema", () => {
  afterEach(() => {
    resetResumeScreeningDb();
  });

  it("creates auth tables and indexes in resume_screening.db", () => {
    const root = mkdtempSync(path.join(tmpdir(), "trends-auth-db-"));
    const db = getResumeScreeningDb(root);

    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
      .all() as Array<{ name: string }>;

    expect(tables.map((row) => row.name)).toEqual(
      expect.arrayContaining([
        "users",
        "auth_identities",
        "auth_password_credentials",
        "auth_sessions",
        "auth_oidc_states",
        "workspace_memberships",
      ]),
    );
  });
});
