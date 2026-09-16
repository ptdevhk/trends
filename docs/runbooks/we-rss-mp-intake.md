# WeRSS (公众号 → RSS) intake — Phase B runbook

Continuous WeChat official-account (公众号) monitoring for the Research desk.
Trends **never** crawls WeChat itself; a self-hosted **WeRSS** sidecar owns the
WeChat auth surface and publishes plain RSS that both TrendRadar and Trends
consume through the existing `rss:*` lane.

Plan: `projects/trends/work/2026-09-16-research-wechat-mp-rss-intake/plan.md`
(Phase A + C shipped in PR #1389; this is the human-gated Phase B).

> **Human gate.** Fork choice, host, and the 公众号 list are operator decisions.
> Nothing in this runbook holds live secrets — configure them on the host only.

## 1. Pick fork + host (operator)

| Fork | Notes |
|------|-------|
| [we-mp-rss](https://github.com/rachelos/we-mp-rss) | Python; scrape-style with scheduled polling. |
| [wewe-rss](https://github.com/cooderl/wewe-rss) | Node; reads via **WeRead**; QR login, stable feed URLs. **ARCHIVED upstream — do not choose.** |

Host: local `macos-dev` (dev only) **or** a `ptcloud` sidecar (shared/preview).
Prefer the sidecar for anything other than a one-off local test — the login
session must persist, and dev laptops sleep.

### 1a. Connector catalog (`config/research-mp-connectors.yaml`)

`config/research-mp-connectors.yaml` is the **opt-in connector catalog** for mp
(公众号 → RSS) sources. It is a *static catalog*, **not a plugin runtime**: nothing
in it installs, authenticates, or starts anything, and no code contacts a
connector until an operator enables a feed with a real URL.

| Plugin | `kind` | Recommendation | Notes |
|--------|--------|----------------|-------|
| `we-mp-rss` | `self-host` | **recommended** | Self-hosted; needs the §2 install + login on the host. |
| `wechat2rss` | `hosted-mirror` | not recommended | Externally owned mirror; availability/ToS vary. No local install. |
| `mp2rss` | `saas` | not recommended | SaaS; requires an Mp2RSS signup **by the operator** (not done here, no QR flow in this repo). |
| `wewe-rss` | `self-host` | **do not use** | `status: archived` — preserved for awareness only; `load_mp_connector_feeds()` skips it unconditionally, even if `enabled: true`. |

**Every shipped plugin is `enabled: false` and every example feed has an empty
`url:`, so the default adds zero feeds** — `load_rss_feeds()` returns exactly the
`config.yaml rss.feeds` set.

To enable one later (operator, after §2):

1. Set that plugin's `enabled: true` in `config/research-mp-connectors.yaml`.
2. Paste the **real** feed URL into its feed's `url:` (e.g.
   `http://127.0.0.1:<port>/feeds/<mp_id>.xml`, or the hosted mirror's URL).
3. Restart the worker (or wait for the next scheduled run).

`load_rss_feeds()` merges enabled connector feeds **after** `config.yaml rss.feeds`.
A feed whose plugin is `enabled: true` but whose `url` is empty/missing is a
**hard skip with an error log** — that id is never returned, so it can never reach
`HttpRssPort`. An archived plugin (`wewe-rss`) is skipped with an error regardless
of its `enabled` flag.

Example feed ids (all currently disabled, empty `url`):

| Feed id | Platform on ingest |
|---------|--------------------|
| `werss-cnc-diecast` | `rss:werss-cnc-diecast` |
| `wechat2rss-cnc-diecast` | `rss:wechat2rss-cnc-diecast` |
| `mp2rss-cnc-diecast` | `rss:mp2rss-cnc-diecast` |

The `rss:` prefix lock below (§3) applies to **every** connector id, not just the
WeRSS fork: the id in the catalog must stay bare (`mp2rss-cnc-diecast`) because the
worker derives `platform = f"rss:{feed_id}"`.

> This PR ships the catalog + loader only. It does **not** install a connector,
> perform a WeChat/WeRead login/QR scan, run `docker`, sign up for Mp2RSS, or scrape
> `mp.weixin.qq.com`.

Record here once chosen:

| Item | Value |
|------|-------|
| Fork | _tbd_ |
| Host | _tbd_ (e.g. `ptcloud`) |
| Port | _tbd_ (bind **127.0.0.1 only**) |
| Auth mode | _tbd_ (WeRead QR / WeChat login per fork) |

## 2. Install + authenticate (operator, on the host)

1. Install the fork on the chosen host, bound to `127.0.0.1:<port>`.
   Do **not** expose the port publicly.
2. Log in (QR scan / WeRead) and confirm the session persists across a restart.
3. Subscribe the named 压铸 / 机床 公众号 from the boss pack / operator list.
4. Verify a feed renders:

   ```bash
   curl -s "http://127.0.0.1:<port>/feeds/<mp_id>.xml" | head -40
   ```

   It must return valid RSS 2.0 with `<item>` entries (title + link + pubDate).

## 3. Platform-string convention (LOCKED — do not deviate)

`isHotlistPlatform()` in `apps/api/src/services/research-pulse-service.ts` is a
**negative** test: anything not prefixed `rss:` is treated as a NewsNow hotlist
platform. A WeRSS feed emitted as `werss:` / `wechat:` / `mp:` would therefore
**leak into the titled 综合热榜** and corrupt the honest hotlist/订阅 chip split.

**Rule: every WeRSS feed id MUST be `rss:werss-<mp_id>`.** That happens
automatically if the feed id in the config below is `werss-<mp_id>`, because
`apps/worker/research_ports.py` derives the platform as `f"rss:{feed_id}"`.

A regression test already locks the boundary:
`research-pulse-service.test.ts` → `isHotlistPlatform: non-rss subscription
prefixes are NOT hotlist (fail-safe for Phase B WeRSS)`.

## 4. Wire TrendRadar (`config/config.yaml`)

Add one entry per 公众号 under `rss.feeds` (same block as the `gnews-*` feeds):

```yaml
    # WeRSS (公众号) — Phase B. id MUST be werss-<mp_id> so the platform is rss:werss-<mp_id>.
    - id: "werss-cnc-diecast"
      name: "公众号 · 压铸前沿"          # operator-visible label
      url: "http://127.0.0.1:<port>/feeds/<mp_id>.xml"
      max_age_days: 7                    # match the gnews-* feeds

    - id: "werss-machine-tool"
      name: "公众号 · 机床观察"
      url: "http://127.0.0.1:<port>/feeds/<mp_id>.xml"
      max_age_days: 7
```

If the WeRSS host is not the Trends host, replace `127.0.0.1` with a
private-network address — never a public one. TrendRadar reads this file
directly; no code change is needed.

## 5. Wire Trends research ingest (same file, same entries)

Trends reads the **same** `rss.feeds` list via
`apps/worker/research_ingest.py:load_rss_feeds()`, which also merges any enabled
feeds from `config/research-mp-connectors.yaml` (§1a). The running job is
gated by `RESEARCH_INGEST_ENABLED=1` (`add_research_ingest_job`,
`apps/worker/scheduler.py:239`). So steps 4 + 1a are the whole wiring — restart the
worker (or let the next scheduled run fire) and the new feeds flow into
`news_items` as `rss:werss-*` / `rss:<connector-id>`.

Trigger a run on demand:

```bash
curl -s -X POST http://localhost:8000/worker/research/ingest \
  -H 'Content-Type: application/json' -d '{}'
# or from the desk: POST /api/research/ingest/run
```

## 6. Verify (must all hold)

| Check | How | Expect |
|-------|-----|--------|
| Feed ingested | `GET /api/research/pulse?limit=12&hotlistOnly=0` | `rssMatchedCount` includes the new feeds; items show `platform: "rss:werss-*"` |
| Not mislabeled as hotlist | same response with `hotlistOnly=1` | **zero** `rss:werss-*` rows in the titled 综合热榜 |
| Desk renders | `/dev/research` (dev workspace) or `/<slug>/research` | new articles appear as `RSS`-badged rows; soft-empty fallback includes them when hotlist has no hits |
| Source badge | row `data-source` | `rss` (not `hotlist`) |

No UI redesign is required — Phase A's soft-empty path already reads any
`rss:*` platform.

### Dual-count meta is an approximation, not a corpus total (A1c)

`GET /api/research/pulse` reports `meta.hotlistMatchedCount` / `meta.rssMatchedCount`
and the per-keyword `hotlistHitCount` / `rssHitCount` splits from a **single mixed
`limit:100` window** (`loadMixedAnnotatedForMeta`), partitioned by `isHotlistPlatform`.
Those figures are a capped-window approximation, **not exact corpus totals** — dense
RSS volume can crowd the 100-row window and under-report hotlist. `meta.matchedCount`
comes from the per-platform slices instead, so the two can diverge. This is acceptable
for the soft-empty trigger (which is gated on `rawCount > 0`), but do **not** use these
numbers as authoritative counts in dashboards or exports.

Callers that only need the hotlist feed and do not render the 热榜/订阅 dual counts can
skip the extra mixed read with `hotlistOnly=1&hotlistDualCounts=0`; `meta.hotlistDualCounts`
then reports `false` and `rssMatchedCount` is `0` by construction.

## 7. Runbook: feed-id rotation (important)

WeRSS feed URLs are keyed by `<mp_id>`. If the WeChat/WeRead login rotates or an
account re-registers, the ids change and **both** consumers silently stop
updating (the URL 404s; ingest soft-fails per feed and logs a warning).

- Symptom: `[ResearchIngest] rss <id> failed:` warnings in worker logs, and the
  desk's `rss:werss-*` rows going stale.
- Fix: re-read the feed list from the WeRSS UI, update the two `url:` values in
  `config/config.yaml`, restart the worker.
- Detection: alert on `rss:werss-*` items whose `captured_at` is older than the
  expected cadence. (The ingest job cadence matches the TrendRadar schedule —
  default 30 min; see `apps/worker/scheduler.py`.)

## Out of scope

- Scraping WeChat inside the Trends BFF (mp paste uses the metadata-free lane;
  see PR #1389).
- Exposing the WeRSS port publicly.
- Prod deploy / origin push without operator approval.
