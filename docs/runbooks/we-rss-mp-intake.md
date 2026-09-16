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
| [wewe-rss](https://github.com/cooderl/wewe-rss) | Node; reads via **WeRead**; QR login, stable feed URLs. |

Host: local `macos-dev` (dev only) **or** a `ptcloud` sidecar (shared/preview).
Prefer the sidecar for anything other than a one-off local test — the login
session must persist, and dev laptops sleep.

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
`apps/worker/research_ingest.py:load_rss_feeds()`, and the running job is
gated by `RESEARCH_INGEST_ENABLED=1` (`add_research_ingest_job`,
`apps/worker/scheduler.py:239`). So step 4 is the whole wiring — restart the
worker (or let the next scheduled run fire) and the new feeds flow into
`news_items` as `rss:werss-*`.

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
