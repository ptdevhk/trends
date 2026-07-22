import { afterEach, describe, expect, it, vi } from "vitest";

const getWorkspaceConfigValueMock = vi.fn();
const setWorkspaceConfigValueMock = vi.fn();
const listResearchNewsMock = vi.fn();
const resolveResearchCompanySurfaceMock = vi.fn();

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

vi.mock("./research-industry-bridge-service.js", () => ({
  resolveResearchCompanySurface: (surface: string) => resolveResearchCompanySurfaceMock(surface),
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
    resolveResearchCompanySurfaceMock.mockReset();
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
    resolveResearchCompanySurfaceMock.mockImplementation((surface: string) => {
      if (surface === "发那科") {
        return {
          companyKey: "fanuc",
          nameCn: "发那科",
          nameEn: "FANUC",
          displayName: "发那科 / FANUC",
          matchTier: "brand",
          entityId: "brand:fanuc",
          source: "resolveEntity",
        };
      }
      return null;
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
    expect(filtered.meta.keywordHits).toEqual(
      expect.arrayContaining([
        { keyword: "发那科", hitCount: 1, sampleTitles: ["发那科扩产"] },
        { keyword: "数控", hitCount: 0, sampleTitles: [] },
      ]),
    );
    expect(filtered.items).toHaveLength(1);
    expect(filtered.items[0]!.title).toBe("发那科扩产");
    expect(filtered.items[0]!.matchedKeywords).toContain("发那科");
    expect(filtered.items[0]!.url).toBe("https://example.com/1");
    expect(filtered.items[0]!.resolvedCompanies).toEqual([
      { companyKey: "fanuc", nameCn: "发那科", nameEn: "FANUC" },
    ]);

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
    expect(all.meta.matchedCount).toBe(1);
    expect(all.meta.keywordHits).toEqual(
      expect.arrayContaining([
        { keyword: "发那科", hitCount: 1, sampleTitles: ["发那科扩产"] },
      ]),
    );
    expect(all.items).toHaveLength(2);
    expect(all.items[0]!.matchedKeywords).toEqual(["发那科", "扩产"]);
    expect(all.items[0]!.resolvedCompanies).toEqual([
      { companyKey: "fanuc", nameCn: "发那科", nameEn: "FANUC" },
    ]);
    expect(all.items[1]!.matchedKeywords).toEqual([]);
  });

  it("getResearchPulse: hotlistOnly drops rss:* platforms", async () => {
    getWorkspaceConfigValueMock.mockResolvedValue({
      version: 1,
      enabled: [],
      excluded: [],
      custom: [],
    });
    resolveResearchCompanySurfaceMock.mockReturnValue(null);
    listResearchNewsMock.mockResolvedValue([
      {
        _id: "1",
        sourceId: "s",
        platform: "weibo",
        title: "热榜头条",
        contentHash: "h1",
        capturedAt: 300,
      },
      {
        _id: "2",
        sourceId: "s",
        platform: "rss:gnews-fanuc-cn",
        title: "发那科 RSS",
        contentHash: "h2",
        capturedAt: 200,
      },
      {
        _id: "3",
        sourceId: "s",
        platform: "zhihu",
        title: "知乎热榜",
        contentHash: "h3",
        capturedAt: 100,
      },
    ]);

    const result = await getResearchPulse("hr", { limit: 12, all: true, hotlistOnly: true });
    expect(result.meta.rawCount).toBe(2);
    expect(result.items.map((i) => i.platform)).toEqual(["weibo", "zhihu"]);
    expect(result.items.every((i) => !i.platform.startsWith("rss:"))).toBe(true);
  });
});
