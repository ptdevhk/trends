import { describe, expect, it } from "vitest";

import { searchWithTagExpansionPaginated } from "../resumes";

type ConvexHandler<TArgs, TResult> = {
  _handler: (ctx: unknown, args: TArgs) => Promise<TResult>;
};

type SearchPaginatedArgs = {
  paginationOpts: { cursor: string | null; numItems: number };
  query: string;
  keywordGroups: Array<{ original: string; variants: string[] }>;
  mode?: "AND" | "OR";
  sourceMappings?: Array<{ term: string; expandedFrom: string }>;
  minExperience?: number;
  maxExperience?: number;
  minRoleYears?: number;
  roleFilterType?: string;
  skills?: string[];
  requiredKeywords?: string[];
  locations?: string[];
  sources?: string[];
  minSalary?: number;
  maxSalary?: number;
};

type SearchPaginatedResult = {
  page: unknown[];
  continueCursor: string;
  isDone: boolean;
};

const searchPaginatedHandler = (
  searchWithTagExpansionPaginated as unknown as ConvexHandler<SearchPaginatedArgs, SearchPaginatedResult>
)._handler;

function buildSeekResumeDoc(id: string, experience: string, expectedSalary?: string) {
    return {
        _id: id,
        externalId: `seek:${id}`,
        source: "seek",
        tags: [],
        crawledAt: Date.now(),
        content: {
            name: id,
            experience,
            ...(expectedSalary !== undefined ? { expectedSalary } : {}),
            workHistory: [
                { company: "Test Co", title: "Sales", years: "?" },
            ],
        },
        searchText: "cnc sales malaysia",
        ingestData: {
            industryTags: ["cnc", "sales"],
            experienceLevel: "mid",
            computedAt: 1,
            skillsVersion: 1,
            ruleScores: {},
        },
        primaryRuleScore: 50,
    };
}

function build51jobResumeDoc(id: string, experience: string) {
    return {
        _id: id,
        externalId: `51job:${id}`,
        source: "51job",
        tags: [],
        crawledAt: Date.now(),
        content: {
            name: id,
            experience,
        },
        searchText: "cnc sales china",
        ingestData: {
            industryTags: ["cnc", "sales"],
            experienceLevel: "junior",
            computedAt: 1,
            skillsVersion: 1,
            ruleScores: {},
        },
        primaryRuleScore: 50,
    };
}

function makeSearchCtx(resumes: unknown[]) {
    return {
        db: {
            query: () => ({
                withSearchIndex: () => {
                    const paginate = async (opts: { cursor: string | null; numItems: number }) => {
                        if (opts.cursor) {
                            return { page: [], continueCursor: "", isDone: true };
                        }
                        return { page: resumes, continueCursor: "", isDone: true };
                    };
                    return {
                        paginate,
                        filter: () => ({
                            take: async () => resumes,
                            paginate,
                        }),
                    };
                },
            }),
        },
    };
}

describe("minExperience filter graceful degradation", () => {
    it("resumes with empty experience pass minExperience filter (Seek data)", async () => {
        const resume = buildSeekResumeDoc("seek-1", "");
        const ctx = makeSearchCtx([resume]);

        const result = await searchPaginatedHandler(ctx, {
            paginationOpts: { cursor: null, numItems: 10 },
            query: "cnc sales",
            keywordGroups: [{ original: "cnc", variants: ["cnc"] }],
            minExperience: 1,
        });

        // After fix: empty experience is unknown, so minExperience filter is skipped
        expect(result.page).toHaveLength(1);
    });

    it("resumes with unparseable experience pass minExperience filter", async () => {
        const resume = buildSeekResumeDoc("seek-2", "?");
        const ctx = makeSearchCtx([resume]);

        const result = await searchPaginatedHandler(ctx, {
            paginationOpts: { cursor: null, numItems: 10 },
            query: "cnc sales",
            keywordGroups: [{ original: "cnc", variants: ["cnc"] }],
            minExperience: 1,
        });

        expect(result.page).toHaveLength(1);
    });

    it("resumes with known low experience are still excluded by minExperience", async () => {
        const resume = build51jobResumeDoc("51job-1", "应届");
        const ctx = makeSearchCtx([resume]);

        const result = await searchPaginatedHandler(ctx, {
            paginationOpts: { cursor: null, numItems: 10 },
            query: "cnc sales",
            keywordGroups: [{ original: "cnc", variants: ["cnc"] }],
            minExperience: 1,
        });

        // "应届" parses to 0, which is below minExperience: 1 → excluded
        expect(result.page).toHaveLength(0);
    });

    it("resumes with unknown experience are excluded by maxExperience", async () => {
        const resume = buildSeekResumeDoc("seek-3", "");
        const ctx = makeSearchCtx([resume]);

        const result = await searchPaginatedHandler(ctx, {
            paginationOpts: { cursor: null, numItems: 10 },
            query: "cnc sales",
            keywordGroups: [{ original: "cnc", variants: ["cnc"] }],
            maxExperience: 5,
        });

        // Unknown experience + maxExperience → excluded (cannot guarantee cap)
        expect(result.page).toHaveLength(0);
    });

    it("resumes with known high experience pass minExperience", async () => {
        const resume = build51jobResumeDoc("51job-2", "5");
        const ctx = makeSearchCtx([resume]);

        const result = await searchPaginatedHandler(ctx, {
            paginationOpts: { cursor: null, numItems: 10 },
            query: "cnc sales",
            keywordGroups: [{ original: "cnc", variants: ["cnc"] }],
            minExperience: 1,
        });

        expect(result.page).toHaveLength(1);
    });
});

