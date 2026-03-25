#!/usr/bin/env python3
# coding=utf-8

import contextlib
import html
import json
import sys
from typing import List

from trendradar.core import load_config
from trendradar.core.config import (
    limit_accounts,
    parse_multi_account_config,
    validate_paired_configs,
)
from trendradar.notification.batch import truncate_to_bytes
from trendradar.notification.senders import send_to_telegram


def split_rendered_content(content: str, max_bytes: int) -> List[str]:
    normalized = content.replace("\r\n", "\n").strip()
    if not normalized:
      return [""]
    if len(normalized.encode("utf-8")) <= max_bytes:
      return [normalized]

    batches: List[str] = []
    current = ""
    for line in normalized.split("\n"):
        candidate = f"{current}\n{line}".strip("\n") if current else line
        if len(candidate.encode("utf-8")) <= max_bytes:
            current = candidate
            continue

        if current:
            batches.append(current)
            current = ""

        remaining = line
        while remaining and len(remaining.encode("utf-8")) > max_bytes:
            chunk = truncate_to_bytes(remaining, max_bytes)
            if not chunk:
                break
            batches.append(chunk)
            remaining = remaining[len(chunk):]
        current = remaining

    if current:
        batches.append(current)

    return batches or [normalized]


def build_splitter(content: str):
    escaped_content = html.escape(content)

    def split_content_func(_report_data, _format_type, _update_info=None, max_bytes=4000, **_kwargs):
        return split_rendered_content(escaped_content, max_bytes)

    return split_content_func


def main() -> int:
    payload = json.load(sys.stdin)
    content = str(payload.get("content") or "").strip()
    if not content:
        raise ValueError("content is required")

    with contextlib.redirect_stdout(sys.stderr):
        config = load_config()
        if payload.get("botToken"):
            config["TELEGRAM_BOT_TOKEN"] = str(payload["botToken"])
        if payload.get("chatId"):
            config["TELEGRAM_CHAT_ID"] = str(payload["chatId"])

        tokens = parse_multi_account_config(config.get("TELEGRAM_BOT_TOKEN", ""))
        chat_ids = parse_multi_account_config(config.get("TELEGRAM_CHAT_ID", ""))
        valid, count = validate_paired_configs(
            {"bot_token": tokens, "chat_id": chat_ids},
            "Telegram",
            required_keys=["bot_token", "chat_id"],
        )
        if not valid or count <= 0:
            raise ValueError("Telegram configuration is missing bot token or chat id")

        max_accounts = config.get("MAX_ACCOUNTS_PER_CHANNEL", 3)
        tokens = limit_accounts(tokens, max_accounts, "Telegram")
        chat_ids = chat_ids[: len(tokens)]
        split_content_func = build_splitter(content)

        sent = 0
        for index, token in enumerate(tokens):
            chat_id = chat_ids[index] if index < len(chat_ids) else ""
            if not token or not chat_id:
                continue
            ok = send_to_telegram(
                bot_token=token,
                chat_id=chat_id,
                report_data={},
                report_type="Resume Ops Summary",
                split_content_func=split_content_func,
            )
            if ok:
                sent += 1

    if sent <= 0:
        raise RuntimeError("Telegram summary delivery failed")

    json.dump({"ok": True, "accountsSent": sent}, sys.stdout)
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as error:
        print(str(error), file=sys.stderr)
        raise SystemExit(1)
