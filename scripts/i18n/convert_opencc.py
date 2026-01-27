#!/usr/bin/env python3
"""
OpenCC Chinese Converter

Converts Traditional Chinese (zh-Hant) to Simplified Chinese (zh-Hans)
using OpenCC library.

Usage:
    python scripts/i18n/convert_opencc.py [--dry-run]

Options:
    --dry-run    Show what would be changed without writing files

Requirements:
    pip install opencc-python-reimplemented
"""

from __future__ import annotations

import argparse
import re
import sys
from pathlib import Path
from typing import Any

import yaml

try:
    import opencc
except ImportError:
    print("ERROR: OpenCC library not installed.")
    print("Install with: pip install opencc-python-reimplemented")
    sys.exit(1)


# Configuration
I18N_DIR = Path(__file__).parent.parent.parent / "config" / "i18n"
SOURCE_LOCALE = "zh-Hant"
TARGET_LOCALE = "zh-Hans"

# Header comment for generated file
GENERATED_HEADER = '''# ═══════════════════════════════════════════════════════════════
#                    TrendRadar i18n - 简体中文
#                      Version: 1.0.0
#
# 此文件由 zh-Hant.yaml 通过 OpenCC 转换生成
# 请勿直接编辑，修改请在 zh-Hant.yaml 中进行
#
# 重新生成命令: python scripts/i18n/convert_opencc.py
# ═══════════════════════════════════════════════════════════════

'''


def create_converter() -> opencc.OpenCC:
    """Create an OpenCC converter for Traditional to Simplified Chinese."""
    # t2s: Traditional Chinese to Simplified Chinese
    return opencc.OpenCC("t2s")


def convert_value(converter: opencc.OpenCC, value: Any) -> Any:
    """Recursively convert string values in a data structure."""
    if isinstance(value, str):
        return converter.convert(value)
    elif isinstance(value, dict):
        return {k: convert_value(converter, v) for k, v in value.items()}
    elif isinstance(value, list):
        return [convert_value(converter, item) for item in value]
    else:
        return value


def load_yaml_preserving_order(filepath: Path) -> dict[str, Any]:
    """Load YAML file preserving key order."""
    with open(filepath, encoding="utf-8") as f:
        return yaml.safe_load(f) or {}


def save_yaml_with_header(filepath: Path, data: dict[str, Any], header: str) -> None:
    """Save YAML file with custom header comment."""
    yaml_content = yaml.dump(
        data,
        allow_unicode=True,
        default_flow_style=False,
        sort_keys=False,
        width=1000,  # Prevent line wrapping
    )

    # Add section comments back (simplified approach)
    with open(filepath, "w", encoding="utf-8") as f:
        f.write(header)
        f.write(yaml_content)


def format_yaml_with_sections(data: dict[str, Any]) -> str:
    """
    Format YAML data with section headers and proper structure.
    Mirrors the format of the source zh-Hant.yaml file.
    """
    output_lines = []

    # Section headers mapping
    section_headers = {
        "meta": "# 元数据",
        "app": "# ===============================================================\n# 应用程序通用\n# ===============================================================",
        "report": "# ===============================================================\n# 报告模式\n# ===============================================================",
        "platforms": "# ===============================================================\n# 平台名称\n# ===============================================================",
        "notification": "# ===============================================================\n# 通知消息\n# ===============================================================",
        "ai": "# ===============================================================\n# AI 分析\n# ===============================================================",
        "storage": "# ===============================================================\n# 存储\n# ===============================================================",
        "time": "# ===============================================================\n# 时间相关\n# ===============================================================",
        "errors": "# ===============================================================\n# 错误消息\n# ===============================================================",
        "success": "# ===============================================================\n# 成功消息\n# ===============================================================",
        "ui": "# ===============================================================\n# UI 元素 (未来 Web 界面使用)\n# ===============================================================",
        "mcp": "# ===============================================================\n# MCP Server 相关\n# ===============================================================",
    }

    for key, value in data.items():
        # Add section header if available
        if key in section_headers:
            if output_lines:  # Add blank line before new section
                output_lines.append("")
            output_lines.append(section_headers[key])

        # Dump this section as YAML
        section_yaml = yaml.dump(
            {key: value},
            allow_unicode=True,
            default_flow_style=False,
            sort_keys=False,
            width=1000,
        )
        output_lines.append(section_yaml.rstrip())

    return "\n".join(output_lines)


def convert_locale(dry_run: bool = False) -> bool:
    """
    Convert zh-Hant.yaml to zh-Hans.yaml using OpenCC.

    Returns:
        True if successful, False otherwise
    """
    source_path = I18N_DIR / f"{SOURCE_LOCALE}.yaml"
    target_path = I18N_DIR / f"{TARGET_LOCALE}.yaml"

    print(f"Converting: {SOURCE_LOCALE}.yaml -> {TARGET_LOCALE}.yaml")
    print()

    # Load source
    if not source_path.exists():
        print(f"ERROR: Source file not found: {source_path}")
        return False

    source_data = load_yaml_preserving_order(source_path)
    print(f"  Loaded {SOURCE_LOCALE}.yaml")

    # Create converter
    converter = create_converter()
    print(f"  OpenCC converter initialized (t2s)")

    # Convert all string values
    converted_data = convert_value(converter, source_data)

    # Update meta locale info
    if "meta" in converted_data:
        converted_data["meta"]["locale"] = "zh-Hans"
        converted_data["meta"]["name"] = "简体中文"

    print(f"  Converted all string values")

    # Count converted strings
    def count_strings(data: Any) -> int:
        if isinstance(data, str):
            return 1
        elif isinstance(data, dict):
            return sum(count_strings(v) for v in data.values())
        elif isinstance(data, list):
            return sum(count_strings(item) for item in data)
        return 0

    string_count = count_strings(converted_data)
    print(f"  Total strings converted: {string_count}")

    if dry_run:
        print()
        print("DRY RUN - No files written")
        print()
        print("Preview of converted content (first 50 lines):")
        print("-" * 40)
        preview = format_yaml_with_sections(converted_data)
        preview_lines = preview.split("\n")[:50]
        print("\n".join(preview_lines))
        if len(preview.split("\n")) > 50:
            print("...")
        return True

    # Save converted file
    formatted_content = format_yaml_with_sections(converted_data)
    with open(target_path, "w", encoding="utf-8") as f:
        f.write(GENERATED_HEADER)
        f.write(formatted_content)
        f.write("\n")

    print(f"  Saved: {target_path}")
    print()
    print("Conversion complete!")
    return True


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Convert Traditional Chinese to Simplified Chinese using OpenCC"
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Show what would be changed without writing files",
    )
    args = parser.parse_args()

    print("=" * 60)
    print("TrendRadar OpenCC Chinese Converter")
    print("=" * 60)
    print()

    success = convert_locale(dry_run=args.dry_run)
    return 0 if success else 1


if __name__ == "__main__":
    sys.exit(main())
