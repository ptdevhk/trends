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
  getHotlistPlatformsState,
  HotlistPlatformsValidationError,
  putHotlistPlatforms,
} from "./research-hotlist-platforms-service.js";
import {
  HOTLIST_PLATFORMS_CONFIG_KEY,
  loadResearchHotlistPlatformsSeed,
} from "./research-hotlist-platforms.js";

describe("research-hotlist-platforms-service", () => {
  afterEach(() => {
    getWorkspaceConfigValueMock.mockReset();
    setWorkspaceConfigValueMock.mockReset();
  });

  it("get returns seed + empty workspace + defaults effective", async () => {
    getWorkspaceConfigValueMock.mockResolvedValue(undefined);
    const state = await getHotlistPlatformsState("hr");
    const seed = loadResearchHotlistPlatformsSeed();
    expect(getWorkspaceConfigValueMock).toHaveBeenCalledWith("hr", HOTLIST_PLATFORMS_CONFIG_KEY);
    expect(state.workspace).toEqual({ version: 1, enabled: [], excluded: [] });
    expect(state.effective).toEqual(seed.defaults);
  });

  it("put rejects unknown platform id", async () => {
    getWorkspaceConfigValueMock.mockResolvedValue(undefined);
    await expect(putHotlistPlatforms("hr", { enabled: ["not-real"] })).rejects.toBeInstanceOf(
      HotlistPlatformsValidationError,
    );
    expect(setWorkspaceConfigValueMock).not.toHaveBeenCalled();
  });

  it("put persists and returns effective", async () => {
    getWorkspaceConfigValueMock.mockResolvedValue(undefined);
    setWorkspaceConfigValueMock.mockResolvedValue(undefined);
    const state = await putHotlistPlatforms("hr", {
      enabled: ["weibo", "cls-hot"],
      excluded: [],
    });
    expect(state.effective).toEqual(["weibo", "cls-hot"]);
    expect(setWorkspaceConfigValueMock).toHaveBeenCalledWith(
      "hr",
      HOTLIST_PLATFORMS_CONFIG_KEY,
      expect.objectContaining({
        version: 1,
        enabled: ["weibo", "cls-hot"],
        excluded: [],
      }),
    );
  });
});
