import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { SkillsKnowledgeService } from "./skills-knowledge";

const TEST_SKILLS_MD = `---
version: 1
updated_at: '2026-02-21'
description: Test skills knowledge file
---

# Skills Knowledge

## Domain Taxonomy

### machinery
- displayName: Machinery
- keywords: 机床, 车床, lathe, machining

### cnc
- displayName: CNC
- keywords: cnc, 数控, fanuc, star

### sales
- displayName: Sales
- keywords: 销售, 客户, sales, account

## Synonym Table

- 机床: 机械设备, 加工设备
- 车床: CNC车床, 数控车床
- 数控: CNC, Computer Numerical Control
- 销售: 业务, 商务

## Experience Signals

### senior
- displayName: Senior Level
- keywords: 团队管理, 大客户, manager, lead

### mid
- displayName: Mid Level
- keywords: 独立, 熟练, specialist

### junior
- displayName: Junior Level
- keywords: 应届, 实习, assistant, intern

## Company Patterns

- FANUC (aliases: 发那科, Fanuc)
- STAR (aliases: 津上, Star Micronics)
- BROTHER (aliases: 兄弟, Brother Industries)

## Industry Context

### CNC Machining Domain
CNC machining involves automated control of machine tools. Key brands include FANUC and STAR.

### Sales and Business Development
B2B sales requires technical knowledge and customer relationship management.

## Exclusion Patterns

- exclude: ad, promo, 广告, spam

## Learning Log (Append Only)

- 2026-02-10: STAR + 渠道客户优先
- 2026-02-15: 车床经验5年+更匹配
`;

function createFixtureRoot(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "skills-knowledge-"));
  fs.mkdirSync(path.join(root, "config", "resume"), { recursive: true });

  fs.writeFileSync(path.join(root, "config", "resume", "skills.md"), TEST_SKILLS_MD, "utf8");

  // Add marker files for findProjectRoot
  fs.writeFileSync(path.join(root, "pyproject.toml"), "", "utf8");
  fs.mkdirSync(path.join(root, "output"), { recursive: true });

  return root;
}

function cleanupFixtureRoot(root: string): void {
  fs.rmSync(root, { recursive: true, force: true });
}

