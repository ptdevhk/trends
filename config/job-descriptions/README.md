# Job Descriptions for Resume Screening

This directory contains job description templates used for AI-powered resume matching.

## Format

Each JD file uses Markdown with YAML frontmatter:

```markdown
---
id: jd-unique-id
title: 职位名称
department: 部门
location: 工作地点
salary_range:
  min: 5000
  max: 15000
  currency: CNY
  period: month
---

# Position Description
...

# Required Criteria
- Criterion 1
- Criterion 2

# Preferred Criteria
- Criterion 1

# Scoring Rules
- Required: 20 points each
- Preferred: 10 points each
- Passing threshold: 70

# Keywords
keyword1, keyword2, keyword3
```

## Files

- `cpp-software-engineer.md` - C++软件开发工程师
- `3d-scanner-sales.md` - 三维扫描设备销售工程师
- `lathe-sales.md` - 车床销售工程师
- `machining-center-sales.md` - 销售工程师（加工中心）
- `senior-mechanical-engineer.md` - 高级机械工程师
- `overseas-sales.md` - 销售工程师（越南/泰国/马来西亚）
- `five-axis-application.md` - 五轴应用工程师
- `fixture-engineer.md` - 夹具工程师

*Source: Extracted from hr.job5156.com on 2026-02-05*


## Usage

JD files are loaded by the resume matching system to:
1. Extract structured requirements
2. Generate AI matching prompts
3. Calculate match scores against resumes
