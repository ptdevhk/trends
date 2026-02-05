import fs from "node:fs";
import path from "node:path";

import { findProjectRoot } from "./db.js";

// Type definitions
export interface CompanyEntry {
    id: number;
    nameCn: string;
    nameEn?: string;
    type: string;
    category: "key_company" | "ites_exhibitor" | "agent";
}

export interface KeywordEntry {
    id: number;
    keyword: string;
    english?: string;
    category: "machining" | "lathe" | "edm" | "measurement" | "smt" | "3d_printing";
}

export interface BrandEntry {
    id: number;
    nameCn: string;
    nameEn?: string;
    type: string;
    origin: "international" | "domestic" | "agent";
}

export interface VerificationResult {
    verified: boolean;
    confidence: number;
    match?: CompanyEntry | KeywordEntry | BrandEntry;
    matches?: Array<CompanyEntry | KeywordEntry | BrandEntry>;
}

export interface IndustryData {
    companies: CompanyEntry[];
    keywords: KeywordEntry[];
    brands: BrandEntry[];
    companyUrls: string[];
    metadata: {
        loadedAt: string;
        companiesCount: number;
        keywordsCount: number;
        brandsCount: number;
    };
}

/**
 * Parse a markdown table into an array of records
 */
function parseMarkdownTable(tableLines: string[]): Record<string, string>[] {
    if (tableLines.length < 3) return []; // Need header, separator, and at least one row

    const headerLine = tableLines[0];
    const headers = headerLine
        .split("|")
        .map((h) => h.trim())
        .filter(Boolean);

    // Skip separator line (index 1)
    const dataRows = tableLines.slice(2);

    return dataRows.map((row) => {
        const cells = row
            .split("|")
            .map((c) => c.trim())
            .filter((_, i) => i > 0); // Skip first empty cell from leading |

        const record: Record<string, string> = {};
        headers.forEach((header, i) => {
            record[header] = cells[i]?.trim() || "";
        });
        return record;
    });
}

/**
 * Extract tables from markdown content by section
 */
