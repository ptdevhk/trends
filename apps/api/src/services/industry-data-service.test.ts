import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { IndustryDataService } from "./industry-data-service";

const fixtureMarkdown = `
# Industry Data

## 1. Key Companies (Key Companies)

| ID | 公司名称 (Company Name) | 英文名称 (English Name) | 类型 (Type) |
|----|------------------------|------------------------|-------------|
| 1 | Core Machines Co | | |

## 2. ITES Shenzhen Industrial Exhibition Exhibitors

### 2.1 Metal Cutting Machine Tools

| ID | 公司名称 (Company Name) | 英文名称 (English Name) | 类型 (Type) |
|----|------------------------|------------------------|-------------|
| 1 | Test Exhibitor Co | | Metal Cutting |
`;

const createFixtureRoot = (): string => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "industry-data-service-"));
    const dataDir = path.join(root, "config", "industry-data");
    fs.mkdirSync(dataDir, { recursive: true });
    fs.writeFileSync(path.join(dataDir, "keywords-structured.md"), fixtureMarkdown);
    return root;
};

const cleanupFixtureRoot = (root: string): void => {
    fs.rmSync(root, { recursive: true, force: true });
};

describe("IndustryDataService", () => {
    it("loads ITES exhibitors from subsections", () => {
        const root = createFixtureRoot();
        try {
            const service = new IndustryDataService(root);
            const companies = service.loadCompanies();
            const exhibitors = companies.filter((company) => company.category === "ites_exhibitor");

            expect(exhibitors.map((company) => company.nameCn)).toContain("Test Exhibitor Co");
        } finally {
            cleanupFixtureRoot(root);
        }
    });

    it("does not verify empty company names", () => {
        const root = createFixtureRoot();
        try {
            const service = new IndustryDataService(root);
            const result = service.verifyCompany("   ");

            expect(result.verified).toBe(false);
            expect(result.confidence).toBe(0);
        } finally {
            cleanupFixtureRoot(root);
        }
    });
});
