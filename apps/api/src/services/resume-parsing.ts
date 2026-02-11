export function parseExperienceYears(value: string): number | null {
  if (!value) return null;
  const normalized = value.trim();
  if (!normalized) return null;
  if (/应届|无经验/.test(normalized)) return 0;
  const match = normalized.match(/(\d+)(?:\s*[-~到]\s*(\d+))?/);
  if (!match) return null;
  const min = Number(match[1]);
  const max = match[2] ? Number(match[2]) : min;
  return Number.isNaN(max) ? null : max;
}

export function normalizeEducationLevel(value: string): string | null {
  if (!value) return null;
  const normalized = value.trim();
  if (!normalized) return null;
  if (/博士/.test(normalized)) return "phd";
  if (/硕士|研究生/.test(normalized)) return "master";
  if (/本科/.test(normalized)) return "bachelor";
  if (/大专|专科/.test(normalized)) return "associate";
  if (/中专|高中|中技/.test(normalized)) return "high_school";
  return null;
}

export function parseSalaryRange(value: string): { min?: number; max?: number; currency?: string; period?: string } | null {
  if (!value) return null;
  const normalized = value.replace(/\s/g, "");
  if (!normalized || /面议/.test(normalized)) return null;
  const match = normalized.match(/(\d+(?:\.\d+)?)(?:-(\d+(?:\.\d+)?))?/);
  if (!match) return null;
  const min = Number(match[1]);
  const max = match[2] ? Number(match[2]) : undefined;
  if (Number.isNaN(min)) return null;
  const periodMatch = normalized.match(/\/(月|年)/);
  const period = periodMatch ? (periodMatch[1] === "年" ? "year" : "month") : undefined;
  return {
    min,
    max,
    currency: "CNY",
    period,
  };
}

