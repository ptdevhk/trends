import fs from "node:fs";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createApp } from "../../app";
import { parseJsonBody } from "../../test-utils";
import {
  makeUnresolvedEvent,
  type UnresolvedAggregate,
} from "../../services/industry-unresolved-queue.js";
import { writeUnresolvedQueue } from "../../services/industry-unresolved-store.js";
import {
  defaultUnresolvedResolutionsPath,
  readUnresolvedResolutions,
} from "../../services/industry-unresolved-resolutions.js";
import { createAuthContext } from "../test-auth-helpers";

const mockState = vi.hoisted(() => ({ root: "" }));

vi.mock("../../services/config.js", async () => {
  const fsMod = await import("node:fs");
  const osMod = await import("node:os");
  const pathMod = await import("node:path");
  const root = fsMod.mkdtempSync(
    pathMod.join(osMod.tmpdir(), "industry-unresolved-route-")
  );
  // SkillsKnowledgeService reads <projectRoot>/config/resume/skills.md at
  // construction (through UnifiedSearchService), so mirror the real file.
  const realRoot = process.cwd();
  const skillsSrc = pathMod.join(realRoot, "config", "resume", "skills.md");
  if (fsMod.existsSync(skillsSrc)) {
    const skillsDir = pathMod.join(root, "config", "resume");
    fsMod.mkdirSync(skillsDir, { recursive: true });
    fsMod.copyFileSync(skillsSrc, pathMod.join(skillsDir, "skills.md"));
  }
  mockState.root = root;
  return {
    config: {
      projectRoot: root,
      version: "0.0.0-test",
      auth: {
        allowedOrigins: [],
        adminResetEnabled: true,
        convexWriteSecret: "test-secret",
        sessionCookieName: "trends_session",
        csrfCookieName: "trends_csrf",
        secureCookies: false,
        sessionTtlSeconds: 3600,
        oidc: {
          enabled: false,
          clientId: "test-client",
          clientSecret: "test-secret",
          redirectUri: "http://localhost/callback",
          scope: "openid profile email",
          discoveryUrl: "http://localhost/oidc",
        },
        hrDemo: { username: "", token: "", tokenHash: "" },
      },
    },
    getConvexWriteSecret: () => "test-secret",
  };
});

