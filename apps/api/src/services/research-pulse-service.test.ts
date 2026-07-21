import { afterEach, describe, expect, it, vi } from "vitest";

const getWorkspaceConfigValueMock = vi.fn();
const setWorkspaceConfigValueMock = vi.fn();
const listResearchNewsMock = vi.fn();

vi.mock("./workspace-config-service.js", () => ({
  workspaceConfigService: {
    getWorkspaceConfigValue: (workspaceSlug: string, configKey: string) =>
      getWorkspaceConfigValueMock(workspaceSlug, configKey),
    setWorkspaceConfigValue: (workspaceSlug: string, configKey: string, configValue: unknown) =>
      setWorkspaceConfigValueMock(workspaceSlug, configKey, configValue),
  },
}));

vi.mock("./research-service.js", () => ({
  listResearchNews: (params: { limit?: number }) => listResearchNewsMock(params),
}));

import {
  getPulseKeywordsState,
  getResearchPulse,
  putPulseKeywords,
  PulseKeywordsValidationError,
} from "./research-pulse-service.js";
import {
  loadResearchPulseKeywordsSeed,
  PULSE_KEYWORDS_CONFIG_KEY,
} from "./research-pulse-keywords.js";

describe("research-pulse-service", () => {
  afterEach(() => {
    getWorkspaceConfigValueMock.mockReset();
    setWorkspaceConfigValueMock.mockReset();
    listResearchNewsMock.mockReset();
  });

  it("getPulseKeywordsState: no workspace config → effective = seed defaults", async () => {
    getWorkspaceConfigValueMock.mockResolvedValue(undefined);
    const state = await getPulseKeywordsState("hr");
    const seed = loadResearchPulseKeywordsSeed();
    expect(getWorkspaceConfigValueMock).toHaveBeenCalledWith("hr", PULSE_KEYWORDS_CONFIG_KEY);
    expect(state.workspace).toEqual({ version: 1, enabled: [], excluded: [], custom: [] });
    expect(state.effective).toEqual(seed.defaultKeywords);
    expect(state.seed.defaultKeywords).toEqual(seed.defaultKeywords);
  });

  it("putPulseKeywords: custom appears in effective on subsequent get", async () => {
    getWorkspaceConfigValueMock.mockResolvedValue(undefined);
    setWorkspaceConfigValueMock.mockResolvedValue(undefined);

    const put = await putPulseKeywords("hr", { custom: ["刀塔"] });
    expect(put.effective).toContain("刀塔");
    expect(setWorkspaceConfigValueMock).toHaveBeenCalledWith(
      "hr",
      PULSE_KEYWORDS_CONFIG_KEY,
      expect.objectContaining({
        version: 1,
        custom: ["刀塔"],
      }),
    );

    getWorkspaceConfigValueMock.mockResolvedValue({
      version: 1,
      enabled: [],
      excluded: [],
      custom: ["刀塔"],
    });
    const got = await getPulseKeywordsState("hr");
    expect(got.effective).toContain("刀塔");
    expect(got.workspace.custom).toEqual(["刀塔"]);
  });

  it("putPulseKeywords: rejects more than 20 custom keywords", async () => {
    getWorkspaceConfigValueMock.mockResolvedValue(undefined);
    const custom = Array.from({ length: 21 }, (_, i) => `kw${i}`);
    await expect(putPulseKeywords("hr", { custom })).rejects.toBeInstanceOf(
      PulseKeywordsValidationError,
    );
    expect(setWorkspaceConfigValueMock).not.toHaveBeenCalled();
  });

  it("putPulseKeywords: rejects keyword longer than 32 chars", async () => {
    getWorkspaceConfigValueMock.mockResolvedValue(undefined);
    await expect(
      putPulseKeywords("hr", { custom: ["x".repeat(33)] }),
    ).rejects.toBeInstanceOf(PulseKeywordsValidationError);
    expect(setWorkspaceConfigValueMock).not.toHaveBeenCalled();
  });

  it("getResearchPulse: filters non-matching titles; all=true is unfiltered", async () => {
    getWorkspaceConfigValueMock.mockResolvedValue({
      version: 1,
      enabled: [],
      excluded: [],
      custom: ["发那科"],
    });
    listResearchNewsMock.mockResolvedValue([
      {
        _id: "1",
        sourceId: "s",
        platform: "weibo",
        title: "发那科扩产",
        contentHash: "h1",
        capturedAt: 200,
        url: "https://example.com/1",
      },
      {
        _id: "2",
        sourceId: "s",
        platform: "weibo",
        title: "娱乐热搜",
        contentHash: "h2",
        capturedAt: 100,
      },
    ]);

    const filtered = await getResearchPulse("hr", { limit: 12 });
    expect(listResearchNewsMock).toHaveBeenCalledWith({ limit: 100 });
    expect(filtered.meta.filtered).toBe(true);
    expect(filtered.meta.rawCount).toBe(2);
    expect(filtered.meta.matchedCount).toBe(1);
    expect(filtered.items).toHaveLength(1);
    expect(filtered.items[0]!.title).toBe("发那科扩产");
    expect(filtered.items[0]!.matchedKeywords).toContain("发那科");
    expect(filtered.items[0]!.url).toBe("https://example.com/1");

    listResearchNewsMock.mockClear();
    listResearchNewsMock.mockResolvedValue([
      {
        _id: "1",
        sourceId: "s",
        platform: "weibo",
        title: "发那科扩产",
        contentHash: "h1",
        capturedAt: 200,
      },
      {
        _id: "2",
        sourceId: "s",
        platform: "weibo",
        title: "娱乐热搜",
        contentHash: "h2",
        capturedAt: 100,
      },
    ]);

    const all = await getResearchPulse("hr", { limit: 12, all: true });
    expect(listResearchNewsMock).toHaveBeenCalledWith({ limit: 12 });
    expect(all.meta.filtered).toBe(false);
    expect(all.meta.matchedCount).toBe(2);
    expect(all.items).toHaveLength(2);
    expect(all.items.every((i) => i.matchedKeywords.length === 0)).toBe(true);
  });
});
