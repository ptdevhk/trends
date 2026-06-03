import { renderHook } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach } from "vitest";

const mockQueryResult = vi.hoisted(() => ({ value: undefined as unknown }));

vi.mock("convex/react", () => ({
  useQuery: (_query: unknown, args: unknown) => {
    if (args === "skip") return undefined;
    return mockQueryResult.value;
  },
}));

vi.mock("../../../../packages/convex/convex/_generated/api", () => ({
  api: {
    resumes: {
      countResumesByStatus: "resumes:countResumesByStatus",
    },
  },
}));

describe("useStatusCounts", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockQueryResult.value = undefined;
  });

  it("returns loading state initially when Convex query is undefined", async () => {
    mockQueryResult.value = undefined;

    const { useStatusCounts } = await import("@/hooks/useStatusCounts");
    const { result } = renderHook(() =>
      useStatusCounts({
        filters: { locations: ["China"] },
        workspaceSlug: "test",
        useAndModeBff: false,
      })
    );

    expect(result.current.loading).toBe(true);
    expect(result.current.new).toBe(0);
    expect(result.current.shortlisted).toBe(0);
    expect(result.current.rejected).toBe(0);
    expect(result.current.total).toBe(0);
  });

  it("returns counts when Convex query resolves", async () => {
    mockQueryResult.value = {
      new: 42,
      shortlisted: 7,
      rejected: 3,
      total: 52,
      overflow: false,
    };

    const { useStatusCounts } = await import("@/hooks/useStatusCounts");
    const { result } = renderHook(() =>
      useStatusCounts({
        filters: { locations: ["China"] },
        workspaceSlug: "test",
        useAndModeBff: false,
      })
    );

    expect(result.current.loading).toBe(false);
    expect(result.current.new).toBe(42);
    expect(result.current.shortlisted).toBe(7);
    expect(result.current.rejected).toBe(3);
    expect(result.current.total).toBe(52);
    expect(result.current.overflow).toBe(false);
  });

  it("uses BFF counts when useAndModeBff is true", async () => {
    const { useStatusCounts } = await import("@/hooks/useStatusCounts");
    const { result } = renderHook(() =>
      useStatusCounts({
        filters: {},
        workspaceSlug: "test",
        useAndModeBff: true,
        bffStatusCounts: { new: 100, shortlisted: 20, rejected: 10 },
      })
    );

    expect(result.current.loading).toBe(false);
    expect(result.current.new).toBe(100);
    expect(result.current.shortlisted).toBe(20);
    expect(result.current.rejected).toBe(10);
    expect(result.current.total).toBe(130);
  });

  it("shows loading when BFF path has no bffStatusCounts yet", async () => {
    const { useStatusCounts } = await import("@/hooks/useStatusCounts");
    const { result } = renderHook(() =>
      useStatusCounts({
        filters: {},
        workspaceSlug: "test",
        useAndModeBff: true,
      })
    );

    expect(result.current.loading).toBe(true);
    expect(result.current.new).toBe(0);
  });

  it("handles null/undefined values in Convex result gracefully", async () => {
    mockQueryResult.value = {
      new: null,
      shortlisted: undefined,
      rejected: 5,
      total: 5,
      overflow: null,
    };

    const { useStatusCounts } = await import("@/hooks/useStatusCounts");
    const { result } = renderHook(() =>
      useStatusCounts({
        filters: {},
        workspaceSlug: "test",
        useAndModeBff: false,
      })
    );

    expect(result.current.new).toBe(0);
    expect(result.current.shortlisted).toBe(0);
    expect(result.current.rejected).toBe(5);
    expect(result.current.total).toBe(5);
  });

  it("propagates overflow flag from Convex result", async () => {
    mockQueryResult.value = {
      new: 3000,
      shortlisted: 1000,
      rejected: 1000,
      total: 5000,
      overflow: true,
    };

    const { useStatusCounts } = await import("@/hooks/useStatusCounts");
    const { result } = renderHook(() =>
      useStatusCounts({
        filters: { minAge: 25 },
        workspaceSlug: "test",
        useAndModeBff: false,
      })
    );

    expect(result.current.overflow).toBe(true);
  });
});
