/**
 * Pure score-parsing utilities for AI debug breakdowns.
 *
 * Extracted from DebugAI.tsx for testability.
 */

export type BreakdownKey = "experience" | "skills" | "industry_db" | "education" | "location";

export type ScoreBreakdown = Record<BreakdownKey, number>;

export const EMPTY_BREAKDOWN: ScoreBreakdown = {
  experience: 0,
  skills: 0,
  industry_db: 0,
  education: 0,
  location: 0,
};

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function toScore(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }

  return null;
}

export function clampScore(value: number): number {
  return Math.max(0, Math.min(100, value));
}

export function parseBreakdownCandidate(candidate: unknown): ScoreBreakdown | null {
  if (!isRecord(candidate)) {
    return null;
  }

  const rawBreakdown = candidate["breakdown"];
  if (!isRecord(rawBreakdown)) {
    return null;
  }

  return {
    experience: clampScore(toScore(rawBreakdown["related_exp"] ?? rawBreakdown["experience"]) ?? 0),
    skills: clampScore(toScore(rawBreakdown["skills"]) ?? 0),
    industry_db: clampScore(toScore(rawBreakdown["industry_db"]) ?? 0),
    education: clampScore(toScore(rawBreakdown["education"]) ?? 0),
    location: clampScore(toScore(rawBreakdown["location"]) ?? 0),
  };
}

export function extractBreakdown(resume: { analysis?: unknown; analyses?: unknown } | null): ScoreBreakdown {
  if (!resume) {
    return EMPTY_BREAKDOWN;
  }

  const directBreakdown = parseBreakdownCandidate(resume.analysis);
  if (directBreakdown) {
    return directBreakdown;
  }

  if (!isRecord(resume.analyses)) {
    return EMPTY_BREAKDOWN;
  }

  const defaultBreakdown = parseBreakdownCandidate(resume.analyses["default"]);
  if (defaultBreakdown) {
    return defaultBreakdown;
  }

  for (const analysis of Object.values(resume.analyses)) {
    const parsed = parseBreakdownCandidate(analysis);
    if (parsed) {
      return parsed;
    }
  }

  return EMPTY_BREAKDOWN;
}

export function readTextField(source: unknown, key: string): string | null {
  if (!isRecord(source)) {
    return null;
  }

  const value = source[key];
  if (typeof value === "string" && value.trim()) {
    return value.trim();
  }

  return null;
}
