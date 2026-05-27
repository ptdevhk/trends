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
import json
import re
import sys
from pathlib import Path
from typing import Any

import yaml


# Configuration
PROJECT_ROOT = Path(__file__).parent.parent.parent
I18N_DIR = PROJECT_ROOT / "config" / "i18n"
SOURCE_LOCALE = "zh-Hant"
TARGET_LOCALES = ["zh-Hans", "en"]
WEB_LOCALES_DIR = PROJECT_ROOT / "apps" / "web" / "src" / "i18n" / "locales"
WEB_SOURCE_LOCALE = "zh-Hant"
WEB_TARGET_LOCALES = ["zh-Hans", "en"]
WEB_SOURCE_DIR = PROJECT_ROOT / "apps" / "web" / "src"
TRANSLATION_CALL_PATTERN = re.compile(r"\b(?:i18n\.)?t\s*\(\s*(['\"])([^'\"\n]+)\1\s*(?:,|\))")
USE_TRANSLATION_PATTERN = re.compile(r"useTranslation\s*\(\s*(['\"])([^'\"\n]+)\1\s*\)")


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


def load_web_locale(locale: str) -> dict[str, Any]:
    """Load a web locale JSON file."""
    filepath = WEB_LOCALES_DIR / f"{locale}.json"
    if not filepath.exists():
        raise FileNotFoundError(f"Locale file not found: {filepath}")
    with open(filepath, encoding="utf-8") as f:
        return json.load(f) or {}


def save_locale(locale: str, data: dict[str, Any]) -> None:
    """Save a locale YAML file."""
    filepath = I18N_DIR / f"{locale}.yaml"
    with open(filepath, "w", encoding="utf-8") as f:
        yaml.dump(data, f, allow_unicode=True, default_flow_style=False, sort_keys=False)


