# Search Profiles

This directory contains pre-configured search profiles that combine:
- Location
- Keywords
- Job Description reference
- Filter settings
- Automation settings (scheduling, notifications)

## Usage

Search profiles are the primary way to run automated resume collection and matching with minimal user input.

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

# Notifications
notifications:
  enabled: true
  channels:
    - type: wechat_work
      webhook: ${WECHAT_WORK_WEBHOOK}
    - type: email
      recipients:
        - hr@company.com
  triggers:
    - event: new_high_match    # Score >= 80
    - event: daily_summary

# AI matching settings (optional, uses defaults if omitted)
ai:
  screenerThreshold: 50
  evaluatorThreshold: 70
  maxCandidatesPerRun: 200
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

_No profiles yet. Create your first profile!_
