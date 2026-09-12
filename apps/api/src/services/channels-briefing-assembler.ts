import type { ChannelsPreviewPost } from "./channels-preview-probe.js";

export type ChannelsBriefingOpportunity = {
  who: string;
  sell: string;
  why: string;
};

export type ChannelsBriefing = {
  oneLiner: string;
  generatedAt: string;
  posts: Array<{
    shareId: string;
    url: string;
    author: string;
    caption: string;
    createtime: number | null;
    likes: number;
    comments: number;
    forwards: number;
    favs: number;
    coverUrl: string | null;
  }>;
  coreTrends: string[];
  weakSignals: string[];
  opportunities: ChannelsBriefingOpportunity[];
  sources: string[];
};

const MACHINE_BRAND_RE = /创世纪|乔锋|发那科|海天|纽威|华中数控|沈阳机床|马扎克|牧野|加工中心|五轴|机床/;

function corpus(posts: ChannelsPreviewPost[]): string {
  return posts.map((post) => `${post.author}\n${post.caption}`).join("\n");
}

function heat(post: ChannelsPreviewPost): number {
  return post.forwards + post.likes + post.favs;
}

function createtimeRank(value: number | null): number {
  return value ?? Number.NEGATIVE_INFINITY;
}

function rankPostsByForwards(posts: ChannelsPreviewPost[]): ChannelsPreviewPost[] {
  return [...posts].sort((a, b) => {
    if (b.forwards !== a.forwards) {
      return b.forwards - a.forwards;
    }
    const timeDelta = createtimeRank(b.createtime) - createtimeRank(a.createtime);
    if (timeDelta !== 0) {
      return timeDelta;
    }
    return 0;
  });
}

function namedActor(text: string): string | undefined {
  const patterns = [
    /奇宏电子（AVC）/,
    /奇宏电子/,
    /奇宏/,
    /拓普集团/,
    /拓普/,
    /比亚迪/,
    /英维克/,
    /立敏达/,
    /AVC/,
  ];
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match?.[0]) {
      return match[0];
    }
  }
  return undefined;
}

function pushUnique(list: string[], item: string, limit: number): void {
  if (list.length >= limit) {
    return;
  }
  if (list.includes(item)) {
    return;
  }
  list.push(item);
}

function pushOpportunity(
  list: ChannelsBriefingOpportunity[],
  row: ChannelsBriefingOpportunity,
  limit: number,
): void {
  if (list.length >= limit) {
    return;
  }
  if (list.some((existing) => existing.who === row.who && existing.sell === row.sell)) {
    return;
  }
  list.push(row);
}