describe("salary filter graceful degradation", () => {
    it("resumes with empty salary pass minSalary filter (Seek data)", async () => {
        const resume = buildSeekResumeDoc("seek-sal-1", "", "");
        const ctx = makeSearchCtx([resume]);

        const result = await searchPaginatedHandler(ctx, {
            paginationOpts: { cursor: null, numItems: 10 },
            query: "cnc sales",
            keywordGroups: [{ original: "cnc", variants: ["cnc"] }],
            minSalary: 5000,
        });

        // Unknown salary + minSalary → passes through (might meet the minimum)
        expect(result.page).toHaveLength(1);
    });

    it("resumes with unknown salary are excluded by maxSalary", async () => {
        const resume = buildSeekResumeDoc("seek-sal-2", "", "");
        const ctx = makeSearchCtx([resume]);

        const result = await searchPaginatedHandler(ctx, {
            paginationOpts: { cursor: null, numItems: 10 },
            query: "cnc sales",
            keywordGroups: [{ original: "cnc", variants: ["cnc"] }],
            maxSalary: 10000,
        });

        // Unknown salary + maxSalary → excluded (cannot guarantee cap)
        expect(result.page).toHaveLength(0);
    });

    it("resumes with known salary are filtered correctly", async () => {
        const resume = buildSeekResumeDoc("seek-sal-3", "5", "3000-5000");
        const ctx = makeSearchCtx([resume]);

        const result = await searchPaginatedHandler(ctx, {
            paginationOpts: { cursor: null, numItems: 10 },
            query: "cnc sales",
            keywordGroups: [{ original: "cnc", variants: ["cnc"] }],
            minSalary: 6000,
        });

        // Known salary 5000 < minSalary 6000 → excluded
        expect(result.page).toHaveLength(0);
    });
});

describe("skills filter uses full searchText", () => {
    it("matches skills from full searchText, not just narrow buildResumeFilterSearchText", async () => {
        // Skill "fanuc" appears in searchText but NOT in name/education/latest-workHistory
        const resume = {
            _id: "seek-skill-1",
            externalId: "seek:skill1",
            source: "seek",
            tags: [],
            crawledAt: Date.now(),
            content: {
                name: "Alice",
                experience: "",
                education: "Bachelor",
                workHistory: [{ company: "Test Co", title: "Sales", years: "?" }],
            },
            searchText: "alice sales fanuc cnc malaysia", // fanuc is here
            ingestData: {
                industryTags: ["cnc", "sales"],
                experienceLevel: "mid",
                computedAt: 1,
                skillsVersion: 1,
                ruleScores: {},
            },
            primaryRuleScore: 50,
        };
        const ctx = makeSearchCtx([resume]);

        const result = await searchPaginatedHandler(ctx, {
            paginationOpts: { cursor: null, numItems: 10 },
            query: "cnc sales",
            keywordGroups: [{ original: "cnc", variants: ["cnc"] }],
            skills: ["fanuc"],
        });

        // "fanuc" is in searchText but not in name/edu/latest WH → should still match
        expect(result.page).toHaveLength(1);
    });

    it("excludes resumes without matching skills in searchText", async () => {
        const resume = buildSeekResumeDoc("seek-skill-2", "");
        const ctx = makeSearchCtx([resume]);

        const result = await searchPaginatedHandler(ctx, {
            paginationOpts: { cursor: null, numItems: 10 },
            query: "cnc sales",
            keywordGroups: [{ original: "cnc", variants: ["cnc"] }],
            skills: ["mazak"],
        });

        // "mazak" not in searchText → excluded
        expect(result.page).toHaveLength(0);
    });
});

describe("requiredKeywords filter uses full searchText", () => {
    it("matches required keywords from full searchText", async () => {
        const resume = {
            _id: "seek-kw-1",
            externalId: "seek:kw1",
            source: "seek",
            tags: [],
            crawledAt: Date.now(),
            content: {
                name: "Bob",
                experience: "",
                education: "Diploma",
                workHistory: [{ company: "Mfg Co", title: "Engineer", years: "?" }],
            },
            searchText: "bob engineer machine tools cnc malaysia", // "machine tools" as phrase
            ingestData: {
                industryTags: ["cnc"],
                experienceLevel: "mid",
                computedAt: 1,
                skillsVersion: 1,
                ruleScores: {},
            },
            primaryRuleScore: 50,
        };
        const ctx = makeSearchCtx([resume]);

        const result = await searchPaginatedHandler(ctx, {
            paginationOpts: { cursor: null, numItems: 10 },
            query: "cnc",
            keywordGroups: [{ original: "cnc", variants: ["cnc"] }],
            requiredKeywords: ["machine tools"],
        });

        // "machine tools" is in searchText but not in narrow buildResumeFilterSearchText → should still match
        expect(result.page).toHaveLength(1);
    });

    it("excludes resumes missing required keywords in searchText", async () => {
        const resume = buildSeekResumeDoc("seek-kw-2", "");
        const ctx = makeSearchCtx([resume]);

        const result = await searchPaginatedHandler(ctx, {
            paginationOpts: { cursor: null, numItems: 10 },
            query: "cnc sales",
            keywordGroups: [{ original: "cnc", variants: ["cnc"] }],
            requiredKeywords: ["machine tools"],
        });

        // "machine tools" not in searchText → excluded
        expect(result.page).toHaveLength(0);
    });
});
