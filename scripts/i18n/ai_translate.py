#!/usr/bin/env python3
"""
AI Translation for i18n Files

Translates the source locale (zh-Hant.yaml) to English using AI.
Uses the existing TrendRadar AI infrastructure (LiteLLM).

Usage:
    python scripts/i18n/ai_translate.py [--dry-run] [--target en]

Options:
    --dry-run       Show what would be translated without calling AI
    --target LANG   Target language code (default: en)

Environment:
    AI_API_KEY      Required. API key for the AI provider.
    AI_MODEL        Optional. Model to use (default: deepseek/deepseek-chat)

Requirements:
    - litellm
    - pyyaml
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path
from typing import Any

import yaml

# Add project root to path for imports
PROJECT_ROOT = Path(__file__).parent.parent.parent
sys.path.insert(0, str(PROJECT_ROOT))

try:
    from litellm import completion
except ImportError:
    print("ERROR: litellm library not installed.")
    print("Install with: pip install litellm")
    sys.exit(1)


# Configuration
I18N_DIR = PROJECT_ROOT / "config" / "i18n"
SOURCE_LOCALE = "zh-Hant"
DEFAULT_TARGET = "en"

# Translation prompt
SYSTEM_PROMPT = """You are a professional translator for software localization.
Your task is to translate UI strings from Traditional Chinese to {target_language}.

Guidelines:
1. Preserve all placeholders like {count}, {key}, {path}, {name}, {message}, {platform} exactly as-is
2. Keep technical terms (API, AI, RSS, MCP, YAML, JSON, etc.) in English
3. Keep brand names (TrendRadar, Telegram, Slack, etc.) as-is
4. Translate naturally for software UI context
5. Be concise - UI strings should be brief
6. For platform names (Weibo, Zhihu, etc.), keep the original name but you may add English name in parentheses for less-known platforms

Output format:
Return ONLY a valid JSON object with the translations, no markdown code blocks, no explanations.
The JSON should have the same structure as the input.
"""

USER_PROMPT_TEMPLATE = """Translate the following YAML content from Traditional Chinese to {target_language}.
Return the translated content as a JSON object with the exact same structure.

Content to translate:
```yaml
{content}
```

