import { afterEach, describe, expect, it, vi } from "vitest";

import {
  CHANNELS_PREVIEW_ENDPOINT,
  ChannelsPreviewUpstreamError,
  classifyChannelsUrl,
  ChannelsUrlError,
  normalizeChannelsPreviewResponse,
  parseCountFmt,
  resolveChannelsPreview,
  sanitizeCoverUrl,
  setChannelsPreviewTransportForTests,
} from "./channels-preview-probe.js";

describe("channels-preview-probe", () => {
  afterEach(() => {
    setChannelsPreviewTransportForTests(undefined);
    vi.restoreAllMocks();
  });

  it("allowlists sph and Finder Preview forms and rejects youtube/mp.weixin", () => {
    expect(classifyChannelsUrl("https://weixin.qq.com/sph/ALr3ch0zp9")).toEqual({
      shareId: "ALr3ch0zp9",
      canonicalUrl: "https://weixin.qq.com/sph/ALr3ch0zp9",
    });
    expect(
      classifyChannelsUrl("https://channels.weixin.qq.com/finder-preview/pages/sph?id=ALr3ch0zp9"),
    ).toEqual({
      shareId: "ALr3ch0zp9",
      canonicalUrl: "https://weixin.qq.com/sph/ALr3ch0zp9",
    });
    expect(() => classifyChannelsUrl("https://www.youtube.com/watch?v=dQw4w9WgXcQ")).toThrow(
      ChannelsUrlError,
    );
    expect(() => classifyChannelsUrl("https://mp.weixin.qq.com/s/notAChannelsShare")).toThrow(
      ChannelsUrlError,
    );
  });

  const LIVE_STILL =
    "https://finder.video.qq.com/251/20304/stodownload?encfilekey=redactedstill&token=redactedstill&picformat=1&wxampicformat=1";
  const PLAYABLE_TWIN =
    "https://finder.video.qq.com/251/20304/stodownload?encfilekey=secretkey123&token=signedtokenabc";

  it("keeps live-shaped stills with pic keys and drops playable twins", () => {
    expect(sanitizeCoverUrl(LIVE_STILL)).toBe(LIVE_STILL);
    expect(
      sanitizeCoverUrl(
        "https://finder.video.qq.com/251/20304/stodownload?encfilekey=redactedstill&token=redactedstill&picformat=1",
      ),
    ).toBe(
      "https://finder.video.qq.com/251/20304/stodownload?encfilekey=redactedstill&token=redactedstill&picformat=1",
    );
    expect(
      sanitizeCoverUrl(
        "https://finder.video.qq.com/251/20304/stodownload?encfilekey=redactedstill&token=redactedstill&wxampicformat=1",
      ),
    ).toBe(
      "https://finder.video.qq.com/251/20304/stodownload?encfilekey=redactedstill&token=redactedstill&wxampicformat=1",
    );
    expect(sanitizeCoverUrl(PLAYABLE_TWIN)).toBeNull();
    expect(
      sanitizeCoverUrl(
        "https://finder.video.qq.com/251/20304/stodownload?encfilekey=redactedstill&token=redactedstill",
      ),
    ).toBeNull();
    expect(
      sanitizeCoverUrl(
        "https://finder.video.qq.com/251/20304/stodownload?encfilekey=redactedstill&token=redactedstill&picformat=1&thumbkey=secretkey456",
      ),
    ).toBeNull();
    expect(sanitizeCoverUrl("https://finder.video.qq.com/251/20304/clip.mp4")).toBeNull();
    expect(sanitizeCoverUrl("https://finder.video.qq.com/251/20304/index.m3u8")).toBeNull();
    expect(
      sanitizeCoverUrl("https://finder.video.qq.com/251/20304/stodownload?wxavfile=1&picformat=1"),
    ).toBeNull();
    expect(
      sanitizeCoverUrl(
        "https://user:pass@finder.video.qq.com/251/20304/stodownload?picformat=1&wxampicformat=1",
      ),
    ).toBeNull();
  });

  it("normalizes feedInfo fixtures without retaining playable media URLs", () => {
    const post = normalizeChannelsPreviewResponse(
      {
        data: {
          feedInfo: {
            description: "液冷冷板",
            createtime: 1,
            likeCount: 2,
            coverUrl: LIVE_STILL,
            media: [
              {
                url: PLAYABLE_TWIN,
              },
            ],
          },
          authorInfo: { nickname: "展" },
        },
      },
      { shareId: "ALr3ch0zp9", canonicalUrl: "https://weixin.qq.com/sph/ALr3ch0zp9" },
    );
    expect(post.caption).toBe("液冷冷板");
    expect(post.author).toBe("展");
    expect(post.coverUrl).toBe(LIVE_STILL);
    expect(JSON.stringify(post)).not.toMatch(/signedtokenabc|secretkey123|thumbkey/);
    const withoutCover = JSON.stringify({ ...post, coverUrl: null });
    expect(withoutCover).not.toMatch(/encfilekey|stodownload/i);
  });

  it("parses 万/w/k/+ suffixed count formats used by WeChat Channels", () => {
    expect(parseCountFmt("1.5万")).toBe(15000);
    expect(parseCountFmt("1.5w")).toBe(15000);
    expect(parseCountFmt("1.5W")).toBe(15000);
    expect(parseCountFmt("100+")).toBe(100);
    expect(parseCountFmt("1.5w+")).toBe(15000);
    expect(parseCountFmt("1.5k")).toBe(1500);
    expect(parseCountFmt("2.5K")).toBe(2500);
    expect(parseCountFmt("111")).toBe(111);
    expect(parseCountFmt(551)).toBe(551);
    expect(parseCountFmt(null)).toBe(0);
    expect(parseCountFmt(undefined)).toBe(0);
    expect(parseCountFmt("")).toBe(0);
    expect(parseCountFmt("abc")).toBe(0);
  });

  it("posts empty generalToken and shortUri to the official Finder Preview endpoint", async () => {
    const seen: Array<{ url: string; body: string; headers: Record<string, string> }> = [];
    setChannelsPreviewTransportForTests({
      async post(input) {
        seen.push(input);
        return {
          status: 200,
          json: {
            data: {
              feedInfo: { description: "液冷", createtime: 1, likeCount: 1 },
              authorInfo: { nickname: "a" },
            },
          },
        };
      },
    });

    await resolveChannelsPreview("https://weixin.qq.com/sph/ALr3ch0zp9");
    expect(seen).toHaveLength(1);
    expect(seen[0]?.url.startsWith(CHANNELS_PREVIEW_ENDPOINT)).toBe(true);
    expect(seen[0]?.url).toContain("_pageUrl=");
    expect(seen[0]?.headers.Origin).toBe("https://channels.weixin.qq.com");
    expect(seen[0]?.headers.Referer).toContain("/finder-preview/pages/sph?id=ALr3ch0zp9");
    const payload = JSON.parse(seen[0]!.body) as {
      baseReq: { generalToken: string };
      shortUri: string;
    };
    expect(payload.baseReq.generalToken).toBe("");
    expect(payload.shortUri).toBe("ALr3ch0zp9");
  });

  it("throws a 502 when the preview payload carries no metadata", async () => {
    setChannelsPreviewTransportForTests({
      async post() {
        return {
          status: 200,
          json: { data: { feedInfo: {} } },
        };
      },
    });
    await expect(resolveChannelsPreview("https://weixin.qq.com/sph/ALr3ch0zp9")).rejects.toThrow(
      ChannelsPreviewUpstreamError,
    );
  });

  it("throws a 502 on a non-2xx transport response", async () => {
    setChannelsPreviewTransportForTests({
      async post() {
        return {
          status: 500,
          json: {},
        };
      },
    });
    await expect(resolveChannelsPreview("https://weixin.qq.com/sph/ALr3ch0zp9")).rejects.toThrow(
      ChannelsPreviewUpstreamError,
    );
  });

  it("maps transport-level failures to 503", async () => {
    setChannelsPreviewTransportForTests({
      async post() {
        throw new Error("fetch failed");
      },
    });
    await expect(resolveChannelsPreview("https://weixin.qq.com/sph/ALr3ch0zp9")).rejects.toMatchObject(
      expect.objectContaining({ status: 503 }),
    );
  });
});
