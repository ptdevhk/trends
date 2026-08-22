import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

interface RubricDimension {
  id: string;
  name: string;
  description: string;
  anchors: Record<string, string>;
}

interface Rubric {
  schema: string;
  language: string;
  title: string;
  description: string;
  scale: { min: number; max: number; labels: Record<string, string> };
  dimensions: RubricDimension[];
}

const loadRubric = (language: "en" | "ms"): Rubric =>
  JSON.parse(
    readFileSync(new URL(`./rubric.${language}.json`, import.meta.url), "utf8"),
  ) as Rubric;

const EXPECTED_DIMENSION_IDS = [
  "hard_skills",
  "experience_depth",
  "domain_context",
  "progression",
  "credentials",
] as const;

describe("my-cohort rubric (BARS 5x5)", () => {
  for (const language of ["en", "ms"] as const) {
    describe(`rubric.${language}.json`, () => {
      const rubric = loadRubric(language);

      it("uses the expected schema and language fields", () => {
        expect(rubric.schema).toBe("my-cohort-rubric/1");
        expect(rubric.language).toBe(language);
        expect(rubric.title.trim().length).toBeGreaterThan(0);
        expect(rubric.description.trim().length).toBeGreaterThan(0);
      });

      it("defines a 1-5 scale with labels at every level", () => {
        expect(rubric.scale.min).toBe(1);
        expect(rubric.scale.max).toBe(5);
        for (let level = 1; level <= 5; level++) {
          expect(rubric.scale.labels[String(level)].trim().length).toBeGreaterThan(0);
        }
      });

      it("has exactly 5 dimensions with unique ids in canonical order", () => {
        expect(rubric.dimensions).toHaveLength(5);
        expect(rubric.dimensions.map((d) => d.id)).toEqual([...EXPECTED_DIMENSION_IDS]);
      });

      it("gives every dimension a name and description", () => {
        for (const dim of rubric.dimensions) {
          expect(dim.name.trim().length).toBeGreaterThan(0);
          expect(dim.description.trim().length).toBeGreaterThan(0);
        }
      });

      it("gives every dimension 5 non-empty behavioral anchors", () => {
        for (const dim of rubric.dimensions) {
          const levels = Object.keys(dim.anchors).sort();
          expect(levels).toEqual(["1", "2", "3", "4", "5"]);
          for (const level of levels) {
            const anchor = dim.anchors[level].trim();
            // Anchors are behavioral descriptions, not placeholder stubs.
            expect(anchor.length).toBeGreaterThanOrEqual(10);
            expect(anchor).not.toMatch(/^(tbd|todo|placeholder|xxx)$/i);
          }
        }
      });

      it("does not reuse identical anchor text across levels", () => {
        for (const dim of rubric.dimensions) {
          const texts = Object.values(dim.anchors).map((t) => t.trim());
          expect(new Set(texts).size).toBe(5);
        }
      });
    });
  }

  describe("cross-language consistency", () => {
    const en = loadRubric("en");
    const ms = loadRubric("ms");

    it("keeps identical dimension ids and order in both languages", () => {
      expect(ms.dimensions.map((d) => d.id)).toEqual(en.dimensions.map((d) => d.id));
    });

    it("uses the same scale bounds in both languages", () => {
      expect(ms.scale.min).toBe(en.scale.min);
      expect(ms.scale.max).toBe(en.scale.max);
    });
  });
});
