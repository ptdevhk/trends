import { renderHook } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import type { ConvexResumeFilters } from "@/hooks/useConvexResumes";

const useQueryMock = vi.fn();

vi.mock("convex/react", () => ({
  useQuery: (query: unknown, args: unknown) => useQueryMock(query, args),
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
  });

  it("returns loading state when Convex query is undefined", async () => {
    useQueryMock.mockReturnValue(undefined);

    const { useStatusCounts } = await import("@/hooks/useStatusCounts");
    const filters: ConvexResumeFilters = { locations: ["China"] };
    const { result } = renderHook(() =>
      useStatusCounts({ filters, workspaceSlug: "test", useAndModeBff: false })
    );

    expect(result.current.loading).toBe(true);
    expect(result.current.new).toBe(0);
    expect(result.current.shortlisted).toBe(0);
    expect(result.current.rejected).toBe(0);
    expect(result.current.total).toBe(0);
  });

  it("returns counts when Convex query resolves", async () => {
    useQueryMock.mockReturnValue({
      new: 42,
      shortlisted: 7,
      rejected: 3,
      interviewed_pass: 2,
      total: 52,
      overflow: false,
    });

    const { useStatusCounts } = await import("@/hooks/useStatusCounts");
    const filters: ConvexResumeFilters = { locations: ["China"] };
    const { result } = renderHook(() =>
      useStatusCounts({ filters, workspaceSlug: "test", useAndModeBff: false })
    );

    expect(result.current.loading).toBe(false);
    expect(result.current.new).toBe(42);
    expect(result.current.shortlisted).toBe(7);
    expect(result.current.rejected).toBe(3);
    expect(result.current).toMatchObject({ interviewed_pass: 2 });
    expect(result.current.total).toBe(52);
    expect(result.current.overflow).toBe(false);
  });

  it("passes showBlocked to the Convex count query", async () => {
    useQueryMock.mockReturnValue({
      new: 3,
      shortlisted: 0,
      rejected: 0,
      total: 3,
      overflow: false,
    });

    const { useStatusCounts } = await import("@/hooks/useStatusCounts");
    const filters = { locations: ["China"], showBlocked: true };
    renderHook(() =>
      useStatusCounts({ filters, workspaceSlug: "test", useAndModeBff: false })
    );

    expect(useQueryMock).toHaveBeenCalledWith(
      "resumes:countResumesByStatus",
      expect.objectContaining({
        workspaceSlug: "test",
        locations: ["China"],
        showBlocked: true,
      }),
    );
  });

  it("uses bffStatusCounts directly when useAndModeBff is true", async () => {
    useQueryMock.mockReturnValue(undefined);

    const { useStatusCounts } = await import("@/hooks/useStatusCounts");
    const filters: ConvexResumeFilters = {};
    const bffStatusCounts = { new: 100, shortlisted: 20, rejected: 10, interviewed_pass: 2 };
    const { result } = renderHook(() =>
      useStatusCounts({
        filters,
        workspaceSlug: "test",
        useAndModeBff: true,
        bffStatusCounts,
      })
    );

    expect(result.current.loading).toBe(false);
    expect(result.current.new).toBe(100);
    expect(result.current.shortlisted).toBe(20);
    expect(result.current.rejected).toBe(10);
    expect(result.current).toMatchObject({ interviewed_pass: 2 });
    expect(result.current.total).toBe(132);
    // useQuery is called unconditionally (rules of hooks) but with "skip" for BFF path
    expect(useQueryMock).toHaveBeenCalledWith("resumes:countResumesByStatus", "skip");
  });

  it("returns loading when BFF path has no bffStatusCounts yet", async () => {
    useQueryMock.mockReturnValue(undefined);

    const { useStatusCounts } = await import("@/hooks/useStatusCounts");
    const { result } = renderHook(() =>
      useStatusCounts({
        filters: {},
        workspaceSlug: "test",
        useAndModeBff: true,
        bffStatusCounts: undefined,
      })
    );

    expect(result.current.loading).toBe(true);
  });
});
