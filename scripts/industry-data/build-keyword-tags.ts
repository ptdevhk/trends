#!/usr/bin/env -S bunx tsx

import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

export const KEYWORD_TAG_CATEGORIES = [
  "machining",
  "lathe",
  "edm",
  "measurement",
  "smt",
  "3d_printing",
] as const;

export type KeywordTagCategory = (typeof KEYWORD_TAG_CATEGORIES)[number];

export type KeywordTagEntry = {
  keyword: string;
  english?: string;
};

export type KeywordTagsFile = {
  version: string;
  source: string;
  tags: Record<KeywordTagCategory, KeywordTagEntry[]>;
};

const SECTION_CATEGORY_MAP: Array<{ prefix: string; category: KeywordTagCategory }> = [
  { prefix: "3.1", category: "machining" },
  { prefix: "3.2", category: "lathe" },
  { prefix: "3.3", category: "edm" },
  { prefix: "3.4", category: "measurement" },
  { prefix: "3.5", category: "smt" },
  { prefix: "3.6", category: "3d_printing" },
];

function resolveCategoryFromHeading(heading: string): KeywordTagCategory | null {
  for (const { prefix, category } of SECTION_CATEGORY_MAP) {
    if (heading.includes(prefix)) {
      return category;
    }
  }
  const lower = heading.toLowerCase();
  if (lower.includes("加工中心") || lower.includes("machining")) return "machining";
  if (lower.includes("车床") || lower.includes("lathe")) return "lathe";
  if (lower.includes("火花") || lower.includes("edm") || lower.includes("线切割")) return "edm";
  if (lower.includes("测量") || lower.includes("扫描") || lower.includes("cmm") || lower.includes("measurement")) {
    return "measurement";
  }
  if (lower.includes("smt")) return "smt";
  if (lower.includes("3d") || lower.includes("打印")) return "3d_printing";
  return null;
}

function parseMarkdownTableRows(tableLines: string[]): Array<{ keyword: string; english?: string }> {
  if (tableLines.length < 3) return [];
  const header = tableLines[0].split("|").map((c) => c.trim()).filter(Boolean);
  const keywordColIdx = header.findIndex((h) => h.includes("关键词") || h.toLowerCase().includes("keyword"));
  const englishColIdx = header.findIndex((h) => h.includes("英文") || h.toLowerCase().includes("english"));

  const dataRows = tableLines.slice(2);
  const results: Array<{ keyword: string; english?: string }> = [];

  for (const row of dataRows) {
    const cells = row.split("|").map((c) => c.trim()).filter((_, i) => i > 0);
    const kwIdx = keywordColIdx >= 0 ? keywordColIdx : 1;
    const enIdx = englishColIdx >= 0 ? englishColIdx : 2;

    const rawKw = cells[kwIdx]?.trim();
    if (!rawKw) continue;

    const rawEn = cells[enIdx]?.trim();
    const entry: KeywordTagEntry = { keyword: rawKw };
    if (rawEn) {
      entry.english = rawEn;
    }
    results.push(entry);
  }
  return results;
}

export function buildKeywordTags(sourcePath: string): KeywordTagsFile {
  const content = readFileSync(sourcePath, "utf-8");

  // Extract Section 3: 核心设备与技术关键词 (Core Equipment & Technical Keywords)
  // Stops at Section 4: ## 4. 品牌分类汇总 (Brand Classification)
  const s3Match = content.match(/## 3\.[^\n]*\n([\s\S]*?)(?=\n## 4\.|$)/);
  if (!s3Match) {
    throw new Error(`Section 3 not found in ${sourcePath}`);
  }

  const s3Content = s3Match[1];
  const sectionChunks = s3Content.split(/\n(?=### )/);

  const tags: Record<KeywordTagCategory, KeywordTagEntry[]> = {
    machining: [],
    lathe: [],
    edm: [],
    measurement: [],
    smt: [],
    "3d_printing": [],
  };

  for (const chunk of sectionChunks) {
    const trimmedChunk = chunk.trim();
    if (!trimmedChunk.startsWith("### ")) continue;

    const firstLine = trimmedChunk.split("\n")[0];
    const category = resolveCategoryFromHeading(firstLine);
    if (!category) continue;

    const lines = trimmedChunk.split("\n");
    const tableLines = lines.filter((l) => l.trim().startsWith("|"));
    const entries = parseMarkdownTableRows(tableLines);

    // Intra-tag deduplication preserving table row order
    const seen = new Set<string>();
    for (const entry of entries) {
      if (seen.has(entry.keyword)) continue;
      seen.add(entry.keyword);
      tags[category].push(entry);
    }
  }

  return {
    version: "v1",
    source: "config/industry-data/keywords-structured.md",
    tags,
  };
}

export function generateKeywordTagsJson(sourcePath: string): string {
  const data = buildKeywordTags(sourcePath);
  return `${JSON.stringify(data, null, 2)}\n`;
}

function printSummary(data: KeywordTagsFile): void {
  console.log("Keyword tags summary:");
  for (const cat of KEYWORD_TAG_CATEGORIES) {
    console.log(`  ${cat}: ${data.tags[cat].length} keywords`);
  }
  const total = KEYWORD_TAG_CATEGORIES.reduce((acc, cat) => acc + data.tags[cat].length, 0);
  console.log(`Total across tags: ${total}`);
}

function main(): void {
  const args = process.argv.slice(2);
  const checkMode = args.includes("--check");

  const repoRoot = resolve(import.meta.dirname, "../../");
  const sourcePath = resolve(repoRoot, "config/industry-data/keywords-structured.md");
  const targetPath = resolve(repoRoot, "config/industry-data/keyword-tags.json");

  const expectedContent = generateKeywordTagsJson(sourcePath);
  const data = buildKeywordTags(sourcePath);

  if (checkMode) {
    let current = "";
    try {
      current = readFileSync(targetPath, "utf-8");
    } catch {
      console.error(`ERROR: ${targetPath} does not exist. Run scripts/industry-data/build-keyword-tags.ts to generate.`);
      process.exit(1);
    }

    if (current !== expectedContent) {
      console.error(`ERROR: ${targetPath} is out of sync with ${sourcePath}.`);
      console.error("Run: bunx tsx scripts/industry-data/build-keyword-tags.ts");
      process.exit(1);
    }

    console.log(`OK: ${targetPath} is up to date.`);
    printSummary(data);
    return;
  }

  writeFileSync(targetPath, expectedContent, "utf-8");
  console.log(`Wrote ${targetPath}`);
  printSummary(data);
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  main();
}
