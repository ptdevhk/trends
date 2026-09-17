# Research gnews hit-rate lab — unattended (2026-09-17)

Measures whether Google News RSS queries built the way the existing `gnews-*`
feeds are built (`config/config.yaml` `rss.feeds`) can lift the Phase A 订阅
counts for the pulse brands in `config/research_pulse_keywords.yaml`
(宝力机械 / 宝惠 / 创世纪 / 乔锋 + 压铸). Anonymous GET only — no login, no
Docker, no scraping of `mp.weixin.qq.com`.

**Important framing:** the existing `gnews-*` feeds are **day-one TrendRadar**
sources, not a connector-catalog win. This lab only checks whether more of the
*same kind* of Google News query would add signal for the missing brands.

## Baseline — existing `gnews-*` (L1)

All hit with `hl=zh-CN&gl=CN&ceid=CN:zh-Hans` (except `gnews-fanuc-en`, which is
`en-US` by design). HTTP 200 `application/xml` on all.

| Feed | Query | HTTP | Items | Maps to pulse chip | Would it lift 订阅? |
|------|-------|------|-------|--------------------|----------------------|
| `gnews-fanuc-cn` | 发那科 | 200 | **92** | 发那科 (brands) | yes (already live) |
| `gnews-fanuc-hire` | 发那科 招聘 | 200 | 5 | 发那科 + 招聘 | minor |
| `gnews-fanuc-en` | FANUC CNC | 200 | 56 | 发那科 (en) | yes (already live) |
| `gnews-mazak-cn` | 马扎克 | 200 | 58 | 马扎克 (brands) | yes (already live) |
| `gnews-makino-cn` | 牧野 机床 | 200 | 11 | 牧野 (brands) | minor |
| `gnews-cnc-machine` | 数控 机床 | 200 | 100 | 数控 (cnc-core) | yes (already live) |
| `gnews-cnc-hiring` | 数控 招聘 | 200 | 26 | 数控 + 招聘 | minor |
| `gnews-robot-cnc` | 工业机器人 机床 | 200 | 64 | 数控 / 机床 | yes (already live) |

## Candidate queries (L2)

Same URL shape as `gnews-fanuc-cn` (`q=<query>&hl=zh-CN&gl=CN&ceid=CN:zh-Hans`).

| Candidate feed | Query | HTTP | Items | Maps to pulse chip | Would it lift 订阅? |
|----------------|-------|------|-------|--------------------|----------------------|
| `gnews-baoli` | 宝力机械 | 200 | **1** | 宝力机械 (brands) | **No** — single irrelevant hit (HK Tech 300 黎鋭敏, stable over 2 runs) |
| `gnews-polywell` | 宝惠 | 200 | **63** | 宝惠 (brands) | **No** — all hits are 东宝药业/惠升/惠科, **not** the 宝惠 CNC brand; keyword noise |
| `gnews-genesis` | 创世纪机床 | 200 | **17** | 创世纪 (brands) | **Yes** (创世纪 machine-tool specific; titles are on-topic) |
| `gnews-genesis-bare` | 创世纪 | 200 | **100** | 创世纪 (brands) | **Yes, more volume** — but includes 创世纪(300083) financial-noise; bare query is noisier |
| `gnews-qiaofeng` | 乔锋机床 | 200 | **12** | 乔锋 (brands) | **Yes** (乔锋智能 on-topic) |
| `gnews-qiaofeng-bare` | 乔锋 | 200 | **100** | 乔锋 (brands) | **Yes, more volume** — includes 乔锋智能 finance/quote noise |
| `gnews-diecast` | 压铸 | 200 | **100** | 压铸 (die-cast industry, 订阅-facing) | **Yes** (东风一体化压铸 etc., on-topic) |

## Decision (L4)

Add `enabled: false` stubs for every candidate with `items > 0`:

- `gnews-genesis` (创世纪机床, 17) — **kept** as the on-topic variant.
- `gnews-qiaofeng` (乔锋机床, 12) — **kept** as the on-topic variant.
- `gnews-diecast` (压铸, 100) — **kept**.
- `gnews-polywell` (宝惠, 63) — **kept stub but flagged**: high item count is
  homonym noise (惠升/惠科/东宝药业), not the 宝惠 CNC brand; disabled default
  means it will not pollute ingest until an operator reviews titles.
- `gnews-baoli` (宝力机械, 1) — **stub kept** (1 item is not zero, but it is an
  irrelevant HK Tech 300 mention; flag for operator review).

Bare `创世纪` / `乔锋` (100-item) variants are **not** stubbed to avoid financing
news noise; `创世纪机床` / `乔锋机床` are the on-topic picks.

All stubs are `enabled: false` and must stay that way in committed config.

## Result

- Baseline gnews set: all 8 feeds healthy (200, 11–100 items).
- Of the candidate brand queries, only `创世纪机床` / `乔锋机床` / `压铸` would
  cleanly lift 订阅 for the missing brands. `宝力机械` and `宝惠` are effectively
  **dead queries** (1 irrelevant hit / homonym noise) — Google News does not index
  those brand names usefully, so no single query fix will help them.
- This is a measurement, not a Phase B claim: these would still ride the same
  existing gnews RSS lane (`rss:gnews-*`) and need operator enablement.
