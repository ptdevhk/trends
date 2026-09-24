import { afterEach, describe, expect, it, vi } from "vitest";

const getWorkspaceConfigValueMock = vi.fn();
const setWorkspaceConfigValueMock = vi.fn();

vi.mock("./workspace-config-service.js", () => ({
  workspaceConfigService: {
    getWorkspaceConfigValue: (workspaceSlug: string, configKey: string) =>
      getWorkspaceConfigValueMock(workspaceSlug, configKey),
    setWorkspaceConfigValue: (workspaceSlug: string, configKey: string, configValue: unknown) =>
      setWorkspaceConfigValueMock(workspaceSlug, configKey, configValue),
  },
}));

import {
  getNewsSourcesState,
  NewsSourcesValidationError,
  putNewsSources,
} from "./research-news-sources-service.js";
import {
  NEWS_SOURCES_CONFIG_KEY,
  loadResearchNewsSourcesSeed,
} from "./research-news-sources.js";

describe("research-news-sources-service", () => {
  afterEach(() => {
    getWorkspaceConfigValueMock.mockReset();
    setWorkspaceConfigValueMock.mockReset();
  });

  it("get returns seed + empty workspace (default-ON) effective = full catalog", async () => {
    getWorkspaceConfigValueMock.mockResolvedValue(undefined);
    const state = await getNewsSourcesState("hr");
    const seed = loadResearchNewsSourcesSeed();
    expect(getWorkspaceConfigValueMock).toHaveBeenCalledWith("hr", NEWS_SOURCES_CONFIG_KEY);
    expect(state.workspace).toEqual({
      version: 1,
      excludedGroups: [],
      excludedFeeds: [],
      enabledFeeds: [],
    });
    expect(state.effective).toEqual(seed.catalogIds);
  });

  it("put rejects unknown feed id", async () => {
    getWorkspaceConfigValueMock.mockResolvedValue(undefined);
    await expect(
      putNewsSources("hr", { excludedFeeds: ["not-real"] }),
    ).rejects.toBeInstanceOf(NewsSourcesValidationError);
    expect(setWorkspaceConfigValueMock).not.toHaveBeenCalled();
  });

  it("put rejects unknown group id", async () => {
    getWorkspaceConfigValueMock.mockResolvedValue(undefined);
    await expect(
      putNewsSources("hr", { excludedGroups: ["not-a-group"] }),
    ).rejects.toBeInstanceOf(NewsSourcesValidationError);
    expect(setWorkspaceConfigValueMock).not.toHaveBeenCalled();
  });

  it("put master off yields empty effective and persists", async () => {
    getWorkspaceConfigValueMock.mockResolvedValue(undefined);
    setWorkspaceConfigValueMock.mockResolvedValue(undefined);
    const state = await putNewsSources("hr", { masterEnabled: false });
    expect(state.effective).toEqual([]);
    expect(setWorkspaceConfigValueMock).toHaveBeenCalledWith(
      "hr",
      NEWS_SOURCES_CONFIG_KEY,
      expect.objectContaining({ masterEnabled: false, version: 1 }),
    );
  });

  it("put excluded group drops its feeds", async () => {
    getWorkspaceConfigValueMock.mockResolvedValue(undefined);
    setWorkspaceConfigValueMock.mockResolvedValue(undefined);
    const seed = loadResearchNewsSourcesSeed();
    const brandGroup = seed.groups.find((g) => g.id === "brands")!;
    const state = await putNewsSources("hr", { excludedGroups: [brandGroup.id] });
    for (const f of brandGroup.feeds) {
      expect(state.effective).not.toContain(f);
    }
    expect(state.effective.length).toBeGreaterThan(0);
  });
});
