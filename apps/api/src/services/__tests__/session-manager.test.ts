import { describe, expect, it } from "vitest";

import { parseJson, normalizeSession } from "../session-manager.js";

describe("parseJson", () => {
  it("parses valid JSON string into typed object", () => {
    const result = parseJson<{ foo: number }>('{"foo":42}');
    expect(result).toEqual({ foo: 42 });
  });

  it("returns undefined for non-string input", () => {
    expect(parseJson(123)).toBeUndefined();
    expect(parseJson(null)).toBeUndefined();
    expect(parseJson(undefined)).toBeUndefined();
    expect(parseJson({})).toBeUndefined();
  });

  it("returns undefined for empty or whitespace-only string", () => {
    expect(parseJson("")).toBeUndefined();
    expect(parseJson("   ")).toBeUndefined();
    expect(parseJson("\t\n")).toBeUndefined();
  });

  it("returns undefined for invalid JSON", () => {
    expect(parseJson("{broken")).toBeUndefined();
    expect(parseJson("not json")).toBeUndefined();
  });

  it("parses JSON array", () => {
    expect(parseJson<number[]>("[1,2,3]")).toEqual([1, 2, 3]);
  });

  it("parses JSON null value", () => {
    expect(parseJson<null>("null")).toBeNull();
  });
});

describe("normalizeSession", () => {
  it("maps snake_case database row to SearchSession camelCase", () => {
    const row = {
      id: "abc-123",
      workspace_slug: "my-workspace",
      user_id: "user-1",
      job_description_id: "jd-1",
      sample_name: "Test Sample",
      filters: '{"q":"engineer","limit":10}',
      share_title: "Shared",
      search_state: '{"location":"Shenzhen","keywords":["cnc"]}',
      status: "active",
      created_at: "2026-01-15T10:00:00+08:00",
      updated_at: "2026-01-15T11:00:00+08:00",
      expires_at: "2026-02-15T10:00:00+08:00",
    };

    const session = normalizeSession(row);

    expect(session.id).toBe("abc-123");
    expect(session.workspaceSlug).toBe("my-workspace");
    expect(session.userId).toBe("user-1");
    expect(session.jobDescriptionId).toBe("jd-1");
    expect(session.sampleName).toBe("Test Sample");
    expect(session.filters).toEqual({ q: "engineer", limit: 10 });
    expect(session.shareTitle).toBe("Shared");
    expect(session.searchState).toEqual({ location: "Shenzhen", keywords: ["cnc"] });
    expect(session.status).toBe("active");
    expect(session.createdAt).toBe("2026-01-15T10:00:00+08:00");
    expect(session.updatedAt).toBe("2026-01-15T11:00:00+08:00");
    expect(session.expiresAt).toBe("2026-02-15T10:00:00+08:00");
  });

  it("defaults workspaceSlug to 'dev' when missing", () => {
    const session = normalizeSession({ id: "1", created_at: "t", updated_at: "t" });
    expect(session.workspaceSlug).toBe("dev");
  });

  it("defaults workspaceSlug to 'dev' when empty string", () => {
    const session = normalizeSession({ id: "1", workspace_slug: "", created_at: "t", updated_at: "t" });
    expect(session.workspaceSlug).toBe("dev");
  });

  it("defaults status to 'active' when missing", () => {
    const session = normalizeSession({ id: "1", created_at: "t", updated_at: "t" });
    expect(session.status).toBe("active");
  });

  it("sets optional string fields to undefined when null or missing", () => {
    const row = {
      id: "1",
      workspace_slug: "ws",
      status: "completed",
      created_at: "2026-01-01T00:00:00+08:00",
      updated_at: "2026-01-01T00:00:00+08:00",
      user_id: null,
      job_description_id: null,
      sample_name: null,
      share_title: null,
      expires_at: null,
    };

    const session = normalizeSession(row);

    expect(session.userId).toBeUndefined();
    expect(session.jobDescriptionId).toBeUndefined();
    expect(session.sampleName).toBeUndefined();
    expect(session.shareTitle).toBeUndefined();
    expect(session.expiresAt).toBeUndefined();
  });

  it("sets filters and searchState to undefined when null or missing", () => {
    const session = normalizeSession({
      id: "1",
      created_at: "t",
      updated_at: "t",
      filters: null,
      search_state: null,
    });

    expect(session.filters).toBeUndefined();
    expect(session.searchState).toBeUndefined();
  });

  it("sets filters and searchState to undefined for invalid JSON", () => {
    const session = normalizeSession({
      id: "1",
      created_at: "t",
      updated_at: "t",
      filters: "{bad json",
      search_state: "not-json",
    });

    expect(session.filters).toBeUndefined();
    expect(session.searchState).toBeUndefined();
  });

  it("coerces id to string", () => {
    const session = normalizeSession({ id: 42, created_at: "t", updated_at: "t" });
    expect(session.id).toBe("42");
    expect(typeof session.id).toBe("string");
  });
});
