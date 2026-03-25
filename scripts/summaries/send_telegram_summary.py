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
from trendradar.notification.batch import (
    add_batch_headers,
    get_max_batch_header_size,
    truncate_to_bytes,
)
from trendradar.notification.senders import send_to_telegram

TELEGRAM_BATCH_BYTES = 4000


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


def plan_telegram_batches(content: str, max_bytes: int = TELEGRAM_BATCH_BYTES) -> List[str]:
    escaped_content = html.escape(content)
    header_reserve = get_max_batch_header_size("telegram")
    batches = split_rendered_content(escaped_content, max_bytes - header_reserve)
    return add_batch_headers(batches, "telegram", max_bytes)


def build_splitter(content: str):
    escaped_content = html.escape(content)

    def split_content_func(_report_data, _format_type, _update_info=None, max_bytes=4000, **_kwargs):
        return split_rendered_content(escaped_content, max_bytes)

    return split_content_func


def mask_chat_id(chat_id: str) -> str:
    normalized = str(chat_id or "").strip()
    if not normalized:
        return "(missing)"
    suffix = normalized[-4:] if len(normalized) > 4 else normalized
    return f"***{suffix}"


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
        planned_batches = plan_telegram_batches(content)
        batch_count_per_account = len(planned_batches)
        batch_sizes = [len(batch.encode("utf-8")) for batch in planned_batches]

        sent = 0
        attempted = 0
        account_entries = []
        for index, token in enumerate(tokens):
            chat_id = chat_ids[index] if index < len(chat_ids) else ""
            attempted_account = bool(token and chat_id)
            account_entry = {
                "index": index + 1,
                "chatIdHint": mask_chat_id(chat_id),
                "attempted": attempted_account,
                "sent": False,
                "batchesPlanned": batch_count_per_account if attempted_account else 0,
            }
            if not attempted_account:
                account_entry["skippedReason"] = "missing token or chat_id"
                account_entries.append(account_entry)
                continue

            attempted += 1
            ok = send_to_telegram(
                bot_token=token,
                chat_id=chat_id,
                report_data={},
                report_type="Resume Ops Summary",
                split_content_func=split_content_func,
            )
            if ok:
                sent += 1
                account_entry["sent"] = True
            account_entries.append(account_entry)

    if sent <= 0:
        raise RuntimeError("Telegram summary delivery failed")

    json.dump(
        {
            "ok": True,
            "channel": "telegram",
            "accountsConfigured": count,
            "accountsSelected": len(tokens),
            "accountsAttempted": attempted,
            "accountsSent": sent,
            "batchCountPerAccount": batch_count_per_account,
            "totalBatches": batch_count_per_account * attempted,
            "batchSizes": batch_sizes,
            "maxBytesPerBatch": TELEGRAM_BATCH_BYTES,
            "usedOverrideBotToken": bool(payload.get("botToken")),
            "usedOverrideChatId": bool(payload.get("chatId")),
            "accounts": account_entries,
        },
        sys.stdout,
    )
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as error:
        print(str(error), file=sys.stderr)
        raise SystemExit(1)
