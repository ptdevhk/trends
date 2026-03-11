---
version: 6
updated_at: '2026-03-11'
description: >
  English locale variant for the resume skills knowledge.
  Maintained alongside the zh-Hans canonical source for localized authoring.
---

# Skills Knowledge

This file provides structured domain knowledge for automated resume screening. `skills-knowledge.ts` parses the zh-Hans canonical file at runtime, while this English variant is kept in sync for localized authoring and review.

## Domain Taxonomy

Skills are organized by domain tags. Each domain includes a canonical tag, display name, and keyword set.

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

Maps variant terms to canonical forms for search expansion and matching normalization.

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

Keyword signals used to infer candidate experience level during ingest.

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

Key companies and brand aliases used for company recognition and industry verification.

- FANUC [role: both] (aliases: 发那科, Fanuc)
- SIEMENS [role: both] (aliases: 西门子, Siemens)
- STAR [role: both] (aliases: 斯大, スター精密, Star Micronics)
- BROTHER [role: both] (aliases: 兄弟, Brother Industries)
- MITSUBISHI [role: both] (aliases: 三菱, Mitsubishi Electric)
- HAAS [role: both] (aliases: 哈斯, Haas Automation)
- MAZAK [role: both] (aliases: 马扎克, 山崎马扎克, Yamazaki Mazak)
- DMG MORI [role: both] (aliases: 德马吉森精机, 德马吉, DMG森精机)
- MAKINO [role: both] (aliases: 牧野, マキノ)
- OKUMA [role: both] (aliases: 大隈, オークマ)
- CITIZEN [role: both] (aliases: 西铁城, 宫野, シチズン, Miyano)
- DOOSAN [role: both] (aliases: 斗山, 두산)
- HYUNDAI WIA [role: both] (aliases: 现代威亚, 현대위아)
- TSUGAMI [role: both] (aliases: 津上, つがみ)
- JINGDIAO [role: both] (aliases: 北京精雕, 精雕科技, 精雕集团)

Tier 1 - CNC / Machining
- HARDINGE [role: both] (aliases: 哈挺, Hardinge)
- YASDA [role: both] (aliases: 安田, ヤスダ)
- HERMLE [role: both] (aliases: 哈默, 赫姆勒)
- TOYODA [role: both] (aliases: 丰田工机, ジェイテクト)
- RENISHAW [role: equipment] (aliases: 雷尼绍, レニショー)
- TORNOS [role: both] (aliases: 特纳斯, Tornos Swiss)
- GF MACHINING [role: both] (aliases: 乔治费歇尔, 米科朗, 阿奇, Mikron, AgieCharmilles)
- OKK [role: both] (aliases: 大阪机工, オーケーケー)
- MATSUURA [role: both] (aliases: 松浦, マツウラ)
- HURCO [role: both] (aliases: 赫克, ハーコ)
- KURAKI [role: both] (aliases: 仓敷, クラキ)
- OKAMOTO [role: equipment] (aliases: 冈本, 冈本数控磨床)
- NACHI [role: both] (aliases: 不二越, NACHi)
- ROEDERS [role: equipment] (aliases: 罗德斯, Röders)
- LITZ [role: both] (aliases: 丽驰)
- TAKISAWA [role: both] (aliases: 泷泽, 台湾泷泽)
- TAKAMATSU [role: both] (aliases: 高松)
- NOMURA [role: both] (aliases: 野村)
- FIDIA [role: equipment] (aliases: 菲迪亚)

Tier 2 - EDM / Wire Cutting
- SODICK [role: equipment] (aliases: 沙迪克, ソディック)
- CHARMILLES [role: equipment] (aliases: 夏米尔, GF AgieCharmilles)

