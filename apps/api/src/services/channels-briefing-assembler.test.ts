import { describe, expect, it } from "vitest";

import { assembleChannelsBriefing } from "./channels-briefing-assembler.js";
import type { ChannelsPreviewPost } from "./channels-preview-probe.js";

function post(
  overrides: Partial<ChannelsPreviewPost> & Pick<ChannelsPreviewPost, "shareId">,
): ChannelsPreviewPost {
  return {
    url: `https://weixin.qq.com/sph/${overrides.shareId}`,
    author: "author",
    caption: "液冷冷板",
    createtime: 1,
    likes: 0,
    comments: 0,
    forwards: 0,
    favs: 0,
    views: 0,
    coverUrl: null,
    ...overrides,
  };
}

describe("assembleChannelsBriefing", () => {
  it("sorts posts by forwards descending", () => {
    const briefing = assembleChannelsBriefing([
      post({ shareId: "low", forwards: 10, createtime: 9 }),
      post({ shareId: "high", forwards: 50, createtime: 1 }),
      post({ shareId: "mid", forwards: 20, createtime: 5 }),
    ]);
    expect(briefing.posts.map((item) => item.shareId)).toEqual(["high", "mid", "low"]);
    expect(briefing.posts.map((item) => item.forwards)).toEqual([50, 20, 10]);
  });

  it("breaks equal forwards with newer createtime first", () => {
    const briefing = assembleChannelsBriefing([
      post({ shareId: "older", forwards: 20, createtime: 100 }),
      post({ shareId: "newer", forwards: 20, createtime: 200 }),
    ]);
    expect(briefing.posts.map((item) => item.shareId)).toEqual(["newer", "older"]);
  });

  it("keeps original order when forwards and createtime tie", () => {
    const briefing = assembleChannelsBriefing([
      post({ shareId: "first", forwards: 20, createtime: 50 }),
      post({ shareId: "second", forwards: 20, createtime: 50 }),
      post({ shareId: "third", forwards: 20, createtime: 50 }),
    ]);
    expect(briefing.posts.map((item) => item.shareId)).toEqual(["first", "second", "third"]);
  });

  it("leaves sources in paste order while ranking posts", () => {
    const urls = [
      "https://weixin.qq.com/sph/low",
      "https://weixin.qq.com/sph/high",
    ];
    const briefing = assembleChannelsBriefing(
      [
        post({ shareId: "low", url: urls[0]!, forwards: 1, createtime: 1 }),
        post({ shareId: "high", url: urls[1]!, forwards: 9, createtime: 1 }),
      ],
      { sources: urls },
    );
    expect(briefing.posts.map((item) => item.shareId)).toEqual(["high", "low"]);
    expect(briefing.sources).toEqual(urls);
  });

  it("falls back to the first caption when no keyword matches", () => {
    const briefing = assembleChannelsBriefing([
      post({ shareId: "generic", caption: "车间日常记录" }),
    ]);
    expect(briefing.oneLiner).toContain("车间日常记录");
    // No keyword → no liquid/fittings/diecast/expansion opportunity rows, so
    // the fallback opportunity derives from the first post.
    expect(briefing.opportunities).toHaveLength(1);
    expect(briefing.opportunities[0]!.who).toBe("author");
    expect(briefing.opportunities[0]!.why).toContain("车间日常记录");
  });

  it("emits the robot weak-signal when 机器人 appears but no machine brand is named", () => {
    const briefing = assembleChannelsBriefing([
      post({ shareId: "robot", caption: "机器人布局扩产" }),
    ]);
    expect(briefing.weakSignals.some((s) => s.includes("机器人布局仍是早期线索"))).toBe(true);
  });

  it("emits the no-brand weak-signal when captions carry no machine brand", () => {
    const briefing = assembleChannelsBriefing([
      post({ shareId: "nobrand", caption: "冷板上量扩产" }),
    ]);
    expect(briefing.weakSignals.some((s) => s.includes("没有点名机床品牌"))).toBe(true);
  });
});
