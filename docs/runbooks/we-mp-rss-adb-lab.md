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
- Container **left running** on `127.0.0.1:8001` (intentional). No QR login
  performed. Stop later with `docker rm -f we-mp-rss-lab`.

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
