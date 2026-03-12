import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { SkillsKnowledgeService } from "./skills-knowledge";
import { UnifiedSearchService } from "./unified-search-service";

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

  it("preserves AND grouping for multi-keyword queries", () => {
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
        workHistory: [],
        extractedAt: "2026-03-11T00:00:00.000Z",
        resumeId: "resume-sales",
      };
      const cncResume: ResumeItem = {
        ...salesResume,
        name: "CNC候选人",
        jobIntention: "CNC工程师",
        resumeId: "resume-cnc",
      };
      const bothResume: ResumeItem = {
        ...salesResume,
        name: "复合候选人",
        jobIntention: "CNC销售工程师",
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
});