Tier 3 - Measurement / Metrology
- HEXAGON [role: equipment] (aliases: 海克斯康, ヘキサゴン)
- ZEISS [role: equipment] (aliases: 蔡司, 卡尔蔡司, Carl Zeiss)
- KEYENCE [role: equipment] (aliases: 基恩士, キーエンス)
- MITUTOYO [role: equipment] (aliases: 三丰, ミツトヨ)
- WENZEL [role: equipment] (aliases: 温泽, ヴェンツェル)
- FARO [role: equipment] (aliases: 法如, ファロ)
- CREAFORM [role: equipment] (aliases: 形创)
- MAHR [role: equipment] (aliases: 马尔)
- TESA [role: equipment] (aliases: 天萨)

Tier 4 - Tooling / Components
- SANDVIK [role: equipment] (aliases: 山特维克, サンドビック)
- MARPOSS [role: equipment] (aliases: 马波斯, マーポス)
- HEIDENHAIN [role: equipment] (aliases: 海德汉, ハイデンハイン)

Tier 5 - Domestic / Pearl River Delta
- 创世纪 [role: both] (aliases: 深圳创世纪, CGJ)
- 台群 [role: both] (aliases: 台群精机, Taiqun)
- 沈阳机床 [role: both] (aliases: 沈机, SMTCL)
- 润星科技 [role: both] (aliases: 润星, Runxing)
- 思瑞测量 [role: both] (aliases: 思瑞, CHOTEST)
- 秦川机床 [role: both] (aliases: 秦川, Qinchuan)
- 天准科技 [role: both] (aliases: 天准, TZTEK)
- 中图仪器 [role: both] (aliases: 中图, SinoAge)
- 纽威 [role: both] (aliases: 纽威数控, Neway)
- 程泰 [role: both] (aliases: 程泰机械, Goodway)
- 乔锋 [role: both] (aliases: 乔锋智能, Qiaofeng)

## Industry Context

Background notes used for AI prompt enrichment and domain understanding.

### CNC Machining Domain
CNC (Computer Numerical Control) machining uses programmed commands to automate machine tools. Core brands include FANUC, SIEMENS, STAR, BROTHER, and MITSUBISHI. Common machine types include lathes, machining centers, and multi-axis systems.

### Sales and Business Development
B2B sales for manufacturing equipment usually requires technical product knowledge, customer relationship management, and channel development capability. Typical keywords include key accounts, channels, and business development.

### Metrology and Quality
Precision measurement relies on CMM (Coordinate Measuring Machine), 3D scanning, and quality inspection workflows, which are critical to manufacturing QA/QC.

### Automation
Industrial automation commonly involves PLCs, servo systems, and robotics across factory automation and smart manufacturing scenarios.

## Exclusion Patterns

Tokens indicating irrelevant content such as ads and promotions. Matching resumes are flagged for review.

- exclude: ad, promo, 广告, 推广, 招商, 加盟, spam

## Learning Log (Compacted)

HR feedback patterns and observations. On 2026-03-10, 174 raw shortlist entries were compacted into 50 unique patterns. `shortlist_pattern` entries with `(Nx)` suffixes remain machine-readable as weighted signals.

- 2026-03-10: shortlist_pattern: sales + mid -> high_priority (22x)
- 2026-03-10: shortlist_pattern: sales + senior -> high_priority (19x)
- 2026-03-10: shortlist_pattern: sales/software + senior -> high_priority (16x)
- 2026-03-10: shortlist_pattern: sales/software + mid -> high_priority (14x)
- 2026-03-10: shortlist_pattern: machinery/cnc + unknown -> medium_priority (10x)
- 2026-03-10: shortlist_pattern: machinery/cnc + mid -> medium_priority (7x)
- 2026-03-10: shortlist_pattern: cnc + mid -> medium_priority (5x)
- 2026-03-10: shortlist_pattern: machinery + unknown -> medium_priority (5x)
- 2026-03-10: shortlist_pattern: machinery/sales/software + senior -> medium_priority (5x)
- 2026-03-10: shortlist_pattern: cnc + unknown -> medium_priority (5x)
- 2026-03-10: learning_log_compaction: aggregated 174 raw shortlist entries into 50 unique patterns for durable signal storage.
- 2026-03-10: processing pipeline now excludes selfIntro, jobIntention, and header experience from strict matching; work history is the sole evidence source for experience and scoring.
