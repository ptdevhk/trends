import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  aggregateUnresolvedEvents,
  filterAggregates,
  looksLikeSellBrandMisspelling,
  makeUnresolvedEvent,
} from "./industry-unresolved-queue.js";
import {
  appendUnresolvedEvents,
  defaultUnresolvedQueuePath,
  readUnresolvedQueue,
  writeUnresolvedQueue,
} from "./industry-unresolved-store.js";

describe("industry unresolved queue (pure)", () => {
  it("aggregates by normalizedKey with count, examples, maxNearbyScore", () => {
    const events = [
      makeUnresolvedEvent("乔某机床", "miss", 40),
      makeUnresolvedEvent("乔某 机床", "miss", 75),
      makeUnresolvedEvent("乔某机床有限公司", "miss", 50),
      makeUnresolvedEvent("other", "low_confidence_keyword", 10),
    ];
    // Force same key for first three by using identical surfaces for two
    const same = [
      makeUnresolvedEvent("UnknownOEM-A", "miss", 40),
      makeUnresolvedEvent("UnknownOEM-A", "miss", 80),
      makeUnresolvedEvent("UnknownOEM-A 分厂", "miss", 50),
      makeUnresolvedEvent("Other-B", "low_confidence_keyword", 10),
    ];
    // normalizeSurface strips spaces/punct — UnknownOEM-A分厂 differs
    const aggs = aggregateUnresolvedEvents(same);
    const top = aggs.find((a) => a.normalizedKey.includes("unknownoema"));
    expect(top).toBeDefined();
    expect(top!.count).toBeGreaterThanOrEqual(2);
    expect(top!.maxNearbyScore).toBe(80);
    expect(top!.examples.length).toBeGreaterThan(0);
  });

  it("priority stub: freq>=3", () => {
    const events = [
      makeUnresolvedEvent("FreqBrandX", "miss", 10),
      makeUnresolvedEvent("FreqBrandX", "miss", 10),
      makeUnresolvedEvent("FreqBrandX", "miss", 10),
    ];
    const [agg] = aggregateUnresolvedEvents(events);
    expect(agg.priority).toBe(true);
    expect(agg.priorityReasons).toContain("freq>=3");
  });

  it("priority stub: score>=70", () => {
    const events = [makeUnresolvedEvent("HighScoreY", "miss", 71)];
    const [agg] = aggregateUnresolvedEvents(events);
    expect(agg.priority).toBe(true);
    expect(agg.priorityReasons).toContain("score>=70");
  });

  it("priority stub: sell-brand misspelling heuristic", () => {
    // single-edit of "brother"
    expect(looksLikeSellBrandMisspelling("brothe")).toBe(true);
    const events = [makeUnresolvedEvent("brothe", "miss", 5)];
    const [agg] = aggregateUnresolvedEvents(events);
    expect(agg.priority).toBe(true);
    expect(agg.priorityReasons).toContain("sell_brand_misspelling");
  });

  it("filterAggregates respects minCount", () => {
    const events = [
      makeUnresolvedEvent("once", "miss"),
      makeUnresolvedEvent("twice", "miss"),
      makeUnresolvedEvent("twice", "miss"),
    ];
    const aggs = aggregateUnresolvedEvents(events);
    const filtered = filterAggregates(aggs, { minCount: 2 });
    expect(filtered.every((a) => a.count >= 2)).toBe(true);
    expect(filtered.some((a) => a.normalizedKey.includes("twice"))).toBe(true);
  });
});

describe("industry unresolved store (sidecar)", () => {
  it("writes and reads queue under output/industry-data without network", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "industry-queue-"));
    try {
      const filePath = defaultUnresolvedQueuePath(root);
      const events = [
        makeUnresolvedEvent("MissCo1", "miss", 72),
        makeUnresolvedEvent("MissCo1", "miss", 60),
        makeUnresolvedEvent("MissCo2", "low_confidence_keyword", 20),
      ];
      writeUnresolvedQueue(filePath, events);
      expect(fs.existsSync(filePath)).toBe(true);
      const loaded = readUnresolvedQueue(filePath);
      expect(loaded.events.length).toBe(3);
      expect(loaded.aggregates.length).toBeGreaterThan(0);
      const miss1 = loaded.aggregates.find((a) => a.normalizedKey.includes("missco1"));
      expect(miss1?.count).toBe(2);
      expect(miss1?.maxNearbyScore).toBe(72);

      appendUnresolvedEvents(filePath, [makeUnresolvedEvent("MissCo1", "miss", 90)]);
      const again = readUnresolvedQueue(filePath);
      const miss1b = again.aggregates.find((a) => a.normalizedKey.includes("missco1"));
      expect(miss1b?.count).toBe(3);
      expect(miss1b?.priority).toBe(true);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});
