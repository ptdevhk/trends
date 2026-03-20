/* eslint-disable */
// AUTO-GENERATED FILE. DO NOT EDIT DIRECTLY.
// Source: config/resume/ai-prompts*.md
// Run: make sync-resume-ai-prompts

export const DEFAULT_RESUME_AI_PROMPT_LOCALE = "zh-Hans" as const;

export const RESUME_AI_PROMPT_LOCALE_TO_NATURAL_LANGUAGE = {
  "zh-Hans": "Simplified Chinese",
  "zh-Hant": "Traditional Chinese",
  "en": "English",
  "ja": "Japanese",
  "ko": "Korean"
} as const;

export interface ResumeAiPromptMetadata {
  version: number;
  updatedAt: string;
  description: string;
}

export interface ResumeAiPromptSections {
  systemPrompt: string;
  userPromptTemplate: string;
  outputContract: string;
  promptVariables: string;
  notes: string;
}

export interface ResumeAiPromptSource {
  sourceFileRelativePath: string;
  metadata: ResumeAiPromptMetadata;
  sections: ResumeAiPromptSections;
}

export interface ResumeAiPromptResolution {
  requestedLocale: string;
  resolvedSourceLocale: string;
  sourceFileRelativePath: string;
  fallbackToZhHans: boolean;
  naturalLanguage: string;
}

export interface ResumeAiPromptDefinition {
  metadata: ResumeAiPromptMetadata;
  sections: ResumeAiPromptSections;
  normalized: {
    version: number;
    locale: string;
    sourceLocale: string;
    systemPrompt: string;
    userPromptTemplate: string;
    outputContract: string;
    promptVariables: string;
    notes: string;
  };
  resolution: ResumeAiPromptResolution;
}

