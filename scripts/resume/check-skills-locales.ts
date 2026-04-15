#!/usr/bin/env -S npx tsx

import { readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { parse as parseYaml } from "yaml";

type Frontmatter = {
  version: number;
  updated_at: string;
};

type DomainBlock = {
  tag: string;
  keywords: string[];
};

type ExperienceBlock = {
  level: string;
  keywords: string[];
};

type SynonymEntry = {
  canonical: string;
  variants: string[];
};

type CompanyPattern = {
  name: string;
  role: string;
  aliases: string[];
};

type SalesRolePolicy = {
  directTitleSignals: string[];
  contextSignals: string[];
  auxiliaryPrefixes: string[];
  directDutyCues: string[];
};

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, "..", "..");
const zhPath = path.join(repoRoot, "config", "resume", "skills.md");
const enPath = path.join(repoRoot, "config", "resume", "skills.en.md");

const SECTION_ALIASES = {
  domainTaxonomy: ["Domain Taxonomy", "领域分类"],
  synonymTable: ["Synonym Table", "同义词表"],
  experienceSignals: ["Experience Signals", "经验等级信号"],
  companyPatterns: ["Company Patterns", "公司数据库"],
  roleSignalPolicy: ["Role Signal Policy", "角色信号策略"],
  exclusionPatterns: ["Exclusion Patterns", "排除模式"],
  learningLog: ["Learning Log", "学习日志"],
} as const;

function splitFrontmatter(rawMarkdown: string, filePath: string): { frontmatter: Frontmatter; body: string } {
  const lines = rawMarkdown.split("\n");
  if (lines[0]?.trim() !== "---") {
    throw new Error(`${filePath}: missing opening frontmatter fence`);
  }

  let frontmatterEnd = -1;
  for (let index = 1; index < lines.length; index += 1) {
    if (lines[index]?.trim() === "---") {
      frontmatterEnd = index;
      break;
    }
  }

  if (frontmatterEnd === -1) {
    throw new Error(`${filePath}: missing closing frontmatter fence`);
  }

  const parsed = parseYaml(lines.slice(1, frontmatterEnd).join("\n")) as Partial<Frontmatter> | null;
  if (!parsed || typeof parsed.version !== "number" || typeof parsed.updated_at !== "string") {
    throw new Error(`${filePath}: invalid frontmatter`);
  }

  return {
    frontmatter: {
      version: parsed.version,
      updated_at: parsed.updated_at,
    },
    body: lines.slice(frontmatterEnd + 1).join("\n"),
  };
}

function parseTopLevelSections(body: string): Map<string, string> {
  const sections = new Map<string, string>();
  const lines = body.split("\n");
  let currentHeading: string | null = null;
  let currentLines: string[] = [];

  const flush = (): void => {
    if (!currentHeading) {
      currentLines = [];
      return;
    }

    sections.set(currentHeading, currentLines.join("\n").trim());
    currentLines = [];
  };

  for (const line of lines) {
    if (line.startsWith("## ")) {
      flush();
      currentHeading = line.slice(3).trim();
      continue;
    }

    if (currentHeading) {
      currentLines.push(line);
    }
  }

  flush();
  return sections;
}

function getSection(sections: Map<string, string>, aliases: readonly string[], filePath: string): string {
  for (const alias of aliases) {
    for (const [heading, value] of sections.entries()) {
      if (heading === alias || heading.startsWith(alias)) {
        return value;
      }
    }
  }

  throw new Error(`${filePath}: missing section ${aliases[0]}`);
}

function parseCsv(value: string): string[] {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

function parseDomains(section: string): DomainBlock[] {
  const lines = section.split("\n");
  const blocks: DomainBlock[] = [];
  let current: DomainBlock | null = null;

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith("### ")) {
      if (current) {
        blocks.push(current);
      }
      current = {
        tag: trimmed.slice(4).trim(),
        keywords: [],
      };
      continue;
    }

    if (current && trimmed.startsWith("- keywords:")) {
      current.keywords = parseCsv(trimmed.slice("- keywords:".length).trim());
    }
  }

  if (current) {
    blocks.push(current);
  }

  return blocks;
}

function parseExperienceLevels(section: string): ExperienceBlock[] {
  const lines = section.split("\n");
  const blocks: ExperienceBlock[] = [];
  let current: ExperienceBlock | null = null;

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith("### ")) {
      if (current) {
        blocks.push(current);
      }
      current = {
        level: trimmed.slice(4).trim(),
        keywords: [],
      };
      continue;
    }

    if (current && trimmed.startsWith("- keywords:")) {
      current.keywords = parseCsv(trimmed.slice("- keywords:".length).trim());
    }
  }

  if (current) {
    blocks.push(current);
  }

  return blocks;
}

function parseSynonyms(section: string): SynonymEntry[] {
  return section
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.startsWith("- ") && line.includes(":"))
    .map((line) => {
      const [canonical, variants] = line.slice(2).split(/:\s*/, 2);
      return {
        canonical: canonical.trim(),
        variants: parseCsv(variants ?? ""),
      };
    });
}

