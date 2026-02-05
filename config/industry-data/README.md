---
title: Industry Data Configuration
description: User-managed keywords, companies, and brand data for resume matching
version: 1.0
last_updated: 2026-02-05
---

# Industry Data

This directory contains user-customizable data for the precision machinery and machine tool industry. The data is used for:

1. **Resume-JD Matching**: Validate company names and skills against known entities
2. **AI Verification**: Cross-reference candidate work history against known companies
3. **Skill Taxonomy**: Map candidate skills to industry-standard keywords
4. **Brand Recognition**: Identify experience with specific equipment brands

## Files

| File | Purpose | Records |
|------|---------|---------|
| `keywords-structured.md` | Structured tables with companies, keywords, brands | ~800+ entries |
| `keywords-raw.md` | Raw text format for quick reference | ~700 lines |
| `company-urls.md` | Company website URLs for verification | 11 URLs |

## Data Categories

### Companies (~400+)
- **Key Companies**: Major industry players
- **ITES Exhibitors**: 223 companies from Shenzhen Industrial Exhibition
  - Metal cutting machines: 141 companies
  - Other categories: 82 companies

### Technical Keywords (~100+)
- Machining centers: CNC, 5-axis, milling, drilling
- Lathes: Swiss-type, turn-mill, turret
- EDM/Wire cutting: Wire EDM, spark machines
- Measurement: CMM, 3D scanning, ATOS
- SMT: Pick and place, reflow, AOI
- 3D Printing: Additive manufacturing

### Brands (~120+)
- **International**: MAZAK, MAKINO, FANUC, DMG, Zeiss, ATOS, GOM
- **Domestic**: 创世纪, 台群, 思瑞, 天准
- **Import Agents**: 东源, 大川, 金承诺, 领哲

## Usage in Resume Screening

```typescript
// Example: Load keywords for matching
import { loadIndustryData } from '@/services/industry-data';

const data = loadIndustryData();
// data.companies: Company[]
// data.keywords: Keyword[]
// data.brands: Brand[]

// Verify company exists in known list
const isKnown = data.companies.some(c => 
  resume.company.includes(c.name)
);

// Match skills against taxonomy
const matchedSkills = data.keywords.filter(k =>
  resume.skills.some(s => s.includes(k.keyword))
);
```

## Updating Data

Users can edit these files directly:

1. **Add new companies**: Edit `keywords-structured.md` tables
2. **Add keywords**: Add to appropriate category in section 3
3. **Add brands**: Add to section 4 under correct classification
4. **Add company URLs**: Append to `company-urls.md`

## File Format

### keywords-structured.md
YAML frontmatter + Markdown tables:
```markdown
---
title: 精密机械与机床行业资源汇总
categories: [precision_machinery, cnc_machines, ...]
---

## 1. 重点企业列表 (Key Companies)
| ID | 公司名称 | 英文名称 | 类型 |
...
```

### company-urls.md
Simple URL list (one per line):
```
https://www.leeport.com.hk/
https://www.yamazen.com.cn/
...
```

## API Integration (Future)

These files will be parsed to provide:
- `GET /api/industry/companies` - List known companies
- `GET /api/industry/keywords` - List technical keywords
- `GET /api/industry/brands` - List equipment brands
- `POST /api/industry/verify` - Verify company/skill exists
