import { describe, expect, it } from "vitest";
import {
  isLiveResearchSignal,
  isShowcaseCuratedSignal,
  partitionAndRankSignalsForPersona,
} from "./live-signal.js";

const liveHire = {
  kind: "hiring_signal",
  capturedAt: 2,
  evidence: { platform: "weibo", title: "x", url: "https://weibo.com/real/1" },
  ingestRunId: "research-abc",
};
const liveSales = {
  kind: "sales_trigger",
  capturedAt: 3,
  evidence: { platform: "zhihu", title: "y", url: "https://www.zhihu.com/question/1" },
  ingestRunId: "research-def",
};
const seedHire = {
  kind: "hiring_signal",
  capturedAt: 9,
  evidence: { platform: "showcase", title: "s" },
  ingestRunId: "showcase-seed-v1",
};
const seedSales = {
  kind: "sales_trigger",
  capturedAt: 8,
  evidence: { platform: "showcase", title: "s2" },
  ingestRunId: "showcase-seed-v1",
};
const demoHire = {
  kind: "hiring_signal",
  capturedAt: 7,
  evidence: {
    platform: "rss:demo",
    title: "demo",
    url: "https://example.com/news/2",
  },
  ingestRunId: "demo-seed",
};

describe("live-signal", () => {
  it("isLiveResearchSignal rejects showcase platform and showcase-seed ingest", () => {
    expect(isLiveResearchSignal(liveHire)).toBe(true);
    expect(isLiveResearchSignal(seedHire)).toBe(false);
    expect(
      isLiveResearchSignal({
        evidence: { platform: "weibo" },
        ingestRunId: "showcase-seed-v1",
      }),
    ).toBe(false);
  });

  it("rejects demo-seed and rss:demo and example.com as not live", () => {
    expect(
      isLiveResearchSignal({
        evidence: { platform: "rss:demo", url: "https://example.com/news/1" },
        ingestRunId: "demo-seed",
      }),
    ).toBe(false);
    expect(
      isLiveResearchSignal({
        evidence: { platform: "weibo", url: "https://example.com/x" },
        ingestRunId: "research-abc",
      }),
    ).toBe(false);
    expect(
      isLiveResearchSignal({
        evidence: { platform: "weibo", url: "https://weibo.com/real/1" },
        ingestRunId: "research-abc",
      }),
    ).toBe(true);
    expect(
      isLiveResearchSignal({
        evidence: { platform: "weibo" },
        ingestRunId: "demo-other",
      }),
    ).toBe(false);
  });

  it("isShowcaseCuratedSignal only for showcase seed", () => {
    expect(isShowcaseCuratedSignal(seedHire)).toBe(true);
    expect(isShowcaseCuratedSignal(demoHire)).toBe(false);
    expect(isShowcaseCuratedSignal(liveHire)).toBe(false);
  });

  it("partition ranks live first for hr then showcase; drops demo", () => {
    const { items, meta } = partitionAndRankSignalsForPersona(
      [seedSales, liveSales, seedHire, liveHire, demoHire],
      "hr",
    );
    expect(meta).toEqual({ liveCount: 2, showcaseCount: 2, liveFirst: true });
    expect(items.map((i) => i.kind)).toEqual([
      "hiring_signal",
      "sales_trigger",
      "hiring_signal",
      "sales_trigger",
    ]);
    expect(items[0]).toBe(liveHire);
    expect(items.some((i) => i === demoHire)).toBe(false);
  });

  it("sales persona reorders live kinds without promoting showcase above live", () => {
    const { items } = partitionAndRankSignalsForPersona(
      [liveHire, liveSales, seedHire],
      "sales",
    );
    expect(items[0]).toBe(liveSales);
    expect(items[1]).toBe(liveHire);
    expect(items[2]).toBe(seedHire);
  });
});
