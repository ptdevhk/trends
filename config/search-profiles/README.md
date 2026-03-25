# Search Profiles

This directory contains pre-configured search profiles that combine:
- Location
- Keywords
- Job Description reference
- Filter settings
- Automation settings (currently crawl scheduling only)
- Source routing and optional AI review behavior

## Runtime Status

The current worker runtime actively uses these profile fields:
- `location`
- `keywords`
- `requiredKeywords`
- `filters`
- `jobDescription`
- `schedule.enabled`
- `schedule.cron`
- `schedule.timezone`
- `schedule.maxCandidates`

The current worker runtime does **not** yet execute profile-level notification or summary triggers from YAML.
Keep summary delivery on the dedicated summary pipeline and env-driven worker summary job for now.

## Usage

Search profiles are routing presets for automated resume collection and matching with minimal operator input.

### Quick Start

1. User enters **location + keywords**
2. System auto-matches to a search profile (or creates a new one)
3. All other settings are pre-configured

### Creating a Profile

```yaml
# example-profile.yaml
id: dongguan-lathe-sales
name: 东莞车床销售招聘
description: 东莞地区车床销售岗位

# Core inputs
location: 东莞
keywords:
  - 车床
  - 销售
  - CNC

# Auto-linked job description
jobDescription: lathe-sales

# Filter settings (can use preset or custom)
filterPreset: sales-mid
# OR custom filters:
# filters:
#   minExperience: 2
#   maxExperience: 8
#   education: [大专, 本科]
#   salaryRange: { min: 8000, max: 20000 }

# Automation
schedule:
  enabled: true
  cron: "0 9 * * 1-5"  # Mon-Fri 9:00 AM
  timezone: Asia/Shanghai

# Notifications metadata
# Note: this block is not executed by the current worker runtime.
notifications:
  enabled: true
  channels:
    - type: wechat_work
      webhook: ${WECHAT_WORK_WEBHOOK}
    - type: email
      recipients:
        - hr@company.com

# Optional AI review settings
# Keep deterministic scoring as the default engine; use AI only on shortlisted resumes.
ai:
  pipeline:
    - stage: review
      model: openai/gpt-5-mini
      threshold: 70
      batchSize: 20
```

## File Format

- YAML format (`.yaml` or `.yml`)
- Frontmatter-style metadata supported
- Environment variable substitution: `${VAR_NAME}`

## API Integration

```bash
# List all profiles
curl http://localhost:3000/api/search-profiles

# Run a profile
curl -X POST http://localhost:3000/api/search-profiles/dongguan-lathe-sales/run

# Create from quick start
curl -X POST http://localhost:3000/api/search-profiles/quick-start \
  -H "Content-Type: application/json" \
  -d '{"location": "东莞", "keywords": ["车床", "销售"]}'
```

## Files

- `dongguan-lathe-sales.yaml`: example routing preset with active crawl scheduling plus optional metadata blocks that are not all executed by the worker today
