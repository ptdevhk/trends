import { afterEach, describe, expect, it, vi } from "vitest";

import { buildMpBriefing, MpBriefingValidationError } from "./mp-briefing-service.js";

describe("buildMpBriefing", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("accepts a mix of modern and legacy mp article URLs and returns cards", async () => {
    const urls = [
      "https://mp.weixin.qq.com/s/AbC123xyz_89",
      "https://mp.weixin.qq.com/s?__biz=MzA3NDk&mid=2247&idx=1&sn=a1b2c3",
      "https://mp.weixin.qq.com/s/fanuc-die-cast",
    ];
    const result = await buildMpBriefing(urls);
    expect(result.cards).toHaveLength(3);
    expect(result.cards[0]).toEqual({
      url: "https://mp.weixin.qq.com/s/AbC123xyz_89",
      articleId: "AbC123xyz_89",
      kind: "mp",
    });
    expect(result.cards[1]?.articleId).toBeUndefined();
    expect(result.cards[1]?.kind).toBe("mp");
    expect(result.cards[2]?.articleId).toBe("fanuc-die-cast");
    expect(typeof result.generatedAt).toBe("string");
  });

  it("rejects a Channels sph URL with a validation error (never Channels)", async () => {
    await expect(
      buildMpBriefing(["https://weixin.qq.com/sph/ALr3ch0zp9"]),
    ).rejects.toThrow(MpBriefingValidationError);
  });

  it("rejects a non-mp URL", async () => {
    await expect(
      buildMpBriefing(["https://example.com/article/1"]),
    ).rejects.toThrow(MpBriefingValidationError);
  });

  it("rejects 0 URLs", async () => {
    await expect(buildMpBriefing([])).rejects.toThrow(MpBriefingValidationError);
  });

  it("rejects 9 URLs", async () => {
    const nine = Array.from(
      { length: 9 },
      (_, i) => `https://mp.weixin.qq.com/s/id-${i}`,
    );
    await expect(buildMpBriefing(nine)).rejects.toThrow(MpBriefingValidationError);
  });

  it("rejects a non-array input", async () => {
    await expect(buildMpBriefing("https://mp.weixin.qq.com/s/abc")).rejects.toThrow(
      MpBriefingValidationError,
    );
  });

  it("rejects a blank entry in the array", async () => {
    await expect(
      buildMpBriefing(["https://mp.weixin.qq.com/s/abc", "  "]),
    ).rejects.toThrow(MpBriefingValidationError);
  });
});