describe("SkillsKnowledgeService", () => {
  it("parses domain taxonomy correctly", () => {
    const root = createFixtureRoot();

    try {
      const service = new SkillsKnowledgeService(root);
      const taxonomy = service.getIndustryTaxonomy();

      expect(taxonomy).toHaveLength(3);

      const machinery = taxonomy.find((d) => d.tag === "machinery");
      expect(machinery).toBeDefined();
      expect(machinery?.displayName).toBe("Machinery");
      expect(machinery?.keywords).toContain("机床");
      expect(machinery?.keywords).toContain("车床");
      expect(machinery?.keywords).toContain("lathe");

      const cnc = taxonomy.find((d) => d.tag === "cnc");
      expect(cnc).toBeDefined();
      expect(cnc?.displayName).toBe("CNC");
      expect(cnc?.keywords).toContain("cnc");
      expect(cnc?.keywords).toContain("fanuc");

      const sales = taxonomy.find((d) => d.tag === "sales");
      expect(sales).toBeDefined();
      expect(sales?.displayName).toBe("Sales");
      expect(sales?.keywords).toContain("销售");
      expect(sales?.keywords).toContain("sales");
    } finally {
      cleanupFixtureRoot(root);
    }
  });

  it("parses synonym table and returns variant → canonical mapping", () => {
    const root = createFixtureRoot();

    try {
      const service = new SkillsKnowledgeService(root);
      const synonymMap = service.getSynonymTable();

      expect(synonymMap.get("机械设备")).toBe("机床");
      expect(synonymMap.get("加工设备")).toBe("机床");
      expect(synonymMap.get("cnc车床")).toBe("车床");
      expect(synonymMap.get("数控车床")).toBe("车床");
      expect(synonymMap.get("cnc")).toBe("数控");
      expect(synonymMap.get("业务")).toBe("销售");

      // Canonical terms should map to themselves
      expect(synonymMap.get("机床")).toBe("机床");
      expect(synonymMap.get("销售")).toBe("销售");
    } finally {
      cleanupFixtureRoot(root);
    }
  });

  it("getSkillVocabulary returns union of all keywords and synonyms", () => {
    const root = createFixtureRoot();

    try {
      const service = new SkillsKnowledgeService(root);
      const vocab = service.getSkillVocabulary();

      // Domain keywords
      expect(vocab.has("机床")).toBe(true);
      expect(vocab.has("车床")).toBe(true);
      expect(vocab.has("cnc")).toBe(true);
      expect(vocab.has("销售")).toBe(true);

      // Synonym variants
      expect(vocab.has("机械设备")).toBe(true);
      expect(vocab.has("cnc车床")).toBe(true);
      expect(vocab.has("业务")).toBe(true);
    } finally {
      cleanupFixtureRoot(root);
    }
  });

  it("parses experience signals correctly", () => {
    const root = createFixtureRoot();

    try {
      const service = new SkillsKnowledgeService(root);
      const signals = service.getExperienceSignals();

      expect(signals).toHaveLength(3);

      const senior = signals.find((s) => s.level === "senior");
      expect(senior).toBeDefined();
      expect(senior?.displayName).toBe("Senior Level");
      expect(senior?.keywords).toContain("团队管理");
      expect(senior?.keywords).toContain("manager");

      const mid = signals.find((s) => s.level === "mid");
      expect(mid).toBeDefined();
      expect(mid?.displayName).toBe("Mid Level");
      expect(mid?.keywords).toContain("独立");

      const junior = signals.find((s) => s.level === "junior");
      expect(junior).toBeDefined();
      expect(junior?.displayName).toBe("Junior Level");
      expect(junior?.keywords).toContain("应届");
      expect(junior?.keywords).toContain("intern");
    } finally {
      cleanupFixtureRoot(root);
    }
  });

  it("parses company patterns with aliases", () => {
    const root = createFixtureRoot();

    try {
      const service = new SkillsKnowledgeService(root);
      const patterns = service.getCompanyPatterns();

      expect(patterns).toHaveLength(3);

      const fanuc = patterns.find((p) => p.name === "fanuc");
      expect(fanuc).toBeDefined();
      expect(fanuc?.aliases).toContain("发那科");
      expect(fanuc?.allNames).toContain("fanuc");
      expect(fanuc?.allNames).toContain("发那科");

      const star = patterns.find((p) => p.name === "star");
      expect(star).toBeDefined();
      expect(star?.aliases).toContain("津上");
      expect(star?.allNames).toContain("star");
      expect(star?.allNames).toContain("star micronics");
    } finally {
      cleanupFixtureRoot(root);
    }
  });

  it("getCompanyLookupSet includes all company names lowercased", () => {
    const root = createFixtureRoot();

    try {
      const service = new SkillsKnowledgeService(root);
      const lookup = service.getCompanyLookupSet();

      expect(lookup.has("fanuc")).toBe(true);
      expect(lookup.has("发那科")).toBe(true);
      expect(lookup.has("star")).toBe(true);
      expect(lookup.has("津上")).toBe(true);
      expect(lookup.has("brother")).toBe(true);
      expect(lookup.has("兄弟")).toBe(true);
    } finally {
      cleanupFixtureRoot(root);
    }
  });

  it("getIndustryContext returns formatted string", () => {
    const root = createFixtureRoot();

    try {
      const service = new SkillsKnowledgeService(root);
      const context = service.getIndustryContext();

      expect(context).toContain("CNC Machining Domain");
      expect(context).toContain("automated control");
      expect(context).toContain("Sales and Business Development");
      expect(context).toContain("customer relationship");
    } finally {
      cleanupFixtureRoot(root);
    }
  });

  it("parses exclusion tokens", () => {
    const root = createFixtureRoot();

    try {
      const service = new SkillsKnowledgeService(root);
      const tokens = service.getExclusionTokens();

      expect(tokens).toContain("ad");
      expect(tokens).toContain("promo");
      expect(tokens).toContain("广告");
      expect(tokens).toContain("spam");
    } finally {
      cleanupFixtureRoot(root);
    }
  });

  it("parses learning log entries", () => {
    const root = createFixtureRoot();

    try {
      const service = new SkillsKnowledgeService(root);
      const log = service.getLearningLog();

      expect(log).toHaveLength(2);
      expect(log[0].date).toBe("2026-02-10");
      expect(log[0].observation).toBe("STAR + 渠道客户优先");
      expect(log[1].date).toBe("2026-02-15");
      expect(log[1].observation).toBe("车床经验5年+更匹配");
    } finally {
      cleanupFixtureRoot(root);
    }
  });

  it("appends learning feedback into Learning Log section", () => {
    const root = createFixtureRoot();

    try {
      const service = new SkillsKnowledgeService(root);
      const entry = service.appendLearningEntry("shortlist pattern -> cnc + senior");

      expect(entry).toMatch(/^- \d{4}-\d{2}-\d{2}: shortlist pattern -> cnc \+ senior$/);

      const log = service.getLearningLog();
      expect(log).toHaveLength(3);
      expect(log[2]?.observation).toBe("shortlist pattern -> cnc + senior");

      const saved = fs.readFileSync(path.join(root, "config", "resume", "skills.md"), "utf8");
      expect(saved).toContain(entry);
    } finally {
      cleanupFixtureRoot(root);
    }
  });

  it("caches parsed data and clearCache invalidates it", () => {
    const root = createFixtureRoot();

    try {
      const service = new SkillsKnowledgeService(root);

      // First call parses and caches
      const taxonomy1 = service.getIndustryTaxonomy();
      expect(taxonomy1).toHaveLength(3);

      // Second call uses cache (should be same reference)
      const taxonomy2 = service.getIndustryTaxonomy();
      expect(taxonomy2).toBe(taxonomy1);

      // Clear cache
      service.clearCache();

      // Third call re-parses
      const taxonomy3 = service.getIndustryTaxonomy();
      expect(taxonomy3).toHaveLength(3);
      expect(taxonomy3).not.toBe(taxonomy1);
    } finally {
      cleanupFixtureRoot(root);
    }
  });

  it("throws FileParseError for missing file", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "skills-missing-"));
    fs.mkdirSync(path.join(root, "config", "resume"), { recursive: true });

    // Add marker files but no skills.md
    fs.writeFileSync(path.join(root, "pyproject.toml"), "", "utf8");
    fs.mkdirSync(path.join(root, "output"), { recursive: true });

    try {
      const service = new SkillsKnowledgeService(root);
      expect(() => service.getIndustryTaxonomy()).toThrow("skills.md not found");
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("handles missing optional sections gracefully", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "skills-minimal-"));
    fs.mkdirSync(path.join(root, "config", "resume"), { recursive: true });

    const minimalSkills = `---
version: 1
updated_at: '2026-02-21'
---

# Skills Knowledge

## Domain Taxonomy

### machinery
- displayName: Machinery
- keywords: lathe
`;

    fs.writeFileSync(path.join(root, "config", "resume", "skills.md"), minimalSkills, "utf8");
    fs.writeFileSync(path.join(root, "pyproject.toml"), "", "utf8");
    fs.mkdirSync(path.join(root, "output"), { recursive: true });

    try {
      const service = new SkillsKnowledgeService(root);

      expect(service.getIndustryTaxonomy()).toHaveLength(1);
      expect(service.getSynonymTable().size).toBe(0);
      expect(service.getExperienceSignals()).toHaveLength(0);
      expect(service.getCompanyPatterns()).toHaveLength(0);
      expect(service.getExclusionTokens()).toHaveLength(0);
      expect(service.getLearningLog()).toHaveLength(0);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});
