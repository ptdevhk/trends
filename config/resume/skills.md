---
version: 1
updated_at: '2026-02-21'
description: >
  Curated skill taxonomy, synonyms, and domain knowledge for resume screening.
  Used by the background ingest agent for deterministic matching and pre-scoring.
  This file consolidates data from rule-scoring.ts, resume-index.ts, and skills_words.txt.
---

# Skills Knowledge

This file provides structured domain knowledge for automated resume screening. It is parsed by `skills-knowledge.ts` and used by the background ingest agent to pre-compute matching signals on new resume arrival.

## Domain Taxonomy

Skills are organized by domain tags. Each domain has a canonical tag, display name, and associated keywords.

### machinery
- displayName: Machinery
- keywords: 机床, 车床, 加工中心, 机械, 设备, 五轴, 夹具, 治具, lathe, machining, milling

### cnc
- displayName: CNC
- keywords: cnc, 数控, fanuc, siemens, star, brother, mitsubishi

### sales
- displayName: Sales
- keywords: 销售, 业务, 客户, 大客户, 渠道, sales, account, bd, market, engineer

### automation
- displayName: Automation
- keywords: 自动化, 机器人, plc, 伺服, automation

### metrology
- displayName: Metrology
- keywords: 测量, 三维扫描, 3d, cmm, metrology, scan

### software
- displayName: Software
- keywords: c++, c#, mfc, qt, 软件, 开发, algorithm, python

## Synonym Table

Maps variant terms to canonical forms. Used for synonym expansion in search and matching.

- 机床: 机械设备, 加工设备
- 车床: CNC车床, 数控车床
- 加工中心: machining center, machining-center, 加工设备
- 五轴: 5-axis, 五轴联动
- 夹具: 治具, fixture
- 数控: CNC, Computer Numerical Control
- 销售: 业务, 商务, 销售员
- 大客户: 渠道客户, key account, 关键客户
- 自动化: automation, 工业自动化
- 机器人: robot, 工业机器人
- 测量: 计量, measurement, 质量检测
- 三维扫描: 3D扫描, 3d-scan, 三维测量
- CMM: 三坐标, 三坐标测量机
- 软件: software, 程序, 应用

## Experience Signals

Keywords that indicate experience level. Used by the ingest agent to classify candidates.

### senior
- displayName: Senior Level
- keywords: 团队管理, 大客户, 渠道拓展, 主管, 经理, manager, lead, director, 带团队, 培训, 项目管理

### mid
- displayName: Mid Level
- keywords: 独立, 熟练, 精通, 负责, 专员, specialist, coordinator, 项目, 方案

### junior
- displayName: Junior Level
- keywords: 应届, 实习, 助理, assistant, trainee, intern, 学习, 协助, 初级

## Company Patterns

Known companies in the target industry with name variations. Used for company recognition and industry context.

- FANUC (aliases: 发那科, Fanuc)
- SIEMENS (aliases: 西门子, Siemens)
- STAR (aliases: 津上, スター精密, Star Micronics)
- BROTHER (aliases: 兄弟, Brother Industries)
- MITSUBISHI (aliases: 三菱, Mitsubishi Electric)
- HAAS (aliases: 哈斯, Haas Automation)
- MAZAK (aliases: 马扎克, Yamazaki Mazak)
- DMG MORI (aliases: 德马吉森精机, DMG森精机)
- MAKINO (aliases: 牧野, マキノ)
- OKUMA (aliases: 大隈, オークマ)
- CITIZEN (aliases: 西铁城, シチズン)
- DOOSAN (aliases: 斗山, 두산)
- HYUNDAI WIA (aliases: 现代威亚, 현대위아)
- TSUGAMI (aliases: 津上, つがみ)
- JINGDIAO (aliases: 北京精雕, 精雕)

## Industry Context

Background information for AI prompt enrichment and domain understanding.

### CNC Machining Domain
CNC (Computer Numerical Control) machining involves automated control of machine tools using programmed commands. Key brands include FANUC, SIEMENS, STAR, BROTHER, and MITSUBISHI. Common machine types: lathes (车床), machining centers (加工中心), multi-axis systems (五轴).

### Sales and Business Development
B2B sales in manufacturing equipment requires technical knowledge of machinery, customer relationship management, and channel development. Keywords: 大客户 (key accounts), 渠道 (channels), 业务拓展 (business development).

### Metrology and Quality
Precision measurement using CMM (Coordinate Measuring Machine), 3D scanning, and quality inspection. Critical for manufacturing QA/QC processes.

### Automation
Industrial automation using PLCs (Programmable Logic Controllers), servo systems, and robotics. Common in factory automation and smart manufacturing.

## Exclusion Patterns

Tokens that indicate irrelevant content (ads, promotions). Resumes containing these are flagged for review.

- exclude: ad, promo, 广告, 推广, 招商, 加盟, spam

## Learning Log (Append Only)

HR feedback patterns and observations. New entries are appended by the feedback loop (M6).

<!-- Future feedback entries will be added here in the format:
- YYYY-MM-DD: observation or pattern
-->
