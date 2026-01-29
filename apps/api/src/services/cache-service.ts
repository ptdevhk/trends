import crypto from "node:crypto";

type CacheEntry<T> = {
  value: T;
  timestampMs: number;
};

function stableStringify(value: unknown): string {
  if (value === null) return "null";
  if (value === undefined) return "undefined";
  if (value instanceof Date) return value.toISOString();

  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(",")}]`;
  }

  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    const keys = Object.keys(record).sort((a, b) => a.localeCompare(b));
    return `{${keys.map((k) => `${k}:${stableStringify(record[k])}`).join(",")}}`;
  }

  return String(value);
}

export class CacheService {
  private cache = new Map<string, CacheEntry<unknown>>();

  get<T>(key: string, ttlSeconds = 900): T | undefined {
    const entry = this.cache.get(key);
    if (!entry) return undefined;
    if (Date.now() - entry.timestampMs < ttlSeconds * 1000) return entry.value as T;

    this.cache.delete(key);
    return undefined;
  }

  set<T>(key: string, value: T): void {
    this.cache.set(key, { value, timestampMs: Date.now() });
  }

  delete(key: string): boolean {
    return this.cache.delete(key);
  }

  clear(): void {
    this.cache.clear();
  }

  getStats(): { total_entries: number } {
    return { total_entries: this.cache.size };
  }

  makeKey(namespace: string, params?: Record<string, unknown>): string {
    if (!params || Object.keys(params).length === 0) return namespace;

    const normalized: Record<string, string> = {};

    for (const [key, value] of Object.entries(params)) {
      if (value === undefined || value === null) continue;

      if (Array.isArray(value)) {
        if (value.every((v) => typeof v === "string")) {
          normalized[key] = JSON.stringify([...value].sort());
        } else {
          normalized[key] = stableStringify(value);
        }
        continue;
      }

      if (typeof value === "object") {
        normalized[key] = stableStringify(value);
        continue;
      }

      normalized[key] = String(value);
    }

    const paramStr = Object.entries(normalized)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${k}=${v}`)
      .join("&");

    const hash = crypto.createHash("md5").update(paramStr, "utf8").digest("hex").slice(0, 8);
    return `${namespace}:${hash}`;
  }
}
