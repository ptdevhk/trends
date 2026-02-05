import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import { IndustryDataService } from "../services/industry-data-service.js";
import { config } from "../services/config.js";

const app = new OpenAPIHono();
const industryService = new IndustryDataService(config.projectRoot);

// Schemas
const CompanyEntrySchema = z.object({
    id: z.number(),
    nameCn: z.string(),
    nameEn: z.string().optional(),
    type: z.string(),
    category: z.enum(["key_company", "ites_exhibitor", "agent"]),
});

const KeywordEntrySchema = z.object({
    id: z.number(),
    keyword: z.string(),
    english: z.string().optional(),
    category: z.enum(["machining", "lathe", "edm", "measurement", "smt", "3d_printing"]),
});

const BrandEntrySchema = z.object({
    id: z.number(),
    nameCn: z.string(),
    nameEn: z.string().optional(),
    type: z.string(),
    origin: z.enum(["international", "domestic", "agent"]),
});

const StatsResponseSchema = z.object({
    success: z.literal(true),
    stats: z.object({
        loadedAt: z.string(),
        companiesCount: z.number(),
        keywordsCount: z.number(),
        brandsCount: z.number(),
    }),
});

const CompaniesResponseSchema = z.object({
    success: z.literal(true),
    count: z.number(),
    data: z.array(CompanyEntrySchema),
});

const KeywordsResponseSchema = z.object({
    success: z.literal(true),
    count: z.number(),
    data: z.array(KeywordEntrySchema),
});

const BrandsResponseSchema = z.object({
    success: z.literal(true),
    count: z.number(),
    data: z.array(BrandEntrySchema),
});

const VerifyRequestSchema = z.object({
    type: z.enum(["company", "keyword", "brand"]),
    value: z.string(),
    category: z.string().optional(),
});

const VerifyResponseSchema = z.object({
    success: z.literal(true),
    result: z.object({
        verified: z.boolean(),
        confidence: z.number(),
        match: z.any().optional(),
        matches: z.array(z.any()).optional(),
    }),
});

const ValidationResponseSchema = z.object({
    success: z.literal(true),
    valid: z.boolean(),
    issues: z.array(
        z.object({
            section: z.string(),
            row: z.number(),
            issue: z.string(),
            severity: z.enum(["error", "warning"]),
        })
    ),
    stats: z.object({
        totalTables: z.number(),
        totalRows: z.number(),
        tablesWithIssues: z.number(),
    }),
});

// GET /api/industry/stats
const statsRoute = createRoute({
    method: "get",
    path: "/api/industry/stats",
    tags: ["industry"],
    summary: "Get industry data statistics",
    description: "Returns counts of companies, keywords, and brands loaded from config",
    responses: {
        200: {
            content: { "application/json": { schema: StatsResponseSchema } },
            description: "Statistics about loaded industry data",
        },
    },
});

app.openapi(statsRoute, (c) => {
    const stats = industryService.getStats();
    return c.json({ success: true as const, stats }, 200);
});

// GET /api/industry/companies
const companiesRoute = createRoute({
    method: "get",
    path: "/api/industry/companies",
    tags: ["industry"],
    summary: "List all companies",
    description: "Returns all companies from industry data (key companies, ITES exhibitors, agents)",
    request: {
        query: z.object({
            category: z.enum(["key_company", "ites_exhibitor", "agent"]).optional(),
            q: z.string().optional(),
        }),
    },
    responses: {
        200: {
            content: { "application/json": { schema: CompaniesResponseSchema } },
            description: "List of companies",
        },
    },
});

app.openapi(companiesRoute, (c) => {
    const { category, q } = c.req.valid("query");
    let companies = industryService.loadCompanies();

    // Filter by category
    if (category) {
        companies = companies.filter((c) => c.category === category);
    }

    // Search by name
    if (q) {
        const query = q.toLowerCase();
        companies = companies.filter(
            (c) =>
                c.nameCn.toLowerCase().includes(query) ||
                (c.nameEn && c.nameEn.toLowerCase().includes(query))
        );
    }

    return c.json({ success: true as const, count: companies.length, data: companies }, 200);
});