Remember: Return ONLY valid JSON, preserving all placeholders and technical terms."""


# Generated file header
GENERATED_HEADER = '''# ═══════════════════════════════════════════════════════════════
#                    TrendRadar i18n - English
#                      Version: 1.0.0
#
# This file is generated from zh-Hant.yaml via AI translation
# Do not edit directly, make changes in zh-Hant.yaml instead
#
# Regenerate command: python scripts/i18n/ai_translate.py
# ═══════════════════════════════════════════════════════════════

'''


def get_ai_config() -> dict[str, Any]:
    """Get AI configuration from environment."""
    return {
        "MODEL": os.environ.get("AI_MODEL", "deepseek/deepseek-chat"),
        "API_KEY": os.environ.get("AI_API_KEY", ""),
        "TEMPERATURE": 0.3,  # Lower temperature for more consistent translations
        "MAX_TOKENS": 8000,
        "TIMEOUT": 120,
    }


def call_ai(messages: list[dict[str, str]], config: dict[str, Any]) -> str:
    """Call AI API using LiteLLM."""
    params = {
        "model": config["MODEL"],
        "messages": messages,
        "temperature": config["TEMPERATURE"],
        "timeout": config["TIMEOUT"],
    }

    if config["API_KEY"]:
        params["api_key"] = config["API_KEY"]

    if config["MAX_TOKENS"] > 0:
        params["max_tokens"] = config["MAX_TOKENS"]

    response = completion(**params)
    return response.choices[0].message.content


def flatten_for_translation(data: dict[str, Any], prefix: str = "") -> dict[str, str]:
    """Flatten nested dict to dot-notation keys with string values only."""
    result = {}
    for key, value in data.items():
        full_key = f"{prefix}.{key}" if prefix else key
        if isinstance(value, dict):
            result.update(flatten_for_translation(value, full_key))
        elif isinstance(value, str):
            result[full_key] = value
    return result


def unflatten_from_translation(flat: dict[str, str]) -> dict[str, Any]:
    """Convert dot-notation flat dict back to nested dict."""
    result: dict[str, Any] = {}
    for key, value in flat.items():
        parts = key.split(".")
        current = result
        for part in parts[:-1]:
            if part not in current:
                current[part] = {}
            current = current[part]
        current[parts[-1]] = value
    return result


def chunk_dict(data: dict[str, str], max_items: int = 30) -> list[dict[str, str]]:
    """Split a dictionary into smaller chunks for API calls."""
    items = list(data.items())
    return [dict(items[i:i + max_items]) for i in range(0, len(items), max_items)]


def translate_chunk(
    chunk: dict[str, str],
    target_language: str,
    config: dict[str, Any],
) -> dict[str, str]:
    """Translate a chunk of strings using AI."""
    # Format content as YAML-like for readability
    content_lines = []
    for key, value in chunk.items():
        content_lines.append(f"{key}: {value}")
    content = "\n".join(content_lines)

    # Build messages
    system_prompt = SYSTEM_PROMPT.format(target_language=target_language)
    user_prompt = USER_PROMPT_TEMPLATE.format(
        target_language=target_language,
        content=content,
    )

    messages = [
        {"role": "system", "content": system_prompt},
        {"role": "user", "content": user_prompt},
    ]

    # Call AI
    response = call_ai(messages, config)

    # Parse JSON response
    # Handle potential markdown code blocks
    response = response.strip()
    if response.startswith("```"):
        lines = response.split("\n")
        # Remove first and last lines (code block markers)
        if lines[0].startswith("```"):
            lines = lines[1:]
        if lines and lines[-1].strip() == "```":
            lines = lines[:-1]
        response = "\n".join(lines)

    try:
        translated = json.loads(response)
    except json.JSONDecodeError as e:
        print(f"  WARNING: Failed to parse AI response as JSON: {e}")
        print(f"  Response preview: {response[:200]}...")
        # Return original chunk on failure
        return chunk

    return translated


def translate_locale(
    source_data: dict[str, Any],
    target_language: str,
    config: dict[str, Any],
    dry_run: bool = False,
) -> dict[str, Any]:
    """Translate entire locale data."""
    # Flatten to get all translatable strings
    flat = flatten_for_translation(source_data)

    # Remove meta fields that shouldn't be translated
    meta_keys = [k for k in flat if k.startswith("meta.")]
    for key in meta_keys:
        del flat[key]

    print(f"  Total translatable strings: {len(flat)}")

    if dry_run:
        print("  DRY RUN - Skipping AI translation")
        # Return source data with placeholder translations
        result = {}
        for key, value in flat.items():
            result[key] = f"[EN] {value}"
        translated_nested = unflatten_from_translation(result)
        # Add meta back
        translated_nested["meta"] = {
            "locale": "en",
            "name": "English",
            "direction": "ltr",
        }
        return translated_nested

    # Chunk the strings for API calls
    chunks = chunk_dict(flat, max_items=30)
    print(f"  Split into {len(chunks)} chunks for translation")

    translated_flat = {}

    for i, chunk in enumerate(chunks):
        print(f"  Translating chunk {i + 1}/{len(chunks)} ({len(chunk)} strings)...")
        try:
            translated_chunk = translate_chunk(chunk, target_language, config)
            translated_flat.update(translated_chunk)
        except Exception as e:
            print(f"  ERROR translating chunk {i + 1}: {e}")
            # Keep original on failure
            translated_flat.update(chunk)

    # Convert back to nested structure
    translated_nested = unflatten_from_translation(translated_flat)

    # Add meta information
    translated_nested["meta"] = {
        "locale": "en",
        "name": "English",
        "direction": "ltr",
    }

    return translated_nested


def format_yaml_with_sections(data: dict[str, Any]) -> str:
    """Format YAML data with section headers."""
    output_lines = []

    section_headers = {
        "meta": "# Metadata",
        "app": "# ===============================================================\n# Application General\n# ===============================================================",
        "report": "# ===============================================================\n# Report Modes\n# ===============================================================",
        "platforms": "# ===============================================================\n# Platform Names\n# ===============================================================",
        "notification": "# ===============================================================\n# Notification Messages\n# ===============================================================",
        "ai": "# ===============================================================\n# AI Analysis\n# ===============================================================",
        "storage": "# ===============================================================\n# Storage\n# ===============================================================",
        "time": "# ===============================================================\n# Time Related\n# ===============================================================",
        "errors": "# ===============================================================\n# Error Messages\n# ===============================================================",
        "success": "# ===============================================================\n# Success Messages\n# ===============================================================",
        "ui": "# ===============================================================\n# UI Elements (for future web interface)\n# ===============================================================",
        "mcp": "# ===============================================================\n# MCP Server Related\n# ===============================================================",
    }

    for key, value in data.items():
        if key in section_headers:
            if output_lines:
                output_lines.append("")
            output_lines.append(section_headers[key])

        section_yaml = yaml.dump(
            {key: value},
            allow_unicode=True,
            default_flow_style=False,
            sort_keys=False,
            width=1000,
        )
        output_lines.append(section_yaml.rstrip())

    return "\n".join(output_lines)


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Translate i18n locale files using AI"
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Show what would be translated without calling AI",
    )
    parser.add_argument(
        "--target",
        default=DEFAULT_TARGET,
        help=f"Target language code (default: {DEFAULT_TARGET})",
    )
    args = parser.parse_args()

    print("=" * 60)
    print("TrendRadar AI Translation for i18n")
    print("=" * 60)
    print()

    # Get AI config
    config = get_ai_config()

    if not args.dry_run and not config["API_KEY"]:
        print("ERROR: AI_API_KEY environment variable not set")
        print("Set it with: export AI_API_KEY='your-api-key'")
        return 1

    print(f"Source locale: {SOURCE_LOCALE}")
    print(f"Target language: {args.target}")
    print(f"AI Model: {config['MODEL']}")
    print()

    # Load source locale
    source_path = I18N_DIR / f"{SOURCE_LOCALE}.yaml"
    if not source_path.exists():
        print(f"ERROR: Source file not found: {source_path}")
        return 1

    with open(source_path, encoding="utf-8") as f:
        source_data = yaml.safe_load(f)

    print(f"Loaded source: {source_path}")

    # Translate
    print()
    print("Translating...")
    try:
        translated_data = translate_locale(
            source_data,
            target_language="English" if args.target == "en" else args.target,
            config=config,
            dry_run=args.dry_run,
        )
    except Exception as e:
        print(f"ERROR during translation: {e}")
        return 1

    # Save translated file
    target_path = I18N_DIR / f"{args.target}.yaml"
    formatted_content = format_yaml_with_sections(translated_data)

    if args.dry_run:
        print()
        print("DRY RUN - Preview of translated content (first 50 lines):")
        print("-" * 40)
        preview_lines = formatted_content.split("\n")[:50]
        print("\n".join(preview_lines))
        if len(formatted_content.split("\n")) > 50:
            print("...")
    else:
        with open(target_path, "w", encoding="utf-8") as f:
            f.write(GENERATED_HEADER)
            f.write(formatted_content)
            f.write("\n")

        print()
        print(f"Saved: {target_path}")

    print()
    print("Translation complete!")
    return 0


if __name__ == "__main__":
    sys.exit(main())
