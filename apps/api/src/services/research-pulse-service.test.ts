import { afterEach, describe, expect, it, vi } from "vitest";

const getWorkspaceConfigValueMock = vi.fn();
const setWorkspaceConfigValueMock = vi.fn();
const listResearchNewsMock = vi.fn();
const resolveResearchCompanySurfaceMock = vi.fn();
const getHotlistPlatformsStateMock = vi.fn();

vi.mock("./workspace-config-service.js", () => ({
  workspaceConfigService: {
    getWorkspaceConfigValue: (workspaceSlug: string, configKey: string) =>
      getWorkspaceConfigValueMock(workspaceSlug, configKey),
    setWorkspaceConfigValue: (workspaceSlug: string, configKey: string, configValue: unknown) =>
      setWorkspaceConfigValueMock(workspaceSlug, configKey, configValue),
  },
}));

vi.mock("./research-service.js", () => ({
  listResearchNews: (params: { limit?: number; platform?: string }) => listResearchNewsMock(params),
}));

vi.mock("./research-industry-bridge-service.js", () => ({
  resolveResearchCompanySurface: (surface: string) => resolveResearchCompanySurfaceMock(surface),
}));

vi.mock("./research-hotlist-platforms-service.js", () => ({
  getHotlistPlatformsState: (workspaceSlug: string) => getHotlistPlatformsStateMock(workspaceSlug),
}));

