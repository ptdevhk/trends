import { describe, expect, it } from "vitest";

import {
    DEFAULT_ANALYSIS_PARALLELISM,
    DEFAULT_SUBMIT_RESUME_PARALLELISM,
    MAX_ANALYSIS_PARALLELISM,
    MAX_SUBMIT_RESUME_PARALLELISM,
    resolveAnalysisParallelism,
    resolveSubmitResumeParallelism,
} from "../lib/parallelism";

type EnvCase = {
    name: string;
    env: Record<string, string | undefined>;
};

const analysisEnvCases: EnvCase[] = [
    { name: "unset", env: {} },
    { name: "non-numeric", env: { AI_ANALYSIS_PARALLELISM: "abc" } },
    { name: "1", env: { AI_ANALYSIS_PARALLELISM: "1" } },
    { name: "4", env: { AI_ANALYSIS_PARALLELISM: "4" } },
    { name: "8", env: { AI_ANALYSIS_PARALLELISM: "8" } },
    { name: "999", env: { AI_ANALYSIS_PARALLELISM: "999" } },
];

const submitEnvCases: EnvCase[] = [
    { name: "unset", env: {} },
    { name: "non-numeric", env: { SUBMIT_RESUME_PARALLELISM: "abc" } },
    { name: "1", env: { SUBMIT_RESUME_PARALLELISM: "1" } },
    { name: "4", env: { SUBMIT_RESUME_PARALLELISM: "4" } },
    { name: "8", env: { SUBMIT_RESUME_PARALLELISM: "8" } },
    { name: "999", env: { SUBMIT_RESUME_PARALLELISM: "999" } },
];

const workloads = [0, 1, 3, 10, 100];

describe("resolveAnalysisParallelism", () => {
    it("falls back to AI_PARALLELISM when AI_ANALYSIS_PARALLELISM is unset", () => {
        expect(resolveAnalysisParallelism(100, { AI_PARALLELISM: "6" })).toBe(6);
        expect(
            resolveAnalysisParallelism(100, {
                AI_ANALYSIS_PARALLELISM: "2",
                AI_PARALLELISM: "6",
            })
        ).toBe(2);
    });

    for (const envCase of analysisEnvCases) {
        it(`clamps and respects workload boundaries (${envCase.name})`, () => {
            let previous = 0;
            for (const workload of workloads) {
                const parallelism = resolveAnalysisParallelism(workload, envCase.env);
                expect(parallelism).toBeGreaterThanOrEqual(1);
                expect(parallelism).toBeLessThanOrEqual(MAX_ANALYSIS_PARALLELISM);
                if (workload > 0) {
                    expect(parallelism).toBeLessThanOrEqual(workload);
                }
                expect(parallelism).toBeGreaterThanOrEqual(previous);
                previous = parallelism;
            }
        });
    }
});

describe("resolveSubmitResumeParallelism", () => {
    it("uses defaults for missing or invalid values and caps to max", () => {
        expect(resolveSubmitResumeParallelism(100, {})).toBe(DEFAULT_SUBMIT_RESUME_PARALLELISM);
        expect(resolveSubmitResumeParallelism(100, { SUBMIT_RESUME_PARALLELISM: "abc" })).toBe(DEFAULT_SUBMIT_RESUME_PARALLELISM);
        expect(resolveSubmitResumeParallelism(100, { SUBMIT_RESUME_PARALLELISM: "0" })).toBe(DEFAULT_SUBMIT_RESUME_PARALLELISM);
        expect(resolveSubmitResumeParallelism(100, { SUBMIT_RESUME_PARALLELISM: "-3" })).toBe(DEFAULT_SUBMIT_RESUME_PARALLELISM);
        expect(resolveSubmitResumeParallelism(100, { SUBMIT_RESUME_PARALLELISM: "999" })).toBe(MAX_SUBMIT_RESUME_PARALLELISM);
    });

    for (const envCase of submitEnvCases) {
        it(`clamps and respects workload boundaries (${envCase.name})`, () => {
            let previous = 0;
            for (const workload of workloads) {
                const parallelism = resolveSubmitResumeParallelism(workload, envCase.env);
                expect(parallelism).toBeGreaterThanOrEqual(1);
                expect(parallelism).toBeLessThanOrEqual(MAX_SUBMIT_RESUME_PARALLELISM);
                if (workload > 0) {
                    expect(parallelism).toBeLessThanOrEqual(workload);
                }
                expect(parallelism).toBeGreaterThanOrEqual(previous);
                previous = parallelism;
            }
        });
    }
});

describe("parallelism resolver stress checks", () => {
    it("maintains bounded output under large workloads (analysis)", () => {
        let previous = 0;
        for (let workload = 0; workload <= 20000; workload += 101) {
            const parallelism = resolveAnalysisParallelism(workload, { AI_ANALYSIS_PARALLELISM: "999" });
            expect(parallelism).toBeGreaterThanOrEqual(1);
            expect(parallelism).toBeLessThanOrEqual(MAX_ANALYSIS_PARALLELISM);
            if (workload > 0) {
                expect(parallelism).toBeLessThanOrEqual(workload);
            }
            expect(parallelism).toBeGreaterThanOrEqual(previous);
            previous = parallelism;
        }
    });

    it("maintains bounded output under large workloads (submit)", () => {
        let previous = 0;
        for (let workload = 0; workload <= 20000; workload += 101) {
            const parallelism = resolveSubmitResumeParallelism(workload, { SUBMIT_RESUME_PARALLELISM: "999" });
            expect(parallelism).toBeGreaterThanOrEqual(1);
            expect(parallelism).toBeLessThanOrEqual(MAX_SUBMIT_RESUME_PARALLELISM);
            if (workload > 0) {
                expect(parallelism).toBeLessThanOrEqual(workload);
            }
            expect(parallelism).toBeGreaterThanOrEqual(previous);
            previous = parallelism;
        }
    });

    it("keeps analysis default at expected value", () => {
        expect(resolveAnalysisParallelism(100, {})).toBe(DEFAULT_ANALYSIS_PARALLELISM);
    });
});
