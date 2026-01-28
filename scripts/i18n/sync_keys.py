#!/usr/bin/env python3
"""
i18n Key Synchronization Checker

Verifies that all locale files have the same keys as the source file (zh-Hant.yaml).
This script is used in CI to ensure translation completeness.

Usage:
    python scripts/i18n/sync_keys.py [--fix]

Options:
    --fix    Auto-add missing keys with placeholder values (for development)

Exit codes:
    0 - All locales are in sync
    1 - Missing or extra keys found
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path
from typing import Any

import yaml


# Configuration
I18N_DIR = Path(__file__).parent.parent.parent / "config" / "i18n"
SOURCE_LOCALE = "zh-Hant"
TARGET_LOCALES = ["zh-Hans", "en"]


def flatten_keys(data: dict[str, Any], prefix: str = "") -> set[str]:
    """Recursively flatten nested dict keys into dot-notation paths."""
    keys = set()
    for key, value in data.items():
        full_key = f"{prefix}.{key}" if prefix else key
        if isinstance(value, dict):
            keys.update(flatten_keys(value, full_key))
        else:
            keys.add(full_key)
    return keys


def get_nested_value(data: dict[str, Any], key_path: str) -> Any:
    """Get a value from a nested dict using dot notation."""
    keys = key_path.split(".")
    current = data
    for key in keys:
        if not isinstance(current, dict) or key not in current:
            return None
        current = current[key]
    return current


def set_nested_value(data: dict[str, Any], key_path: str, value: Any) -> None:
    """Set a value in a nested dict using dot notation."""
    keys = key_path.split(".")
    current = data
    for key in keys[:-1]:
        if key not in current:
            current[key] = {}
        current = current[key]
    current[keys[-1]] = value


def load_locale(locale: str) -> dict[str, Any]:
    """Load a locale YAML file."""
    filepath = I18N_DIR / f"{locale}.yaml"
    if not filepath.exists():
        raise FileNotFoundError(f"Locale file not found: {filepath}")
    with open(filepath, encoding="utf-8") as f:
        return yaml.safe_load(f) or {}


def save_locale(locale: str, data: dict[str, Any]) -> None:
    """Save a locale YAML file."""
    filepath = I18N_DIR / f"{locale}.yaml"
    with open(filepath, "w", encoding="utf-8") as f:
        yaml.dump(data, f, allow_unicode=True, default_flow_style=False, sort_keys=False)


def check_locale_sync(
    source_data: dict[str, Any],
    target_data: dict[str, Any],
    locale: str,
) -> tuple[set[str], set[str]]:
    """
    Compare source and target locale keys.

    Returns:
        (missing_keys, extra_keys) - Keys missing in target, keys in target but not in source
    """
    source_keys = flatten_keys(source_data)
    target_keys = flatten_keys(target_data)

    # Exclude meta.locale and meta.name from comparison (they should differ)
    ignore_keys = {"meta.locale", "meta.name"}
    source_keys -= ignore_keys
    target_keys -= ignore_keys

    missing_keys = source_keys - target_keys
    extra_keys = target_keys - source_keys

    return missing_keys, extra_keys


def format_key_list(keys: set[str], max_display: int = 20) -> str:
    """Format a set of keys for display."""
    sorted_keys = sorted(keys)
    if len(sorted_keys) <= max_display:
        return "\n".join(f"  - {key}" for key in sorted_keys)
    displayed = sorted_keys[:max_display]
    remaining = len(sorted_keys) - max_display
    return "\n".join(f"  - {key}" for key in displayed) + f"\n  ... and {remaining} more"


def fix_missing_keys(
    source_data: dict[str, Any],
    target_data: dict[str, Any],
    missing_keys: set[str],
    locale: str,
) -> dict[str, Any]:
    """Add missing keys to target with placeholder values."""
    for key in missing_keys:
        source_value = get_nested_value(source_data, key)
        if isinstance(source_value, str):
            # Add placeholder marker for translators
            placeholder = f"[TODO: Translate to {locale}] {source_value}"
            set_nested_value(target_data, key, placeholder)
        else:
            set_nested_value(target_data, key, source_value)
    return target_data


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Check i18n locale files for missing or extra keys"
    )
    parser.add_argument(
        "--fix",
        action="store_true",
        help="Auto-add missing keys with placeholder values",
    )
    parser.add_argument(
        "--verbose",
        "-v",
        action="store_true",
        help="Show detailed output",
    )
    args = parser.parse_args()

    print("=" * 60)
    print("TrendRadar i18n Key Synchronization Check")
    print("=" * 60)
    print()

    # Check if i18n directory exists
    if not I18N_DIR.exists():
        print(f"ERROR: i18n directory not found: {I18N_DIR}")
        return 1

    # Load source locale
    try:
        source_data = load_locale(SOURCE_LOCALE)
        print(f"Source locale: {SOURCE_LOCALE}.yaml")
        source_keys = flatten_keys(source_data) - {"meta.locale", "meta.name"}
        print(f"  Total keys: {len(source_keys)}")
        print()
    except FileNotFoundError as e:
        print(f"ERROR: {e}")
        return 1

    all_synced = True
    results = []

    for locale in TARGET_LOCALES:
        print(f"Checking: {locale}.yaml")
        try:
            target_data = load_locale(locale)
        except FileNotFoundError:
            print(f"  ERROR: File not found!")
            all_synced = False
            continue

        missing_keys, extra_keys = check_locale_sync(source_data, target_data, locale)

        if missing_keys:
            all_synced = False
            print(f"  MISSING keys ({len(missing_keys)}):")
            if args.verbose:
                print(format_key_list(missing_keys))
            else:
                print(f"    Run with --verbose to see all keys")

            if args.fix:
                print(f"  Fixing: Adding {len(missing_keys)} missing keys...")
                target_data = fix_missing_keys(source_data, target_data, missing_keys, locale)
                save_locale(locale, target_data)
                print(f"  Fixed: {locale}.yaml updated")
        else:
            print(f"  No missing keys")

        if extra_keys:
            all_synced = False
            print(f"  EXTRA keys ({len(extra_keys)}) - consider removing:")
            if args.verbose:
                print(format_key_list(extra_keys))
            else:
                print(f"    Run with --verbose to see all keys")
        else:
            print(f"  No extra keys")

        results.append({
            "locale": locale,
            "missing": len(missing_keys),
            "extra": len(extra_keys),
        })
        print()

    # Summary
    print("=" * 60)
    print("Summary")
    print("=" * 60)
    print()
    print(f"{'Locale':<12} {'Missing':<10} {'Extra':<10} {'Status':<10}")
    print("-" * 42)
    for r in results:
        status = "OK" if r["missing"] == 0 and r["extra"] == 0 else "ISSUES"
        print(f"{r['locale']:<12} {r['missing']:<10} {r['extra']:<10} {status:<10}")
    print()

    if all_synced:
        print("All locales are in sync!")
        return 0
    else:
        print("Some locales have synchronization issues.")
        if not args.fix:
            print("Run with --fix to auto-add missing keys with placeholders.")
        return 1


if __name__ == "__main__":
    sys.exit(main())
