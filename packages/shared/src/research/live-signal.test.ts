import { describe, expect, it } from "vitest";
import {
  isLiveResearchSignal,
  partitionAndRankSignalsForPersona,
} from "./live-signal.js";

const liveHire = {
  kind: "hiring_signal",
  capturedAt: 2,
  evidence: { platform: "weibo", title: "x" },
  ingestRunId: "research-abc",
};
const liveSales = {
  kind: "sales_trigger",
  capturedAt: 3,
  evidence: { platform: "zhihu", title: "y" },
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

  it("partition ranks live first for hr then showcase", () => {
    const { items, meta } = partitionAndRankSignalsForPersona(
      [seedSales, liveSales, seedHire, liveHire],
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
