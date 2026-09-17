# Research mp connector probe — unattended spike (2026-09-17)

Anonymous-only probe of the `config/research-mp-connectors.yaml` plugins. No
WeChat/WeRead login, no QR, no Docker/sidecar install, no Mp2RSS signup, no
BFF WeChat scrape. Purpose: record what each connector actually returns today so
a Phase B operator knows which are even worth pursuing.

## Summary table

| Plugin | Probe URL (secrets redacted) | HTTP status | RSS items / error | Can it fill Phase A 订阅 without operator login? | Next operator step |
|--------|------------------------------|-------------|-------------------|--------------------------------------------------|--------------------|
| **gnews control** (`config.yaml` `rss.feeds`) | `https://news.google.com/rss/search?q=发那科&hl=zh-CN&gl=CN&ceid=CN:zh-Hans` | 200, `application/xml` | **91 items** | — (baseline: proves worker ingest path works) | none |
| **we-mp-rss** (self-host) | `127.0.0.1:{8001,8080,4000,8000}/feeds/` | connection refused on all; **3000 is the Trends BFF** (热点追踪 API), not WeRSS | 0 | **No** — nothing listening locally | Stand up the fork on a host (install + WeChat login), then set `enabled: true` + real URL per runbook §1a |
| **wechat2rss** (hosted-mirror) | `https://wechat2rss.xlab.app/list/all/` | 200 `text/html` (308→200 after redirect) | 395 listed feeds; `https://wechat2rss.xlab.app/feed/<40-hex>.xml` → 200 `application/xml`, **20 items each** | **Maybe** — public feed URLs exist, but **no 压铸/机床/CNC/FANUC 公众号 listed** (only machinery-adjacent `先生制造` = 20 items, generic manufacturing/essays) | Operator must confirm a CNC 公众号 feed exists (or add one); then paste the real `feed/<hash>.xml` URL into the catalog. Hosted mirror — no install. |
| **mp2rss** (saas) | `https://mp2rss.bugcode.dev/` + `/api/feeds` | app 200 `text/html`; **`/api/*` 401** (`application/json`), login/注册 wall | 0 (API requires auth) | **No** (unless operator signs up and supplies an API token) | Operator signs up for Mp2RSS (out of scope here), gets a feed/API token, pastes real URL. OAuth/GitHub-Google login not tested. |
| **wewe-rss** (archived) | `https://api.github.com/repos/cooderl/wewe-rss` | 200 | n/a | **No** — `archived: true`, last push 2026-03-20 | **Do not use.** Loader already refuses it unconditionally (W3-2). |

## Detailed probes

### Control — gnews (proves ingest works)

- URL from `config.yaml` `rss.feeds[gnews-fanuc-cn]`.
- `curl` → **200**, `content-type: application/xml; charset=utf-8`, **94,789 bytes**, **91 `<item>`**.
- First titles: 上海发那科2027校园招聘 / 工业机器人四大家族壁垒 / 发那科+谷歌 AI 焊接智能体. Ingest path for a working feed is confirmed.

### we-mp-rss (self-host, catalog `recommended`)

- `config/research-mp-connectors.yaml` default catalog contributes **zero feeds**: `load_mp_connector_feeds()` → `[]`; `load_rss_feeds()` → 10 (all `config.yaml`), no `werss-*` ids.
- Local TCP probe of common WeRSS ports (`127.0.0.1`):
  - `8001`, `8080`, `4000`, `8000` → **Connection refused**.
  - `3000` → **connected but it is the Trends BFF** (`{"name":"热点追踪 API","version":"0.4.23"…}`, `GET /feeds/` → 404). **Not WeRSS.**
  - `8317` is the CPA proxy on ptcloud and was **not** probed as WeRSS (per constraint); it returned connection refused from this host anyway.
- Verdict: no local WeRSS sidecar is running; Phase A 订阅 cannot be filled by this connector until an operator installs + logs in.

### wechat2rss (hosted-mirror, catalog `not-recommended`)

- Repo `ttttmr/Wechat2RSS` (GitHub): **not archived**, 1.6k stars, homepage `https://wechat2rss.xlab.app`.
- `https://wechat2rss.xlab.app/list/all/` → 308 → `200 text/html`; lists **395 公众号** feeds.
- Public feed URL format: `https://wechat2rss.xlab.app/feed/<40-hex>.xml`.
- Two public feeds sampled (anonymously, no login):
  - 极客公园 → 200 `application/xml`, **20 items** (豆包手机开卖 / 京东押注物理AI).
  - CNCERT风险评估 → 200, **20 items**.
- Search of the 395-feed list for 压铸 / 机床 / 数控 / FANUC / 发那科: **none**. Only machinery-adjacent match: `先生制造` (20 items, generic essays — sampled, titles are editorial/essay-style).
- Verdict: hosted feeds work and are publicly fetchable, but the CNC/die-cast 公众号 set the Research desk needs is **not present** on this public instance today. Phase A 订阅 would only be filled if such a feed is added/subscribed upstream — operator decision.

### mp2rss (saas, catalog `not-recommended`)

- `https://areyoubugcoder.github.io/Mp2RSS/` → 200 `text/html` (landing page: "公众号文章数据服务", RSS/JSON/Open API).
- App `https://mp2rss.bugcode.dev/` → 200 `text/html`, page contains 登录/注册 (login wall).
- `GET /api/` and `GET /api/feeds` → **401 `application/json`** (auth required).
- `/feeds` and `/openapi.json` on the app → 200 `text/html` but no public RSS items exposed anonymously.
- Verdict: **login wall / 401**. Cannot fill Phase A 订阅 without an operator signing up for Mp2RSS and supplying a token — explicitly out of scope for this spike.

### wewe-rss (archived)

- `https://api.github.com/repos/cooderl/wewe-rss` → **`archived: true`**, 9.7k stars, last push 2026-03-20.
- No install attempted. `load_mp_connector_feeds()` already refuses it unconditionally (W3-2), so it can never be ingested even if enabled.

## Catalog state

- Committed catalog unchanged: every plugin `enabled: false`, all example `url:` empty. **No `enabled: true` was committed.**
- `uv run pytest apps/worker/tests/test_research_ingest.py apps/worker/tests/test_research_ports.py` → **35 passed** (includes the four acceptance cases: default adds zero ids, enable+URL includes, enable+empty excludes, wewe-rss never ingested).

## Redactions & limits

- No secrets in this report; all URLs are public/`127.0.0.1`. Mp2RSS API 401 body was not echoed (auth-related).
- Full `mp.weixin.qq.com` article pages were **not** scraped — only RSS titles were recorded.
- `wechat2rss`/`mp2rss`/`wewe-rss` reachability assumes outbound network from pvelxc; all external GETs succeeded, so network is not the blocker.
