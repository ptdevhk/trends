import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

function createFixtureRoot(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "sessions-route-"));
  fs.mkdirSync(path.join(root, "output"), { recursive: true });
  fs.mkdirSync(path.join(root, "config", "resume"), { recursive: true });
  fs.writeFileSync(path.join(root, "pyproject.toml"), "", "utf8");
  fs.writeFileSync(
    path.join(root, "config", "resume", "skills.md"),
    [
      "---",
      "version: 1",
      'updated_at: "2026-03-26"',
      "---",
      "",
      "## Company Patterns",
      "",
      "### fanuc",
      "- aliases: FANUC, 发那科",
      "- tier: 1",
      "",
    ].join("\n"),
    "utf8"
  );
  return root;
}

async function loadSessionModules(root: string) {
  process.env.PROJECT_ROOT = root;
  vi.resetModules();
  const { createApp } = await import("../app");
  const { resetResumeScreeningDb } = await import("../services/database");
  return {
    createApp,
    resetResumeScreeningDb,
  };
}

describe("session routes", () => {
  let root = "";

  afterEach(async () => {
    vi.restoreAllMocks();
    delete process.env.PROJECT_ROOT;
    if (root) {
      const { resetResumeScreeningDb } = await import("../services/database");
      resetResumeScreeningDb();
      fs.rmSync(root, { recursive: true, force: true });
      root = "";
    }
  });

  it("creates and rehydrates persisted share session state", async () => {
    root = createFixtureRoot();
    const { createApp } = await loadSessionModules(root);
    const app = createApp();

    const createResponse = await app.request("/api/sessions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Workspace-Slug": "hr",
      },
      body: JSON.stringify({
        jobDescriptionId: "lathe-sales",
        filters: {
          minExperience: 3,
          minAge: 28,
          status: ["offer"],
        },
        shareTitle: "Kuala Lumpur · Sales Engineer",
        searchState: {
          location: "Kuala Lumpur MY",
          keywords: ["Sales Engineer", "CNC"],
          requiredKeywords: ["machine tools"],
          jobDescriptionId: "lathe-sales",
          selectedTags: ["STAR"],
          selectedCompanies: ["fanuc"],
          selectedExperienceLevel: "mid",
          collectionSource: {
            type: "seek",
            exactUrl: "https://my.employer.seek.com/candidates/recommended?jobId=1&pageNumber=1",
          },
          collectUrl: "https://my.employer.seek.com/candidates/recommended?jobId=1&pageNumber=1",
          filters: {
            minExperience: 3,
            minAge: 28,
            status: ["offer"],
          },
          referenceNote: "Priority shortlist for HR sync",
        },
      }),
    });

    expect(createResponse.status).toBe(200);
    const createdPayload = await createResponse.json() as {
      success: boolean;
      session: {
        id: string;
        workspaceSlug: string;
        shareTitle?: string;
        searchState?: {
          location?: string;
          referenceNote?: string;
          filters?: {
            minAge?: number;
            status?: string[];
          };
        };
      };
    };

    expect(createdPayload.success).toBe(true);
    expect(createdPayload.session.workspaceSlug).toBe("hr");
    expect(createdPayload.session.shareTitle).toBe("Kuala Lumpur · Sales Engineer");
    expect(createdPayload.session.searchState).toMatchObject({
      location: "Kuala Lumpur MY",
      referenceNote: "Priority shortlist for HR sync",
      filters: {
        minAge: 28,
        status: ["offer"],
      },
    });

    const getResponse = await app.request(`/api/sessions/${createdPayload.session.id}`, {
      headers: {
        "X-Workspace-Slug": "hr",
      },
    });

    expect(getResponse.status).toBe(200);
    const getPayload = await getResponse.json() as {
      success: boolean;
      session: {
        shareTitle?: string;
        filters?: {
          minAge?: number;
        };
        searchState?: {
          requiredKeywords?: string[];
          referenceNote?: string;
          selectedTags?: string[];
          selectedCompanies?: string[];
          selectedExperienceLevel?: string;
        };
      };
    };

    expect(getPayload.success).toBe(true);
    expect(getPayload.session.shareTitle).toBe("Kuala Lumpur · Sales Engineer");
    expect(getPayload.session.filters).toMatchObject({ minAge: 28 });
    expect(getPayload.session.searchState).toMatchObject({
      requiredKeywords: ["machine tools"],
      referenceNote: "Priority shortlist for HR sync",
      selectedTags: ["STAR"],
      selectedCompanies: ["fanuc"],
      selectedExperienceLevel: "mid",
    });
  });

  it("updates and clears persisted share metadata within the workspace scope", async () => {
    root = createFixtureRoot();
    const { createApp } = await loadSessionModules(root);
    const app = createApp();

    const createResponse = await app.request("/api/sessions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Workspace-Slug": "hr",
      },
      body: JSON.stringify({
        shareTitle: "Original title",
        searchState: {
          location: "Dongguan",
          keywords: ["CNC"],
        },
      }),
    });
    const createdPayload = await createResponse.json() as {
      session: {
        id: string;
      };
    };

    const updateResponse = await app.request(`/api/sessions/${createdPayload.session.id}`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        "X-Workspace-Slug": "hr",
      },
      body: JSON.stringify({
        shareTitle: null,
        searchState: null,
        filters: {
          minExperience: 5,
          minAge: 30,
        },
      }),
    });

    expect(updateResponse.status).toBe(200);
    const updatePayload = await updateResponse.json() as {
      success: boolean;
      session: {
        shareTitle?: string;
        searchState?: unknown;
        filters?: {
          minExperience?: number;
          minAge?: number;
        };
      };
    };

    expect(updatePayload.success).toBe(true);
    expect(updatePayload.session.shareTitle).toBeUndefined();
    expect(updatePayload.session.searchState).toBeUndefined();
    expect(updatePayload.session.filters).toMatchObject({
      minExperience: 5,
      minAge: 30,
    });

    const missingWorkspaceResponse = await app.request(`/api/sessions/${createdPayload.session.id}`, {
      headers: {
        "X-Workspace-Slug": "dev",
      },
    });

    expect(missingWorkspaceResponse.status).toBe(404);
  });
});