def save_web_locale(locale: str, data: dict[str, Any]) -> None:
    """Save a web locale JSON file."""
    filepath = WEB_LOCALES_DIR / f"{locale}.json"
    with open(filepath, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
        f.write("\n")


def check_locale_sync(
    source_keys: set[str],
    target_data: dict[str, Any],
    locale: str,
) -> tuple[set[str], set[str]]:
    """
    Compare source and target locale keys.

    Returns:
        (missing_keys, extra_keys) - Keys missing in target, keys in target but not in source
    """
    target_keys = flatten_keys(target_data)

    # Exclude meta.locale and meta.name from comparison (they should differ)
    ignore_keys = {"meta.locale", "meta.name"}
    source_keys -= ignore_keys
    target_keys -= ignore_keys

    missing_keys = source_keys - target_keys
    extra_keys = target_keys - source_keys

    return missing_keys, extra_keys


def iter_web_source_files() -> list[Path]:
    """Return all web source files that can contain translation key usage."""
    files: list[Path] = []
    for path in WEB_SOURCE_DIR.rglob("*"):
        if not path.is_file():
            continue
        if path.suffix not in {".ts", ".tsx"}:
            continue
        path_str = str(path)
        if "__tests__" in path_str or path_str.endswith(".test.ts") or path_str.endswith(".test.tsx"):
            continue
        files.append(path)
    return files


def find_static_translation_key_usages() -> tuple[set[str], dict[str, str]]:
    """
    Find translation keys used via static t() calls:
      - t('some.key')
      - i18n.t("some.key")
      - t('some.key', { count: 5, defaultValue: '...' })
    Resolves useTranslation('namespace') prefixes so keys match locale structure.
    """
    used_keys: set[str] = set()
    key_locations: dict[str, str] = {}

    for file_path in iter_web_source_files():
        content = file_path.read_text(encoding="utf-8")

        # Detect useTranslation('namespace') to resolve prefixed keys
        ns_match = USE_TRANSLATION_PATTERN.search(content)
        namespace = ns_match.group(2).strip() if ns_match else None

        for match in TRANSLATION_CALL_PATTERN.finditer(content):
            key = match.group(2).strip()
            if not key:
                continue
            # Prefix key with namespace if useTranslation declares one
            resolved_key = f"{namespace}.{key}" if namespace else key
            used_keys.add(resolved_key)
            if resolved_key not in key_locations:
                line_number = content.count("\n", 0, match.start()) + 1
                relative = file_path.relative_to(PROJECT_ROOT)
                key_locations[resolved_key] = f"{relative}:{line_number}"

    return used_keys, key_locations


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


def remove_extra_keys(
    target_data: dict[str, Any],
    extra_keys: set[str],
) -> dict[str, Any]:
    """Remove extra keys from target that don't exist in source."""
    for key in extra_keys:
        keys = key.split(".")
        current = target_data
        for k in keys[:-1]:
            if not isinstance(current, dict) or k not in current:
                break
            current = current[k]
        else:
            if isinstance(current, dict) and keys[-1] in current:
                del current[keys[-1]]
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

    if not WEB_LOCALES_DIR.exists():
        print(f"ERROR: web locale directory not found: {WEB_LOCALES_DIR}")
        return 1

    # Load source locale
    try:
        source_data = load_locale(SOURCE_LOCALE)
        print("YAML locale parity checks")
        print(f"Source locale: {SOURCE_LOCALE}.yaml")
        source_keys = flatten_keys(source_data) - {"meta.locale", "meta.name"}
        print(f"  Total keys: {len(source_keys)}")
        print()
    except FileNotFoundError as e:
        print(f"ERROR: {e}")
        return 1

    all_synced = True
    yaml_results = []

    for locale in TARGET_LOCALES:
        print(f"Checking: {locale}.yaml")
        try:
            target_data = load_locale(locale)
        except FileNotFoundError:
            print(f"  ERROR: File not found!")
            all_synced = False
            continue

        missing_keys, extra_keys = check_locale_sync(source_keys, target_data, locale)

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

            if args.fix:
                print(f"  Fixing: Removing {len(extra_keys)} extra keys...")
                target_data = remove_extra_keys(target_data, extra_keys)
                save_locale(locale, target_data)
                print(f"  Fixed: {locale}.yaml updated")
        else:
            print(f"  No extra keys")

        yaml_results.append({
            "locale": locale,
            "missing": len(missing_keys),
            "extra": len(extra_keys),
        })
        print()

    print("Web JSON locale parity checks")
    print(f"Source locale: {WEB_SOURCE_LOCALE}.json")
    try:
        web_source_data = load_web_locale(WEB_SOURCE_LOCALE)
    except FileNotFoundError as e:
        print(f"ERROR: {e}")
        return 1

    web_source_keys = flatten_keys(web_source_data)
    print(f"  Total keys: {len(web_source_keys)}")
    print()

    web_results = []
    for locale in WEB_TARGET_LOCALES:
        print(f"Checking: {locale}.json")
        try:
            target_data = load_web_locale(locale)
        except FileNotFoundError:
            print("  ERROR: File not found!")
            all_synced = False
            continue

        missing_keys, extra_keys = check_locale_sync(web_source_keys, target_data, locale)
        if missing_keys:
            all_synced = False
            print(f"  MISSING keys ({len(missing_keys)}):")
            if args.verbose:
                print(format_key_list(missing_keys))
            else:
                print("    Run with --verbose to see all keys")

            if args.fix:
                print(f"  Fixing: Adding {len(missing_keys)} missing keys...")
                target_data = fix_missing_keys(web_source_data, target_data, missing_keys, locale)
                save_web_locale(locale, target_data)
                print(f"  Fixed: {locale}.json updated")
        else:
            print("  No missing keys")

        if extra_keys:
            all_synced = False
            print(f"  EXTRA keys ({len(extra_keys)}) - consider removing:")
            if args.verbose:
                print(format_key_list(extra_keys))
            else:
                print("    Run with --verbose to see all keys")

            if args.fix:
                print(f"  Fixing: Removing {len(extra_keys)} extra keys...")
                target_data = remove_extra_keys(target_data, extra_keys)
                save_web_locale(locale, target_data)
                print(f"  Fixed: {locale}.json updated")
        else:
            print("  No extra keys")

        web_results.append({
            "locale": locale,
            "missing": len(missing_keys),
            "extra": len(extra_keys),
        })
        print()

    print("Web translation key usage checks")
    used_keys, key_locations = find_static_translation_key_usages()
    missing_used_keys = used_keys - web_source_keys
    print(f"Static t()/i18n.t() calls found: {len(used_keys)}")
    if missing_used_keys:
        all_synced = False
        print(f"MISSING keys used in code ({len(missing_used_keys)}):")
        for key in sorted(missing_used_keys)[:20]:
            location = key_locations.get(key, "unknown")
            print(f"  - {key} ({location})")
        if len(missing_used_keys) > 20:
            print(f"  ... and {len(missing_used_keys) - 20} more")
    else:
        print("No missing keys used in static t()/i18n.t() calls")
    print()

    # Summary
    print("=" * 60)
    print("Summary")
    print("=" * 60)
    print()
    print("YAML locale parity")
    print(f"{'Locale':<12} {'Missing':<10} {'Extra':<10} {'Status':<10}")
    print("-" * 42)
    for r in yaml_results:
        status = "OK" if r["missing"] == 0 and r["extra"] == 0 else "ISSUES"
        print(f"{r['locale']:<12} {r['missing']:<10} {r['extra']:<10} {status:<10}")
    print()

    print("Web JSON locale parity")
    print(f"{'Locale':<12} {'Missing':<10} {'Extra':<10} {'Status':<10}")
    print("-" * 42)
    for r in web_results:
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
