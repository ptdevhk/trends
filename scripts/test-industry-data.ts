#!/usr/bin/env npx tsx
/**
 * Test script for IndustryDataService
 * Run with: npx tsx scripts/test-industry-data.ts
 */

import path from "node:path";

// Simple mock for findProjectRoot since we're running from project root
const projectRoot = process.cwd();

// Inline the service loading to avoid ESM issues
import fs from "node:fs";

interface CompanyEntry {
    id: number;
    nameCn: string;
    nameEn?: string;
    type: string;
    category: "key_company" | "ites_exhibitor" | "agent";
}

interface KeywordEntry {
    id: number;
    keyword: string;
    english?: string;
    category: string;
}

interface BrandEntry {
    id: number;
    nameCn: string;
    nameEn?: string;
    type: string;
    origin: string;
}

function parseMarkdownTable(tableLines: string[]): Record<string, string>[] {
    if (tableLines.length < 3) return [];

    const headerLine = tableLines[0];
    const headers = headerLine
        .split("|")
        .map((h) => h.trim())
        .filter(Boolean);

    const dataRows = tableLines.slice(2);

    return dataRows.map((row) => {
        const cells = row
            .split("|")
            .map((c) => c.trim())
            .filter((_, i) => i > 0);

        const record: Record<string, string> = {};
        headers.forEach((header, i) => {
            record[header] = cells[i]?.trim() || "";
        });
        return record;
    });
}