export const RESUME_AI_PROMPT_SOURCES = {
  "zh-Hans": {
    "sourceFileRelativePath": "config/resume/ai-prompts.md",
    "metadata": {
      "version": 2,
      "updatedAt": "2026-03-18",
      "description": "Canonical zh-Hans resume AI prompts for summary and screening analysis. This markdown file is the authoring source for the generated shared prompt runtime."
    },
    "sections": {
      "systemPrompt": "你是一个专业的HR助手，专门帮助筛选精密机械和机床行业的简历。\n你必须严格按照【纯数字 JSON】格式返回结果。\n1. 绝对不要包含 markdown 标记 (如 ```json ... ```)。\n2. 所有评分字段（score, breakdown.*）必须是【JSON Number 类型】，绝对禁止使用字符串或中文数字（如 \"30\", \"三十\", thirty）。\n3. 正确示例: \"score\": 85\n4. 错误示例: \"score\": \"85\", \"score\": \"eighty-five\"\n5. 如果无法确切评分，请基于现有信息估算一个数字。\n6. summary/highlights/concerns 必须优先围绕候选人的岗位角色、行业背景、与职位直接相关的工作经历展开，不要只重复总工龄或学历。\n7. 只要已经提供了工作经历证据，就不要写“未提供具体工作经历”或类似表述。\n8. `岗位信号` 是结构化岗位证据，优先使用它判断候选人到底是销售、工程、调试还是技术支持，不要被“配合销售”“促成订单”“培训客户”等描述误导成直接销售经历。",
      "userPromptTemplate": "请分析以下候选人与职位的匹配度：\n\n## 职位信息\n**职位名称**: {jobTitle}\n**职位要求**:\n{requirements}\n\n## 评分规则 (权重与标准)\n{matchingRules}\n\n## 候选人信息\n**姓名**: {candidateName}\n**行业数据库验证公司**: {verifiedCompanies}\n**工作经历证据**:\n{evidenceText}\n**岗位信号**:\n{roleSignals}\n\n## industry_db 评分规则 (重要)\n- `breakdown.industry_db` 分数必须且只能基于\"行业数据库验证公司\"字段。\n- 如果\"行业数据库验证公司\"为\"无\"，则 `industry_db` 必须为 0。\n- 不要根据公司名称自行推测是否属于行业数据库，只以上方提供的验证结果为准。\n\n## 销售经验判定规则（重要）\n- 只有当工作经历中的岗位本身明确是销售、销售工程师、销售经理、业务开发或类似销售角色时，才算直接销售经验。\n- 如果岗位是应用工程师、技术支持、调试、编程、培训、研发、售前支持，或者只是“配合销售”“协助销售”“促成订单”，都不要算作直接销售经验。\n- 如果 `岗位信号` 里没有直接销售角色，而职位要求又是销售类岗位，请显著降低 `related_exp`，避免把技术支持型候选人误判为高匹配销售候选人。\n\n## 总结与判断要求\n- summary/highlights/concerns 必须优先围绕候选人的岗位角色、行业背景、与职位直接相关的工作经历展开。\n- 优先指出候选人最近/最相关的岗位名称、所在行业或公司背景、以及可验证的相关年限。\n- 不要只重复总工作年限、学历，除非这些信息直接影响岗位匹配判断。\n- 只要工作经历证据里已经有岗位或公司信息，就不要写“未提供具体工作经历”或类似表述。",
      "outputContract": "```text\n请以JSON格式返回分析结果，确保 score 为数字类型：\n{\n  \"score\": 30,\n  \"breakdown\": {\n    \"related_exp\": 20,\n    \"industry_db\": 10\n  },\n  \"recommendation\": \"strong_match\" | \"match\" | \"potential\" | \"no_match\",\n  \"highlights\": [\"匹配亮点1\", \"匹配亮点2\"],\n  \"concerns\": [\"不足之处1\", \"不足之处2\"],\n  \"summary\": \"中文总结\"\n}\n```\n\n### breakdown 字段说明\n- `related_exp`: 基于\"工作经历证据\"评估候选人与目标岗位的相关经验匹配度（0-100）。运行时按 50% 权重换算为 0-50 贡献。\n- `industry_db`: 基于已知行业数据库公司/品牌命中情况评估（0-100，参考用途）。运行时将以规则引擎计算值（公司命中 + 品牌命中）替换 AI 提供的值；AI 提供值不影响最终得分，仅供参考。\n- `score` = `related_exp`（AI 值 × 0.5）+ `industry_db`（系统规则计算值），合计 0-100，不得包含其他未提供数据支撑的维度。",
      "promptVariables": "- `{jobTitle}`: 当前职位名称。\n- `{requirements}`: 当前职位要求或关键词构造出的要求文本。\n- `{matchingRules}`: 评分规则说明，可能是默认规则或关键词匹配规则。\n- `{candidateName}`: 候选人姓名。\n- `{evidenceText}`: 从工作经历提取出的严格证据文本。\n- `{roleSignals}`: 从工作经历抽取出的结构化岗位信号，优先显示销售/工程/技术支持等实际岗位角色。\n- `{verifiedCompanies}`: 行业数据库验证通过的公司列表；无匹配时显示\"无\"。\n- `{workExperience}`: (保留于替换链路，模板不展示) 候选人总工作年限。\n- `{education}`: (保留于替换链路，模板不展示) 候选人学历。\n- `{companies}`: (保留于替换链路，模板不展示) 候选人公司名汇总。",
      "notes": "- 本文件是简历分析 Prompt 的 canonical source。\n- `AI_OUTPUT_LOCALE` 为空或不支持时，运行时默认回退到 zh-Hans 主文件。\n- 英文等 locale 变体使用单独文件维护，并通过生成脚本同步到共享运行时代码。\n- 当前阶段只迁移 resume AI prompt/rule 文本，不迁移数值型配置。"
    }
  },
  "en": {
    "sourceFileRelativePath": "config/resume/ai-prompts.en.md",
    "metadata": {
      "version": 2,
      "updatedAt": "2026-03-18",
      "description": "English locale variant for the resume AI prompts. Falls back to the zh-Hans master prompt when this file is absent."
    },
    "sections": {
      "systemPrompt": "You are a professional HR assistant focused on screening resumes for the precision machinery and machine-tool industry.\nYou must return results strictly as plain numeric JSON.\n1. Never include markdown wrappers such as ```json ... ```.\n2. All scoring fields (score, breakdown.*) must use JSON Number values. Do not use strings or spelled-out numbers such as \"30\", \"thirty\", or Chinese numerals.\n3. Correct example: \"score\": 85\n4. Incorrect example: \"score\": \"85\", \"score\": \"eighty-five\"\n5. If an exact score is not possible, estimate a reasonable numeric score from the available evidence.\n6. summary/highlights/concerns must prioritize the candidate's role focus, industry background, and directly relevant work history instead of repeating only total years or education.\n7. If work-history evidence is already provided, do not say that specific work experience was missing.\n8. `Role Signals` are structured role evidence. Use them to decide whether the candidate is actually in sales, engineering, debugging, or technical support. Do not let phrases like \"support sales\", \"close orders\", or \"train customers\" inflate direct sales experience.",
      "userPromptTemplate": "Please analyze how well the following candidate matches the job:\n\n## Job Information\n**Job Title**: {jobTitle}\n**Job Requirements**:\n{requirements}\n\n## Scoring Rules (weights and standards)\n{matchingRules}\n\n## Candidate Information\n**Name**: {candidateName}\n**Industry Database Verified Companies**: {verifiedCompanies}\n**Work-History Evidence**:\n{evidenceText}\n**Role Signals**:\n{roleSignals}\n\n## industry_db Scoring Rule (Important)\n- The `breakdown.industry_db` score must be based solely on the \"Industry Database Verified Companies\" field above.\n- If \"Industry Database Verified Companies\" is \"none\", then `industry_db` must be 0.\n- Do not guess whether a company belongs to the industry database based on its name alone; use only the verification result provided above.\n\n## Sales Experience Rule (Important)\n- Count direct sales experience only when the work-history role itself is explicitly sales, sales engineer, sales manager, business development, or a similar sales role.\n- If the role is application engineer, technical support, debugging, programming, training, R&D, presales support, or merely \"supporting sales\" / \"helping close orders\", do not count it as direct sales experience.\n- If `Role Signals` contain no direct sales role and the job is a sales role, significantly lower `related_exp` to avoid misclassifying technical-support candidates as strong sales matches.\n\n## Summary and Judgment Requirements\n- summary/highlights/concerns must prioritize the candidate's role focus, industry background, and directly relevant work history.\n- Prefer calling out the candidate's most recent or most relevant role title, industry or company background, and verifiable relevant years.\n- Do not simply restate total years of work or education unless those details directly affect the match decision.\n- If work-history evidence already contains role or company information, do not say that specific work experience was missing.",
      "outputContract": "```text\nReturn the analysis as JSON and ensure score is numeric:\n{\n  \"score\": 30,\n  \"breakdown\": {\n    \"related_exp\": 20,\n    \"industry_db\": 10\n  },\n  \"recommendation\": \"strong_match\" | \"match\" | \"potential\" | \"no_match\",\n  \"highlights\": [\"Matching highlight 1\", \"Matching highlight 2\"],\n  \"concerns\": [\"Concern 1\", \"Concern 2\"],\n  \"summary\": \"English summary\"\n}\n```\n\n### breakdown Field Descriptions\n- `related_exp`: Scores how well the candidate's work-history evidence matches the target role (0-100). Runtime converts it into a 0-50 contribution using a fixed 50% weight.\n- `industry_db`: Scores known industry database company/brand hits (0-100, reference only). Runtime replaces the AI-provided value with the rule-engine result (company hits + brand hits); the AI-provided value does not affect the final score.\n- `score` = `related_exp` (AI value × 0.5) + `industry_db` (system rule result), for a 0-100 total. Do not include dimensions without grounded data.",
      "promptVariables": "- `{jobTitle}`: Current job title.\n- `{requirements}`: Current job requirements or keyword-derived requirement text.\n- `{matchingRules}`: Scoring rules, either default scoring guidance or keyword-specific guidance.\n- `{candidateName}`: Candidate name.\n- `{evidenceText}`: Strict work-history evidence extracted from resume history.\n- `{roleSignals}`: Structured role signals extracted from work history, prioritizing actual sales/engineering/technical-support roles.\n- `{verifiedCompanies}`: Companies verified against the industry database; shows \"none\" when no matches exist.\n- `{workExperience}`: (kept in hydration chain, not in template) Candidate total years of work experience.\n- `{education}`: (kept in hydration chain, not in template) Candidate education level.\n- `{companies}`: (kept in hydration chain, not in template) Candidate company summary.",
      "notes": "- This file is a locale-specific variant of the zh-Hans master prompt.\n- Runtime resolution is driven by `AI_OUTPUT_LOCALE`.\n- If this file is unavailable, runtime falls back to `config/resume/ai-prompts.md`.\n- This pass only migrates prompt text, not numeric resume-scoring config."
    }
  }
} as const satisfies Record<string, ResumeAiPromptSource>;