function parseCompanyPatterns(section: string): CompanyPattern[] {
  return section
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.startsWith("- "))
    .map((line) => {
      const match = line.match(/^- (.+?) \[role: (.+?)\] \(aliases: (.+)\)$/);
      if (!match) {
        throw new Error(`Invalid company pattern line: ${line}`);
      }

      return {
        name: match[1]?.trim() ?? "",
        role: match[2]?.trim() ?? "",
        aliases: parseCsv(match[3] ?? ""),
      };
    });
}

function parseRoleSignalPolicy(section: string): { sales?: SalesRolePolicy } {
  const lines = section.split("\n");
  let inSalesBlock = false;
  const parsed: SalesRolePolicy = {
    directTitleSignals: [],
    contextSignals: [],
    auxiliaryPrefixes: [],
    directDutyCues: [],
  };

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith("### ")) {
      inSalesBlock = trimmed.slice(4).trim().toLowerCase() === "sales";
      continue;
    }

    if (!inSalesBlock) {
      continue;
    }

    if (trimmed.startsWith("- directTitleSignals:")) {
      parsed.directTitleSignals = parseCsv(trimmed.slice("- directTitleSignals:".length).trim());
      continue;
    }
    if (trimmed.startsWith("- contextSignals:")) {
      parsed.contextSignals = parseCsv(trimmed.slice("- contextSignals:".length).trim());
      continue;
    }
    if (trimmed.startsWith("- auxiliaryPrefixes:")) {
      parsed.auxiliaryPrefixes = parseCsv(trimmed.slice("- auxiliaryPrefixes:".length).trim());
      continue;
    }
    if (trimmed.startsWith("- directDutyCues:")) {
      parsed.directDutyCues = parseCsv(trimmed.slice("- directDutyCues:".length).trim());
    }
  }

  if (
    parsed.directTitleSignals.length === 0
    && parsed.contextSignals.length === 0
    && parsed.auxiliaryPrefixes.length === 0
    && parsed.directDutyCues.length === 0
  ) {
    return {};
  }

  return { sales: parsed };
}

function parseExclusionTokens(section: string): string[] {
  const line = section
    .split("\n")
    .map((value) => value.trim())
    .find((value) => value.startsWith("- exclude:"));

  if (!line) {
    throw new Error("Missing exclusion token entry");
  }

  return parseCsv(line.slice("- exclude:".length).trim());
}

function parseLearningLog(section: string): string[] {
  return section
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => /^- \d{4}-\d{2}-\d{2}:/.test(line));
}

function compareValue<T>(label: string, left: T, right: T): void {
  const leftJson = JSON.stringify(left);
  const rightJson = JSON.stringify(right);

  if (leftJson !== rightJson) {
    throw new Error(`${label} mismatch\nzh-Hans: ${leftJson}\nen: ${rightJson}`);
  }
}

async function run(): Promise<void> {
  const [zhRaw, enRaw] = await Promise.all([
    readFile(zhPath, "utf8"),
    readFile(enPath, "utf8"),
  ]);

  const zh = splitFrontmatter(zhRaw, zhPath);
  const en = splitFrontmatter(enRaw, enPath);

  compareValue("skills frontmatter version", zh.frontmatter.version, en.frontmatter.version);
  compareValue("skills frontmatter updated_at", zh.frontmatter.updated_at, en.frontmatter.updated_at);

  const zhSections = parseTopLevelSections(zh.body);
  const enSections = parseTopLevelSections(en.body);

  compareValue(
    "domain taxonomy",
    parseDomains(getSection(zhSections, SECTION_ALIASES.domainTaxonomy, zhPath)),
    parseDomains(getSection(enSections, SECTION_ALIASES.domainTaxonomy, enPath)),
  );
  compareValue(
    "synonym table",
    parseSynonyms(getSection(zhSections, SECTION_ALIASES.synonymTable, zhPath)),
    parseSynonyms(getSection(enSections, SECTION_ALIASES.synonymTable, enPath)),
  );
  compareValue(
    "experience signals",
    parseExperienceLevels(getSection(zhSections, SECTION_ALIASES.experienceSignals, zhPath)),
    parseExperienceLevels(getSection(enSections, SECTION_ALIASES.experienceSignals, enPath)),
  );
  compareValue(
    "company patterns",
    parseCompanyPatterns(getSection(zhSections, SECTION_ALIASES.companyPatterns, zhPath)),
    parseCompanyPatterns(getSection(enSections, SECTION_ALIASES.companyPatterns, enPath)),
  );
  compareValue(
    "role signal policy",
    parseRoleSignalPolicy(getSection(zhSections, SECTION_ALIASES.roleSignalPolicy, zhPath)),
    parseRoleSignalPolicy(getSection(enSections, SECTION_ALIASES.roleSignalPolicy, enPath)),
  );
  compareValue(
    "exclusion patterns",
    parseExclusionTokens(getSection(zhSections, SECTION_ALIASES.exclusionPatterns, zhPath)),
    parseExclusionTokens(getSection(enSections, SECTION_ALIASES.exclusionPatterns, enPath)),
  );
  compareValue(
    "learning log",
    parseLearningLog(getSection(zhSections, SECTION_ALIASES.learningLog, zhPath)),
    parseLearningLog(getSection(enSections, SECTION_ALIASES.learningLog, enPath)),
  );

  console.log("Resume skills locale files are structurally consistent");
}

run().catch((error: unknown) => {
  console.error("Resume skills locale consistency check failed:", error);
  process.exit(1);
});
