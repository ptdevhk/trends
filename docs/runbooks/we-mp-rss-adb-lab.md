# we-mp-rss + USB ADB lab — unattended (2026-09-17)

Probes the operator's intended WeChat/WeCom factor (**Motorola USB ADB**) and the
`we-mp-rss` sidecar image on pvelxc `/root/workspace`. Anonymous/read-only —
no WeChat UI automation, no QR completion, no cookie/ticket handling, no
`mp.weixin.qq.com` BFF scrape.

## Results table

| Check | Result |
|-------|--------|
| USB device present? | **No** — `adb` not installed; `lsusb` shows no Motorola `22b8:` device (only ASUSTek AURA, ASMedia hub, Genesys hub, Intel AX201 BT) |
| Model | n/a (no device) |
| WeChat pkg (`com.tencent.mm`)? | n/a (no device) |
| WeCom pkg (`com.tencent.wework`)? | n/a (no device) |
| we-mp-rss localhost HTTP? | **Yes** — container `we-mp-rss-lab` on `127.0.0.1:8001`, `GET /` → **200** `text/html`, `GET /feeds` → **200** (left running intentionally) |
| Next operator step | Install `adb` + platform-tools, plug in the Motorola with USB debugging on, `adb devices`; install we-mp-rss on its host, scan the WeChat QR / WeRead login, subscribe 压铸/机床 公众号, then wire a real `rss:werss-*` feed. |

## A1 — adb / USB

```
$ command -v adb
(empty — adb not found)

$ adb version / adb devices -l
command not found: adb
```

`lsusb` (full):

```
Bus 001 Device 001: ID 1d6b:0002 Linux Foundation 2.0 root hub
Bus 001 Device 002: ID 0b05:19af ASUSTek Computer, Inc. AURA LED Controller
Bus 001 Device 003: ID 174c:2074 ASMedia Technology Inc. ASM1074 High-Speed hub
Bus 001 Device 004: ID 05e3:0608 Genesys Logic, Inc. Hub
Bus 001 Device 005: ID 8087:0026 Intel Corp. AX201 Bluetooth
Bus 002 Device 001: ID 1d6b:0003 Linux Foundation 3.0 root hub
Bus 002 Device 002: ID 174c:3074 ASMedia Technology Inc. ASM1074 SuperSpeed hub
```

`lsusb -d 22b8:` (Motorola) → **no output** (no Motorola device attached).

**Verdict: empty device list is the valid result.** A2 (model / `pm list packages`)
was not runnable because no device was present; no serial was fabricated.

## A3 — WeCom vs WeChat role (documented, not run)

- **WeCom (`com.tencent.wework`) is NOT a subscription factor.** In `we-mp-rss`,
  the only WeCom-adjacent hook is the **expiry notification webhook**
  (`WECHAT_WEBHOOK` + `SEND_CODE`), which sends a message when a QR/login expires.
  It **cannot** subscribe 压铸/机床 公众号.
- **WeChat (`com.tencent.mm`) IS the auth app**: we-mp-rss auth is a WeChat
  **QR code / WeRead** login (ReadMe `扫码授权.png`; optional `weread_mp`
  collection mode). The Motorola USB ADB factor would only be used to hold the
  WeChat session — and per constraint this lab does not tap/automate it.

## A4 — docker / python3 / port / sidecar

- `docker` present: **Docker 29.6.2**.
- `python3` present: **3.14.3**.
- `:8001` free before start (`ss` empty; bind ok).
- `docker pull ghcr.io/rachelos/we-mp-rss:latest` → **success**.
- Container started bound to **127.0.0.1:8001** only (not `0.0.0.0`), named
  volume under `/tmp/we-mp-rss-data` (not committed):

  ```
  docker run -d --name we-mp-rss-lab --restart no \
    -p 127.0.0.1:8001:8001 -v /tmp/we-mp-rss-data:/app/data \
    ghcr.io/rachelos/we-mp-rss:latest
  ```

- `curl http://127.0.0.1:8001/` → **200**, `text/html; charset=utf-8`, 1202 bytes
  (we-mp-rss v1.5.3, `API_BASE /api/v1/wx`).
