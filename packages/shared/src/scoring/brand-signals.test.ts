import { describe, expect, it } from "vitest";
import {
  aggregateBrandOrigin,
  aggregateProductClass,
  buildBrandHitsPromptSegments,
  classifyBrandProductClass,
  formatBrandHitLabel,
  normalizeBrandOrigin,
  parseBrandOrigin,
  parseProductClass,
  stripForbiddenStrongMatchProse,
  structuredBrandConcerns,
  summarizeNonEmployerBrandHitLabels,
} from "./brand-signals.js";

describe("classifyBrandProductClass", () => {
  it("classifies machining-center brand types as complete_machine", () => {
    expect(classifyBrandProductClass("加工中心/数控车床")).toBe("complete_machine");
    expect(classifyBrandProductClass("CNC machining center")).toBe("complete_machine");
  });

  it("classifies tooling types as tool_accessory", () => {
    expect(classifyBrandProductClass("刀具")).toBe("tool_accessory");
    expect(classifyBrandProductClass("cutting tools")).toBe("tool_accessory");
  });

  it("classifies sensors/metrology as industrial_component", () => {
    expect(classifyBrandProductClass("测量扫描")).toBe("industrial_component");
    expect(classifyBrandProductClass("sensor")).toBe("industrial_component");
  });

  it("returns other for empty/unknown types", () => {
    expect(classifyBrandProductClass(undefined)).toBe("other");
    expect(classifyBrandProductClass("")).toBe("other");
    expect(classifyBrandProductClass("misc")).toBe("other");
  });
});

describe("normalizeBrandOrigin / aggregateBrandOrigin", () => {
  it("maps agent origin to unknown", () => {
    expect(normalizeBrandOrigin("agent")).toBe("unknown");
    expect(normalizeBrandOrigin("international")).toBe("international");
    expect(normalizeBrandOrigin("domestic")).toBe("domestic");
  });

  it("lets international evidence win over domestic", () => {
    expect(
      aggregateBrandOrigin([
        { origin: "domestic" },
        { origin: "international" },
      ]),
    ).toBe("international");
  });

  it("reports domestic-only when no international hits exist", () => {
    expect(aggregateBrandOrigin([{ origin: "domestic" }, { origin: "unknown" }])).toBe(
      "domestic",
    );
  });

  it("reports unknown when no origin evidence exists", () => {
    expect(aggregateBrandOrigin([])).toBe("unknown");
    expect(aggregateBrandOrigin([{ origin: "agent" }])).toBe("unknown");
  });
});

describe("aggregateProductClass", () => {
  it("prefers complete_machine when present", () => {
    expect(
      aggregateProductClass([
        { productClass: "tool_accessory" },
        { productClass: "complete_machine" },
      ]),
    ).toBe("complete_machine");
  });

  it("falls back to tool_accessory then industrial_component", () => {
    expect(aggregateProductClass([{ productClass: "tool_accessory" }])).toBe("tool_accessory");
    expect(aggregateProductClass([{ type: "测量扫描" }])).toBe("industrial_component");
  });
});

describe("parseBrandOrigin / parseProductClass", () => {
  it("accepts known enum values and rejects others", () => {
    expect(parseBrandOrigin("domestic")).toBe("domestic");
    expect(parseBrandOrigin("agent")).toBeUndefined();
    expect(parseProductClass("tool_accessory")).toBe("tool_accessory");
    expect(parseProductClass("widget")).toBeUndefined();
  });
});

describe("formatBrandHitLabel / summarizeNonEmployerBrandHitLabels", () => {
  it("formats origin and product class tags", () => {
    expect(
      formatBrandHitLabel({
        brand: "TOYODA",
        origin: "international",
        productClass: "complete_machine",
      }),
    ).toBe("TOYODA (international/complete_machine)");
  });

  it("skips employer hits and includes origin tags for non-employer hits", () => {
    expect(
      summarizeNonEmployerBrandHitLabels([
        { brand: "FANUC", context: "employer", origin: "international" },
        { brand: "蕙勒", context: "sales", origin: "domestic", productClass: "complete_machine" },
      ]),
    ).toEqual(["蕙勒 (domestic/complete_machine)"]);
  });

  it("appends candidate-level brandOrigin/productClass as a prompt segment", () => {
    expect(
      buildBrandHitsPromptSegments({
        brandHits: [{ brand: "蕙勒", context: "sales", origin: "domestic", productClass: "complete_machine" }],
        brandOrigin: "domestic",
        productClass: "complete_machine",
      }),
    ).toEqual(["蕙勒 (domestic/complete_machine)", "brandOrigin=domestic, productClass=complete_machine"]);
  });
});

describe("structuredBrandConcerns", () => {
  it("emits domestic and tool concerns in zh", () => {
    const concerns = structuredBrandConcerns({
      brandOrigin: "domestic",
      productClass: "tool_accessory",
      locale: "zh",
    });
    expect(concerns.some((c) => c.includes("国产"))).toBe(true);
    expect(concerns.some((c) => c.includes("刀具"))).toBe(true);
  });

  it("emits English concerns when locale is en", () => {
    const concerns = structuredBrandConcerns({
      brandOrigin: "domestic",
      productClass: "industrial_component",
      locale: "en",
    });
    expect(concerns.some((c) => /domestic/i.test(c))).toBe(true);
    expect(concerns.some((c) => /component/i.test(c))).toBe(true);
  });
});

describe("stripForbiddenStrongMatchProse", () => {
  it("does not alter high-band summaries", () => {
    expect(stripForbiddenStrongMatchProse("较强匹配的机床销售", 80)).toBe("较强匹配的机床销售");
  });

  it("strips strong-match prose on low bands", () => {
    const result = stripForbiddenStrongMatchProse("刀具销售，较强匹配，建议重点推进", 30);
    expect(result).not.toMatch(/较强匹配/);
    expect(result).not.toMatch(/重点推进/);
    expect(result).toMatch(/匹配有限/);
  });
});
