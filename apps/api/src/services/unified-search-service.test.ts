import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { SkillsKnowledgeService } from "./skills-knowledge";
import { UnifiedSearchService, type VerifiedEmployerCatalog } from "./unified-search-service";

import type { ResumeItem } from "../types/resume";
import type { ResumeIndex } from "./resume-index";

const TEST_SKILLS_MD = `---
version: 1
updated_at: '2026-03-11'
description: Test skills knowledge file
---

# Skills Knowledge

## Domain Taxonomy

### sales
- displayName: Sales
- keywords: 销售, sales

## Synonym Table

- 销售: 业务, 商务, 销售员, sales

## Company Patterns

- MITSUBISHI [role: both] (aliases: 三菱, 三菱系统)
`;

function createFixtureRoot(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "unified-search-service-"));
  fs.mkdirSync(path.join(root, "config", "resume"), { recursive: true });
  fs.writeFileSync(path.join(root, "config", "resume", "skills.md"), TEST_SKILLS_MD, "utf8");
  fs.writeFileSync(path.join(root, "pyproject.toml"), "", "utf8");
  fs.mkdirSync(path.join(root, "output"), { recursive: true });
  return root;
}

function cleanupFixtureRoot(root: string): void {
  fs.rmSync(root, { recursive: true, force: true });
}

const TEST_SKILLS_MD_WITH_MACHINERY = `---
version: 1
updated_at: '2026-07-30'
description: Test skills knowledge file with machinery domain
---

# Skills Knowledge

## Domain Taxonomy

### machinery
- displayName: 机械
- keywords: cnc, machine tools, 机床

### sales
- displayName: Sales
- keywords: 销售, sales

## Synonym Table

- 销售: 业务, 商务, 销售员, sales

## Company Patterns

- MITSUBISHI [role: both] (aliases: 三菱, 三菱系统)
`;

function createMachineryFixtureRoot(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "unified-search-machinery-"));
  fs.mkdirSync(path.join(root, "config", "resume"), { recursive: true });
  fs.writeFileSync(path.join(root, "config", "resume", "skills.md"), TEST_SKILLS_MD_WITH_MACHINERY, "utf8");
  fs.writeFileSync(path.join(root, "pyproject.toml"), "", "utf8");
  fs.mkdirSync(path.join(root, "output"), { recursive: true });
  return root;
}

function catalogWith(employers: Array<{
  companyKey: string;
  industryClass: string;
  displayName: string;
  aliases?: string[];
}>): VerifiedEmployerCatalog {
  return {
    getVerifiedEmployers: () =>
      employers.map((employer) => ({
        companyKey: employer.companyKey,
        industryClass: employer.industryClass,
        displayName: employer.displayName,
        aliases: employer.aliases ?? [],
        updatedAt: 1,
      })),
  };
}

