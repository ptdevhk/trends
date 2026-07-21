import { describe, expect, it } from "vitest";
import { resolve } from "node:path";
import {
  SHOWCASE_SIGNAL_KINDS,
  loadResearchShowcasePack,
  parseResearchShowcasePack,
  showcaseContentHash,
} from "./research-showcase-pack.js";

// apps/api/src/services -> monorepo root is four levels up
const REPO_ROOT = resolve(import.meta.dirname, "../../../../");

describe("research-showcase-pack", () => {
  it("loads real config pack with golden pro-technic and valid kinds only", () => {
    const pack = loadResearchShowcasePack(REPO_ROOT);
    expect(pack.version).toBe("v1");
    expect(pack.seedIngestRunId).toBe("showcase-seed-v1");
    const keys = pack.golden.map((c) => c.companyKey);
    expect(keys).toContain("pro-technic-machinery");
    expect(keys).toContain("polywell");
    expect(pack.fromResumeDesk.length).toBeGreaterThanOrEqual(3);

    for (const company of [...pack.golden, ...pack.fromResumeDesk]) {
      for (const signal of company.signals) {
        expect(SHOWCASE_SIGNAL_KINDS).toContain(signal.kind);
      }
    }

    const pro = pack.golden.find((c) => c.companyKey === "pro-technic-machinery");
    expect(pro).toBeTruthy();
    expect(pro!.signals.length).toBeGreaterThanOrEqual(3);
    const kinds = new Set(pro!.signals.map((s) => s.kind));
    expect(kinds.size).toBeGreaterThanOrEqual(3);
  });

  it("rejects invalid signal kinds", () => {
    expect(() =>
      parseResearchShowcasePack({
        version: "v1",
        golden: [
          {
            companyKey: "x",
            displayName: "X",
            aliases: [],
            signals: [{ kind: "not_a_kind", title: "t" }],
          },
        ],
        fromResumeDesk: [],
      }),
    ).toThrow(/Invalid signal kind/);
  });

  it("builds stable showcase contentHash", () => {
    expect(showcaseContentHash("polywell", "hiring_signal")).toBe(
      "showcase:v1:polywell:hiring_signal",
    );
  });
});