export function assembleChannelsBriefing(
  posts: ChannelsPreviewPost[],
  options?: { now?: Date; sources?: string[] },
): ChannelsBriefing {
  const text = corpus(posts);
  const liquid = /液冷|冷板|水冷/.test(text);
  const fittings = /UQD|UQDB|NVQD|MQD|接头|Manifold|歧管/.test(text);
  const diecast = /压铸/.test(text);
  const expansion = /扩产|扩建|年产/.test(text);
  const exhibition = /展/.test(text);
  const robot = /机器人/.test(text);
  const hasMachineBrand = MACHINE_BRAND_RE.test(text);

  const oneLinerParts: string[] = [];
  if (liquid && fittings) {
    oneLinerParts.push(
      "这几条内容讲的是同一条需求链：AI 服务器要把热带走 → 冷板 / 歧管 / UQD 接头要上量 → 壳体、阀芯、密封槽、平面度都是机床件。",
    );
  } else if (liquid) {
    oneLinerParts.push("视频号在讲液冷/冷板上量，CNC 切口是壳体、平面度与孔系。");
  } else if (diecast) {
    oneLinerParts.push("压铸厂把液冷或机器人写成第二曲线，CNC 切口是后加工与热管理件。");
  } else if (expansion) {
    oneLinerParts.push("公开文本在讲扩产，CNC 销售应对齐产线节拍与夹具。");
  } else {
    const fallback = posts[0]?.caption?.trim() || "公开标题未直接点出机床关键词，请结合原文阅读。";
    oneLinerParts.push(fallback.slice(0, 120));
  }
  if (exhibition) {
    oneLinerParts.push("深圳液冷展是拜访窗口。");
  }
  if (diecast) {
    oneLinerParts.push("拓普是压铸后加工和热管理件的切口。");
  }

  const coreTrends: string[] = [];
  if (liquid) {
    const hottest = [...posts].sort((a, b) => heat(b) - heat(a))[0];
    const heatNote = hottest ? `这几条里转发最高（${hottest.forwards}）。` : "";
    pushUnique(
      coreTrends,
      expansion
        ? `液冷从概念变成扩产订单。公开标题写到冷板/液冷产线与年产规模。${heatNote}`.trim()
        : `液冷/冷板出现在公开标题里，是这几条里的核心热点。${heatNote}`.trim(),
      4,
    );
  }
  if (fittings) {
    pushUnique(
      coreTrends,
      "接头是独立赛道。UQD/接头供应商名单把冷板和快接头写成上量件，CNC 切口是接头本体、阀芯、密封槽、高压孔系。",
      4,
    );
  }
  if (diecast) {
    pushUnique(
      coreTrends,
      "压铸厂在找液冷和机器人的第二曲线。对 CNC：压铸后加工、热管理壳体。",
      4,
    );
  }
  if (exhibition) {
    pushUnique(coreTrends, "拜访窗口：公开作者/标题指向液冷或压铸展会，可用这几条当谈话提纲。", 4);
  }
  if (coreTrends.length === 0) {
    for (const post of posts) {
      const snippet = post.caption.trim().slice(0, 80);
      if (snippet) {
        pushUnique(coreTrends, snippet, 4);
      }
    }
  }

  const weakSignals: string[] = [];
  if (!hasMachineBrand) {
    pushUnique(
      weakSignals,
      "这几条没有点名机床品牌或五轴型号。机床需求来自冷板、接头和压铸件的加工。",
      3,
    );
  }
  if (posts.length > 1) {
    const quietest = [...posts].sort((a, b) => heat(a) - heat(b))[0];
    if (quietest) {
      pushUnique(
        weakSignals,
        `${quietest.author || quietest.shareId} 这条互动低于同组（转发 ${quietest.forwards}），更适合作为线索，还不宜当成已确定的采购。`,
        3,
      );
    }
  }
  if (robot) {
    pushUnique(weakSignals, "机器人布局仍是早期线索，还不宜当成已确定的采购。", 3);
  }

  const opportunities: ChannelsBriefingOpportunity[] = [];
  if (liquid || expansion) {
    pushOpportunity(
      opportunities,
      {
        who: namedActor(text)?.includes("奇宏")
          ? "奇宏电子（AVC）深圳新产线及周边冷板/歧管代工厂"
          : namedActor(text) ?? "液冷冷板/歧管产线及周边代工厂",
        sell: "立加 / 高速钻攻、微米级平面与孔系、不锈钢/铝/铜件夹具",
        why: "公开标题写到液冷/冷板产线或年产规模",
      },
      4,
    );
  }
  if (fittings) {
    pushOpportunity(
      opportunities,
      {
        who: "国产 UQD/NVQD 接头厂（比亚迪、英维克、立敏达等）",
        sell: "精密车铣、阀芯/密封槽、高压孔、小五轴或多工位",
        why: "公开标题把接头/UQD 当成独立赛道",
      },
      4,
    );
  }
  if (diecast) {
    pushOpportunity(
      opportunities,
      {
        who: namedActor(text)?.includes("拓普")
          ? "拓普及同类新能源压铸 / 热管理件供应商"
          : "新能源压铸 / 热管理件供应商",
        sell: "压铸后加工单元、壳体铣削、热管理板/管件夹具",
        why: "公开标题把液冷或机器人写成新增长点",
      },
      4,
    );
  }
  if (exhibition) {
    pushOpportunity(
      opportunities,
      {
        who: "液冷/压铸展会的采购与设备商",
        sell: "现场对标：冷板产线节拍、接头精度、交期",
        why: "公开作者或标题指向展会窗口",
      },
      4,
    );
  }
  if (opportunities.length === 0 && posts[0]) {
    pushOpportunity(
      opportunities,
      {
        who: posts[0].author || "视频号作者",
        sell: "需人工判断的 CNC 件",
        why: posts[0].caption.slice(0, 80) || "公开标题未命中液冷/UQD/压铸关键词",
      },
      4,
    );
  }

  return {
    oneLiner: oneLinerParts.join(""),
    generatedAt: (options?.now ?? new Date()).toISOString(),
    posts: rankPostsByForwards(posts).map((post) => ({
      shareId: post.shareId,
      url: post.url,
      author: post.author,
      caption: post.caption,
      createtime: post.createtime,
      likes: post.likes,
      comments: post.comments,
      forwards: post.forwards,
      favs: post.favs,
      coverUrl: post.coverUrl,
    })),
    coreTrends: coreTrends.slice(0, 4),
    weakSignals: weakSignals.slice(0, 3),
    opportunities: opportunities.slice(0, 4),
    sources: options?.sources ?? posts.map((post) => post.url),
  };
}