describe("UnifiedSearchService", () => {
  it("expands keywords with source mapping", () => {
    const root = createFixtureRoot();

    try {
      const skillsService = new SkillsKnowledgeService(root);
      const service = new UnifiedSearchService(skillsService);
      const expansion = service.expandKeyword("销售");

      expect(expansion.groups).toEqual([
        {
          original: "销售",
          variants: ["销售", "业务", "商务", "销售员", "sales"],
        },
      ]);
      expect(expansion.mode).toBe("AND");
      expect(expansion.flatTerms).toEqual(["销售", "业务", "商务", "销售员", "sales"]);
      expect(expansion.sourceMapping).toEqual({
        "业务": "销售",
        "商务": "销售",
        "销售员": "销售",
        "sales": "销售",
      });
    } finally {
      cleanupFixtureRoot(root);
    }
  });

  it("preserves AND grouping for legacy multi-keyword token queries", () => {
    const root = createFixtureRoot();

    try {
      const skillsService = new SkillsKnowledgeService(root);
      const service = new UnifiedSearchService(skillsService);
      const expansion = service.expandKeyword("销售 CNC");

      expect(expansion.mode).toBe("AND");
      expect(expansion.groups).toEqual([
        {
          original: "销售",
          variants: ["销售", "业务", "商务", "销售员", "sales"],
        },
        {
          original: "cnc",
          variants: ["cnc"],
        },
      ]);
      expect(expansion.flatTerms).toEqual(["销售", "业务", "商务", "销售员", "sales", "cnc"]);
    } finally {
      cleanupFixtureRoot(root);
    }
  });

  it("splits CJK-ASCII boundary queries into per-token groups", () => {
    const root = createFixtureRoot();

    try {
      const skillsService = new SkillsKnowledgeService(root);
      const service = new UnifiedSearchService(skillsService);
      const expansion = service.expandKeyword("CNC编程");

      expect(expansion.mode).toBe("AND");
      expect(expansion.groups).toEqual([
        {
          original: "cnc",
          variants: ["cnc"],
        },
        {
          original: "编程",
          variants: ["编程"],
        },
      ]);
      expect(expansion.flatTerms).toEqual(["cnc", "编程"]);
    } finally {
      cleanupFixtureRoot(root);
    }
  });

  it("splits punctuation-delimited keyword groups with AND semantics", () => {
    const root = createFixtureRoot();

    try {
      const skillsService = new SkillsKnowledgeService(root);
      const service = new UnifiedSearchService(skillsService);
      const expansion = service.expandKeyword("数控车床；加工中心");

      expect(expansion.mode).toBe("AND");
      expect(expansion.groups.map((g) => g.original)).toEqual(["数控车床", "加工中心"]);
      expect(expansion.flatTerms).toEqual(["数控车床", "加工中心"]);
    } finally {
      cleanupFixtureRoot(root);
    }
  });

  it("splits mixed boundary + punctuation queries into per-token groups", () => {
    const root = createFixtureRoot();

    try {
      const skillsService = new SkillsKnowledgeService(root);
      const service = new UnifiedSearchService(skillsService);
      const expansion = service.expandKeyword("CNC编程;操机。UG编程．销售");

      expect(expansion.mode).toBe("AND");
      expect(expansion.groups.map((g) => g.original)).toEqual(["cnc", "编程", "操机", "ug", "编程", "销售"]);
      expect(expansion.flatTerms).toEqual(["cnc", "编程", "操机", "ug", "销售", "业务", "商务", "销售员", "sales"]);
    } finally {
      cleanupFixtureRoot(root);
    }
  });

  it("preserves quoted phrase groups with OR semantics", () => {
    const root = createFixtureRoot();

    try {
      const skillsService = new SkillsKnowledgeService(root);
      const service = new UnifiedSearchService(skillsService);
      const expansion = service.expandKeyword('"Sales Engineer" OR "Sales Manager"');

      expect(expansion.mode).toBe("OR");
      expect(expansion.groups).toEqual([
        {
          original: "sales engineer",
          variants: ["sales engineer"],
        },
        {
          original: "sales manager",
          variants: ["sales manager"],
        },
      ]);
      expect(expansion.flatTerms).toEqual(["sales engineer", "sales manager"]);
    } finally {
      cleanupFixtureRoot(root);
    }
  });

  it("expands company-pattern aliases to canonical and alternate brand terms", () => {
    const root = createFixtureRoot();

    try {
      const skillsService = new SkillsKnowledgeService(root);
      const service = new UnifiedSearchService(skillsService);
      const expansion = service.expandKeyword("三菱");

      expect(expansion.groups).toEqual([
        {
          original: "三菱",
          variants: ["三菱", "mitsubishi", "三菱系统"],
        },
      ]);
      expect(expansion.flatTerms).toEqual(["三菱", "mitsubishi", "三菱系统"]);
      expect(expansion.sourceMapping).toEqual({
        "mitsubishi": "三菱",
        "三菱系统": "三菱",
      });
    } finally {
      cleanupFixtureRoot(root);
    }
  });

  it("returns provenance across text, tags, and company fields", () => {
    const root = createFixtureRoot();

    try {
      const skillsService = new SkillsKnowledgeService(root);
      const service = new UnifiedSearchService(skillsService);
      const resume: ResumeItem = {
        name: "周祥富",
        profileUrl: "https://example.com/1",
        activityStatus: "active",
        age: "40",
        experience: "11年",
        education: "中专",
        location: "东莞",
        selfIntro: "",
        jobIntention: "销售工程师",
        expectedSalary: "6000-7999",
        workHistory: [
          {
            raw: "legacy fallback line",
            companyName: "东莞市泽钿精密机械有限公司",
            jobTitle: "销售工程师",
            startDate: "2015-12",
            endDate: "2020-07",
          },
        ],
        extractedAt: "2026-03-11T00:00:00.000Z",
        resumeId: "resume-1",
      };
      const indexMap = new Map<string, ResumeIndex>([
        [
          "resume-1",
          {
            resumeId: "resume-1",
            experienceYears: 11,
            educationLevel: "high_school",
            locationCity: "东莞",
            skills: [],
            companies: ["泽钿精密"],
            industryTags: ["sales"],
            salaryRange: null,
            searchText: "销售 销售工程师",
          },
        ],
      ]);

      const result = service.searchUnified([resume], "销售", { indexMap });

      expect(result.results).toHaveLength(1);
      expect(result.results[0]?.provenance).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ term: "销售", source: "searchText" }),
          expect.objectContaining({ term: "sales", source: "industryTags", expandedFrom: "销售" }),
        ])
      );
    } finally {
      cleanupFixtureRoot(root);
    }
  });

  it("requires all keyword groups in AND mode", () => {
    const root = createFixtureRoot();

    try {
      const skillsService = new SkillsKnowledgeService(root);
      const service = new UnifiedSearchService(skillsService);
      const salesResume: ResumeItem = {
        name: "销售候选人",
        profileUrl: "https://example.com/1",
        activityStatus: "active",
        age: "35",
        experience: "8年",
        education: "大专",
        location: "东莞",
        selfIntro: "",
        jobIntention: "销售工程师",
        expectedSalary: "10000-15000",
        workHistory: [{ raw: "负责销售渠道拓展" }],
        extractedAt: "2026-03-11T00:00:00.000Z",
        resumeId: "resume-sales",
      };
      const cncResume: ResumeItem = {
        ...salesResume,
        name: "CNC候选人",
        jobIntention: "CNC工程师",
        workHistory: [{ raw: "负责CNC设备调试" }],
        resumeId: "resume-cnc",
      };
      const bothResume: ResumeItem = {
        ...salesResume,
        name: "复合候选人",
        jobIntention: "CNC销售工程师",
        workHistory: [{ raw: "负责CNC设备销售与渠道拓展" }],
        resumeId: "resume-both",
      };

      const results = service.searchUnified(
        [salesResume, cncResume, bothResume],
        "销售 CNC"
      );

      expect(results.results.map((entry) => entry.resume.resumeId)).toEqual(["resume-both"]);
    } finally {
      cleanupFixtureRoot(root);
    }
  });

  it("matches either quoted phrase group in OR mode", () => {
    const root = createFixtureRoot();

    try {
      const skillsService = new SkillsKnowledgeService(root);
      const service = new UnifiedSearchService(skillsService);
      const engineerResume: ResumeItem = {
        name: "Engineer only",
        profileUrl: "https://example.com/1",
        activityStatus: "active",
        age: "35",
        experience: "8年",
        education: "本科",
        location: "Kuala Lumpur MY",
        selfIntro: "",
        jobIntention: "Sales Engineer",
        expectedSalary: "10000-15000",
        workHistory: [{ raw: "Worked as Sales Engineer for CNC accounts" }],
        extractedAt: "2026-03-11T00:00:00.000Z",
        resumeId: "resume-engineer",
      };
      const managerResume: ResumeItem = {
        ...engineerResume,
        name: "Manager only",
        jobIntention: "Sales Manager",
        workHistory: [{ raw: "Worked as Sales Manager for industrial accounts" }],
        resumeId: "resume-manager",
      };
      const genericSalesResume: ResumeItem = {
        ...engineerResume,
        name: "Generic sales",
        jobIntention: "Sales Executive",
        workHistory: [{ raw: "Worked as Sales Executive for general B2B accounts" }],
        resumeId: "resume-generic-sales",
      };

      const results = service.searchUnified(
        [engineerResume, managerResume, genericSalesResume],
        '"Sales Engineer" OR "Sales Manager"'
      );

      expect(results.results.map((entry) => entry.resume.resumeId)).toEqual([
        "resume-engineer",
        "resume-manager",
      ]);
    } finally {
      cleanupFixtureRoot(root);
    }
  });

  it("does not match job intention text when no index searchText is available", () => {
    const root = createFixtureRoot();

    try {
      const skillsService = new SkillsKnowledgeService(root);
      const service = new UnifiedSearchService(skillsService);
      const resume: ResumeItem = {
        name: "Header only",
        profileUrl: "https://example.com/1",
        activityStatus: "active",
        age: "35",
        experience: "8年",
        education: "本科",
        location: "东莞",
        selfIntro: "精通FANUC系统",
        jobIntention: "销售工程师",
        expectedSalary: "10000-15000",
        workHistory: [],
        extractedAt: "2026-03-20T00:00:00.000Z",
        resumeId: "resume-header-only",
      };

      const results = service.searchUnified([resume], "销售");

      expect(results.results).toEqual([]);
    } finally {
      cleanupFixtureRoot(root);
    }
  });
});