function extractTablesFromMarkdown(content: string): {
    section: string;
    rows: Record<string, string>[];
}[] {
    const lines = content.split("\n");
    const sections: { section: string; rows: Record<string, string>[] }[] = [];

    let currentSection = "";
    const headingStack: Array<string | undefined> = [];
    let tableLines: string[] = [];
    let inTable = false;

    for (const line of lines) {
        // Track section headers
        const headingMatch = line.match(/^(#{2,6})\s+(.*)$/);
        if (headingMatch) {
            // Save previous table if exists
            if (tableLines.length > 0) {
                sections.push({
                    section: currentSection,
                    rows: parseMarkdownTable(tableLines),
                });
                tableLines = [];
            }
            const level = headingMatch[1].length;
            const title = headingMatch[2].trim();
            headingStack[level] = title;
            for (let i = level + 1; i < headingStack.length; i += 1) {
                headingStack[i] = undefined;
            }
            const parts: string[] = [];
            for (let i = 2; i < headingStack.length; i += 1) {
                const part = headingStack[i];
                if (part) parts.push(part);
            }
            currentSection = parts.join(" / ");
            inTable = false;
        }
        // Detect table start
        else if (line.includes("|") && line.trim().startsWith("|")) {
            inTable = true;
            tableLines.push(line);
        }
        // Continue table
        else if (inTable && line.includes("|")) {
            tableLines.push(line);
        }
        // End of table
        else if (inTable && !line.includes("|")) {
            if (tableLines.length > 0) {
                sections.push({
                    section: currentSection,
                    rows: parseMarkdownTable(tableLines),
                });
                tableLines = [];
            }
            inTable = false;
        }
    }

    // Don't forget last table
    if (tableLines.length > 0) {
        sections.push({
            section: currentSection,
            rows: parseMarkdownTable(tableLines),
        });
    }

    return sections;
}

/**
 * Map category string to type
 */
function mapKeywordCategory(
    sectionName: string
): KeywordEntry["category"] {
    const lower = sectionName.toLowerCase();
    if (lower.includes("加工中心") || lower.includes("machining")) return "machining";
    if (lower.includes("车床") || lower.includes("lathe")) return "lathe";
    if (lower.includes("火花") || lower.includes("edm") || lower.includes("线切割")) return "edm";
    if (lower.includes("测量") || lower.includes("扫描") || lower.includes("cmm") || lower.includes("measurement")) return "measurement";
    if (lower.includes("smt")) return "smt";
    if (lower.includes("3d") || lower.includes("打印")) return "3d_printing";
    return "machining"; // default
}

/**
 * Map brand origin from section name
 */
function mapBrandOrigin(sectionName: string): BrandEntry["origin"] {
    const lower = sectionName.toLowerCase();
    if (lower.includes("国际") || lower.includes("international")) return "international";
    if (lower.includes("国产") || lower.includes("domestic")) return "domestic";
    if (lower.includes("代理") || lower.includes("agent")) return "agent";
    return "international"; // default
}

export class IndustryDataService {
    private readonly projectRoot: string;
    private cachedData: IndustryData | null = null;

    constructor(projectRoot?: string) {
        this.projectRoot = projectRoot ? path.resolve(projectRoot) : findProjectRoot();
    }

    private getIndustryDataDir(): string {
        return path.join(this.projectRoot, "config", "industry-data");
    }

    /**
     * Load all industry data from config files
     */
    loadAll(): IndustryData {
        if (this.cachedData) return this.cachedData;

        const companies = this.loadCompanies();
        const keywords = this.loadKeywords();
        const brands = this.loadBrands();
        const companyUrls = this.loadCompanyUrls();

        this.cachedData = {
            companies,
            keywords,
            brands,
            companyUrls,
            metadata: {
                loadedAt: new Date().toISOString(),
                companiesCount: companies.length,
                keywordsCount: keywords.length,
                brandsCount: brands.length,
            },
        };

        return this.cachedData;
    }

    /**
     * Load companies from structured markdown
     */
    loadCompanies(): CompanyEntry[] {
        const filePath = path.join(this.getIndustryDataDir(), "keywords-structured.md");
        if (!fs.existsSync(filePath)) return [];

        const content = fs.readFileSync(filePath, "utf-8");
        const sections = extractTablesFromMarkdown(content);
        const companies: CompanyEntry[] = [];

        for (const { section, rows } of sections) {
            // Section 1: Key Companies
            if (section.includes("重点企业") || section.includes("Key Companies")) {
                for (const row of rows) {
                    const id = parseInt(row["ID"] || "0", 10);
                    const nameCn = row["公司名称 (Company Name)"] || row["公司名称"] || "";
                    const nameEn = row["英文名称 (English Name)"] || row["英文名称"] || "";
                    const type = row["类型 (Type)"] || row["类型"] || "key_company";

                    if (nameCn) {
                        companies.push({
                            id,
                            nameCn,
                            nameEn: nameEn || undefined,
                            type: type || "key_company",
                            category: "key_company",
                        });
                    }
                }
            }
            // Section 2: ITES Exhibitors
            else if (section.includes("ITES") || section.includes("参展商")) {
                for (const row of rows) {
                    const id = parseInt(row["ID"] || "0", 10);
                    const nameCn = row["公司名称 (Company Name)"] || row["公司名称"] || "";
                    const nameEn = row["英文名称 (English Name)"] || row["英文名称"] || "";
                    const type = row["类型 (Type)"] || row["展品类别 (Category)"] || row["类型"] || "ites_exhibitor";

                    if (nameCn) {
                        companies.push({
                            id: companies.length + 1, // Renumber to avoid duplicates
                            nameCn,
                            nameEn: nameEn || undefined,
                            type,
                            category: "ites_exhibitor",
                        });
                    }
                }
            }
            // Section 4.3: Import Agents
            else if (section.includes("代理商") || section.includes("Agent")) {
                for (const row of rows) {
                    const id = parseInt(row["ID"] || "0", 10);
                    const nameCn = row["代理商名称 (Agent Name)"] || row["代理商名称"] || "";
                    const nameEn = row["英文名称 (English Name)"] || row["英文名称"] || "";
                    const type = row["类型 (Type)"] || row["类型"] || "agent";

                    if (nameCn) {
                        companies.push({
                            id: companies.length + 1,
                            nameCn,
                            nameEn: nameEn || undefined,
                            type,
                            category: "agent",
                        });
                    }
                }
            }
        }

        return companies;
    }

    /**
     * Load keywords from structured markdown
     */
    loadKeywords(): KeywordEntry[] {
        const filePath = path.join(this.getIndustryDataDir(), "keywords-structured.md");
        if (!fs.existsSync(filePath)) return [];

        const content = fs.readFileSync(filePath, "utf-8");
        const sections = extractTablesFromMarkdown(content);
        const keywords: KeywordEntry[] = [];

        for (const { section, rows } of sections) {
            // Section 3: Keywords
            if (
                section.includes("关键词") ||
                section.includes("Keyword") ||
                section.includes("加工中心相关") ||
                section.includes("车床相关") ||
                section.includes("火花机") ||
                section.includes("三坐标") ||
                section.includes("SMT") ||
                section.includes("3D打印")
            ) {
                const category = mapKeywordCategory(section);

                for (const row of rows) {
                    const id = parseInt(row["ID"] || "0", 10);
                    const keyword = row["关键词 (Keyword)"] || row["关键词"] || "";
                    const english = row["英文名称 (English Name)"] || row["英文名称"] || "";

                    if (keyword) {
                        keywords.push({
                            id,
                            keyword,
                            english: english || undefined,
                            category,
                        });
                    }
                }
            }
        }

        return keywords;
    }

    /**
     * Load brands from structured markdown
     */
    loadBrands(): BrandEntry[] {
        const filePath = path.join(this.getIndustryDataDir(), "keywords-structured.md");
        if (!fs.existsSync(filePath)) return [];

        const content = fs.readFileSync(filePath, "utf-8");
        const sections = extractTablesFromMarkdown(content);
        const brands: BrandEntry[] = [];

        for (const { section, rows } of sections) {
            // Section 4: Brands (but not agents section)
            if (
                (section.includes("品牌") || section.includes("Brand")) &&
                !section.includes("代理商") &&
                !section.includes("Agent")
            ) {
                const origin = mapBrandOrigin(section);

                for (const row of rows) {
                    const id = parseInt(row["ID"] || "0", 10);
                    const nameCn = row["品牌名称 (Brand Name)"] || row["品牌名称"] || "";
                    const nameEn = row["英文名称 (English Name)"] || row["英文名称"] || "";
                    const type = row["类型 (Type)"] || row["类型"] || "";

                    if (nameCn) {
                        brands.push({
                            id,
                            nameCn,
                            nameEn: nameEn || undefined,
                            type,
                            origin,
                        });
                    }
                }
            }
        }

        return brands;
    }

    /**
     * Load company URLs from markdown file
     */
    loadCompanyUrls(): string[] {
        const filePath = path.join(this.getIndustryDataDir(), "company-urls.md");
        if (!fs.existsSync(filePath)) return [];

        const content = fs.readFileSync(filePath, "utf-8");
        const lines = content.split("\n");

        return lines
            .map((line) => line.trim())
            .filter((line) => line.startsWith("http://") || line.startsWith("https://"));
    }

    /**
     * Verify a company name against known companies
     */
    verifyCompany(name: string): VerificationResult {
        const data = this.loadAll();
        if (!name || !name.trim()) {
            return { verified: false, confidence: 0.0 };
        }

        const normalizedName = name.toLowerCase().trim();

        // Exact match
        const exactMatch = data.companies.find(
            (c) =>
                c.nameCn.toLowerCase() === normalizedName ||
                (c.nameEn && c.nameEn.toLowerCase() === normalizedName)
        );

        if (exactMatch) {
            return { verified: true, confidence: 1.0, match: exactMatch };
        }

        // Partial match (contains)
        const partialMatches = data.companies.filter(
            (c) =>
                c.nameCn.toLowerCase().includes(normalizedName) ||
                normalizedName.includes(c.nameCn.toLowerCase()) ||
                (c.nameEn && c.nameEn.toLowerCase().includes(normalizedName))
        );

        if (partialMatches.length > 0) {
            return {
                verified: true,
                confidence: 0.7,
                match: partialMatches[0],
                matches: partialMatches,
            };
        }

        return { verified: false, confidence: 0.2 };
    }

    /**
     * Match keywords in text
     */
    matchKeywords(text: string, category?: KeywordEntry["category"]): KeywordEntry[] {
        const data = this.loadAll();
        const normalizedText = text.toLowerCase();

        return data.keywords.filter((k) => {
            if (category && k.category !== category) return false;

            return (
                normalizedText.includes(k.keyword.toLowerCase()) ||
                (k.english && normalizedText.includes(k.english.toLowerCase()))
            );
        });
    }

    /**
     * Match brands in text
     */
    matchBrands(text: string): BrandEntry[] {
        const data = this.loadAll();
        const normalizedText = text.toLowerCase();

        return data.brands.filter((b) => {
            return (
                normalizedText.includes(b.nameCn.toLowerCase()) ||
                (b.nameEn && normalizedText.includes(b.nameEn.toLowerCase()))
            );
        });
    }

    /**
     * Clear cache and reload data
     */
    reload(): IndustryData {
        this.cachedData = null;
        return this.loadAll();
    }

    /**
     * Get statistics about loaded data
     */
    getStats(): IndustryData["metadata"] {
        return this.loadAll().metadata;
    }

    /**
     * Validate markdown format and return issues
     */
    validateFormat(): {
        valid: boolean;
        issues: Array<{
            section: string;
            row: number;
            issue: string;
            severity: "error" | "warning";
        }>;
        stats: {
            totalTables: number;
            totalRows: number;
            tablesWithIssues: number;
        };
    } {
        const filePath = path.join(this.getIndustryDataDir(), "keywords-structured.md");
        if (!fs.existsSync(filePath)) {
            return {
                valid: false,
                issues: [{ section: "file", row: 0, issue: "File not found", severity: "error" }],
                stats: { totalTables: 0, totalRows: 0, tablesWithIssues: 0 },
            };
        }

        const content = fs.readFileSync(filePath, "utf-8");
        const lines = content.split("\n");
        const issues: Array<{ section: string; row: number; issue: string; severity: "error" | "warning" }> = [];

        let currentSection = "";
        const headingStack: Array<string | undefined> = [];
        let tableStartLine = 0;
        let tableLines: string[] = [];
        let inTable = false;
        let lineNum = 0;
        let totalTables = 0;
        let totalRows = 0;
        const tablesWithIssues = new Set<number>();

        const validateTable = (section: string, lines: string[], startLine: number) => {
            if (lines.length < 2) return;

            totalTables++;
            const headerLine = lines[0];
            const separatorLine = lines[1];
            const dataLines = lines.slice(2);

            // Count columns from header
            const headerCols = headerLine.split("|").filter((c) => c.trim()).length;

            // Validate separator
            const separatorCols = separatorLine.split("|").filter((c) => c.trim()).length;
            if (separatorCols !== headerCols) {
                issues.push({
                    section,
                    row: startLine + 2,
                    issue: `Separator has ${separatorCols} columns, header has ${headerCols}`,
                    severity: "error",
                });
                tablesWithIssues.add(totalTables);
            }

            // Check for standard 4-column format (ID, Name CN, Name EN, Type)
            if (headerCols < 3) {
                issues.push({
                    section,
                    row: startLine + 1,
                    issue: `Table has only ${headerCols} columns, expected at least 3 (ID, Name, Type)`,
                    severity: "warning",
                });
                tablesWithIssues.add(totalTables);
            }

            // Validate each data row
            dataLines.forEach((line, i) => {
                totalRows++;
                const dataCols = line.split("|").filter((c, idx) => idx > 0 && c.trim() !== "").length +
                    line.split("|").filter((c, idx) => idx > 0 && c.trim() === "").length;
                const actualCols = line.split("|").length - 1; // Exclude leading empty

                // Check column count consistency
                if (actualCols !== headerCols && actualCols !== headerCols + 1) {
                    issues.push({
                        section,
                        row: startLine + 3 + i,
                        issue: `Row has ${actualCols} columns, expected ${headerCols}`,
                        severity: "error",
                    });
                    tablesWithIssues.add(totalTables);
                }

                // Check for empty required fields (ID and Name)
                const cells = line.split("|").map((c) => c.trim()).filter((_, idx) => idx > 0);
                if (cells.length >= 2) {
                    // ID should be numeric
                    const id = cells[0];
                    if (id && !/^\d+$/.test(id)) {
                        issues.push({
                            section,
                            row: startLine + 3 + i,
                            issue: `ID "${id}" is not numeric`,
                            severity: "warning",
                        });
                    }

                    // Name should not be empty
                    const name = cells[1];
                    if (!name || name.trim() === "") {
                        issues.push({
                            section,
                            row: startLine + 3 + i,
                            issue: "Name column is empty",
                            severity: "error",
                        });
                        tablesWithIssues.add(totalTables);
                    }
                }
            });
        };

        for (const line of lines) {
            lineNum++;

            const headingMatch = line.match(/^(#{2,6})\s+(.*)$/);
            if (headingMatch) {
                if (tableLines.length > 0) {
                    validateTable(currentSection, tableLines, tableStartLine);
                    tableLines = [];
                }
                const level = headingMatch[1].length;
                const title = headingMatch[2].trim();
                headingStack[level] = title;
                for (let i = level + 1; i < headingStack.length; i += 1) {
                    headingStack[i] = undefined;
                }
                const parts: string[] = [];
                for (let i = 2; i < headingStack.length; i += 1) {
                    const part = headingStack[i];
                    if (part) parts.push(part);
                }
                currentSection = parts.join(" / ");
                inTable = false;
            } else if (line.includes("|") && line.trim().startsWith("|")) {
                if (!inTable) {
                    tableStartLine = lineNum;
                }
                inTable = true;
                tableLines.push(line);
            } else if (inTable && line.includes("|")) {
                tableLines.push(line);
            } else if (inTable && !line.includes("|")) {
                if (tableLines.length > 0) {
                    validateTable(currentSection, tableLines, tableStartLine);
                    tableLines = [];
                }
                inTable = false;
            }
        }

        // Validate last table
        if (tableLines.length > 0) {
            validateTable(currentSection, tableLines, tableStartLine);
        }

        return {
            valid: issues.filter((i) => i.severity === "error").length === 0,
            issues,
            stats: {
                totalTables,
                totalRows,
                tablesWithIssues: tablesWithIssues.size,
            },
        };
    }
}
