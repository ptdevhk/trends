---
version: 10
updated_at: '2026-07-23'
description: >
  简历筛选技能知识库（zh-Hans 主文件）。
  用于背景计算代理的确定性匹配、同义词扩展与预评分。
  该文件整合了规则评分、简历索引与行业词库配置。
---

# 技能知识库

本文件提供用于自动化简历筛选的结构化领域知识。`skills-knowledge.ts` 会解析该文件，供背景 ingest 代理在简历入库时预计算匹配信号。

## 领域分类

技能按领域标签组织。每个领域都包含 canonical tag、展示名称与关键词。

### machinery
- displayName: 机械
- keywords: 机床, 车床, 加工中心, 机械, 设备, cnc, 数控, machine tools, machining center, precision machinery, precision machining, cnc machine

### sales
- displayName: 销售
- keywords: 销售, 业务, 销售工程师, 销售经理, 业务拓展, 大客户, 渠道, sales, account, key account, bd, business development, sales engineer, sales manager, account manager, business development manager, key account manager, channel sales, channel manager

### metrology
- displayName: 测量
- keywords: 测量, 三维扫描, 3d, cmm, metrology, measurement, 3d scanning, coordinate measuring machine, quality inspection, scan

### software
- displayName: 软件
- keywords: c++, c#, mfc, qt, 软件, 开发, algorithm, python

## 同义词表

将变体术语映射到标准形式，用于搜索扩展与匹配归一化。

- 车床: CNC车床, 数控车床, cnc lathe
- 加工中心: machining center, machining-center, vertical machining center, horizontal machining center, 加工设备, machine tool, precision machining
- 五轴: 5-axis, 五轴联动
- 夹具: 治具, fixture
- 数控: CNC, Computer Numerical Control, 数控加工, 机床, 机械设备, 加工设备, machine tools, cnc machine, cnc machines, precision machinery, 机械, 创世纪, 津上, tsugami, 冈本, okamoto
- 销售: 业务, 商务, 销售员
- 销售工程师: sales engineer, technical sales, technical sales engineer, 售前销售, 技术销售
- 销售经理: sales manager, regional sales manager, territory sales manager
- 业务拓展: business development, business development manager, bd manager
- 大客户: 渠道客户, key account, key account manager, account manager, 关键客户
- 渠道: channel sales, channel manager, channel partner, channel partners, distributor, distributors, dealer, dealers
- 机床销售: 车床销售, cnc销售, 数控机床销售, machine tool sales, cnc machine sales
- 应用工程师: application engineer, applications engineer
- 机器人: robot, 工业机器人
- 测量: 计量, measurement, metrology, quality inspection, dimensional inspection, 质量检测
- 三维扫描: 3D扫描, 3d-scan, 3d scanning, 3d scanner, 三维测量
- CMM: 三坐标, 三坐标测量机, coordinate measuring machine
- 软件: software, 程序, 应用

## 经验等级信号

用于识别候选人经验层级的关键词信号，供 ingest 代理做确定性分层。

### senior
- displayName: 资深
- keywords: 团队管理, 大客户, 渠道拓展, 主管, 经理, manager, lead, director, 带团队, 培训, 项目管理, head of, vp, chief, senior, principal, overseeing, led team, leadership

### mid
- displayName: 中级
- keywords: 独立, 熟练, 精通, 负责, 专员, specialist, coordinator, 项目, 方案, experienced, proficient, responsible for, managed, intermediate

### junior
- displayName: 初级
- keywords: 应届, 实习, 助理, assistant, trainee, intern, 学习, 协助, 初级, entry level, fresh graduate, graduate, no experience, beginner

## 角色信号策略

### sales
- directTitleSignals: 销售工程师, 销售经理, 销售主管, 业务拓展, 业务开发, account manager, key account manager, business development manager, channel manager, channel sales, sales engineer, sales manager, sales supervisor
- contextSignals: 销售, 业务, 大客户, 渠道, 客户开发, sales, account, key account, business development, bd
- auxiliaryPrefixes: 配合, 协助, 辅助, 支持, 协同
- directDutyCues: 客户, 渠道, 订单, 回款, 报价, 开拓, 拓展, 拜访, 维护, 成交, 合同, 经销, 代理商, 经销商, 大客户

## 公司数据库

目标行业内的重点公司与品牌别名，用于公司识别与行业背景验证。

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