- `curl http://127.0.0.1:8001/feeds` → **200**.
- Container **left running** on `127.0.0.1:8001` (intentional); restart policy
  set to **`unless-stopped`** (Wave 7). No QR login performed. Stop later with
  `docker rm -f we-mp-rss-lab`.

## Wave 7 — coordinator macos-dev facts + sidecar continuation

> **Coordinator macos-dev facts** (do NOT re-probe USB on pvelxc — pvelxc has no
> Motorola). These are operator-attested, not re-measured here.

| Check | Result |
|-------|--------|
| USB host | **macos-dev** (not pvelxc) |
| adb device | `ZY22C77QXX` **authorized** |
| Model | `XT2125-4` (code `nio_retcn`) |
| WeChat pkg | `com.tencent.mm` **installed** |
| WeCom pkg | `com.tencent.wework` **installed** |
| Tunnel to sidecar | `ssh -N -L 18001:127.0.0.1:8001 pvelxc-3adc3628` |
| `GET http://127.0.0.1:18001/` | **200** — SPA title `WeRss微信公众号订阅助手` |
| `GET /api/docs` | **200** |

- **Operator scans the QR with WeChat (`com.tencent.mm`), NOT WeCom.**
  WeCom (`com.tencent.wework`) is only the expiry-notify webhook
  (`WECHAT_WEBHOOK` + `SEND_CODE`) and cannot subscribe 压铸/机床 公众号.
- **One phone cannot unattended-ADB-scan**: scanning the WeChat QR is an attended
  action on the operator's phone; ADB is used to hold the session, not to scan.
- Sidecar continuation (Wave 7, pvelxc): container `we-mp-rss-lab` still **Up** on
  `127.0.0.1:8001`, restart policy now **`unless-stopped`** (loopback bind only —
  verified `127.0.0.1:8001->8001`, never `0.0.0.0`). `GET /` → 200 (1202 bytes),
  `GET /feeds` → 200.

### Wave 7 — anonymous-visible RSS/feed URL pattern (from `GET /api/docs` → `/api/openapi.json`)

`/api/openapi.json` (WeRSS API, 141 paths) exposes these anonymous RSS/feed GET
routes (security: none — all read-only, no auth headers required):

| Route | Summary | Notes |
|-------|---------|-------|
| `/feed/{feed_id}.{ext}` | 获取公众号文章源 | `{ext}` = rss/atom/json; params `limit`/`offset`/`kw` |
| `/feed/search/{kw}/{feed_id}.{ext}` | search a feed | `kw` free-form |
| `/feed/tag/{tag_id}.{ext}` | tag feed | |
| `/rss/{feed_id}` | 获取公众号文章 | `{ext}` param, limit/offset |
| `/rss/{feed_id}/fresh` | 更新并获取公众号文章RSS | triggers a fetch then returns items |
| `/rss/{feed_id}/api` | 获取特定RSS源详情 | |
| `/rss`, `/rss/fresh`, `/rss/content/{content_id}` | aggregate + content | |

So once an operator subscribes a 公众号 via WeChat QR, the anonymous feed URL is
`http://127.0.0.1:8001/feed/<feed_id>.rss` (or `/rss/<feed_id>`), which becomes the
real `url:` for a `rss:werss-<mp_id>` Trends connector feed. No authenticated write
APIs were called; no secrets printed (auth/QR paths exist — `/api/v1/wx/auth/qr/code`
etc. — but were **not** invoked).

## Secrets

None committed. `WECHAT_WEBHOOK`/`SEND_CODE` and config values are referenced by
name only; values never logged or written to git. No cookies/tickets in this
report.

## Constraint checklist

- No WeChat UI automation (no `we-mp-auto-scan`, no two-phone flow). ✅
- No cookie/ticket in git or worker_done. ✅
- No enable of the Trends werss connector catalog (`config/research-mp-connectors.yaml`
  untouched; `config.yaml` werss stubs still commented). ✅
- No merge, no preview/prod deploy. ✅
- No BFF scrape of `mp.weixin.qq.com`. ✅
