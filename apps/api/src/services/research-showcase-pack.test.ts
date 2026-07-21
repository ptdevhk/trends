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
  it("loads CNC zh-Hans pack: golden pro-technic + fanuc; no MY non-CNC primary fillers", () => {
    const pack = loadResearchShowcasePack(REPO_ROOT);
    expect(pack.version).toBe("v1");
    expect(pack.seedIngestRunId).toBe("showcase-seed-v1");
    const goldenKeys = pack.golden.map((c) => c.companyKey);
    const deskKeys = pack.fromResumeDesk.map((c) => c.companyKey);
    expect(goldenKeys).toContain("pro-technic-machinery");
    expect(goldenKeys).toContain("polywell");
    expect(goldenKeys).toContain("fanuc");
    expect(deskKeys).toContain("makino");
    expect(deskKeys).toContain("qiaofeng");
    // Non-CNC MY fillers demoted from primary set
    expect(deskKeys).not.toContain("globalfoundries");
    expect(deskKeys).not.toContain("nestle-malaysia");
    expect(deskKeys).not.toContain("hino-motors-malaysia");
    expect(pack.fromResumeDesk.length).toBeGreaterThanOrEqual(3);

    for (const company of [...pack.golden, ...pack.fromResumeDesk]) {
      expect(company.nameCn && company.nameCn.length > 0).toBe(true);
      for (const signal of company.signals) {
        expect(SHOWCASE_SIGNAL_KINDS).toContain(signal.kind);
        // zh-Hans first: titles contain CJK
        expect(/[\u4e00-\u9fff]/.test(signal.title)).toBe(true);
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
