import { describe, expect, it } from "vitest";
import {
  classifyMpArticleUrl,
  MpArticleUrlError,
} from "./mp-article-classifier.js";

describe("classifyMpArticleUrl", () => {
  it("accepts the modern /s/<id> article form", () => {
    const result = classifyMpArticleUrl("https://mp.weixin.qq.com/s/AbC123xyz_89");
    expect(result.url).toBe("https://mp.weixin.qq.com/s/AbC123xyz_89");
    expect(result.articleId).toBe("AbC123xyz_89");
  });

  it("accepts the legacy /s?__biz=... share form", () => {
    const url =
      "https://mp.weixin.qq.com/s?__biz=MzA3NDk&mid=2247&idx=1&sn=a1b2c3";
    expect(classifyMpArticleUrl(url).url).toBe(url);
    expect(classifyMpArticleUrl(url).articleId).toBeUndefined();
  });

  it("trims surrounding whitespace", () => {
    const result = classifyMpArticleUrl("  https://mp.weixin.qq.com/s/fanuc  ");
    expect(result.url).toBe("https://mp.weixin.qq.com/s/fanuc");
    expect(result.articleId).toBe("fanuc");
  });

  it("rejects a Channels sph URL (separate briefing lane)", () => {
    expect(() =>
      classifyMpArticleUrl("https://weixin.qq.com/sph/ALr3ch0zp9"),
    ).toThrow(MpArticleUrlError);
  });

  it("rejects non-https", () => {
    expect(() =>
      classifyMpArticleUrl("http://mp.weixin.qq.com/s/abc"),
    ).toThrow(MpArticleUrlError);
  });

  it("rejects userinfo in the URL", () => {
    expect(() =>
      classifyMpArticleUrl("https://user:pass@mp.weixin.qq.com/s/abc"),
    ).toThrow(MpArticleUrlError);
  });

  it("rejects a non-443 port", () => {
    expect(() =>
      classifyMpArticleUrl("https://mp.weixin.qq.com:8080/s/abc"),
    ).toThrow(MpArticleUrlError);
  });

  it("rejects non-article WeChat paths", () => {
    expect(() =>
      classifyMpArticleUrl("https://mp.weixin.qq.com/appmsg/abc"),
    ).toThrow(MpArticleUrlError);
    expect(() =>
      classifyMpArticleUrl("https://mp.weixin.qq.com/profile/abc"),
    ).toThrow(MpArticleUrlError);
  });

  it("rejects a bare /s without the legacy __biz marker", () => {
    expect(() => classifyMpArticleUrl("https://mp.weixin.qq.com/s/")).toThrow(
      MpArticleUrlError,
    );
  });

  it("rejects an empty / malformed URL", () => {
    expect(() => classifyMpArticleUrl("")).toThrow(MpArticleUrlError);
    expect(() => classifyMpArticleUrl("not a url")).toThrow(MpArticleUrlError);
  });
});
