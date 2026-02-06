# Job Descriptions for Resume Screening

This directory contains job description templates used for AI-powered resume matching.

## Format

Each JD file uses Markdown with YAML frontmatter. The frontmatter includes **auto-matching configuration** for minimal human-in-the-loop operation.

### Full Example

```markdown
---
id: jd-unique-id
title: 职位名称
title_en: English Job Title
department: 部门
location: 工作地点
source: hr.job5156.com
extracted_at: "2026-02-05"
status: active  # active, draft, closed

# Auto-matching configuration (for minimal human-in-the-loop)
auto_match:
  # Keywords that trigger auto-selection of this JD
  keywords:
    - 关键词1
    - 关键词2
  # Locations where this JD applies
  locations:
    - 东莞
    - 广州
  # Priority when multiple JDs match (higher = preferred, 0-100)
  priority: 80
  # Suggested filter preset (from config/resume/filter-presets.json5)
  filter_preset: sales-mid
  # Custom filter suggestions (overrides preset partially)
  suggested_filters:
    minExperience: 2
    education: ["大专", "本科"]
    salaryRange: { min: 8000, max: 20000 }
---

# 职位描述 (Position Description)

岗位职责描述...

# 职位要求 (Job Requirements)

1. 要求一
2. 要求二

# 必要条件 (Required Criteria)

- 必要条件1
- 必要条件2

# 优先条件 (Preferred Criteria)

- 优先条件1

# 评分规则 (Scoring Rules)

| 条件类型 | 分值 | 说明 |
|---------|------|------|
| 必要条件 | 20分/项 | 最高60分 |
| 优先条件 | 10分/项 | 最高30分 |
| 及格线 | 70分 | 推荐面试 |

# 关键词 (Keywords)

keyword1, keyword2, keyword3
```

## Auto-Matching System

When a user enters search keywords (e.g., "车床 销售"), the system:

1. **Matches keywords** against all JD `auto_match.keywords`
2. **Filters by location** if user specified a location
3. **Ranks by priority** when multiple JDs match
4. **Returns best match** with confidence score

### API Usage

```bash
# Auto-match endpoint
curl -X POST http://localhost:3000/api/job-descriptions/match \
  -H "Content-Type: application/json" \
  -d '{"keywords": ["车床", "销售"], "location": "东莞"}'

# Response
{
  "success": true,
  "match": {
    "jobDescriptionId": "lathe-sales",
    "title": "车床销售工程师",
    "confidence": 0.92,
    "matchedKeywords": ["车床", "销售"],
    "suggestedFilters": { ... }
  },
  "alternatives": [ ... ]
}
```

## Files

| File | Title | Primary Keywords | Priority |
|------|-------|------------------|----------|
| `lathe-sales.md` | 车床销售工程师 | 车床, STAR, CNC车床 | 90 |
| `machining-center-sales.md` | 销售工程师（加工中心） | 加工中心, CNC | 85 |
| `cpp-software-engineer.md` | C++软件开发工程师 | C++, C#, MFC | 80 |
| `3d-scanner-sales.md` | 三维扫描设备销售工程师 | 三维扫描, 3D | 85 |
| `senior-mechanical-engineer.md` | 高级机械工程师 | 机械, 结构设计 | 80 |
| `overseas-sales.md` | 销售工程师（海外） | 海外, 越南, 泰国 | 75 |
| `five-axis-application.md` | 五轴应用工程师 | 五轴, 应用工程师 | 80 |
| `fixture-engineer.md` | 夹具工程师 | 夹具, 治具 | 75 |

*Source: Extracted from hr.job5156.com on 2026-02-05*

## Usage

JD files are loaded by the resume matching system to:

1. **Auto-select** based on user's search keywords
2. **Extract structured requirements** for AI matching
3. **Apply suggested filters** automatically
4. **Generate AI matching prompts** with requirements + criteria
5. **Calculate match scores** against resumes

## Creating New JDs

1. Copy an existing JD as template
2. Update frontmatter with new ID, title, and auto_match config
3. Fill in job requirements and criteria
4. Add relevant keywords
5. Test with `make test-jd-match KEYWORD="your keywords"`

## Best Practices

- **Keywords**: Include common variations and abbreviations
- **Priority**: Set higher for more specific/common positions
- **Filters**: Set realistic defaults based on market data
- **Scoring**: Keep scoring rules consistent across similar roles
