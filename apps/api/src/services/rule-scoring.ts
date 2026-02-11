import { FilterPresetService } from "./filter-preset-service.js";
import { JobDescriptionService } from "./job-description-service.js";
import type { MatchingResult } from "./ai-matching.js";
import type { ResumeIndex } from "./resume-index.js";

export interface RuleScoringResult {
  score: number;
  recommendation: MatchingResult["recommendation"];
  breakdown: {
    skillMatch: number;
    experienceMatch: number;
    educationMatch: number;
    locationMatch: number;
    industryMatch: number;
  };
  matchedSkills: string[];
  matchedCompanies: string[];
}

export interface RuleScoringContext {
  jobDescriptionId: string;
  title: string;
  keywords: string[];
  targetLocations: string[];
  minExperience?: number;
  educationRequirements: string[];
  industryKeywords: string[];
  industryTags: string[];
}

const EDUCATION_RANK: Record<string, number> = {
  high_school: 1,
  associate: 2,
  bachelor: 3,
  master: 4,
  phd: 5,
};

const INDUSTRY_MAP: Array<{ tag: string; keywords: string[] }> = [
  { tag: "machinery", keywords: ["机床", "车床", "机械", "设备", "夹具", "五轴", "加工中心", "lathe", "machining"] },
  { tag: "cnc", keywords: ["cnc", "数控", "fanuc", "siemens", "star"] },
  { tag: "sales", keywords: ["销售", "客户", "大客户", "业务", "sales", "account"] },
  { tag: "automation", keywords: ["自动化", "机器人", "plc", "automation"] },
  { tag: "metrology", keywords: ["测量", "三维", "扫描", "cmm", "metrology"] },
  { tag: "software", keywords: ["软件", "c++", "c#", "qt", "mfc", "开发"] },
];

function normalizeEducationLevel(value: string | null | undefined): string | null {
  const normalized = (value || "").trim().toLowerCase();
  if (!normalized) return null;

  if (["phd", "doctor"].includes(normalized) || /博士/.test(normalized)) return "phd";
  if (["master", "masters"].includes(normalized) || /硕士|研究生/.test(normalized)) return "master";
  if (["bachelor", "bachelors"].includes(normalized) || /本科/.test(normalized)) return "bachelor";
  if (["associate"].includes(normalized) || /大专|专科/.test(normalized)) return "associate";
  if (["high_school", "high school"].includes(normalized) || /中专|高中|中技/.test(normalized)) return "high_school";

  return null;
}

function recommendationFromScore(score: number): MatchingResult["recommendation"] {
  if (score >= 85) return "strong_match";
  if (score >= 70) return "match";
  if (score >= 50) return "potential";
  return "no_match";
}

function ensureKeywords(value: string[]): string[] {
  return Array.from(
    new Set(
      value
        .map((item) => item.trim().toLowerCase())
        .filter((item) => item.length >= 2)
    )
  );
}

function inferIndustryTags(tokens: string[]): string[] {
  const haystack = tokens.join(" ").toLowerCase();
  const tags = new Set<string>();

  for (const item of INDUSTRY_MAP) {
    if (item.keywords.some((keyword) => haystack.includes(keyword.toLowerCase()))) {
      tags.add(item.tag);
    }
  }

  return Array.from(tags);
}

function getMinEducationRank(requirements: string[]): number | null {
  const ranks = requirements
    .map((item) => normalizeEducationLevel(item))
    .filter((item): item is string => Boolean(item))
    .map((item) => EDUCATION_RANK[item] ?? 0)
    .filter((rank) => rank > 0);

  if (ranks.length === 0) return null;
  return Math.min(...ranks);
}

function compactText(value: string): string {
  return value.toLowerCase().replace(/[\u3000\s]+/g, " ");
}

export class RuleScoringService {
  private readonly jobService: JobDescriptionService;
  private readonly filterPresetService: FilterPresetService;

  constructor(projectRoot?: string) {
    this.jobService = new JobDescriptionService(projectRoot);
    this.filterPresetService = new FilterPresetService(projectRoot);
  }

  buildContext(jobDescriptionId: string): RuleScoringContext {
    const jd = this.jobService.loadFile(jobDescriptionId);
    const autoMatch = jd.autoMatch;

    const keywords = ensureKeywords(autoMatch?.keywords ?? []);
    const targetLocations = Array.from(
      new Set([
        ...(autoMatch?.locations ?? []),
        ...(jd.location ? [jd.location] : []),
      ]
        .map((item) => item.trim())
        .filter(Boolean))
    );

    const presetId = autoMatch?.filter_preset;
    const preset = presetId ? this.filterPresetService.getPreset(presetId) : undefined;

    const minExperience = autoMatch?.suggested_filters?.minExperience ?? preset?.filters.minExperience;
    const educationRequirements = [
      ...(autoMatch?.suggested_filters?.education ?? []),
      ...(preset?.filters.education ?? []),
    ];

    const industryKeywords = ensureKeywords([
      ...keywords,
      compactText(jd.title || ""),
      compactText(jd.content || ""),
    ]);

    const industryTags = inferIndustryTags(industryKeywords);

    return {
      jobDescriptionId,
      title: jd.title || jd.name,
      keywords,
      targetLocations,
      minExperience,
      educationRequirements,
      industryKeywords,
      industryTags,
    };
  }

