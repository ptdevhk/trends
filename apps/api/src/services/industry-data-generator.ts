import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

import type {
    BrandEntry,
    CompanyEntry,
    KeywordEntry,
} from "./industry-data-service.js";

/**
 * Industry-data file generator.
 *
 * Renders canonical in-memory entries back to the on-disk `config/industry-data`
 * formats that `IndustryDataService.loadAll()` parses. brands.json and
 * company-urls.md round-trip losslessly. keywords-structured.md is lossy at load
 * (ITES/agent company IDs are renumbered; quick-search keyword sub-sections merge),
 * so its renderer targets SEMANTIC round-trip equality (re-parse === original), not
 * byte-identity. keywords-raw.md is out of scope (never written).
 *
 * Git commit is best-effort: on any git failure the files are still written and a
 * warning is returned with `sha: null` — never thrown into the caller.
 */

export interface IndustryDataSnapshot {
    companies: CompanyEntry[];
    keywords: KeywordEntry[];
    brands: BrandEntry[];
    companyUrls: string[];
}

const COMPANY_HEADER =
    "| ID | 公司名称 (Company Name) | 英文名称 (English Name) | 类型 (Type) |";
// loadCompanies reads agents via row["代理商名称 (Agent Name)"], so the agent table
// MUST use this header or every agent row parses to an empty nameCn and is dropped.
const AGENT_HEADER =
    "| ID | 代理商名称 (Agent Name) | 英文名称 (English Name) | 类型 (Type) |";
const KEYWORD_HEADER =
    "| ID | 关键词 (Keyword) | 英文名称 (English Name) | 类型 (Type) |";
const SEP = "|----|------------------------|------------------------|-------------|";

function table(header: string, rows: string[][]): string[] {
    const lines = [header, SEP];
    for (const cells of rows) {
        lines.push(`| ${cells.join(" | ")} |`);
    }
    return lines;
}

/** Render brands as canonical JSON (2-space indent, trailing newline). */
export function renderBrandsJson(brands: BrandEntry[]): string {
    const out = brands.map((b) => {
        const o: Record<string, unknown> = {
            id: b.id,
            nameCn: b.nameCn,
        };
        if (b.nameEn !== undefined) o.nameEn = b.nameEn;
        o.type = b.type;
        o.origin = b.origin;
        if (b.familyId) o.familyId = b.familyId;
        if (b.aliases && b.aliases.length > 0) o.aliases = b.aliases;
        if (b.productClass) o.productClass = b.productClass;
        return o;
    });
    return JSON.stringify(out, null, 2) + "\n";
}

const CATEGORY_LABEL: Record<CompanyEntry["category"], string> = {
    key_company: "重点企业列表 (Key Companies)",
    ites_exhibitor: "ITES 深圳工业展参展商 (ITES Shenzhen Industrial Exhibition Exhibitors)",
    agent: "进口代理商 (Import Agents)",
};

const KEYWORD_CATEGORY_LABEL: Record<KeywordEntry["category"], string> = {
    machining: "加工中心相关 (Machining Centers)",
    lathe: "车床相关 (Lathes)",
    edm: "火花机/线切割相关 (EDM/Wire Cutting)",
    measurement: "三坐标/测量扫描相关 (CMM/Measurement Scanning)",
    smt: "SMT相关 (Surface Mount Technology)",
    "3d_printing": "3D打印 (3D Printing)",
};

/**
 * Render companies + keywords as structured markdown. Brand rows are intentionally
 * omitted — brands.json is the canonical brand store (markdown brand tables are a
 * legacy fallback). Re-parsing this output must yield the same companies + keywords.
 */