describe("verified-employer keyword bridge", () => {
  it("injects verified employer names and aliases into industry-scoped groups", () => {
    const root = createMachineryFixtureRoot();

    try {
      const skillsService = new SkillsKnowledgeService(root);
      const catalog = catalogWith([
        {
          companyKey: "eonmetall-group",
          industryClass: "cnc",
          displayName: "Eonmetall Group Bhd",
          aliases: ["eonmetall group bhd", "eonmetall"],
        },
      ]);
      const service = new UnifiedSearchService(skillsService, catalog);
      const expansion = service.expandKeyword("cnc sales");

      const cncGroup = expansion.groups.find((group) => group.original === "cnc");
      expect(cncGroup?.variants).toContain("cnc");
      expect(cncGroup?.variants).toContain("eonmetall group bhd");
      expect(cncGroup?.variants).toContain("eonmetall");

      const salesGroup = expansion.groups.find((group) => group.original === "sales");
      expect(salesGroup?.variants).not.toContain("eonmetall group bhd");
    } finally {
      cleanupFixtureRoot(root);
    }
  });

  it("bridges nothing for non-industry-scoped groups", () => {
    const root = createMachineryFixtureRoot();

    try {
      const skillsService = new SkillsKnowledgeService(root);
      const catalog = catalogWith([
        {
          companyKey: "eonmetall-group",
          industryClass: "cnc",
          displayName: "Eonmetall Group Bhd",
          aliases: ["eonmetall"],
        },
      ]);
      const service = new UnifiedSearchService(skillsService, catalog);
      const expansion = service.expandKeyword("sales");

      const salesGroup = expansion.groups.find((group) => group.original === "sales");
      expect(salesGroup?.variants).not.toContain("eonmetall group bhd");
      expect(salesGroup?.variants).not.toContain("eonmetall");
    } finally {
      cleanupFixtureRoot(root);
    }
  });

  it("degrades to synonyms-only expansion when the catalog is empty", () => {
    const root = createMachineryFixtureRoot();

    try {
      const skillsService = new SkillsKnowledgeService(root);
      const service = new UnifiedSearchService(
        skillsService,
        catalogWith([]),
      );
      const expansion = service.expandKeyword("cnc");

      const cncGroup = expansion.groups.find((group) => group.original === "cnc");
      expect(cncGroup?.variants).toEqual(["cnc"]);
    } finally {
      cleanupFixtureRoot(root);
    }
  });

  it("excludes employers whose industry class is not taxonomy-compatible", () => {
    const root = createMachineryFixtureRoot();

    try {
      const skillsService = new SkillsKnowledgeService(root);
      const catalog = catalogWith([
        {
          companyKey: "non-industry-co",
          industryClass: "non_industry",
          displayName: "Used Cars Sdn Bhd",
          aliases: ["used cars"],
        },
        {
          companyKey: "unknown-co",
          industryClass: "unknown",
          displayName: "Mystery Sdn Bhd",
          aliases: ["mystery"],
        },
      ]);
      const service = new UnifiedSearchService(skillsService, catalog);
      const expansion = service.expandKeyword("cnc");

      const cncGroup = expansion.groups.find((group) => group.original === "cnc");
      expect(cncGroup?.variants).not.toContain("used cars sdn bhd");
      expect(cncGroup?.variants).not.toContain("mystery sdn bhd");
    } finally {
      cleanupFixtureRoot(root);
    }
  });
});
