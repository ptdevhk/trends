/**
 * Export MY bootstrap employer candidates from sample resume backup files.
 *
 * Reads resume backup JSON files (the same format used by `restore-resumes`),
 * extracts employer surfaces from work history, ranks them by frequency and
 * direct-role relevance, and emits a JSON file suitable for the MY bootstrap
 * deep-research / reviewed-import workflow.
 *
 * Usage:
 *   npx tsx scripts/industry-data/export-my-employer-candidates.ts \
 *     --input output/resume-samples \
 *     --output output/industry-data/my-employer-candidates.json
 *
 * Or via environment:
 *   INPUT_DIR=output/resume-samples OUTPUT_FILE=output/industry-data/...
 */
import { readdir, readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";

interface ResumeBackupFile {
  metadata?: Record<string, unknown>;
  resumes?: unknown[];
  data?: unknown[];
}

interface WorkHistoryItem {
  raw?: string;
  companyName?: string;
  jobTitle?: string;
  description?: string;
}

interface ResumeItem {
  name?: string;
  source?: string;
  sourceKey?: string;
  workHistory?: WorkHistoryItem[];
}

interface EmployerCandidate {
  employerName: string;
  normalizedEmployerName: string;
  sampleCount: number;
  sampleJobTitles: string[];
  sampleDutySnippets: string[];
  seedMatchType: string;
  suggestedCompanyKey?: string;
}

// Reuse the same extraction logic as the runtime (simplified for offline export).
function normalizeText(value: string | undefined): string {
  return (value || "")
    .replace(/[　\s]+/g, " ")
    .trim();
}

function normalizeEmployerName(value: string): string {
  return normalizeText(value).toLowerCase();
}

function extractCompanyFromEntry(entry: WorkHistoryItem): string {
  const companyName = normalizeText(entry.companyName);
  if (companyName) {
    return companyName;
  }

  const raw = normalizeText(entry.raw);
  if (!raw) {
    return "";
  }

  // CN pattern: "...公司名称..." typically after the date range.
  // Try common patterns: "YYYY-MM~YYYY-MM 公司名称 职位" or "at Company · Title"
  const cnMatch = raw.match(/(?:~\s*(?:至今|present|current|now)?\s*|\)\s*)([^\d]+?)$/u);
  if (cnMatch && cnMatch[1]) {
    const candidate = cnMatch[1].trim();
    // Split on job title if present
    const parts = candidate.split(/\s{2,}|\s+/);
    if (parts.length > 0 && parts[0].length >= 2) {
      return parts[0];
    }
    return candidate;
  }

  // EN pattern: "Title at Company · Date range"
  const enAtMatch = raw.match(/\bat\s+([^·(]+)/i);
  if (enAtMatch && enAtMatch[1]) {
    return enAtMatch[1].trim();
  }

  // EN pattern: "Title · Company · Date range"
  const enDotMatch = raw.match(/·\s*([^·(]+)/);
  if (enDotMatch && enDotMatch[1]) {
    const candidate = enDotMatch[1].trim();
    // Strip trailing date info
    const dateIdx = candidate.search(/\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec|\d{4})\b/i);
    if (dateIdx > 0) {
      return candidate.slice(0, dateIdx).trim();
    }
    return candidate;
  }

  return "";
}

function extractJobTitle(entry: WorkHistoryItem): string {
  return normalizeText(entry.jobTitle) || "";
}

function extractDutySnippet(entry: WorkHistoryItem): string {
  const desc = normalizeText(entry.description);
  if (desc) {
    return desc.slice(0, 200);
  }
  const raw = normalizeText(entry.raw);
  if (raw) {
    return raw.slice(0, 200);
  }
  return "";
}

// Simple seed match type detection (mirrors industry-data-service tiers).
const CNC_KEYWORDS = [
  "cnc", "数控", "机床", "加工中心", "车床", "铣床", "磨床",
  "机械", "模具", "自动化", "金属加工", "刀具", "夹具", "量具", "测量", "三坐标",
  "machining", "machinery", "machine tool", "precision", "metrology",
];

const CNC_BRANDS = [
  "fanuc", "siemens", "haas", "mazak", "mitsubishi", "dmg mori", "okuma",
  "star", "citizen", "tsugami", "tornos", "brother", "jingdiao",
];

function detectSeedMatchType(employerName: string): string {
  const lower = employerName.toLowerCase();
  if (!lower) {
    return "none";
  }

  for (const brand of CNC_BRANDS) {
    if (lower.includes(brand)) {
      return "brand_match";
    }
  }

  for (const keyword of CNC_KEYWORDS) {
    if (lower.includes(keyword)) {
      return "keyword_match";
    }
  }

  return "none";
}

function isDirectRoleRelevant(jobTitle: string, dutySnippet: string): boolean {
  const text = `${jobTitle} ${dutySnippet}`.toLowerCase();
  const salesSignals = ["sales", "销售", "业务", "account", "business development", "channel", "渠道"];
  const engineerSignals = ["engineer", "工程师", "技术", "编程", "调试", "cnc", "数控", "mechanical"];
  return salesSignals.some((s) => text.includes(s)) || engineerSignals.some((s) => text.includes(s));
}

async function readBackupFile(filePath: string): Promise<ResumeItem[]> {
  const content = await readFile(filePath, "utf-8");
  const parsed: ResumeBackupFile = JSON.parse(content);
  const resumes = parsed.resumes ?? parsed.data ?? [];
  return resumes.filter((r): r is ResumeItem => r !== null && typeof r === "object");
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  let inputDir = process.env.INPUT_DIR ?? "output/resume-samples";
  let outputFile = process.env.OUTPUT_FILE ?? "output/industry-data/my-employer-candidates.json";

  for (let i = 0; i < args.length; i += 2) {
    const flag = args[i];
    const value = args[i + 1];
    if (flag === "--input" && value) {
      inputDir = value;
    } else if (flag === "--output" && value) {
      outputFile = value;
    }
  }

  const absInput = path.resolve(inputDir);
  const absOutput = path.resolve(outputFile);

  console.log(`-> scanning ${absInput}`);
  const entries = await readdir(absInput);
  const backupFiles = entries
    .filter((name) => name.endsWith(".json") && name.startsWith("resume-backup-"))
    .sort()
    .map((name) => path.join(absInput, name));

  if (backupFiles.length === 0) {
    throw new Error(`No resume-backup-*.json files found in ${absInput}`);
  }

  console.log(`-> found ${backupFiles.length} backup file(s)`);

  // Collect employer surfaces across all resumes.
  const employerMap = new Map<
    string,
    {
      employerName: string;
      sampleCount: number;
      jobTitles: Set<string>;
      dutySnippets: Set<string>;
      sources: Set<string>;
      directRoleRelevantCount: number;
    }
  >();

  let totalResumes = 0;
  for (const filePath of backupFiles) {
    const fileName = path.basename(filePath);
    const resumes = await readBackupFile(filePath);
    totalResumes += resumes.length;
    console.log(`  ${fileName}: ${resumes.length} resumes`);

    for (const resume of resumes) {
      const workHistory = resume.workHistory ?? [];
      const source = resume.source ?? resume.sourceKey ?? "unknown";

      for (const entry of workHistory) {
        const employerName = extractCompanyFromEntry(entry);
        if (!employerName || employerName.length < 2) {
          continue;
        }

        const normalized = normalizeEmployerName(employerName);
        if (!normalized) {
          continue;
        }

        const jobTitle = extractJobTitle(entry);
        const dutySnippet = extractDutySnippet(entry);

        const existing = employerMap.get(normalized) ?? {
          employerName,
          sampleCount: 0,
          jobTitles: new Set<string>(),
          dutySnippets: new Set<string>(),
          sources: new Set<string>(),
          directRoleRelevantCount: 0,
        };

        existing.sampleCount += 1;
        existing.employerName = employerName.length > existing.employerName.length
          ? employerName
          : existing.employerName;
        if (jobTitle) {
          existing.jobTitles.add(jobTitle);
        }
        if (dutySnippet) {
          existing.dutySnippets.add(dutySnippet);
        }
        existing.sources.add(source);
        if (isDirectRoleRelevant(jobTitle, dutySnippet)) {
          existing.directRoleRelevantCount += 1;
        }

        employerMap.set(normalized, existing);
      }
    }
  }

  console.log(`-> processed ${totalResumes} resumes, ${employerMap.size} unique employer surfaces`);

  // Build output, sorted by sample count desc, then direct-role relevance.
  const candidates: EmployerCandidate[] = Array.from(employerMap.values())
    .map((data) => {
      const seedMatchType = detectSeedMatchType(data.employerName);
      return {
        employerName: data.employerName,
        normalizedEmployerName: normalizeEmployerName(data.employerName),
        sampleCount: data.sampleCount,
        sampleJobTitles: Array.from(data.jobTitles).slice(0, 10),
        sampleDutySnippets: Array.from(data.dutySnippets).slice(0, 5),
        seedMatchType,
        ...(seedMatchType !== "none" ? { suggestedCompanyKey: normalizeEmployerName(data.employerName).replace(/[^a-z0-9]/g, "") } : {}),
      };
    })
    .sort((a, b) => {
      // Direct-role-relevant employers first, then by sample count.
      const aRelevant = employerMap.get(a.normalizedEmployerName)?.directRoleRelevantCount ?? 0;
      const bRelevant = employerMap.get(b.normalizedEmployerName)?.directRoleRelevantCount ?? 0;
      if (bRelevant !== aRelevant) {
        return bRelevant - aRelevant;
      }
      return b.sampleCount - a.sampleCount;
    });

  const output = {
    metadata: {
      generatedAt: new Date().toISOString(),
      inputDir: absInput,
      totalResumes,
      totalEmployerSurfaces: candidates.length,
      sourceFiles: backupFiles.map((f) => path.basename(f)),
    },
    candidates,
  };

  await mkdir(path.dirname(absOutput), { recursive: true });
  await writeFile(absOutput, JSON.stringify(output, null, 2), "utf-8");
  console.log(`-> wrote ${candidates.length} employer candidates to ${absOutput}`);

  // Print top 20 for quick review.
  console.log("\nTop 20 employer candidates:");
  for (const c of candidates.slice(0, 20)) {
    console.log(`  [${c.sampleCount}] ${c.employerName} (seed: ${c.seedMatchType})`);
    if (c.sampleJobTitles.length > 0) {
      console.log(`    titles: ${c.sampleJobTitles.slice(0, 3).join(", ")}`);
    }
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
