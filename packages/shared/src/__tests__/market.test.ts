import { describe, it, expect } from "vitest";
import { SOURCE_KEY_TO_MARKET, deriveMarketFromSourceKey, type KeywordMarket } from "../market.js";

describe("market", () => {
  describe("SOURCE_KEY_TO_MARKET", () => {
    it("maps job5156 to CN", () => {
      expect(SOURCE_KEY_TO_MARKET.job5156).toBe("CN");
    });

    it("maps 51job to CN", () => {
      expect(SOURCE_KEY_TO_MARKET["51job"]).toBe("CN");
    });

    it("maps seek to MY", () => {
      expect(SOURCE_KEY_TO_MARKET.seek).toBe("MY");
    });
  });

  describe("deriveMarketFromSourceKey", () => {
    it("returns CN for null", () => {
      expect(deriveMarketFromSourceKey(null)).toBe("CN");
    });

    it("returns CN for undefined", () => {
      expect(deriveMarketFromSourceKey(undefined)).toBe("CN");
    });

    it("returns CN for empty string", () => {
      expect(deriveMarketFromSourceKey("")).toBe("CN");
    });

    it("returns CN for unknown sourceKey", () => {
      expect(deriveMarketFromSourceKey("linkedin")).toBe("CN");
    });

    it("returns MY for seek", () => {
      expect(deriveMarketFromSourceKey("seek")).toBe("MY");
    });

    it("returns CN for job5156", () => {
      expect(deriveMarketFromSourceKey("job5156")).toBe("CN");
    });

    it("returns CN for 51job", () => {
      expect(deriveMarketFromSourceKey("51job")).toBe("CN");
    });
  });

  describe("KeywordMarket type", () => {
    it("accepts CN value", () => {
      const market: KeywordMarket = "CN";
      expect(market).toBe("CN");
    });

    it("accepts MY value", () => {
      const market: KeywordMarket = "MY";
      expect(market).toBe("MY");
    });
  });
});
