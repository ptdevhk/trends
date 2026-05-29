import fs from "node:fs";
import path from "node:path";
import { describe, expect, it, vi, beforeEach, afterAll } from "vitest";

import { FilterPresetService } from "../filter-preset-service";

const FIXTURE_DIR = path.join(__dirname, "__fixtures__", "filter-preset-service");

function writeFixture(content: string): void {
  fs.mkdirSync(FIXTURE_DIR, { recursive: true });
  fs.mkdirSync(path.join(FIXTURE_DIR, "config", "resume"), { recursive: true });
  fs.writeFileSync(
    path.join(FIXTURE_DIR, "config", "resume", "filter-presets.json5"),
    content,
    "utf8"
  );
}

function removeFixture(): void {
  fs.rmSync(FIXTURE_DIR, { recursive: true, force: true });
}

const SAMPLE_CONFIG = `{
  presets: [
    {
      id: "sales-entry",
      name: "Sales Entry",
      category: "sales",
      filters: {
        maxExperience: 3,
        education: ["bachelor"],
        salaryRange: { min: 5000, max: 10000 }
      }
    },
    {
      id: "sales-senior",
      name: "Sales Senior",
      category: "sales",
      filters: {
        maxExperience: null,
        education: ["bachelor", "master"],
        salaryRange: { min: 15000, max: 35000 }
      }
    },
    {
      id: "engineer-entry",
      name: "Engineer Entry",
      category: "engineering",
      filters: {
        maxExperience: 3
      }
    }
  ],
  categories: [
    { id: "sales", name: "Sales", icon: "briefcase" },
    { id: "engineering", name: "Engineering", icon: "gear" }
  ]
}`;

describe("FilterPresetService", () => {
  beforeEach(() => {
    removeFixture();
  });

  afterAll(() => {
    removeFixture();
  });

  it("returns empty presets and categories when config file does not exist", () => {
    const service = new FilterPresetService(FIXTURE_DIR);
    expect(service.listPresets()).toEqual([]);
    expect(service.listCategories()).toEqual([]);
  });

  it("loads presets from config file", () => {
    writeFixture(SAMPLE_CONFIG);
    const service = new FilterPresetService(FIXTURE_DIR);

    const presets = service.listPresets();
    expect(presets).toHaveLength(3);
    expect(presets[0]?.id).toBe("sales-entry");
    expect(presets[1]?.id).toBe("sales-senior");
    expect(presets[2]?.id).toBe("engineer-entry");
  });

  it("filters presets by category", () => {
    writeFixture(SAMPLE_CONFIG);
    const service = new FilterPresetService(FIXTURE_DIR);

    const salesPresets = service.listPresets("sales");
    expect(salesPresets).toHaveLength(2);
    expect(salesPresets.every((p) => p.category === "sales")).toBe(true);
  });

  it("returns empty array for unknown category", () => {
    writeFixture(SAMPLE_CONFIG);
    const service = new FilterPresetService(FIXTURE_DIR);

    expect(service.listPresets("nonexistent")).toEqual([]);
  });

  it("gets a preset by id", () => {
    writeFixture(SAMPLE_CONFIG);
    const service = new FilterPresetService(FIXTURE_DIR);

    const preset = service.getPreset("sales-senior");
    expect(preset?.name).toBe("Sales Senior");
    expect(preset?.filters.maxExperience).toBeNull();
  });

  it("returns undefined for unknown preset id", () => {
    writeFixture(SAMPLE_CONFIG);
    const service = new FilterPresetService(FIXTURE_DIR);

    expect(service.getPreset("nonexistent")).toBeUndefined();
  });

  it("loads categories from config file", () => {
    writeFixture(SAMPLE_CONFIG);
    const service = new FilterPresetService(FIXTURE_DIR);

    const categories = service.listCategories();
    expect(categories).toHaveLength(2);
    expect(categories[0]?.id).toBe("sales");
    expect(categories[1]?.id).toBe("engineering");
  });

  it("computes stats grouped by category", () => {
    writeFixture(SAMPLE_CONFIG);
    const service = new FilterPresetService(FIXTURE_DIR);

    const stats = service.getStats();
    expect(stats.total).toBe(3);
    expect(stats.byCategory).toEqual({ sales: 2, engineering: 1 });
  });

  it("caches config after first load", () => {
    writeFixture(SAMPLE_CONFIG);
    const service = new FilterPresetService(FIXTURE_DIR);

    const first = service.listPresets();
    // Modify the file after first load
    writeFixture(`{ presets: [], categories: [] }`);
    const second = service.listPresets();

    // Should return cached result, not re-read the modified file
    expect(second).toEqual(first);
    expect(second).toHaveLength(3);
  });

  it("clears cache and re-reads config", () => {
    writeFixture(SAMPLE_CONFIG);
    const service = new FilterPresetService(FIXTURE_DIR);

    service.listPresets();
    writeFixture(`{ presets: [], categories: [] }`);
    service.clearCache();

    const presets = service.listPresets();
    expect(presets).toHaveLength(0);
  });

  it("returns empty stats when no config file exists", () => {
    const service = new FilterPresetService(FIXTURE_DIR);

    const stats = service.getStats();
    expect(stats.total).toBe(0);
    expect(stats.byCategory).toEqual({});
  });

  it("preserves null maxExperience in preset filters", () => {
    writeFixture(SAMPLE_CONFIG);
    const service = new FilterPresetService(FIXTURE_DIR);

    const preset = service.getPreset("sales-senior");
    expect(preset?.filters.maxExperience).toBeNull();
  });

  it("handles preset with missing optional filter fields", () => {
    writeFixture(SAMPLE_CONFIG);
    const service = new FilterPresetService(FIXTURE_DIR);

    const preset = service.getPreset("engineer-entry");
    expect(preset?.filters.maxExperience).toBe(3);
    expect(preset?.filters.education).toBeUndefined();
    expect(preset?.filters.salaryRange).toBeUndefined();
  });
});
