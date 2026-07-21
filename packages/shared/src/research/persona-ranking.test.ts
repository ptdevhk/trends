import { describe, expect, it } from "vitest";
import {
  kindRankForPersona,
  normalizeResearchPersona,
  rankSignalsForPersona,
} from "./persona-ranking.js";

describe("persona-ranking", () => {
  it("normalizes persona to hr|sales", () => {
    expect(normalizeResearchPersona("sales")).toBe("sales");
    expect(normalizeResearchPersona("HR")).toBe("hr");
    expect(normalizeResearchPersona(undefined)).toBe("hr");
  });

  it("ranks hiring first for hr and sales_trigger first for sales", () => {
    const signals = [
      { kind: "company_mention", capturedAt: 1, title: "m" },
      { kind: "hiring_signal", capturedAt: 2, title: "h" },
      { kind: "sales_trigger", capturedAt: 3, title: "s" },
      { kind: "market_move", capturedAt: 4, title: "k" },
    ];

    const hr = rankSignalsForPersona(signals, "hr");
    expect(hr.map((s) => s.kind)).toEqual([
      "hiring_signal",
      "market_move",
      "company_mention",
      "sales_trigger",
    ]);

    const sales = rankSignalsForPersona(signals, "sales");
    expect(sales.map((s) => s.kind)).toEqual([
      "sales_trigger",
      "market_move",
      "company_mention",
      "hiring_signal",
    ]);
  });

  it("exposes kind rank tables", () => {
    expect(kindRankForPersona("hiring_signal", "hr")).toBeLessThan(
      kindRankForPersona("sales_trigger", "hr"),
    );
    expect(kindRankForPersona("sales_trigger", "sales")).toBeLessThan(
      kindRankForPersona("hiring_signal", "sales"),
    );
  });
});