function extractTablesFromMarkdown(content: string): { section: string; rows: Record<string, string>[] }[] {
    const lines = content.split("\n");
    const sections: { section: string; rows: Record<string, string>[] }[] = [];

    let currentSection = "";
    const headingStack: Array<string | undefined> = [];
    let tableLines: string[] = [];
    let inTable = false;

    for (const line of lines) {
        const headingMatch = line.match(/^(#{2,6})\s+(.*)$/);
        if (headingMatch) {
            if (tableLines.length > 0) {
                sections.push({ section: currentSection, rows: parseMarkdownTable(tableLines) });
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
            inTable = true;
            tableLines.push(line);
        } else if (inTable && line.includes("|")) {
            tableLines.push(line);
        } else if (inTable && !line.includes("|")) {
            if (tableLines.length > 0) {
                sections.push({ section: currentSection, rows: parseMarkdownTable(tableLines) });
                tableLines = [];
            }
            inTable = false;
        }
    }

    if (tableLines.length > 0) {
        sections.push({ section: currentSection, rows: parseMarkdownTable(tableLines) });
    }

    return sections;
}

// Main test
console.log("=".repeat(60));
console.log("Industry Data Service Test");
console.log("=".repeat(60));

const industryDataDir = path.join(projectRoot, "config", "industry-data");
const structuredPath = path.join(industryDataDir, "keywords-structured.md");
const urlsPath = path.join(industryDataDir, "company-urls.md");

console.log("\n📁 Files Check:");
console.log(`  - keywords-structured.md: ${fs.existsSync(structuredPath) ? "✅ Found" : "❌ Missing"}`);
console.log(`  - company-urls.md: ${fs.existsSync(urlsPath) ? "✅ Found" : "❌ Missing"}`);

if (!fs.existsSync(structuredPath)) {
    console.error("❌ keywords-structured.md not found!");
    process.exit(1);
}

const content = fs.readFileSync(structuredPath, "utf-8");
const sections = extractTablesFromMarkdown(content);

console.log(`\n📊 Tables Found: ${sections.length}`);

// Count entities by section pattern
let companies = 0;
let keywords = 0;
let brands = 0;

for (const { section, rows } of sections) {
    if (section.includes("重点企业") || section.includes("Key Companies")) {
        companies += rows.length;
        console.log(`  - Key Companies: ${rows.length} rows`);
    } else if (section.includes("ITES") || section.includes("参展商") || section.includes("金属切削") || section.includes("其他展品")) {
        companies += rows.length;
        console.log(`  - ITES "${section.split(" / ").pop()}": ${rows.length} rows`);
    } else if (section.includes("代理商") || section.includes("Agent")) {
        companies += rows.length;
        console.log(`  - Agents "${section.split(" / ").pop()}": ${rows.length} rows`);
    } else if (section.includes("关键词") || section.includes("Keyword") || section.includes("加工中心相关") || section.includes("车床相关") || section.includes("火花机") || section.includes("三坐标") || section.includes("SMT") || section.includes("3D打印")) {
        keywords += rows.length;
        console.log(`  - Keywords "${section.split(" / ").pop()}": ${rows.length} rows`);
    } else if ((section.includes("品牌") || section.includes("Brand")) && !section.includes("代理商")) {
        brands += rows.length;
        console.log(`  - Brands "${section.split(" / ").pop()}": ${rows.length} rows`);
    }
}

console.log("\n📈 Summary:");
console.log(`  - Total Companies: ${companies}`);
console.log(`  - Total Keywords: ${keywords}`);
console.log(`  - Total Brands: ${brands}`);
console.log(`  - Total Entities: ${companies + keywords + brands}`);

// Load company URLs
if (fs.existsSync(urlsPath)) {
    const urlContent = fs.readFileSync(urlsPath, "utf-8");
    const urls = urlContent.split("\n").filter(l => l.startsWith("http"));
    console.log(`  - Company URLs: ${urls.length}`);
}

// Format validation
console.log("\n🔍 Format Validation:");
let issues = 0;
for (const { section, rows } of sections) {
    for (let i = 0; i < rows.length; i++) {
        const row = rows[i];
        const id = row["ID"];
        const name = row["公司名称 (Company Name)"] || row["公司名称"] || row["代理商名称 (Agent Name)"] || row["关键词 (Keyword)"] || row["品牌名称 (Brand Name)"] || "";

        // Check ID is numeric
        if (id && !/^\d+$/.test(id)) {
            console.log(`  ⚠️ [${section}] Row ${i + 1}: ID "${id}" is not numeric`);
            issues++;
        }

        // Check name is not empty (for most tables)
        if (!name && rows.length > 0) {
            // Only warn for tables that should have names
            const keys = Object.keys(row);
            if (keys.some(k => k.includes("名称") || k.includes("Name"))) {
                console.log(`  ⚠️ [${section}] Row ${i + 1}: Name is empty`);
                issues++;
            }
        }
    }
}

if (issues === 0) {
    console.log("  ✅ No format issues found");
} else {
    console.log(`  ⚠️ Found ${issues} issues`);
}

// Test verification
console.log("\n🔬 Verification Tests:");
const testCompanies = ["东源精密机械", "山崎马扎克", "不存在的公司"];
for (const name of testCompanies) {
    const found = sections.some(({ rows }) =>
        rows.some(r =>
            Object.values(r).some(v => v.includes(name))
        )
    );
    console.log(`  - "${name}": ${found ? "✅ Found" : "❌ Not found"}`);
}

const testKeywords = ["加工中心", "车床", "CMM"];
for (const kw of testKeywords) {
    const found = sections.some(({ rows }) =>
        rows.some(r =>
            Object.values(r).some(v => v.includes(kw))
        )
    );
    console.log(`  - Keyword "${kw}": ${found ? "✅ Found" : "❌ Not found"}`);
}

const testBrands = ["MAZAK", "FANUC", "蔡司"];
for (const brand of testBrands) {
    const found = sections.some(({ rows }) =>
        rows.some(r =>
            Object.values(r).some(v => v.toLowerCase().includes(brand.toLowerCase()))
        )
    );
    console.log(`  - Brand "${brand}": ${found ? "✅ Found" : "❌ Not found"}`);
}

console.log("\n" + "=".repeat(60));
console.log("✅ Test Complete");
console.log("=".repeat(60));