第一梯队 - CNC / 加工
- HARDINGE [role: both] (aliases: 哈挺, Hardinge)
- YASDA [role: both] (aliases: 安田, ヤスダ)
- HERMLE [role: both] (aliases: 哈默, 赫姆勒)
- TOYODA [role: both] (aliases: 丰田工机, ジェイテクト, 捷太格特, JTEKT, JTEKT机床, 捷太格特机床)
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

第二梯队 - EDM / 线切割
- SODICK [role: equipment] (aliases: 沙迪克, ソディック)
- CHARMILLES [role: equipment] (aliases: 夏米尔, GF AgieCharmilles)

第三梯队 - 测量 / 计量
- HEXAGON [role: equipment] (aliases: 海克斯康, ヘキサゴン)
- ZEISS [role: equipment] (aliases: 蔡司, 卡尔蔡司, Carl Zeiss)
- KEYENCE [role: equipment] (aliases: 基恩士, キーエンス)
- MITUTOYO [role: equipment] (aliases: 三丰, ミツトヨ)
- WENZEL [role: equipment] (aliases: 温泽, ヴェンツェル)
- FARO [role: equipment] (aliases: 法如, ファロ)
- CREAFORM [role: equipment] (aliases: 形创)
- MAHR [role: equipment] (aliases: 马尔)
- TESA [role: equipment] (aliases: 天萨)

第四梯队 - 刀具 / 零部件
- SANDVIK [role: equipment] (aliases: 山特维克, サンドビック)
- MARPOSS [role: equipment] (aliases: 马波斯, マーポス)
- HEIDENHAIN [role: equipment] (aliases: 海德汉, ハイデンハイン)

第五梯队 - 国产 / 珠三角
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
- 蕙勒 [role: both] (aliases: 蕙勒智能, 蕙勒智能科技, Huile)
- 唯思凌科 [role: both] (aliases: 湖北唯思凌科, 唯思凌科装备, WSLK)

## 行业背景

供 AI 提示增强与领域理解使用的行业背景说明。

### 机械加工领域
机械加工场景包含 CNC（Computer Numerical Control，计算机数控）机床、加工中心、车床与五轴系统。核心品牌包括 FANUC、SIEMENS、STAR、BROTHER 与 MITSUBISHI，相关数控信号统一归入 machinery 领域。

### 销售与业务拓展
制造业设备 B2B 销售通常需要设备技术理解、客户关系管理与渠道开发能力。优先关注销售工程师、销售经理、大客户、渠道销售与业务拓展等复合角色表达，覆盖常见英文头衔如 sales engineer、account manager、business development manager，避免将泛化 engineer 词汇直接视为销售信号。

### 测量与质量
精密测量通常依赖 CMM（三坐标测量机）、3D 扫描与质量检测流程，是制造业 QA/QC 的关键环节；英文 Seek 简历中常见的 metrology、quality inspection 与 coordinate measuring machine 也应归入同一测量语义。

## 排除模式

表示无关内容（如广告、推广）的 token。命中后会被标记为需复核。

- exclude: ad, promo, 广告, 推广, 招商, 加盟, spam

## 学习日志（压缩版）

HR 反馈模式与观察记录。已于 2026-03-10 从 174 条原始 shortlist 记录压缩为 50 个唯一模式。带 `(Nx)` 后缀的 `shortlist_pattern` 仍保持机器可读，用于表示信号强度。

- 2026-03-10: shortlist_pattern: sales + mid -> high_priority (22x)
- 2026-03-10: shortlist_pattern: sales + senior -> high_priority (19x)
- 2026-03-10: shortlist_pattern: sales/software + senior -> high_priority (16x)
- 2026-03-10: shortlist_pattern: sales/software + mid -> high_priority (14x)
- 2026-03-10: shortlist_pattern: machinery + unknown -> medium_priority (10x)
- 2026-03-10: shortlist_pattern: machinery + mid -> medium_priority (7x)
- 2026-03-10: shortlist_pattern: machinery + mid -> medium_priority (5x)
- 2026-03-10: shortlist_pattern: machinery + unknown -> medium_priority (5x)
- 2026-03-10: shortlist_pattern: machinery/sales/software + senior -> medium_priority (5x)
- 2026-03-10: shortlist_pattern: machinery + unknown -> medium_priority (5x)
- 2026-03-10: learning_log_compaction: aggregated 174 raw shortlist entries into 50 unique patterns for durable signal storage.
- 2026-03-10: processing pipeline now excludes selfIntro, jobIntention, and header experience from strict matching; work history is the sole evidence source for experience and scoring.
