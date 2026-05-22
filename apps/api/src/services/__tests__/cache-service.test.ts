import { describe, it, expect, beforeEach, vi } from "vitest";
import { CacheService, stableStringify } from "../cache-service.js";

describe("stableStringify", () => {
  it("stringifies null", () => {
    expect(stableStringify(null)).toBe("null");
  });

  it("stringifies undefined", () => {
    expect(stableStringify(undefined)).toBe("undefined");
  });

  it("stringifies a number", () => {
    expect(stableStringify(42)).toBe("42");
  });

  it("stringifies a string", () => {
    expect(stableStringify("hello")).toBe("hello");
  });

  it("stringifies a boolean", () => {
    expect(stableStringify(true)).toBe("true");
  });

  it("stringifies a Date", () => {
    const date = new Date("2026-05-22T10:00:00.000Z");
    expect(stableStringify(date)).toBe("2026-05-22T10:00:00.000Z");
  });

  it("stringifies an array", () => {
    expect(stableStringify([1, "a", true])).toBe("[1,a,true]");
  });

  it("stringifies an object with sorted keys", () => {
    const result = stableStringify({ b: 2, a: 1 });
    expect(result).toBe("{a:1,b:2}");
  });

  it("handles nested objects", () => {
    const result = stableStringify({ z: { y: 1, x: 2 } });
    expect(result).toBe("{z:{x:2,y:1}}");
  });

  it("handles nested arrays", () => {
    expect(stableStringify([[1, 2], [3, 4]])).toBe("[[1,2],[3,4]]");
  });

  it("produces stable output regardless of key order", () => {
    const a = stableStringify({ foo: 1, bar: 2 });
    const b = stableStringify({ bar: 2, foo: 1 });
    expect(a).toBe(b);
  });
});

describe("CacheService", () => {
  let cache: CacheService;

  beforeEach(() => {
    cache = new CacheService();
  });

  describe("get/set", () => {
    it("stores and retrieves a value", () => {
      cache.set("key1", "value1");
      expect(cache.get("key1")).toBe("value1");
    });

    it("returns undefined for missing key", () => {
      expect(cache.get("missing")).toBeUndefined();
    });

    it("stores and retrieves different types", () => {
      cache.set("num", 42);
      cache.set("obj", { a: 1 });
      cache.set("arr", [1, 2, 3]);
      expect(cache.get<number>("num")).toBe(42);
      expect(cache.get<{ a: number }>("obj")).toEqual({ a: 1 });
      expect(cache.get<number[]>("arr")).toEqual([1, 2, 3]);
    });

    it("overwrites existing key", () => {
      cache.set("key", "old");
      cache.set("key", "new");
      expect(cache.get("key")).toBe("new");
    });
  });

  describe("TTL", () => {
    it("returns value within TTL", () => {
      cache.set("key", "value");
      expect(cache.get("key", 900)).toBe("value");
    });

    it("returns undefined after TTL expires", () => {
      cache.set("key", "value");
      vi.useFakeTimers();
      vi.advanceTimersByTime(901 * 1000);
      expect(cache.get("key", 900)).toBeUndefined();
      vi.useRealTimers();
    });

    it("deletes expired entry on access", () => {
      cache.set("key", "value");
      vi.useFakeTimers();
      vi.advanceTimersByTime(901 * 1000);
      cache.get("key", 900);
      expect(cache.getStats().total_entries).toBe(0);
      vi.useRealTimers();
    });
  });

  describe("delete", () => {
    it("deletes an existing key", () => {
      cache.set("key", "value");
      expect(cache.delete("key")).toBe(true);
      expect(cache.get("key")).toBeUndefined();
    });

    it("returns false for non-existent key", () => {
      expect(cache.delete("missing")).toBe(false);
    });
  });

  describe("clear", () => {
    it("clears all entries", () => {
      cache.set("a", 1);
      cache.set("b", 2);
      cache.clear();
      expect(cache.getStats().total_entries).toBe(0);
    });
  });

  describe("getStats", () => {
    it("reports total entries", () => {
      expect(cache.getStats().total_entries).toBe(0);
      cache.set("a", 1);
      expect(cache.getStats().total_entries).toBe(1);
      cache.set("b", 2);
      expect(cache.getStats().total_entries).toBe(2);
    });
  });

  describe("makeKey", () => {
    it("returns namespace when no params", () => {
      expect(cache.makeKey("ns")).toBe("ns");
    });

    it("returns namespace when empty params", () => {
      expect(cache.makeKey("ns", {})).toBe("ns");
    });

    it("generates deterministic key for same params", () => {
      const key1 = cache.makeKey("ns", { a: 1, b: 2 });
      const key2 = cache.makeKey("ns", { b: 2, a: 1 });
      expect(key1).toBe(key2);
    });

    it("skips null and undefined params", () => {
      const key = cache.makeKey("ns", { a: 1, b: null, c: undefined });
      expect(key).toMatch(/^ns:[a-f0-9]{8}$/);
    });

    it("handles string arrays by sorting", () => {
      const key1 = cache.makeKey("ns", { tags: ["z", "a"] });
      const key2 = cache.makeKey("ns", { tags: ["a", "z"] });
      expect(key1).toBe(key2);
    });

    it("handles object params", () => {
      const key = cache.makeKey("ns", { filter: { x: 1 } });
      expect(key).toMatch(/^ns:[a-f0-9]{8}$/);
    });

    it("formats key as namespace:hash", () => {
      const key = cache.makeKey("myapi", { q: "test" });
      expect(key).toMatch(/^myapi:[a-f0-9]{8}$/);
    });
  });
});