type QueueItem = UnresolvedAggregate & {
  resolution?: {
    action: string;
    targetCompanyKey?: string;
    resolvedBy?: string;
  };
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseConvexCall(input: Request | string | URL, init?: RequestInit): string {
  const body = typeof init?.body === "string" ? JSON.parse(init.body) : null;
  if (!isRecord(body) || typeof body.path !== "string") {
    throw new Error("Missing convex request body");
  }
  return body.path;
}

function convexSuccess(value: unknown): Response {
  return new Response(JSON.stringify({ status: "success", value }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

function setupMaintenanceModeFetch() {
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const pathName = parseConvexCall(input, init);
    if (pathName === "system_settings:isMaintenanceMode") {
      return convexSuccess(false);
    }
    throw new Error(`Unexpected convex path: ${pathName}`);
  });
}

function seedFiles() {
  const queuePath = `${mockState.root}/output/industry-data/unresolved-queue.json`;
  writeUnresolvedQueue(queuePath, [
    makeUnresolvedEvent("UnknownOEM-A", "miss", 40),
    makeUnresolvedEvent("UnknownOEM-A", "miss", 80),
    makeUnresolvedEvent("Other-B", "low_confidence_keyword", 10),
    makeUnresolvedEvent("FreqBrandX", "miss", 10),
    makeUnresolvedEvent("FreqBrandX", "miss", 10),
    makeUnresolvedEvent("FreqBrandX", "miss", 10),
  ]);
}

async function listItems(app: ReturnType<typeof createApp>, query = "") {
  const res = await app.request(`/api/industry-data/unresolved${query}`);
  expect(res.status).toBe(200);
  const body = await parseJsonBody<{
    success: boolean;
    items: QueueItem[];
    total: number;
    counts: { unresolved: number; linked: number; ignored: number; total: number };
  }>(res);
  return body;
}

describe("Industry-data unresolved queue admin API", () => {
  beforeEach(() => {
    seedFiles();
    setupMaintenanceModeFetch();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    fs.rmSync(mockState.root, { recursive: true, force: true });
  });

  describe("GET /api/industry-data/unresolved", () => {
    it("admin: defaults to status=unresolved and reports counts", async () => {
      const app = createApp({
        authContext: createAuthContext({ workspaceSlug: "dev", role: "admin" }),
      });
      const body = await listItems(app);
      expect(body.success).toBe(true);
      expect(body.counts).toEqual({ unresolved: 3, linked: 0, ignored: 0, total: 3 });
      expect(body.total).toBe(3);
      expect(body.items).toHaveLength(3);
      expect(body.items[0].normalizedKey).toContain("freqbrandx");
      expect(body.items[0].resolution).toBeUndefined();
    });

    it("admin: status=all returns enriched linked and ignored items", async () => {
      const resolutionsPath = defaultUnresolvedResolutionsPath(mockState.root);
      fs.mkdirSync(`${mockState.root}/output/industry-data`, { recursive: true });
      fs.writeFileSync(
        resolutionsPath,
        JSON.stringify({
          version: 1,
          updatedAt: "2026-08-19T00:00:00.000Z",
          resolutions: [
            {
              normalizedKey: "unknownoema",
              action: "link",
              targetCompanyKey: "polywell",
              resolvedAt: "2026-08-19T00:00:00.000Z",
              resolvedBy: "admin",
            },
            {
              normalizedKey: "otherb",
              action: "ignore",
              resolvedAt: "2026-08-19T00:00:00.000Z",
              resolvedBy: "demo-admin",
            },
          ],
        }),
        "utf-8"
      );
      const app = createApp({
        authContext: createAuthContext({ workspaceSlug: "dev", role: "admin" }),
      });
      const body = await listItems(app, "?status=all");
      expect(body.total).toBe(3);
      expect(body.counts).toEqual({ unresolved: 1, linked: 1, ignored: 1, total: 3 });
      const linked = body.items.find((i) => i.normalizedKey.includes("unknownoema"));
      expect(linked?.resolution?.action).toBe("link");
      expect(linked?.resolution?.targetCompanyKey).toBe("polywell");
      const ignored = body.items.find((i) => i.normalizedKey.includes("otherb"));
      expect(ignored?.resolution?.action).toBe("ignore");
      expect(ignored?.resolution?.resolvedBy).toBe("demo-admin");
    });

    it("admin: search matches normalizedKey, example surface, and targetCompanyKey", async () => {
      const resolutionsPath = defaultUnresolvedResolutionsPath(mockState.root);
      fs.mkdirSync(`${mockState.root}/output/industry-data`, { recursive: true });
      fs.writeFileSync(
        resolutionsPath,
        JSON.stringify({
          version: 1,
          updatedAt: "2026-08-19T00:00:00.000Z",
          resolutions: [
            {
              normalizedKey: "unknownoema",
              action: "link",
              targetCompanyKey: "polywell",
              resolvedAt: "2026-08-19T00:00:00.000Z",
              resolvedBy: "admin",
            },
          ],
        }),
        "utf-8"
      );
      const app = createApp({
        authContext: createAuthContext({ workspaceSlug: "dev", role: "admin" }),
      });
      const byTarget = await listItems(app, "?status=all&search=polywell");
      expect(byTarget.items).toHaveLength(1);
      expect(byTarget.items[0].normalizedKey).toContain("unknownoema");

      const bySurface = await listItems(app, "?status=all&search=Other-B");
      expect(bySurface.items).toHaveLength(1);
      expect(bySurface.items[0].normalizedKey).toContain("otherb");

      const none = await listItems(app, "?status=all&search=zzz-no-match");
      expect(none.items).toHaveLength(0);
    });

    it("admin: minCount and priorityOnly filters apply", async () => {
      const app = createApp({
        authContext: createAuthContext({ workspaceSlug: "dev", role: "admin" }),
      });
      const byMinCount = await listItems(app, "?status=all&minCount=2");
      expect(byMinCount.items.map((i) => i.normalizedKey).sort()).toEqual([
        "freqbrandx",
        "unknownoema",
      ]);
      const priorityOnly = await listItems(app, "?status=all&priorityOnly=true");
      expect(priorityOnly.items.map((i) => i.normalizedKey).sort()).toEqual([
        "freqbrandx",
        "unknownoema",
      ]);
    });

    it("user and reviewer roles are forbidden (403)", async () => {
      for (const role of ["user", "reviewer"] as const) {
        const app = createApp({
          authContext: createAuthContext({ workspaceSlug: "dev", role }),
        });
        const res = await app.request("/api/industry-data/unresolved");
        expect(res.status, role).toBe(403);
      }
    });

    it("unauthenticated request is rejected (401)", async () => {
      const app = createApp({});
      const res = await app.request("/api/industry-data/unresolved");
      expect(res.status).toBe(401);
    });
  });

  describe("POST /api/industry-data/unresolved/resolve", () => {
    it("admin: links a single key with targetCompanyKey", async () => {
      const app = createApp({
        authContext: createAuthContext({ workspaceSlug: "dev", role: "admin" }),
      });
      const res = await app.request("/api/industry-data/unresolved/resolve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          keys: ["otherb"],
          action: "link",
          targetCompanyKey: "polywell",
          actor: "qa-admin",
        }),
      });
      expect(res.status).toBe(200);
      const body = await parseJsonBody<{
        success: boolean;
        resolved: Array<{ normalizedKey: string; action: string; targetCompanyKey?: string; resolvedBy: string }>;
        updatedAt: string;
      }>(res);
      expect(body.success).toBe(true);
      expect(body.resolved).toHaveLength(1);
      expect(body.resolved[0]).toMatchObject({
        normalizedKey: "otherb",
        action: "link",
        targetCompanyKey: "polywell",
        resolvedBy: "admin-user",
      });
      expect(typeof body.updatedAt).toBe("string");

      const stored = readUnresolvedResolutions(
        defaultUnresolvedResolutionsPath(mockState.root)
      );
      expect(stored.resolutions).toHaveLength(1);
      expect(stored.resolutions[0].targetCompanyKey).toBe("polywell");
    });

    it("admin: bulk-ignores multiple keys, latest-wins replaces an earlier link", async () => {
      const app = createApp({
        authContext: createAuthContext({ workspaceSlug: "dev", role: "admin" }),
      });
      const first = await app.request("/api/industry-data/unresolved/resolve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          keys: ["unknownoema"],
          action: "link",
          targetCompanyKey: "polywell",
        }),
      });
      expect(first.status).toBe(200);

      const res = await app.request("/api/industry-data/unresolved/resolve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          keys: ["freqbrandx", "unknownoema", "freqbrandx"],
          action: "ignore",
        }),
      });
      expect(res.status).toBe(200);
      const body = await parseJsonBody<{
        success: boolean;
        resolved: Array<{ normalizedKey: string; action: string; targetCompanyKey?: string }>;
      }>(res);
      expect(body.success).toBe(true);
      expect(body.resolved).toHaveLength(2);
      const replaced = body.resolved.find((r) => r.normalizedKey === "unknownoema");
      expect(replaced?.action).toBe("ignore");
      expect(replaced?.targetCompanyKey).toBeUndefined();

      const stored = readUnresolvedResolutions(
        defaultUnresolvedResolutionsPath(mockState.root)
      );
      expect(stored.resolutions).toHaveLength(2);
      const freq = stored.resolutions.find((r) => r.normalizedKey === "freqbrandx");
      expect(freq?.action).toBe("ignore");
    });

    it("admin: ignore does not require a targetCompanyKey", async () => {
      const app = createApp({
        authContext: createAuthContext({ workspaceSlug: "dev", role: "admin" }),
      });
      const res = await app.request("/api/industry-data/unresolved/resolve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ keys: ["ghostbrand"], action: "ignore" }),
      });
      expect(res.status).toBe(200);
    });

    it("link without targetCompanyKey → 400", async () => {
      const app = createApp({
        authContext: createAuthContext({ workspaceSlug: "dev", role: "admin" }),
      });
      const res = await app.request("/api/industry-data/unresolved/resolve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ keys: ["otherb"], action: "link" }),
      });
      expect(res.status).toBe(400);
      const body = await parseJsonBody<{ success: boolean; error?: unknown }>(res);
      expect(body.success).toBe(false);
      expect(JSON.stringify(body)).toContain("targetCompanyKey");
    });

    it("empty keys → 400", async () => {
      const app = createApp({
        authContext: createAuthContext({ workspaceSlug: "dev", role: "admin" }),
      });
      const res = await app.request("/api/industry-data/unresolved/resolve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ keys: [], action: "ignore" }),
      });
      expect(res.status).toBe(400);
    });

    it("user role → 403", async () => {
      const app = createApp({
        authContext: createAuthContext({ workspaceSlug: "dev", role: "user" }),
      });
      const res = await app.request("/api/industry-data/unresolved/resolve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ keys: ["otherb"], action: "ignore" }),
      });
      expect(res.status).toBe(403);
    });
  });
});