// GET /api/industry/keywords
const keywordsRoute = createRoute({
    method: "get",
    path: "/api/industry/keywords",
    tags: ["industry"],
    summary: "List all keywords",
    description: "Returns all technical keywords organized by category",
    request: {
        query: z.object({
            category: z.enum(["machining", "lathe", "edm", "measurement", "smt", "3d_printing"]).optional(),
        }),
    },
    responses: {
        200: {
            content: { "application/json": { schema: KeywordsResponseSchema } },
            description: "List of keywords",
        },
    },
});

app.openapi(keywordsRoute, (c) => {
    const { category } = c.req.valid("query");
    let keywords = industryService.loadKeywords();

    if (category) {
        keywords = keywords.filter((k) => k.category === category);
    }

    return c.json({ success: true as const, count: keywords.length, data: keywords }, 200);
});

// GET /api/industry/brands
const brandsRoute = createRoute({
    method: "get",
    path: "/api/industry/brands",
    tags: ["industry"],
    summary: "List all brands",
    description: "Returns all equipment brands (international, domestic, agents)",
    request: {
        query: z.object({
            origin: z.enum(["international", "domestic", "agent"]).optional(),
        }),
    },
    responses: {
        200: {
            content: { "application/json": { schema: BrandsResponseSchema } },
            description: "List of brands",
        },
    },
});

app.openapi(brandsRoute, (c) => {
    const { origin } = c.req.valid("query");
    let brands = industryService.loadBrands();

    if (origin) {
        brands = brands.filter((b) => b.origin === origin);
    }

    return c.json({ success: true as const, count: brands.length, data: brands }, 200);
});

// POST /api/industry/verify
const verifyRoute = createRoute({
    method: "post",
    path: "/api/industry/verify",
    tags: ["industry"],
    summary: "Verify a company, keyword, or brand",
    description: "Check if a value matches known industry data and returns confidence score",
    request: {
        body: {
            content: { "application/json": { schema: VerifyRequestSchema } },
            required: true,
        },
    },
    responses: {
        200: {
            content: { "application/json": { schema: VerifyResponseSchema } },
            description: "Verification result with confidence and matches",
        },
    },
});

app.openapi(verifyRoute, async (c) => {
    const { type, value, category } = c.req.valid("json");

    let result;
    switch (type) {
        case "company":
            result = industryService.verifyCompany(value);
            break;
        case "keyword":
            const keywords = industryService.matchKeywords(
                value,
                category as "machining" | "lathe" | "edm" | "measurement" | "smt" | "3d_printing" | undefined
            );
            result = {
                verified: keywords.length > 0,
                confidence: keywords.length > 0 ? 1.0 : 0.2,
                matches: keywords,
            };
            break;
        case "brand":
            const brands = industryService.matchBrands(value);
            result = {
                verified: brands.length > 0,
                confidence: brands.length > 0 ? 1.0 : 0.2,
                matches: brands,
            };
            break;
    }

    return c.json({ success: true as const, result }, 200);
});

// GET /api/industry/validate
const validateRoute = createRoute({
    method: "get",
    path: "/api/industry/validate",
    tags: ["industry"],
    summary: "Validate markdown format",
    description: "Check the industry data markdown file for format issues",
    responses: {
        200: {
            content: { "application/json": { schema: ValidationResponseSchema } },
            description: "Validation results with any issues found",
        },
    },
});

app.openapi(validateRoute, (c) => {
    const validation = industryService.validateFormat();
    return c.json(
        {
            success: true as const,
            valid: validation.valid,
            issues: validation.issues,
            stats: validation.stats,
        },
        200
    );
});

// POST /api/industry/reload
const reloadRoute = createRoute({
    method: "post",
    path: "/api/industry/reload",
    tags: ["industry"],
    summary: "Reload industry data",
    description: "Clear cache and reload data from config files",
    responses: {
        200: {
            content: { "application/json": { schema: StatsResponseSchema } },
            description: "New statistics after reload",
        },
    },
});

app.openapi(reloadRoute, (c) => {
    const data = industryService.reload();
    return c.json({ success: true as const, stats: data.metadata }, 200);
});

export default app;
