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
| 1 | 北京精雕科技集团有限公司 | JINGDIAO | key_company |
| 2 | 上海发那科机器人有限公司 | FANUC | key_company |
| 3 | 秦川机床集团股份公司 | QINCHUAN | key_company |
| 4 | 润星科技集团 | RUNXING | key_company |
| 5 | 泽钿精密 | | key_company |
| 6 | 宝力机械有限公司 | | key_company |

## 2. ITES Shenzhen Industrial Exhibition Exhibitors

### 2.1 Metal Cutting Machine Tools

| ID | 公司名称 (Company Name) | 英文名称 (English Name) | 类型 (Type) |
|----|------------------------|------------------------|-------------|
| 1 | Test Exhibitor Co | | Metal Cutting |

## 4.3 Import Agents

### 4.3.1 Measurement Agents

| ID | 代理商名称 (Agent Name) | 英文名称 (English Name) | 类型 (Type) |
|----|------------------------|------------------------|-------------|
| 1 | 秦川 | | 测量扫描代理 |
| 2 | 润星 | | 测量扫描代理 |
| 3 | 思瑞 | | 测量扫描代理 |
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

    it("rejects ambiguous short-fragment partial matches for longer employer names", () => {
        const root = createFixtureRoot();
        try {
            const service = new IndustryDataService(root);

            expect(service.verifyCompany("东莞市秦川电力设备有限公司")).toMatchObject({
                verified: false,
            });
            expect(service.verifyCompany("珠海润星泰电器有限公司")).toMatchObject({
                verified: false,
            });
            expect(service.verifyCompany("岑巩县思瑞高级中学")).toMatchObject({
                verified: false,
            });
        } finally {
            cleanupFixtureRoot(root);
        }
    });

    it("matches real companies after stripping city prefixes and legal suffixes", () => {
        const root = createFixtureRoot();
        try {
            const service = new IndustryDataService(root);

            expect(service.verifyCompany("东莞市泽钿精密机械有限公司")).toMatchObject({
                verified: true,
                confidence: 0.7,
                match: expect.objectContaining({
                    nameCn: "泽钿精密",
                }),
            });
            expect(service.verifyCompany("东莞市宝力机械科技有限公司")).toMatchObject({
                verified: true,
                confidence: 0.7,
                match: expect.objectContaining({
                    nameCn: "宝力机械有限公司",
                }),
            });
        } finally {
            cleanupFixtureRoot(root);
        }
    });


    it("keeps exact and qualified near-exact matches for known companies", () => {
        const root = createFixtureRoot();
        try {
            const service = new IndustryDataService(root);

            expect(service.verifyCompany("北京精雕科技集团有限公司")).toMatchObject({
                verified: true,
                confidence: 1,
                match: expect.objectContaining({
                    nameCn: "北京精雕科技集团有限公司",
                }),
            });
            expect(service.verifyCompany("秦川机床集团")).toMatchObject({
                verified: true,
                confidence: 0.7,
                match: expect.objectContaining({
                    nameCn: "秦川机床集团股份公司",
                }),
            });
        } finally {
            cleanupFixtureRoot(root);
        }
    });
});
