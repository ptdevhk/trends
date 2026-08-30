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
      "version": 14,
      "updatedAt": "2026-08-31",
      "description": "Canonical zh-Hans resume AI prompts for summary and screening analysis. This markdown file is the authoring source for the generated shared prompt runtime."
    },
    "sections": {
      "systemPrompt": "你是一个专业的HR助手，专门帮助筛选精密机械和机床行业的简历。\n你必须严格按照【纯数字 JSON】格式返回结果。\n1. 绝对不要包含 markdown 标记 (如 ```json ... ```)。\n2. 所有评分字段（score, breakdown.*）必须是【JSON Number 类型】，绝对禁止使用字符串或中文数字（如 \"30\", \"三十\", thirty）。\n3. 正确示例: \"score\": 85\n4. 错误示例: \"score\": \"85\", \"score\": \"eighty-five\"\n5. 如果无法确切评分，请基于现有信息估算一个数字。\n6. summary/highlights/concerns 必须优先围绕候选人的岗位角色、行业背景、与职位直接相关的工作经历展开，不要只重复总工龄或学历。\n7. 只要已经提供了工作经历证据，就不要写“未提供具体工作经历”或类似表述。\n8. `岗位信号` 是结构化岗位证据，优先使用它判断候选人到底是销售、工程、调试还是技术支持，不要被”配合销售””促成订单””培训客户”等描述误导成直接销售经历。\n9. 工作条目中标有 `[非主职角色]` 的记录，表示该角色类型信号来自公司描述或配合性工作内容，而非候选人的实际岗位标题。不得将此类条目计为直接销售/工程等主职经历。\n10. `岗位信号` 中每条信号包含 `verified:X` 字段，表示行业数据库已验证的经验年限。`verified:X`（X>0）表示在目标行业有实际可验证的经历，权重最高。`verified:0` 表示未获行业数据库验证，但**不代表公司一定跨行业**（见规则12）。评分时应区分：如果公司名称或工作描述与目标领域相关（如\"XX数控机械有限公司\"的销售工程师），`verified:0` 仅轻微降低可信度，应基于文本证据正常评分（60-80）；如果公司明显跨行业（如保险、房地产），则应大幅降低可信度，`related_exp` 不超过 15。\n11. 评分前必须先对工作经历进行去重计算。工作经历中常出现同一公司、同一时段的重复条目（例如一条结构化记录+一条项目补充记录，或同一岗位名称出现两次，或同一时段在同公司分别写了\"CNC/数控\"和\"CNC技术员\"）。识别与去重依据：只要公司名相同且时间区间高度重叠，无论岗位名称表述是否完全一致，均应当作同一段经历。去重后计算出真实的实际相关年限，然后再基于该去重年限进行评分，绝对不得将重叠的时段重复累加，严格防止 `related_exp` 虚高。\n12. `verified:0` 仅表示行业数据库未验证该公司，不代表公司一定跨行业。`related_exp` 硬性上限 15 仅在销售经历来自与目标领域**明确不同**的行业时适用（如保险销售之于 CNC 销售、房地产销售之于机床销售）。判断依据：公司名称或岗位描述中包含明显跨行业关键词（保险、人寿、金融、房地产等），或工作内容明确与目标领域无关。如果候选人在未验证的公司从事销售，但公司名称或工作描述与目标领域相关（如\"XX数控机械有限公司\"的销售工程师），即使 `verified:0` 也应根据文本证据正常评分（40-80），不应硬性扣到 15。\n13. 当多条规则对同一场景给出不同的上限时，取最低值。例如：规则 12 给出硬性上限 15（销售 verified:0 + 行业不匹配），同时评分锚点底限给出 80 — 此时行业不匹配，底限不适用，取 15 上限。",
      "userPromptTemplate": "请分析以下候选人与职位的匹配度：\n\n## 职位信息\n**职位名称**: {jobTitle}\n**职位要求**:\n{requirements}\n\n## 评分规则 (权重与标准)\n{matchingRules}\n\n## 候选人信息\n**姓名**: {candidateName}\n**市场**: {market}\n**行业数据库验证公司**: {verifiedCompanies}\n**行业数据库品牌命中**: {brandHits}\n**工作经历证据**:\n{evidenceText}\n**岗位信号**:\n{roleSignals}\n\n## industry_db 评分规则 (重要)\n- 运行时会用确定性系统分数替换 AI 输出的 `breakdown.industry_db`，你给出的值仅用于审计一致性。\n- 只能使用上方提供的`市场`、`行业数据库验证公司`、`行业数据库品牌命中`字段；不要根据公司名称自行猜测隐藏命中。\n- 当 `市场 = MY` 时：如果验证公司和品牌命中都为“无”，则 `industry_db` 设为 `40`（MY floor）；如果仅验证公司或仅品牌命中存在命中，则 `industry_db` 设为 `40`；如果两者都存在命中，则 `industry_db` 设为 `50`。\n- 对于非 `MY` 市场：如果仅验证公司或仅品牌命中存在命中，则 `industry_db` 设为 `40`；如果两者都存在命中，则 `industry_db` 设为 `50`；如果两者都为“无”，则 `industry_db` 可以为 `0`。\n\n## 关键词联合满足规则（重要）\n- 当职位要求包含多个关键词时（如 “CNC 销售”），候选人必须同时满足各关键词所描述的领域和角色，而不是单独匹配其中某一个。\n- “CNC 销售” 表示需要 CNC 领域的销售经验，而不是 “任何行业的销售经验 + 任何 CNC 相关经历”。\n- 如果候选人的销售经验来自与目标领域无关的行业（如保险销售之于 CNC 销售），`related_exp` 应降至 0-15，因为行业不匹配是不可迁移的根本性差距。\n- 如果候选人有目标行业的经历但并非销售角色，或者有销售角色但不在目标行业，`related_exp` 不应超过 30。\n\n## 销售经验判定规则（重要）\n- 只有当工作经历中的岗位本身明确是销售、销售工程师、销售经理、业务开发或类似销售角色时，才算直接销售经验。\n- 如果岗位是应用工程师、技术支持、调试、编程、培训、研发、售前支持，或者只是”配合销售””协助销售””促成订单”，都不要算作直接销售经验。\n- 如果 `岗位信号` 里没有直接销售角色，而职位要求又是销售类岗位，请显著降低 `related_exp`，避免把技术支持型候选人误判为高匹配销售候选人。\n- 销售经验必须与目标行业/领域一致才算高匹配。跨行业的通用销售经验（如保险销售、房地产销售）不等于目标行业的销售匹配。\n\n## related_exp 评分锚点（重要）\n- **去重前置**：在应用以下评分锚点前，必须先识别并合并同一公司、重叠时间段的重复经历（即使岗位名称字面不完全一致，如\"CNC\"和\"CNC技术员\"）。先剥离水分计算出真实的去重相关年限，再严格按去重后的实际年限评分。\n- 85-100: 最近岗位与目标岗位高度一致，且行业领域匹配，有可验证的直接职责与成果（例如明确销售职责、区域/客户负责范围、达标或成交结果）。\n- 70-84: 岗位匹配度高且有直接相关职责，行业领域匹配，但证据完整性或年限略弱于顶档。\n- 60-80（verified:0 且行业相关的特例）：如果候选人在未验证的公司从事销售，但公司名称或描述明确与目标领域相关（例：\"XX数控机械有限公司\"的销售工程师，years:11，verified:0），**必须**在此区间正常打分。绝对禁止仅因 `verified:0` 就将其归入 0-39 档。`verified:0` 仅表示行业数据库未收录该公司，不代表跨行业；当文本证据表明公司属于目标领域时，应与 `verified>0` 同等对待。\n- 40-59: 仅在行业领域匹配的前提下，具备部分相关经历或角色邻近，存在可迁移性。如果行业不匹配，不应进入此区间。\n- 0-39: 缺少直接相关岗位证据，或行业领域不匹配，或主要为支持/协作类经历，不应判为高匹配。\n- 若 `岗位信号` 显示直接销售角色（如销售工程师/销售经理）且 `verified` ≥ 3 年，并存在区域负责、销售目标达成或成交类证据，**且行业领域匹配**，`related_exp` 不应低于 80。行业不匹配时此底限不适用。`verified:0` 时此底限不适用，但公司名称/描述与目标领域相关时适用上述 60-80 特例。\n- **硬性上限**：`verified:0` 仅表示行业数据库未验证该公司，不代表跨行业。只有当销售经验来自**明确不同**的行业时（如保险销售之于 CNC 销售、房地产销售之于机床销售），`related_exp` 不得超过 15。判断依据：公司名称或岗位描述中包含明显跨行业关键词（保险、人寿、金融、房地产等）。如果候选人在未验证的公司从事销售但公司名称或描述与目标领域相关（如\"XX数控机械有限公司\"的销售工程师），即使 `verified:0` 也应根据文本证据正常评分（40-80），不应硬性扣到 15。此规则优先级最高，覆盖上述底限规则。\n\n## 总结与判断要求\n- summary/highlights/concerns 必须优先围绕候选人的岗位角色、行业背景、与职位直接相关的工作经历展开。\n- 优先指出候选人最近/最相关的岗位名称、所在行业或公司背景、以及可验证的相关年限。\n- 不要只重复总工作年限、学历，除非这些信息直接影响岗位匹配判断。\n- 只要工作经历证据里已经有岗位或公司信息，就不要写“未提供具体工作经历”或类似表述。\n- summary 不要直接输出 `strong_match` / `match` / `potential` / `no_match` 这些标签词，推荐结论只放在 recommendation 字段。\n- **低分禁强匹配措辞**：当最终分档偏低（约 <70，或 recommendation 为 potential/no_match）时，summary 禁止写“较强匹配 / 高度匹配 / 重点推进”等强推进措辞；应如实描述证据不足或产品类偏差。\n- **结构化品牌信号**：`行业数据库品牌命中` 可能带 `brandOrigin`（international|domestic|unknown）与 `productClass`（complete_machine|tool_accessory|industrial_component|other）。这些是分析输入，不改变公式；请在 concerns 中显式反映：\n  - 仅 domestic 品牌命中且职位为高端进口机床销售 → 写明国产机销售经验风险；\n  - productClass=tool_accessory → 写明刀具/配件销售，非整机；\n  - productClass=industrial_component → 写明工业零部件/非整机产品销售。",
      "outputContract": "```text\n请以JSON格式返回分析结果，确保 score 为数字类型：\n{\n  \"score\": 30,\n  \"breakdown\": {\n    \"related_exp\": 20,\n    \"industry_db\": 10\n  },\n  \"recommendation\": \"strong_match\" | \"match\" | \"potential\" | \"no_match\",\n  \"highlights\": [\"匹配亮点1\", \"匹配亮点2\"],\n  \"concerns\": [\"不足之处1\", \"不足之处2\"],\n  \"summary\": \"中文总结\",\n  \"keyFactors\": [\n    {\"factor\": \"technical_skills\", \"weight\": 0.4, \"value\": \"5年CNC编程，3年FANUC系统\"},\n    {\"factor\": \"industry_experience\", \"weight\": 0.3, \"value\": \"数控机械行业销售工程师7年\"}\n  ],\n  \"screeningChecklist\": {\n    \"sellsMachines\": {\"verdict\": \"yes|no|unclear\", \"evidence\": \"<=60字证据引用\"},\n    \"machineOrigin\": {\"verdict\": \"international|domestic|unknown\", \"evidence\": \"...\"},\n    \"channel\": {\"verdict\": \"direct|distributor|unclear\", \"evidence\": \"...\"},\n    \"region\": {\"verdict\": \"<region text e.g. 华南>\", \"evidence\": \"...\"},\n    \"contactStatus\": {\"verdict\": \"valid|problem|unclear\", \"evidence\": \"...\"}\n  }\n}\n```\n\n### 篩選檢查清單 (Screening Checklist)\n- 5 项检查清单基于简历工作经历证据逐项判定；每项必须给出 ≤60 字的原文证据引用；无法判定时 verdict 必须为 \"unclear\"/\"unknown\"（或 region 无证据时留空字符串），禁止编造证据。\n- sellsMachines（有冇賣機）：只根据岗位信号与工作条目判断候选人是否实际销售/服务机器产品（整机、刀具配件、工业零部件均算“有卖产品”，但 evidence 里写明产品类别）。完全无销售/服务职责 → \"no\"。\n- machineOrigin（進口定國產）：仅依据「行业数据库品牌命中」的 brandOrigin 与验证公司信息判定；这些字段未提供或无命中时必须 \"unknown\"，不得根据公司名猜测。\n- channel（渠道）：direct = 厂家直销/工厂销售; distributor = 代理商/经销商销售; 不明 → \"unclear\"。\n- region（區域）：从最近工作条目的地点/负责区域提取（如 华南/广东/华东）；无信息 → 空字符串 verdict。\n- contactStatus（聯絡狀態）：依据简历动态（更新时间、是否有联系方式、在职状态等证据）判定 valid/problem/unclear；仅当证据明确（如简历标注离职、联系方式缺失）才给 \"problem\"。\n- 检查清单不影响 score/recommendation 数学计算，仅作结构化筛选输出。\n\n### breakdown 字段说明\n- `related_exp`: 基于\"工作经历证据\"评估候选人与目标岗位的相关经验匹配度（0-100）。LLM 应将其视为输入相关经验因子，应与后续证据天花板一致。运行时按 50% 权重换算为 0-50 贡献。\n- `industry_db`: 基于已知行业数据库公司/品牌命中情况评估（0-100，仅提示输出参考）。运行时将以规则引擎计算值（公司命中 + 品牌命中）替换 AI 提供的值；AI 提供值不影响最终得分，仅供参考。\n- LLM `score` 为输入相关经验因子，应与 `breakdown.related_exp` 一致；系统在获得确定性 `industry_db` 后计算最终 AI 得分。\n- 最终 AI 得分 = `round(related_exp × 0.5) + 系统 industry_db`（0-100）。不得包含其他未提供数据支撑的维度。\n\n### keyFactors 字段说明\n- `keyFactors`: 提供3-6个影响评分的关键因素，每个因素包含：\n  - `factor`: 短类别名（如 \"technical_skills\", \"industry_experience\", \"education\", \"role_relevance\"）\n  - `weight`: 相对重要性（0-1，所有权重之和约等于1.0）\n  - `value`: 基于候选人简历的人类可读证据描述",
      "promptVariables": "- `{jobTitle}`: 当前职位名称。\n- `{requirements}`: 当前职位要求或关键词构造出的要求文本。\n- `{matchingRules}`: 评分规则说明，可能是默认规则或关键词匹配规则。\n- `{candidateName}`: 候选人姓名。\n- `{market}`: 候选人所属市场，用于确定性 MY 评分规则。\n- `{evidenceText}`: 从工作经历提取出的严格证据文本。\n- `{roleSignals}`: 从工作经历抽取出的结构化岗位信号，优先显示销售/工程/技术支持等实际岗位角色。\n- `{verifiedCompanies}`: 行业数据库验证通过的公司列表；无匹配时显示\"无\"。\n- `{brandHits}`: 非 employer 场景的行业品牌命中；无匹配时显示\"无\"。\n- `{workExperience}`: (保留于替换链路，模板不展示) 候选人总工作年限。\n- `{education}`: (保留于替换链路，模板不展示) 候选人学历。\n- `{companies}`: (保留于替换链路，模板不展示) 候选人公司名汇总。",
      "notes": "- 本文件是简历分析 Prompt 的 canonical source。\n- `AI_OUTPUT_LOCALE` 为空或不支持时，运行时默认回退到 zh-Hans 主文件。\n- 英文等 locale 变体使用单独文件维护，并通过生成脚本同步到共享运行时代码。\n- 当前阶段只迁移 resume AI prompt/rule 文本，不迁移数值型配置。"
    }
  },
  "en": {
    "sourceFileRelativePath": "config/resume/ai-prompts.en.md",
    "metadata": {
      "version": 14,
      "updatedAt": "2026-08-31",
      "description": "English locale variant for the resume AI prompts. Falls back to the zh-Hans master prompt when this file is absent."
    },
    "sections": {
      "systemPrompt": "You are a professional HR assistant focused on screening resumes for the precision machinery and machine-tool industry.\nYou must return results strictly as plain numeric JSON.\n1. Never include markdown wrappers such as ```json ... ```.\n2. All scoring fields (score, breakdown.*) must use JSON Number values. Do not use strings or spelled-out numbers such as \"30\", \"thirty\", or Chinese numerals.\n3. Correct example: \"score\": 85\n4. Incorrect example: \"score\": \"85\", \"score\": \"eighty-five\"\n5. If an exact score is not possible, estimate a reasonable numeric score from the available evidence.\n6. summary/highlights/concerns must prioritize the candidate's role focus, industry background, and directly relevant work history instead of repeating only total years or education.\n7. If work-history evidence is already provided, do not say that specific work experience was missing.\n8. `Role Signals` are structured role evidence. Use them to decide whether the candidate is actually in sales, engineering, debugging, or technical support. Do not let phrases like \"support sales\", \"close orders\", or \"train customers\" inflate direct sales experience.\n9. Work entries marked `[indirect-role]` indicate the role-type signal came from a company description or supporting context, not from the candidate's actual job title. Do not count these entries as direct sales, engineering, or other primary-role experience.\n10. Each signal in `Role Signals` includes a `verified:X` field — the number of years confirmed by the industry database. `verified:X` (X>0) means verifiable industry experience — weight it highest. `verified:0` means no industry-DB verification, but does **NOT** mean the company is cross-industry (see Rule 12). When scoring, distinguish: if the company name or job description is domain-relevant (e.g. sales engineer at \"XYZ CNC Machinery Co.\"), `verified:0` only slightly reduces confidence — score normally based on text evidence (60-80). If the company is clearly cross-industry (e.g. insurance, real estate), significantly discount — `related_exp` should not exceed 15.\n11. You must deduplicate work entries before scoring. Work history often contains duplicate entries for the same company and overlapping time periods (e.g., one structured record + one project-augmented record, or differently worded roles like \"CNC\" vs \"CNC Technician\" for the same period at the same company). Deduplication rule: As long as the company name is the same and the date ranges significantly overlap, treat them as a single continuous period regardless of slight differences in role titles. Calculate the true deduplicated relevant years first, then apply scoring based on the actual deduplicated timeline. Never add overlapping periods together, and strictly prevent duplicate entries from inflating `related_exp`.\n12. `verified:0` only means the industry database has not verified the company — it does NOT mean the company is in a different industry. The hard cap of 15 on `related_exp` only applies when the sales experience is from a **clearly different** sector (e.g. insurance sales for a CNC role, real estate sales for machine tools). Evidence of cross-industry mismatch: company name or job description contains clearly irrelevant keywords (insurance, finance, real estate, etc.), or the work content is explicitly unrelated to the target domain. If the candidate works in sales at an unverified company but the company name or description is domain-relevant (e.g. sales engineer at \"XYZ CNC Machinery Co.\"), score normally based on text evidence (40-80) even with `verified:0` — do not hard-cap to 15.\n13. When multiple rules give conflicting ceilings for the same scenario, apply the lowest value. For example: Rule 12 gives a hard cap of 15 (sales verified:0 + industry mismatch), while the scoring anchor floor gives 80 — when the industry does not match, the floor does not apply, so the 15 cap prevails.",
      "userPromptTemplate": "Please analyze how well the following candidate matches the job:\n\n## Job Information\n**Job Title**: {jobTitle}\n**Job Requirements**:\n{requirements}\n\n## Scoring Rules (weights and standards)\n{matchingRules}\n\n## Candidate Information\n**Name**: {candidateName}\n**Market**: {market}\n**Industry Database Verified Companies**: {verifiedCompanies}\n**Industry Database Brand Hits**: {brandHits}\n**Work-History Evidence**:\n{evidenceText}\n**Role Signals**:\n{roleSignals}\n\n## industry_db Scoring Rule (Important)\n- The runtime replaces the AI-provided `breakdown.industry_db` with a deterministic system score. Your output is for audit consistency only.\n- Use ONLY the provided `Market`, `Industry Database Verified Companies`, and `Industry Database Brand Hits` fields above. Do not guess hidden hits from company names.\n- For `Market = MY`: if both verified companies and brand hits are `none`, set `industry_db` to `40` (MY floor). If only verified companies or only brand hits contain a hit, set `industry_db` to `40`; if both contain hits, set `industry_db` to `50`.\n- For markets other than `MY`: if only verified companies or only brand hits contain a hit, set `industry_db` to `40`; if both contain hits, set `industry_db` to `50`; if both are `none`, `industry_db` may be `0`.\n\n## Keyword Joint-Satisfaction Rule (Important)\n- When job requirements contain multiple keywords (e.g. \"CNC sales\"), the candidate must satisfy ALL keywords' domain AND role simultaneously, not just one of them in isolation.\n- \"CNC sales\" means sales experience in the CNC domain, NOT \"any sales experience + any CNC-related history\".\n- If the candidate's sales experience comes from an unrelated industry (e.g. insurance sales for a CNC sales role), `related_exp` should be reduced to 0-15 because industry mismatch is a fundamental, non-transferable gap.\n- If the candidate has target-industry experience but not in a sales role, or has a sales role but not in the target industry, `related_exp` should not exceed 30.\n\n## Sales Experience Rule (Important)\n- Count direct sales experience only when the work-history role itself is explicitly sales, sales engineer, sales manager, business development, or a similar sales role.\n- If the role is application engineer, technical support, debugging, programming, training, R&D, presales support, or merely \"supporting sales\" / \"helping close orders\", do not count it as direct sales experience.\n- If `Role Signals` contain no direct sales role and the job is a sales role, significantly lower `related_exp` to avoid misclassifying technical-support candidates as strong sales matches.\n- Sales experience must be in the same industry/domain as the target role to count as high-match. Cross-industry generic sales experience (e.g. insurance sales, real estate sales) does not equal a sales match in the target industry.\n\n## related_exp Scoring Anchors (Important)\n- **Deduplicate First**: Before applying the anchors below, you must identify and merge duplicate entries for the same company and overlapping dates (even if role titles differ slightly, e.g., \"CNC\" vs \"CNC Technician\"). Calculate the true deduplicated relevant years first, and base your score strictly on this deduplicated actual timeline.\n- 85-100: The candidate's recent role is highly aligned with the target role AND industry domain, with verifiable direct duties/outcomes (for example, explicit sales ownership, territory/account scope, target attainment, or closed deals).\n- 70-84: Strong direct-role alignment with matching industry domain and relevant duties, but evidence depth or years are slightly weaker than top-tier.\n- 60-80 (Special case for verified:0 + Domain-Relevant): If the candidate does sales at an unverified company, but the company name/description is clearly domain-relevant (e.g., Sales Engineer at \"XYZ CNC Machinery Co.\", years:11, verified:0), you **MUST** score within this 60-80 band. It is strictly forbidden to penalize the score down to the 0-39 band simply because of `verified:0`. `verified:0` only means the industry database has not indexed the company — it does NOT mean cross-industry. When text evidence shows the company belongs to the target domain, treat it equivalently to `verified>0`.\n- 40-59: Partial or adjacent experience with transferability, but ONLY when the industry domain matches. If the industry does not match, do not score in this range.\n- 0-39: Little direct role evidence, or industry domain mismatch, or mostly support/collaboration duties that should not be treated as high match.\n- If `Role Signals` show a direct sales role (for example sales engineer/sales manager) with `verified` >= 3 years plus evidence of territory ownership, target attainment, or closed-deal outcomes, **AND the industry domain matches**, `related_exp` should not be below 80. This floor does not apply when the industry domain does not match. With `verified:0` this floor does not apply, but if the company name/description is domain-relevant, score 60-80 based on text evidence (see Rules 10/12).\n- **Hard ceiling**: `verified:0` only means the industry database has not verified the company — it does NOT mean the company is in a different industry. The hard cap of 15 only applies when the sales experience is from a **clearly different** sector (e.g. insurance sales for CNC, real estate sales for machine tools). Evidence of cross-industry mismatch: company name or job description contains clearly irrelevant keywords (insurance, finance, real estate, etc.). If the candidate works in sales at an unverified company but the company name or description is domain-relevant (e.g. sales engineer at \"XYZ CNC Machinery Co.\"), score normally based on text evidence (40-80) even with `verified:0` — do not hard-cap to 15. This rule has the highest priority and overrides the floor rule above.\n\n## Summary and Judgment Requirements\n- summary/highlights/concerns must prioritize the candidate's role focus, industry background, and directly relevant work history.\n- Prefer calling out the candidate's most recent or most relevant role title, industry or company background, and verifiable relevant years.\n- Do not simply restate total years of work or education unless those details directly affect the match decision.\n- If work-history evidence already contains role or company information, do not say that specific work experience was missing.\n- Do not output literal labels like `strong_match`, `match`, `potential`, or `no_match` inside summary text; keep the verdict in the recommendation field only.\n- **No strong-match prose on low bands**: when the final band is low (about <70, or recommendation is potential/no_match), summary must not claim \"strong match\", \"highly matched\", or \"priority hire\"; describe the evidence gap honestly.\n- **Structured brand signals**: Industry-DB brand hits may include `brandOrigin` (international|domestic|unknown) and `productClass` (complete_machine|tool_accessory|industrial_component|other). These are analysis inputs and do not change the score formula; reflect them in concerns:\n  - domestic-only brand hits for a premium imported machine-tool sales JD → call out domestic-brand risk;\n  - productClass=tool_accessory → cutting tools / accessories, not complete machines;\n  - productClass=industrial_component → industrial components / non-machine product sales.",
      "outputContract": "```text\nReturn the analysis as JSON and ensure score is numeric:\n{\n  \"score\": 30,\n  \"breakdown\": {\n    \"related_exp\": 20,\n    \"industry_db\": 10\n  },\n  \"recommendation\": \"strong_match\" | \"match\" | \"potential\" | \"no_match\",\n  \"highlights\": [\"Matching highlight 1\", \"Matching highlight 2\"],\n  \"concerns\": [\"Concern 1\", \"Concern 2\"],\n  \"summary\": \"English summary\",\n  \"keyFactors\": [\n    {\"factor\": \"technical_skills\", \"weight\": 0.4, \"value\": \"5 years CNC programming, 3 years FANUC systems\"},\n    {\"factor\": \"industry_experience\", \"weight\": 0.3, \"value\": \"Sales engineer at CNC machinery company for 7 years\"}\n  ],\n  \"screeningChecklist\": {\n    \"sellsMachines\": {\"verdict\": \"yes|no|unclear\", \"evidence\": \"<=60字证据引用\"},\n    \"machineOrigin\": {\"verdict\": \"international|domestic|unknown\", \"evidence\": \"...\"},\n    \"channel\": {\"verdict\": \"direct|distributor|unclear\", \"evidence\": \"...\"},\n    \"region\": {\"verdict\": \"<region text e.g. 华南>\", \"evidence\": \"...\"},\n    \"contactStatus\": {\"verdict\": \"valid|problem|unclear\", \"evidence\": \"...\"}\n  }\n}\n```\n\n### Screening Checklist (篩選檢查清單)\n- The 5 screening checklist items are determined item-by-item based on resume work-history evidence; each item must provide a quote of ≤60 characters of original text evidence; when a determination cannot be made, verdict must be \"unclear\"/\"unknown\" (or an empty string for region when no evidence exists); fabricating evidence is strictly forbidden.\n- sellsMachines: Judge whether the candidate actually sells/services machine products (complete machines, cutting tools/accessories, and industrial components all count as \"sells products\", but specify the product category in evidence) based solely on role signals and work entries. Completely lacking sales/service duties → \"no\".\n- machineOrigin: Determined solely based on `brandOrigin` from \"Industry Database Brand Hits\" and verified company information; when these fields are not provided or have no hits, it must be \"unknown\" and cannot be guessed from company names.\n- channel: direct = manufacturer direct sales / factory sales; distributor = agent / distributor sales; unknown/unclear → \"unclear\".\n- region: Extracted from location / responsible territory of the most recent work entry (e.g. South China / Guangdong / East China); no information → empty string verdict.\n- contactStatus: Evaluated as valid/problem/unclear based on resume activity (update time, presence of contact info, employment status evidence, etc.); mark \"problem\" only when evidence is explicit (such as resume noting resignation, missing contact info).\n- The screening checklist does not affect score/recommendation mathematical calculation; it serves solely as structured screening output.\n\n### breakdown Field Descriptions\n- `related_exp`: Scores how well the candidate's work-history evidence matches the target role (0-100). The LLM should treat this as an input related-experience factor that should be consistent with subsequent evidence ceilings. Runtime converts it into a 0-50 contribution using a fixed 50% weight.\n- `industry_db`: Scores known industry database company/brand hits (0-100, prompt-output reference only). Runtime replaces the AI-provided value with the rule-engine result (company hits + brand hits); the AI-provided value does not affect the final score.\n- The LLM `score` is an input related-experience factor and should match `breakdown.related_exp`; the system computes the final AI score after deterministic `industry_db` is available.\n- Final AI Score = `round(related_exp × 0.5) + system industry_db` (0-100). Do not include dimensions without grounded data.\n\n### keyFactors Field Description\n- `keyFactors`: Provide 3-6 key factors that most influenced the score, each containing:\n  - `factor`: A short category name (e.g., \"technical_skills\", \"industry_experience\", \"education\", \"role_relevance\")\n  - `weight`: Relative importance (0-1, all weights should sum to approximately 1.0)\n  - `value`: A brief human-readable description of the evidence from the candidate's resume",
      "promptVariables": "- `{jobTitle}`: Current job title.\n- `{requirements}`: Current job requirements or keyword-derived requirement text.\n- `{matchingRules}`: Scoring rules, either default scoring guidance or keyword-specific guidance.\n- `{candidateName}`: Candidate name.\n- `{market}`: Candidate market used by the deterministic MY scoring rule.\n- `{evidenceText}`: Strict work-history evidence extracted from resume history.\n- `{roleSignals}`: Structured role signals extracted from work history, prioritizing actual sales/engineering/technical-support roles.\n- `{verifiedCompanies}`: Companies verified against the industry database; shows \"none\" when no matches exist.\n- `{brandHits}`: Non-employer industry brand hits; shows \"none\" when no matches exist.\n- `{workExperience}`: (kept in hydration chain, not in template) Candidate total years of work experience.\n- `{education}`: (kept in hydration chain, not in template) Candidate education level.\n- `{companies}`: (kept in hydration chain, not in template) Candidate company summary.",
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