  scoreResume(index: ResumeIndex, context: RuleScoringContext): RuleScoringResult {
    const matchedSkills = context.keywords.filter((keyword) =>
      index.searchText.includes(keyword) || index.skills.some((skill) => skill.includes(keyword))
    );

    const skillMatch = context.keywords.length > 0
      ? Math.round((matchedSkills.length / context.keywords.length) * 30)
      : 0;

    let experienceMatch = 0;
    if (context.minExperience === undefined) {
      experienceMatch = index.experienceYears === null ? 8 : 25;
    } else if (index.experienceYears !== null) {
      if (index.experienceYears >= context.minExperience) {
        experienceMatch = 25;
      } else {
        const gap = context.minExperience - index.experienceYears;
        experienceMatch = Math.max(0, 25 - Math.round(gap * 8));
      }
    }

    let educationMatch = 0;
    const resumeEducation = normalizeEducationLevel(index.educationLevel);
    const minEducationRank = getMinEducationRank(context.educationRequirements);
    if (!minEducationRank) {
      educationMatch = resumeEducation ? 10 : 0;
    } else if (resumeEducation) {
      const rank = EDUCATION_RANK[resumeEducation] ?? 0;
      if (rank >= minEducationRank) {
        educationMatch = 15;
      } else {
        educationMatch = Math.max(0, 15 - (minEducationRank - rank) * 6);
      }
    }

    let locationMatch = 0;
    if (context.targetLocations.length > 0) {
      const location = index.locationCity || "";
      if (location && context.targetLocations.some((target) => location.includes(target) || target.includes(location))) {
        locationMatch = 15;
      }
    }

    const matchedCompanies = index.companies.filter((company) =>
      context.industryKeywords.some((keyword) => company.toLowerCase().includes(keyword))
    );

    const matchedIndustryKeywords = context.industryKeywords.filter((keyword) => index.searchText.includes(keyword));
    const keywordRatioBase = Math.max(1, Math.min(context.industryKeywords.length, 10));
    const keywordRatio = matchedIndustryKeywords.length / keywordRatioBase;
    const tagRatio = context.industryTags.length > 0
      ? index.industryTags.filter((tag) => context.industryTags.includes(tag)).length / context.industryTags.length
      : 0;
    const industryRatio = Math.max(keywordRatio, tagRatio);
    const industryMatch = Math.round(Math.min(1, industryRatio) * 15);

    const rawScore = skillMatch + experienceMatch + educationMatch + locationMatch + industryMatch;
    const score = Math.max(0, Math.min(100, rawScore));

    return {
      score,
      recommendation: recommendationFromScore(score),
      breakdown: {
        skillMatch,
        experienceMatch,
        educationMatch,
        locationMatch,
        industryMatch,
      },
      matchedSkills,
      matchedCompanies,
    };
  }

  scoreBatch(indexes: ResumeIndex[], context: RuleScoringContext): Array<{ resumeId: string; result: RuleScoringResult }> {
    return indexes.map((index) => ({
      resumeId: index.resumeId,
      result: this.scoreResume(index, context),
    }));
  }

  toMatchingResult(result: RuleScoringResult): MatchingResult {
    const highlights: string[] = [];
    const concerns: string[] = [];

    if (result.matchedSkills.length > 0) {
      highlights.push(`命中关键词: ${result.matchedSkills.slice(0, 6).join("、")}`);
    }
    if (result.breakdown.experienceMatch >= 20) {
      highlights.push("经验与职位要求匹配");
    } else {
      concerns.push("经验与职位要求存在差距");
    }
    if (result.breakdown.educationMatch >= 12) {
      highlights.push("学历满足岗位门槛");
    } else {
      concerns.push("学历匹配度偏低");
    }
    if (result.breakdown.locationMatch === 0) {
      concerns.push("工作地点可能不匹配");
    }
    if (result.matchedCompanies.length > 0) {
      highlights.push(`相关公司经历: ${result.matchedCompanies.slice(0, 3).join("、")}`);
    }

    return {
      score: result.score,
      recommendation: result.recommendation,
      highlights,
      concerns,
      summary: `规则评分 ${result.score} 分，技能匹配 ${result.breakdown.skillMatch}/30，经验 ${result.breakdown.experienceMatch}/25。`,
      breakdown: result.breakdown,
      matchedSkills: result.matchedSkills,
      matchedCompanies: result.matchedCompanies,
      scoreSource: "rule",
    };
  }
}

export const ruleScoringService = new RuleScoringService();
