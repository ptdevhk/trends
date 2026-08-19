import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { aggregateUnresolvedEvents, makeUnresolvedEvent } from "./industry-unresolved-queue.js";
import {
  applyResolutionsToAggregates,
  defaultUnresolvedResolutionsPath,
  readUnresolvedResolutions,
  resolveUnresolvedKeys,
  writeUnresolvedResolutions,
  type UnresolvedResolution,
} from "./industry-unresolved-resolutions.js";

function tmpRoot(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "industry-resolutions-"));
}

describe("industry unresolved resolutions (sidecar)", () => {
  it("reads missing file as empty resolutions", () => {
    const root = tmpRoot();
    try {
      const filePath = defaultUnresolvedResolutionsPath(root);
      const loaded = readUnresolvedResolutions(filePath);
      expect(loaded.version).toBe(1);
      expect(loaded.resolutions).toEqual([]);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("writes and reads resolutions roundtrip", () => {
    const root = tmpRoot();
    try {
      const filePath = defaultUnresolvedResolutionsPath(root);
      const resolutions: UnresolvedResolution[] = [
        {
          normalizedKey: "polywell",
          action: "link",
          targetCompanyKey: "polywell",
          resolvedAt: "2026-08-19T00:00:00.000Z",
          resolvedBy: "admin",
        },
        {
          normalizedKey: "ghostbrand",
          action: "ignore",
          resolvedAt: "2026-08-19T00:00:00.000Z",
          resolvedBy: "demo-admin",
        },
      ];
      writeUnresolvedResolutions(filePath, resolutions);
      expect(fs.existsSync(filePath)).toBe(true);
      const loaded = readUnresolvedResolutions(filePath);
      expect(loaded.resolutions).toEqual(resolutions);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("drops malformed resolution entries on read", () => {
    const root = tmpRoot();
    try {
      const filePath = defaultUnresolvedResolutionsPath(root);
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
      fs.writeFileSync(
        filePath,
        JSON.stringify({
          version: 1,
          updatedAt: "2026-08-19T00:00:00.000Z",
          resolutions: [
            { normalizedKey: "valid", action: "ignore", resolvedAt: "t", resolvedBy: "u" },
            { normalizedKey: "bad-action", action: "merge", resolvedAt: "t", resolvedBy: "u" },
            { normalizedKey: "", action: "ignore", resolvedAt: "t", resolvedBy: "u" },
            "junk",
          ],
        }),
        "utf-8"
      );
      const loaded = readUnresolvedResolutions(filePath);
      expect(loaded.resolutions).toEqual([
        { normalizedKey: "valid", action: "ignore", resolvedAt: "t", resolvedBy: "u" },
      ]);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("resolve requires a non-empty keys array", () => {
    const root = tmpRoot();
    try {
      const filePath = defaultUnresolvedResolutionsPath(root);
      expect(() =>
        resolveUnresolvedKeys(filePath, { keys: [], action: "ignore", resolvedBy: "admin" })
      ).toThrow(/keys/);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("link requires a targetCompanyKey", () => {
    const root = tmpRoot();
    try {
      const filePath = defaultUnresolvedResolutionsPath(root);
      expect(() =>
        resolveUnresolvedKeys(filePath, {
          keys: ["polywell"],
          action: "link",
          resolvedBy: "admin",
        })
      ).toThrow(/targetCompanyKey/);
      expect(() =>
        resolveUnresolvedKeys(filePath, {
          keys: ["polywell"],
          action: "link",
          targetCompanyKey: "   ",
          resolvedBy: "admin",
        })
      ).toThrow(/targetCompanyKey/);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("resolves keys with dedupe and latest-wins replacement", () => {
    const root = tmpRoot();
    try {
      const filePath = defaultUnresolvedResolutionsPath(root);
      resolveUnresolvedKeys(filePath, {
        keys: ["polywell"],
        action: "link",
        targetCompanyKey: "polywell",
        resolvedBy: "admin",
        at: "2026-08-19T00:00:00.000Z",
      });
      const result = resolveUnresolvedKeys(filePath, {
        keys: ["ghostbrand", "ghostbrand", "polywell"],
        action: "ignore",
        resolvedBy: "demo-admin",
        at: "2026-08-19T01:00:00.000Z",
      });
      expect(result.resolved).toHaveLength(2);
      expect(result.resolved.map((r) => r.normalizedKey).sort()).toEqual([
        "ghostbrand",
        "polywell",
      ]);
      // latest-wins: polywell re-resolved as ignore without target
      const polywell = result.resolved.find((r) => r.normalizedKey === "polywell");
      expect(polywell?.action).toBe("ignore");
      expect(polywell?.targetCompanyKey).toBeUndefined();
      const loaded = readUnresolvedResolutions(filePath);
      expect(loaded.resolutions).toHaveLength(2);
      const ghost = loaded.resolutions.find((r) => r.normalizedKey === "ghostbrand");
      expect(ghost?.resolvedBy).toBe("demo-admin");
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("stores trimmed targetCompanyKey for link actions", () => {
    const root = tmpRoot();
    try {
      const filePath = defaultUnresolvedResolutionsPath(root);
      const result = resolveUnresolvedKeys(filePath, {
        keys: ["乔某机床"],
        action: "link",
        targetCompanyKey: "  polywell  ",
        resolvedBy: "admin",
      });
      expect(result.resolved[0].targetCompanyKey).toBe("polywell");
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});

describe("applyResolutionsToAggregates (pure enrichment)", () => {
  it("attaches matching resolutions and leaves others untouched", () => {
    const aggregates = aggregateUnresolvedEvents([
      makeUnresolvedEvent("UnknownOEM-A", "miss", 40),
      makeUnresolvedEvent("Other-B", "low_confidence_keyword", 10),
    ]);
    const resolutions: UnresolvedResolution[] = [
      {
        normalizedKey: "unknownoema",
        action: "link",
        targetCompanyKey: "polywell",
        resolvedAt: "2026-08-19T00:00:00.000Z",
        resolvedBy: "admin",
      },
    ];
    const items = applyResolutionsToAggregates(aggregates, resolutions);
    const linked = items.find((i) => i.normalizedKey.includes("unknownoema"));
    expect(linked?.resolution?.action).toBe("link");
    expect(linked?.resolution?.targetCompanyKey).toBe("polywell");
    const other = items.find((i) => i.normalizedKey.includes("other"));
    expect(other?.resolution).toBeUndefined();
  });
});
