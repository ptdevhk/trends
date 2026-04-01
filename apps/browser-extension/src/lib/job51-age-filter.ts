export function normalizeOptionalPositiveInt(value) {
  const parsed = Number.parseInt(String(value ?? "").trim(), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return parsed;
}

export function parseAgeNumber(value) {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) {
    return Math.trunc(value);
  }
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;

  const withSuffix = trimmed.match(/^(\d+)\s*岁$/u);
  if (withSuffix && withSuffix[1]) {
    const parsed = Number.parseInt(withSuffix[1], 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
  }

  const plainNumber = trimmed.match(/^(\d{1,3})$/u);
  if (plainNumber && plainNumber[1]) {
    const parsed = Number.parseInt(plainNumber[1], 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
  }

  return null;
}

export function getAgeRangeFromUrl(
  search = "",
  minAgeParam = "tr_min_age",
  maxAgeParam = "tr_max_age",
) {
  const params = new URLSearchParams(search || "");
  const minAge = normalizeOptionalPositiveInt(params.get(minAgeParam));
  const maxAge = normalizeOptionalPositiveInt(params.get(maxAgeParam));
  const enabled = minAge !== null || maxAge !== null;
  return {
    enabled,
    minAge: minAge !== null ? minAge : undefined,
    maxAge: maxAge !== null ? maxAge : undefined,
  };
}

export function filterResumesByAgeRange(
  resumes,
  search = "",
  minAgeParam = "tr_min_age",
  maxAgeParam = "tr_max_age",
) {
  if (!Array.isArray(resumes)) return [];

  const range = getAgeRangeFromUrl(search, minAgeParam, maxAgeParam);
  if (!range.enabled) return resumes;

  const minAge = range.minAge;
  const maxAge = range.maxAge;

  return resumes.filter((resume) => {
    const age = parseAgeNumber(resume?.age);
    if (age === null) return false;
    if (typeof minAge === "number" && age < minAge) return false;
    if (typeof maxAge === "number" && age > maxAge) return false;
    return true;
  });
}
