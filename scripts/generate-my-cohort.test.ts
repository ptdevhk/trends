import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  ARCHETYPE_IDS,
  DIM_IDS,
  STRATIFICATION,
  TIER_RATING,
  allTemplateText,
  generateCohort,
} from "./generate-my-cohort.js";

const SEED = 20260819;

const rubricEn = JSON.parse(readFileSync(new URL("./my-cohort/rubric.en.json", import.meta.url), "utf8"));
const rubricMs = JSON.parse(readFileSync(new URL("./my-cohort/rubric.ms.json", import.meta.url), "utf8"));

function parseMonth(ym: string): number {
  const [y, m] = ym.split("-").map(Number);
  return y * 12 + (m - 1);
}

function monthYear(ym: string): number {
  return Math.floor(parseMonth(ym) / 12);
}

/** Recursively collect every string VALUE (keys excluded — keys like "highlights" are not content). */
function collectStrings(value: unknown, out: string[] = []): string[] {
  if (typeof value === "string") out.push(value);
  else if (Array.isArray(value)) for (const item of value) collectStrings(item, out);
  else if (value !== null && typeof value === "object")
    for (const key of Object.keys(value as Record<string, unknown>))
      collectStrings((value as Record<string, unknown>)[key], out);
  return out;
}

/** Evaluation-language phrases derived from the rubric itself (self-maintaining). */
function rubricLeakPhrases(): string[] {
  const phrases: string[] = [];
  for (const doc of [rubricEn, rubricMs]) {
    for (const label of Object.values(doc.scale.labels)) phrases.push(label);
    for (const dim of doc.dimensions) for (const anchor of Object.values(dim.anchors)) phrases.push(anchor);
  }
  return phrases.map((p: string) => p.toLowerCase().replace(/\s+/g, " ").trim());
}

/** Distinctive evaluation/rater-kit terms that must never appear in resume content. */
const EXTRA_LEAK_TERMS = [
  "halo",
  "job hopping",
  "behavioral anchor",
  "central tendency",
  "monotonic",
  "unexplained",
  "no evidence",
  "insufficient evidence",
  "not relevant",
  "recognized expert",
  "rubric",
  "rater",
  "kappa",
  "inter-rater",
  "golden",
  "vignette",
  "calibration",
  "baseline",
  "target",
  "tier",
  "cemerlang",
];