export type ResumeAiPromptSourceLocale = keyof typeof RESUME_AI_PROMPT_SOURCES;

export const RESUME_AI_PROMPT_LOCALES = Object.keys(RESUME_AI_PROMPT_SOURCES).sort() as ResumeAiPromptSourceLocale[];

function normalizeRequestedLocale(requestedLocale?: string): string {
  const trimmed = requestedLocale?.trim();
  if (!trimmed) {
    return DEFAULT_RESUME_AI_PROMPT_LOCALE;
  }
  if (trimmed === DEFAULT_RESUME_AI_PROMPT_LOCALE) {
    return trimmed;
  }
  if (trimmed in RESUME_AI_PROMPT_LOCALE_TO_NATURAL_LANGUAGE || trimmed in RESUME_AI_PROMPT_SOURCES) {
    return trimmed;
  }
  return DEFAULT_RESUME_AI_PROMPT_LOCALE;
}

export function resolveResumeAiPromptLocale(requestedLocale?: string): ResumeAiPromptResolution {
  const normalizedRequestedLocale = normalizeRequestedLocale(requestedLocale);
  const hasRequestedSource = normalizedRequestedLocale in RESUME_AI_PROMPT_SOURCES;
  const resolvedSourceLocale = (hasRequestedSource ? normalizedRequestedLocale : DEFAULT_RESUME_AI_PROMPT_LOCALE) as ResumeAiPromptSourceLocale;
  const source = RESUME_AI_PROMPT_SOURCES[resolvedSourceLocale];

  return {
    requestedLocale: normalizedRequestedLocale,
    resolvedSourceLocale,
    sourceFileRelativePath: source.sourceFileRelativePath,
    fallbackToZhHans: normalizedRequestedLocale !== DEFAULT_RESUME_AI_PROMPT_LOCALE && !hasRequestedSource,
    naturalLanguage: RESUME_AI_PROMPT_LOCALE_TO_NATURAL_LANGUAGE[normalizedRequestedLocale as keyof typeof RESUME_AI_PROMPT_LOCALE_TO_NATURAL_LANGUAGE]
      ?? normalizedRequestedLocale,
  };
}

