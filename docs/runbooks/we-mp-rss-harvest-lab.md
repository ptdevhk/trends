# we-mp-rss harvest lab — live sidecar diagnosis (2026-09-17)

Live diagnosis of why three subscribed 公众号 return RSS 200 with **zero `<item>`**.
Sidecar: container `we-mp-rss-lab` on `127.0.0.1:8001` (loopback only).
WeRSS admin login was performed (documented default, value never printed). All
secrets redacted — no cookies, slave_sid, mp token, Authorization Bearer, or
password values appear anywhere below or in git.

## Results table

| Check | Result |
|-------|--------|
| Container | `we-mp-rss-lab` **Up**, `127.0.0.1:8001->8001/tcp` (loopback only) |
| WeRSS admin login | **true** (HTTP 200, token issued; stored 0600 in `/tmp/werss-token`, not printed) — admin login, NOT WeChat wx.login |
| wx.login (WeChat session) | **true** — log line 735 "登录成功", token valid until **2026-09-21 11:36:02** (still valid now) |
| 3 mps present | **Yes** — 压铸实践 `MP_WXS_3093143325`, 压铸WEEKLY `MP_WXS_3583654969`, 轻量化在线 `MP_WXS_3012150704` (all `status: 1`) |
| Per-feed RSS `<item>` count (`/rss/{mp}`) | **0 for all three** (valid RSS 2.0 shell, 0 items) |
| `/feed/{mp}.xml` route | present in OAS (anonymous) |
| `/atom/{mp}` | not separately present; `.atom` via `{ext}`; both 0 items |
| Forced update `GET /api/v1/wx/mps/update/MP_WXS_3583654969` | **200**, `{total: 0, list: []}` |
| Root cause | **公众号 API returns empty (`成功 0 条`) because the Web-crawler crawl is gated by WeChat 频率限制 (rate limit) retries and never ingests articles; session is NOT expired.** Log evidence: 9× "频率限制, 第N次重试…", 8× "成功0条", 0× "成功N>0", plus per-mp `Web浏览器模式,是否采集[..]内容：False` (content scraping left off) |

## Diagnosis

- **Session is valid** — WeChat login succeeded (log line 735), token valid until
  2026-09-21; `/api/v1/wx/auth/verify` → `is_valid: true`. So this is **not** a
  session-expired problem.
- **Crawls never produce articles** — every crawl run ends `成功0条`
  ("frequencey control, stop at 0"). The WeChat 公众号 web API is returning no
  article list entries, and each attempt is rate-limited (`频率限制, 第N次重试…`).
- **Content scraping is disabled** — `Web浏览器模式,是否采集[…内容]：False` for all
  three mps (content fetch toggled off), but that gates article *content*, not the
  article *list*, so it is not the cause of the zero-item feed.
- **Timing**: full crawl runs take ~3+ min and hit the frequency gate repeatedly
  (`第1页开始爬取` → `频率限制` retry → `成功0条`). The article API responds empty
  under the current session/cookies.

## Evidence (secrets stripped)

- Valid session: `登录成功！` → token (numeric id, not printed) valid to
  `2026-09-21 11:36:02`.
- Outcomes: `频率限制` retries = **9**, `成功0条` = **8**, `成功N(N>0)` = **0**.
- Forced update `MP_WXS_3583654969` → HTTP 200 `{total: 0, list: []}`,
  `sync_time` bumped to 1789618259 but no articles ingested.
- RSS shell valid for all three (`<generator>Mp-We-Rss</generator>`), 0 `<item>`.

## Loopback RSS URL patterns (not enabled in Trends catalog)

Once articles ingest, feeds appear at:
- `http://127.0.0.1:8001/rss/MP_WXS_3093143325` (压铸实践)
- `http://127.0.0.1:8001/rss/MP_WXS_3583654969` (压铸WEEKLY)
- `http://127.0.0.1:8001/rss/MP_WXS_3012150704` (轻量化在线)
- `/feed/{mp_id}.xml` / `/rss/{mp_id}/fresh` also exposed (OAS 141 paths, all
  `security: none`).

These are **not** wired into `config/research-mp-connectors.yaml` (no
`enabled:true`) and are **not** `rss:werss-*` ingest URLs.

## Likely next operator step

The article API is answering empty under WeChat 频率限制. Options an operator can
take without code changes here:
1. **Wait / cooldown** — the WeChat 公众号 API rate-limit is per-cookie; let the
   session quiet down and re-run a single bounded update per mp.
2. **Re-scan QR (WeChat)** to refresh cookies/session (operator-attended; the
   Motorola USB ADB factor on macos-dev holds WeChat for re-scan).
3. Confirm the 公众号 accounts are actually publishing (the three are recent adds
   today); 压铸WEEKLY may have a low cadence.

No container config was changed; the admin password was not changed; `:8001` stays
loopback-only.