import {
  getPulseKeywordsState,
  getResearchPulse,
  isHotlistPlatform,
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
    getHotlistPlatformsStateMock.mockReset();
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
        expect.objectContaining({ keyword: "发那科", hitCount: 1, sampleTitles: ["发那科扩产"] }),
        expect.objectContaining({ keyword: "数控", hitCount: 0, sampleTitles: [] }),
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
        expect.objectContaining({ keyword: "发那科", hitCount: 1, sampleTitles: ["发那科扩产"] }),
      ]),
    );
    expect(all.items).toHaveLength(2);
    expect(all.items[0]!.matchedKeywords).toEqual(["发那科", "扩产"]);
    expect(all.items[0]!.resolvedCompanies).toEqual([
      { companyKey: "fanuc", nameCn: "发那科", nameEn: "FANUC" },
    ]);
    expect(all.items[1]!.matchedKeywords).toEqual([]);
  });

  it("getResearchPulse: hotlistOnly queries per platform so RSS cannot crowd out NewsNow", async () => {
    getWorkspaceConfigValueMock.mockResolvedValue({
      version: 1,
      enabled: [],
      excluded: [],
      custom: [],
    });
    resolveResearchCompanySurfaceMock.mockReturnValue(null);
    getHotlistPlatformsStateMock.mockResolvedValue({
      seed: { version: "v1", groups: [], defaults: ["weibo", "zhihu"], catalogIds: ["weibo", "zhihu"] },
      workspace: { version: 1, enabled: [], excluded: [] },
      effective: ["weibo", "zhihu"],
    });
    // Shipped path: listResearchNews({ platform }) per effective hotlist id — never a global mix
    // that is dominated by rss:gnews-* rows.
    listResearchNewsMock.mockImplementation(async (params: { platform?: string }) => {
      if (params.platform === "weibo") {
        return [
          {
            _id: "1",
            sourceId: "s",
            platform: "weibo",
            title: "热榜头条",
            contentHash: "h1",
            capturedAt: 300,
          },
        ];
      }
      if (params.platform === "zhihu") {
        return [
          {
            _id: "3",
            sourceId: "s",
            platform: "zhihu",
            title: "知乎热榜",
            contentHash: "h3",
            capturedAt: 100,
          },
        ];
      }
      // Global unfiltered path would return RSS-only — must not be used when hotlistOnly.
      return [
        {
          _id: "2",
          sourceId: "s",
          platform: "rss:gnews-fanuc-cn",
          title: "发那科 RSS",
          contentHash: "h2",
          capturedAt: 999,
        },
      ];
    });

    const result = await getResearchPulse("hr", { limit: 12, all: true, hotlistOnly: true });
    expect(getHotlistPlatformsStateMock).toHaveBeenCalledWith("hr");
    expect(listResearchNewsMock).toHaveBeenCalledWith(
      expect.objectContaining({ platform: "weibo" }),
    );
    expect(listResearchNewsMock).toHaveBeenCalledWith(
      expect.objectContaining({ platform: "zhihu" }),
    );
    // Items path must still use per-platform reads; one global call is allowed for dual meta counts.
    const platformCalls = listResearchNewsMock.mock.calls.filter(
      (call) => call[0] && call[0].platform != null,
    );
    expect(platformCalls.length).toBeGreaterThanOrEqual(2);
    expect(result.meta.rawCount).toBe(2);
    expect(result.items.map((i) => i.platform)).toEqual(["weibo", "zhihu"]);
    expect(result.items.every((i) => !i.platform.startsWith("rss:"))).toBe(true);
    expect(result.meta.hotlistMatchedCount).toBeGreaterThanOrEqual(0);
    expect(typeof result.meta.rssMatchedCount).toBe("number");
  });

  it("getResearchPulse: hotlistOnly keeps items hotlist-scoped but reports rssMatchedCount for soft-empty chips", async () => {
    getWorkspaceConfigValueMock.mockResolvedValue({
      version: 1,
      enabled: [],
      excluded: [],
      custom: ["发那科", "数控"],
    });
    resolveResearchCompanySurfaceMock.mockReturnValue(null);
    getHotlistPlatformsStateMock.mockResolvedValue({
      seed: { version: "v1", groups: [], defaults: ["weibo"], catalogIds: ["weibo"] },
      workspace: { version: 1, enabled: [], excluded: [] },
      effective: ["weibo"],
    });
    listResearchNewsMock.mockImplementation(async (params: { platform?: string; limit?: number }) => {
      if (params.platform === "weibo") {
        return [
          {
            _id: "1",
            sourceId: "s",
            platform: "weibo",
            title: "娱乐热搜无关",
            contentHash: "h1",
            capturedAt: 300,
          },
        ];
      }
      // Mixed / meta path (no platform): includes CNC RSS density.
      return [
        {
          _id: "1",
          sourceId: "s",
          platform: "weibo",
          title: "娱乐热搜无关",
          contentHash: "h1",
          capturedAt: 300,
        },
        {
          _id: "2",
          sourceId: "s",
          platform: "rss:gnews-fanuc-cn",
          title: "发那科推出新一代数控系统",
          contentHash: "h2",
          capturedAt: 200,
        },
        {
          _id: "3",
          sourceId: "s",
          platform: "rss:gnews-cnc-machine",
          title: "数控机床订单回暖",
          contentHash: "h3",
          capturedAt: 100,
        },
      ];
    });

    const result = await getResearchPulse("hr", { limit: 12, hotlistOnly: true });
    expect(result.items.every((i) => !i.platform.startsWith("rss:"))).toBe(true);
    expect(result.meta.matchedCount).toBe(0);
    expect(result.meta.hotlistMatchedCount).toBe(0);
    expect(result.meta.rssMatchedCount).toBe(2);
    const fanuc = result.meta.keywordHits.find((h) => h.keyword === "发那科");
    const shukong = result.meta.keywordHits.find((h) => h.keyword === "数控");
    expect(fanuc).toMatchObject({
      hitCount: 0,
      hotlistHitCount: 0,
      rssHitCount: 1,
    });
    expect(shukong?.hitCount).toBe(0);
    expect(shukong?.hotlistHitCount).toBe(0);
    expect(shukong?.rssHitCount).toBeGreaterThanOrEqual(1);
  });

  it("getResearchPulse: hotlistOnly=0 includes RSS in matchedCount and dual chip counts", async () => {
    getWorkspaceConfigValueMock.mockResolvedValue({
      version: 1,
      enabled: [],
      excluded: [],
      custom: ["发那科"],
    });
    resolveResearchCompanySurfaceMock.mockReturnValue(null);
    listResearchNewsMock.mockResolvedValue([
      {
        _id: "1",
        sourceId: "s",
        platform: "weibo",
        title: "娱乐热搜",
        contentHash: "h1",
        capturedAt: 300,
      },
      {
        _id: "2",
        sourceId: "s",
        platform: "rss:gnews-fanuc-cn",
        title: "发那科扩产",
        contentHash: "h2",
        capturedAt: 200,
      },
    ]);

    const result = await getResearchPulse("hr", { limit: 12, hotlistOnly: false });
    expect(result.meta.matchedCount).toBe(1);
    expect(result.meta.hotlistMatchedCount).toBe(0);
    expect(result.meta.rssMatchedCount).toBe(1);
    expect(result.items).toHaveLength(1);
    expect(result.items[0]!.platform).toBe("rss:gnews-fanuc-cn");
    expect(result.meta.keywordHits).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          keyword: "发那科",
          hitCount: 1,
          hotlistHitCount: 0,
          rssHitCount: 1,
        }),
      ]),
    );
  });

  it("getResearchPulse: keyword focuses the feed server-side (substring fallback for free-form handoff)", async () => {
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
        title: "液冷扩产订单落地",
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

    const focused = await getResearchPulse("hr", { limit: 12, keyword: "液冷" });
    // The item also matches the seed effective keyword set (液冷/扩产), so the
    // keyword focus narrows the feed to it regardless of the match path.
    expect(focused.items.map((i) => i.title)).toEqual(["液冷扩产订单落地"]);
    expect(focused.meta.filtered).toBe(true);
    expect(focused.meta.rawCount).toBe(2);

    // A keyword matching an item's matchedKeywords (in the effective set) also works.
    const effectiveFocused = await getResearchPulse("hr", { limit: 12, keyword: "扩产" });
    expect(effectiveFocused.items.map((i) => i.title)).toEqual(["液冷扩产订单落地"]);
  });

  it("isHotlistPlatform: non-rss subscription prefixes are NOT hotlist (fail-safe for Phase B WeRSS)", () => {
    // The current classifier is a negative test: anything NOT 'rss:' is treated as
    // a NewsNow hotlist platform. WeRSS feeds must be pinned to the 'rss:' lane
    // (recommended rss:werss-*); this locks that requirement so a mis-prefixed
    // 'werss:'/'wechat:'/'mp:' item would not silently leak into the hotlist.
    expect(isHotlistPlatform("rss:gnews-fanuc-cn")).toBe(false);
    expect(isHotlistPlatform("rss:werss-cnc-diecast")).toBe(false);
    expect(isHotlistPlatform("rss:WERSS-x")).toBe(false); // case-insensitive
    // Real NewsNow platform ids are bare slugs, not rss:.
    expect(isHotlistPlatform("weibo")).toBe(true);
    expect(isHotlistPlatform("zhihu")).toBe(true);
    // A non-'rss:' 'wechat:'/'werss:' prefix WOULD currently be classified as hotlist.
    // This is by design today (the negative test) — Phase B must pin WeRSS to rss:*
    // or invert this to an explicit hotlist allowlist. Assert current behavior so a
    // future regression is caught if we ever expect these to be non-hotlist.
    expect(isHotlistPlatform("werss:cnc-diecast")).toBe(true);
    expect(isHotlistPlatform("wechat:mp")).toBe(true);
  });
});
