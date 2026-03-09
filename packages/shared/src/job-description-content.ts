export const DEFAULT_MIN_EXPERIENCE = 1;

export type StructuredJobDescriptionSeedFields = {
  location?: string;
  industryTags?: string[];
  minExperience?: number;
  maxExperience?: number;
  minAge?: number;
  maxAge?: number;
  customKeywords?: string[];
};

export type StructuredJobDescriptionContentInput = StructuredJobDescriptionSeedFields & {
  title: string;
};

export function normalizeOptionalString(value: string | null | undefined): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const normalized = value.trim();
  return normalized.length > 0 ? normalized : undefined;
}

function normalizeUniqueStringList(values: string[] | null | undefined): string[] {
  if (!Array.isArray(values)) {
    return [];
  }

  const seen = new Set<string>();
  const normalized: string[] = [];

  values.forEach((value) => {
    const token = normalizeOptionalString(value);
    if (!token) {
      return;
    }
    if (seen.has(token)) {
      return;
    }
    seen.add(token);
    normalized.push(token);
  });

  return normalized;
}

function splitLocationTokens(value: string | undefined): string[] {
  if (!value) {
    return [];
  }

  return Array.from(
    new Set(
      value
        .split(/[\s,，、]+/)
        .map((item) => item.trim())
        .filter((item) => item.length > 0),
    ),
  );
}

function toYamlString(value: string): string {
  return JSON.stringify(value);
}

export function generateStructuredJobDescriptionContent(
  fields: StructuredJobDescriptionContentInput,
): string {
  const title = fields.title.trim();
  const locationStr = normalizeOptionalString(fields.location);
  const locationsList = splitLocationTokens(locationStr);
  const industryTags = normalizeUniqueStringList(fields.industryTags);
  const extraKeywords = normalizeUniqueStringList(fields.customKeywords);
  const minExperience = fields.minExperience ?? DEFAULT_MIN_EXPERIENCE;
  const maxExperience = fields.maxExperience;
  const minAge = fields.minAge;
  const maxAge = fields.maxAge;

  const lines: string[] = [
    "---",
    `title: ${toYamlString(title)}`,
    "status: active",
  ];

  if (locationsList.length > 0) {
    lines.push(`location: ${toYamlString(locationsList.join(","))}`);
  }

  lines.push(`min_experience: ${minExperience}`);
  if (typeof maxExperience === "number") {
    lines.push(`max_experience: ${maxExperience}`);
  }
  if (typeof minAge === "number") {
    lines.push(`min_age: ${minAge}`);
  }
  if (typeof maxAge === "number") {
    lines.push(`max_age: ${maxAge}`);
  }

  if (industryTags.length > 0) {
    lines.push("industry_tags:");
    industryTags.forEach((tag) => {
      lines.push(`  - ${toYamlString(tag)}`);
    });
  }

  lines.push("auto_match:");
  if (extraKeywords.length > 0) {
    lines.push("  keywords:");
    extraKeywords.forEach((keyword) => {
      lines.push(`    - ${toYamlString(keyword)}`);
    });
  } else {
    lines.push("  keywords: []");
  }

  lines.push("---");
  lines.push("");
  lines.push("# 职位描述");
  lines.push("");
  lines.push(`请补充「${title}」的岗位职责。`);
  lines.push("");
  lines.push("# 任职要求");
  lines.push("");

  if (typeof maxExperience === "number") {
    lines.push(`- 相关经验：${minExperience}-${maxExperience} 年`);
  } else {
    lines.push(`- 相关经验：${minExperience}+ 年`);
  }

  if (typeof minAge === "number" || typeof maxAge === "number") {
    const min = typeof minAge === "number" ? minAge : "-";
    const max = typeof maxAge === "number" ? maxAge : "-";
    lines.push(`- 年龄范围：${min}-${max}`);
  }

  if (industryTags.length > 0) {
    lines.push(`- 行业方向：${industryTags.join(" / ")}`);
  }

  lines.push("");
  lines.push("# 关键词");
  lines.push("");
  lines.push(extraKeywords.join(", "));

  return lines.join("\n");
}