export function renderKeywordsStructuredMd(input: {
    companies: CompanyEntry[];
    keywords: KeywordEntry[];
    brands: BrandEntry[];
}): string {
    const lines: string[] = ["# 精密机械与机床行业资源汇总", ""];

    // Companies grouped by category, preserving order and current (loaded) ids.
    const companyCats: CompanyEntry["category"][] = [
        "key_company",
        "ites_exhibitor",
        "agent",
    ];
    let sectionNo = 0;
    for (const cat of companyCats) {
        const rows = input.companies.filter((c) => c.category === cat);
        if (rows.length === 0) continue;
        sectionNo += 1;
        lines.push(`## ${sectionNo}. ${CATEGORY_LABEL[cat]}`, "");
        const header = cat === "agent" ? AGENT_HEADER : COMPANY_HEADER;
        lines.push(
            ...table(
                header,
                rows.map((c) => [
                    String(c.id),
                    c.nameCn,
                    c.nameEn ?? "",
                    c.type || "",
                ]),
            ),
            "",
        );
    }

    // Keywords grouped by category.
    const kwCats: KeywordEntry["category"][] = [
        "machining",
        "lathe",
        "edm",
        "measurement",
        "smt",
        "3d_printing",
    ];
    const anyKeywords = input.keywords.length > 0;
    if (anyKeywords) {
        sectionNo += 1;
        lines.push(`## ${sectionNo}. 核心设备与技术关键词 (Core Equipment & Technical Keywords)`, "");
        let sub = 0;
        for (const cat of kwCats) {
            const rows = input.keywords.filter((k) => k.category === cat);
            if (rows.length === 0) continue;
            sub += 1;
            lines.push(`### ${sectionNo}.${sub} ${KEYWORD_CATEGORY_LABEL[cat]}`, "");
            lines.push(
                ...table(
                    KEYWORD_HEADER,
                    rows.map((k) => [
                        String(k.id),
                        k.keyword,
                        k.english ?? "",
                        cat,
                    ]),
                ),
                "",
            );
        }
    }

    return lines.join("\n").replace(/\n{3,}/g, "\n\n").trimEnd() + "\n";
}

/** Render company URLs as one-per-line markdown (preserves order). */
export function renderCompanyUrlsMd(urls: string[]): string {
    return urls.join("\n") + "\n";
}

/**
 * Write all three generated files under `<projectRoot>/config/industry-data`.
 * Returns the relative file names written.
 */
export function regenerateIndustryDataFiles(
    projectRoot: string,
    entries: IndustryDataSnapshot,
): { written: string[] } {
    const dir = path.join(projectRoot, "config", "industry-data");
    fs.mkdirSync(dir, { recursive: true });

    const files: Record<string, string> = {
        "brands.json": renderBrandsJson(entries.brands),
        "keywords-structured.md": renderKeywordsStructuredMd({
            companies: entries.companies,
            keywords: entries.keywords,
            brands: entries.brands,
        }),
        "company-urls.md": renderCompanyUrlsMd(entries.companyUrls),
    };

    const written: string[] = [];
    for (const [name, content] of Object.entries(files)) {
        fs.writeFileSync(path.join(dir, name), content, "utf-8");
        written.push(name);
    }
    return { written };
}

export type ExecGit = (args: string[], cwd: string) => string;

const defaultExecGit: ExecGit = (args, cwd) =>
    execSync(`git ${args.map((a) => `'${a.replace(/'/g, "'\\''")}'`).join(" ")}`, {
        cwd,
        encoding: "utf-8",
        stdio: ["ignore", "pipe", "pipe"],
    });

export interface CommitDeps {
    execGit?: ExecGit;
}

/**
 * Best-effort git add + commit of the generated files. Returns the new HEAD sha, or
 * `{ sha: null, warning }` on any git failure. Never throws.
 */
export function commitIndustryDataFiles(
    projectRoot: string,
    actor: string,
    deps: CommitDeps = {},
): { sha: string | null; warning?: string } {
    const execGit = deps.execGit ?? defaultExecGit;
    try {
        execGit(["add", "config/industry-data"], projectRoot);
        execGit(
            ["commit", "-m", `chore(industry-data): regenerate from admin (${actor})`],
            projectRoot,
        );
        const sha = execGit(["rev-parse", "HEAD"], projectRoot).trim();
        return { sha: sha || null };
    } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return { sha: null, warning: `git commit failed: ${message}` };
    }
}

/** Regenerate files then best-effort commit. */
export function regenerateAndCommit(
    projectRoot: string,
    actor: string,
    entries: IndustryDataSnapshot,
    deps: CommitDeps = {},
): { sha: string | null; warning?: string; written: string[] } {
    const { written } = regenerateIndustryDataFiles(projectRoot, entries);
    const { sha, warning } = commitIndustryDataFiles(projectRoot, actor, deps);
    return { sha, warning, written };
}
