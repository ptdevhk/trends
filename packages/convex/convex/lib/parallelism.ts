type EnvSource = Record<string, string | undefined>;

export const DEFAULT_ANALYSIS_PARALLELISM = 4;
export const MAX_ANALYSIS_PARALLELISM = 12;
export const DEFAULT_SUBMIT_RESUME_PARALLELISM = 8;
export const MAX_SUBMIT_RESUME_PARALLELISM = 24;

function parsePositiveInt(value: string | undefined): number | null {
    if (!value) {
        return null;
    }
    const parsed = Number.parseInt(value, 10);
    if (!Number.isFinite(parsed) || parsed <= 0) {
        return null;
    }
    return parsed;
}

function clampParallelism(total: number, configured: number, cap: number): number {
    if (total <= 0) {
        return 1;
    }
    return Math.max(1, Math.min(total, configured, cap));
}

export function resolveAnalysisParallelism(totalCandidates: number, env: EnvSource = process.env): number {
    const configured = parsePositiveInt(env.AI_ANALYSIS_PARALLELISM ?? env.AI_PARALLELISM)
        ?? DEFAULT_ANALYSIS_PARALLELISM;
    return clampParallelism(totalCandidates, configured, MAX_ANALYSIS_PARALLELISM);
}

export function resolveSubmitResumeParallelism(totalResumes: number, env: EnvSource = process.env): number {
    const configured = parsePositiveInt(env.SUBMIT_RESUME_PARALLELISM)
        ?? DEFAULT_SUBMIT_RESUME_PARALLELISM;
    return clampParallelism(totalResumes, configured, MAX_SUBMIT_RESUME_PARALLELISM);
}