export function getResumeAiPromptDefinition(requestedLocale?: string): ResumeAiPromptDefinition {
  const resolution = resolveResumeAiPromptLocale(requestedLocale);
  const source = RESUME_AI_PROMPT_SOURCES[resolution.resolvedSourceLocale as ResumeAiPromptSourceLocale];
  const sections = source.sections;
  return {
    metadata: source.metadata,
    sections,
    normalized: {
      version: source.metadata.version,
      locale: resolution.requestedLocale,
      sourceLocale: resolution.resolvedSourceLocale,
      systemPrompt: sections.systemPrompt,
      userPromptTemplate: [sections.userPromptTemplate, sections.outputContract].join("\n\n").trim(),
      outputContract: sections.outputContract,
      promptVariables: sections.promptVariables,
      notes: sections.notes,
    },
    resolution,
  };
}

export function buildResumeAiSystemPrompt(requestedLocale?: string): string {
  const definition = getResumeAiPromptDefinition(requestedLocale);
  return [definition.sections.systemPrompt, `Please respond entirely in ${definition.resolution.naturalLanguage}.`].join("\n");
}

export function getResumeAiUserPromptTemplate(requestedLocale?: string): string {
  return getResumeAiPromptDefinition(requestedLocale).normalized.userPromptTemplate;
}