describe("generate-my-cohort", () => {
  it("is deterministic for the same seed (and default seed = 20260819)", () => {
    const a = generateCohort({ seed: SEED });
    const b = generateCohort({ seed: SEED });
    expect(a).toEqual(b);
    expect(generateCohort()).toEqual(a);
    expect(generateCohort({ seed: 1 })).not.toEqual(a);
  });

  it("produces N=35 profiles with the approved stratification", () => {
    const { profiles, targets } = generateCohort({ seed: SEED });
    expect(profiles).toHaveLength(35);
    const counts: Record<string, number> = {};
    for (const p of profiles) {
      const tier = targets[p.profileResumeId].tier;
      counts[tier] = (counts[tier] ?? 0) + 1;
    }
    expect(counts).toEqual(STRATIFICATION);
    // 5/9/10/7/4 sums to 35 (spec's "5+9+10+7+3 = 35" is an arithmetic slip; N=35 wins).
    expect(Object.values(counts).reduce((a, b) => a + b, 0)).toBe(35);
  });

  it("has targets matching every profile: tier, overall = tier rating, dims in 1..5", () => {
    const { profiles, targets } = generateCohort({ seed: SEED });
    expect(Object.keys(targets)).toHaveLength(35);
    for (const p of profiles) {
      const t = targets[p.profileResumeId];
      expect(t).toBeDefined();
      expect(t.overall).toBe(TIER_RATING[t.tier]);
      expect(Object.keys(t.dims).sort()).toEqual([...DIM_IDS].sort());
      for (const dim of DIM_IDS) {
        expect(Number.isInteger(t.dims[dim])).toBe(true);
        expect(t.dims[dim]).toBeGreaterThanOrEqual(1);
        expect(t.dims[dim]).toBeLessThanOrEqual(5);
      }
    }
  });

  it("holds timeline invariants on every profile (grad <= first start, ordered, non-overlapping, min 3mo tenure)", () => {
    const { profiles } = generateCohort({ seed: SEED });
    for (const p of profiles) {
      expect(p.experience.length).toBeGreaterThan(0);
      let prevEnd = -Infinity;
      for (const role of p.experience) {
        expect(role.start).toMatch(/^\d{4}-\d{2}$/);
        expect(role.end).toMatch(/^\d{4}-\d{2}$/);
        const start = parseMonth(role.start);
        const end = parseMonth(role.end);
        expect(end - start).toBeGreaterThanOrEqual(3); // min tenure 3 months
        expect(start).toBeGreaterThanOrEqual(prevEnd); // ordered, no overlap, gaps >= 0
        prevEnd = end;
      }
      const firstStartYear = monthYear(p.experience[0].start);
      for (const edu of p.education ?? []) {
        expect(edu.year).toBeLessThanOrEqual(firstStartYear);
      }
    }
  });

  it("is zero-PII: synthetic names, example.com emails, valid phone shapes, no NRIC/government-id patterns", () => {
    const { profiles } = generateCohort({ seed: SEED });
    const serialized = JSON.stringify(profiles);
    const nricPattern = /\b\d{6}-?\d{2}-?\d{4}\b/;
    expect(serialized).not.toMatch(nricPattern);
    expect(serialized.toLowerCase()).not.toMatch(/(nric|mykad|ic number|passport)/);
    for (const p of profiles) {
      expect(p.personal.name).not.toMatch(/[0-9]/);
      expect(p.personal.email).toMatch(/@example\.com$/);
      expect(p.personal.phone).toMatch(/^\+60 1\d-\d{3} \d{4}$/);
    }
  });

  it("emits the audit CSV with header, 35 rows, blank score, rating = target overall", () => {
    const { profiles, targets, csvRows } = generateCohort({ seed: SEED });
    expect(csvRows[0]).toBe("profileResumeId,board,rating,score");
    expect(csvRows).toHaveLength(36);
    for (let i = 0; i < profiles.length; i++) {
      const row = csvRows[i + 1];
      expect(row).toMatch(/^my-\d{3},MY,[1-5],$/);
      const id = row.split(",")[0];
      expect(row.split(",")[2]).toBe(String(targets[id].overall));
    }
  });

  it("is rubric-blind: resume docs carry no target/tier/rating fields", () => {
    const { profiles } = generateCohort({ seed: SEED });
    for (const p of profiles) {
      const keys = Object.keys(p);
      expect(keys).not.toContain("tier");
      expect(keys).not.toContain("rating");
      expect(keys).not.toContain("dims");
      expect(keys).not.toContain("target");
    }
  });

  it("covers both languages, all four archetypes, unique ids/names/emails", () => {
    const { profiles } = generateCohort({ seed: SEED });
    const languages = new Set(profiles.map((p) => p.language));
    expect([...languages].sort()).toEqual(["en", "ms"]);
    const archetypes = new Set(profiles.map((p) => p.archetype));
    for (const a of ARCHETYPE_IDS) expect(archetypes).toContain(a);
    const ids = profiles.map((p) => p.profileResumeId);
    expect(new Set(ids).size).toBe(35);
    for (const id of ids) expect(id).toMatch(/^my-0(0[1-9]|[1-2][0-9]|3[0-5])$/);
    const names = profiles.map((p) => p.personal.name);
    expect(new Set(names).size).toBe(35);
    const emails = profiles.map((p) => p.personal.email);
    expect(new Set(emails).size).toBe(35);
    for (const p of profiles) {
      expect(p.board).toBe("MY");
      expect(p.languages).toContainEqual({ language: "Bahasa Malaysia", level: "Native" });
      expect(p.languages).toContainEqual(expect.objectContaining({ language: "English" }));
      expect(p.summary).not.toMatch(/\{role\}|\{years\}|\{skills\}|\{domain\}|\{industry\}|\{achievement\}/);
    }
  });

  it("leaks no evaluation language: rubric anchors/labels and rater-kit terms absent from templates AND output", () => {
    const { profiles } = generateCohort({ seed: SEED });
    const templateText = allTemplateText();
    const generatedText = collectStrings(profiles).join("\n").toLowerCase();
    const phrases = [...new Set([...rubricLeakPhrases(), ...EXTRA_LEAK_TERMS])];
    for (const phrase of phrases) {
      expect(templateText, `template contains evaluation language: "${phrase}"`).not.toContain(phrase);
      expect(generatedText, `generated resume contains evaluation language: "${phrase}"`).not.toContain(phrase);
    }
  });
});
