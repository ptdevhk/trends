#!/usr/bin/env python3
"""
Static Site Builder for Multiple Locales

Builds static HTML sites for each supported locale, using the i18n
translation files to localize content.

Usage:
    python scripts/i18n/build_static.py [--output-dir OUTPUT] [--locales LOCALES]

Options:
    --output-dir DIR    Output directory (default: output/static)
    --locales LOCALES   Comma-separated locale codes (default: all)
    --clean             Remove output directory before building

The script:
1. Loads locale translation files from config/i18n/
2. Generates localized HTML templates for each locale
3. Copies static assets (CSS, JS, images)
4. Creates locale-specific directories: output/static/zh-Hant/, etc.
"""

from __future__ import annotations

import argparse
import os
import shutil
import sys
from datetime import datetime
from pathlib import Path
from typing import Any

import yaml


# Configuration
PROJECT_ROOT = Path(__file__).parent.parent.parent
I18N_DIR = PROJECT_ROOT / "config" / "i18n"
TEMPLATE_DIR = PROJECT_ROOT / "templates"  # Future template directory
DEFAULT_OUTPUT_DIR = PROJECT_ROOT / "output" / "static"
AVAILABLE_LOCALES = ["zh-Hant", "zh-Hans", "en"]
DEFAULT_LOCALE = "zh-Hans"


def load_locale(locale: str) -> dict[str, Any]:
    """Load a locale translation file."""
    filepath = I18N_DIR / f"{locale}.yaml"
    if not filepath.exists():
        raise FileNotFoundError(f"Locale file not found: {filepath}")
    with open(filepath, encoding="utf-8") as f:
        return yaml.safe_load(f) or {}


def get_nested(data: dict[str, Any], key_path: str, default: str = "") -> str:
    """Get a nested value using dot notation."""
    keys = key_path.split(".")
    current = data
    for key in keys:
        if not isinstance(current, dict) or key not in current:
            return default
        current = current[key]
    return current if isinstance(current, str) else default


def generate_index_html(locale_data: dict[str, Any], locale: str) -> str:
    """Generate a localized index.html page."""
    # Get translated strings
    app_name = get_nested(locale_data, "app.name", "TrendRadar")
    tagline = get_nested(locale_data, "app.tagline", "Trend Tracking Tool")

    # Navigation
    nav_home = get_nested(locale_data, "ui.navigation.home", "Home")
    nav_trends = get_nested(locale_data, "ui.navigation.trends", "Trends")
    nav_analysis = get_nested(locale_data, "ui.navigation.analysis", "Analysis")
    nav_settings = get_nested(locale_data, "ui.navigation.settings", "Settings")

    # Labels
    loading = get_nested(locale_data, "report.labels.loading", "Loading...")
    no_data = get_nested(locale_data, "report.labels.no_data", "No Data")
    last_updated = get_nested(locale_data, "report.labels.last_updated", "Last Updated")

    # Buttons
    btn_refresh = get_nested(locale_data, "ui.buttons.refresh", "Refresh")
    btn_search = get_nested(locale_data, "ui.buttons.search", "Search")
    btn_filter = get_nested(locale_data, "ui.buttons.filter", "Filter")

    # Sections
    section_new_items = get_nested(locale_data, "report.sections.new_items", "New Trends")
    section_hotlist = get_nested(locale_data, "report.sections.hotlist", "Hot List")
    section_ai_analysis = get_nested(locale_data, "report.sections.ai_analysis", "AI Analysis")

    # Placeholders
    search_placeholder = get_nested(locale_data, "ui.placeholders.search", "Search trends...")

    # Get locale direction
    direction = get_nested(locale_data, "meta.direction", "ltr")
    locale_name = get_nested(locale_data, "meta.name", locale)

    # Build HTML
    html = f'''<!DOCTYPE html>
<html lang="{locale}" dir="{direction}">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>{app_name} - {tagline}</title>
    <meta name="description" content="{tagline}">

    <!-- Locale switcher data -->
    <script>
        window.TRENDRADAR_LOCALE = "{locale}";
        window.TRENDRADAR_LOCALES = {{"zh-Hant": "繁體中文", "zh-Hans": "简体中文", "en": "English"}};
    </script>

    <style>
        :root {{
            --primary-color: #2563eb;
            --secondary-color: #64748b;
            --background-color: #f8fafc;
            --card-background: #ffffff;
            --text-color: #1e293b;
            --border-color: #e2e8f0;
        }}

        * {{
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }}

        body {{
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
            background-color: var(--background-color);
            color: var(--text-color);
            line-height: 1.6;
        }}

        .container {{
            max-width: 1200px;
            margin: 0 auto;
            padding: 1rem;
        }}

        header {{
            background: var(--card-background);
            border-bottom: 1px solid var(--border-color);
            padding: 1rem 0;
            position: sticky;
            top: 0;
            z-index: 100;
        }}

        .header-content {{
            display: flex;
            justify-content: space-between;
            align-items: center;
            flex-wrap: wrap;
            gap: 1rem;
        }}

        .logo {{
            font-size: 1.5rem;
            font-weight: 700;
            color: var(--primary-color);
            text-decoration: none;
        }}

        .tagline {{
            font-size: 0.875rem;
            color: var(--secondary-color);
        }}

        nav {{
            display: flex;
            gap: 1.5rem;
        }}

        nav a {{
            color: var(--text-color);
            text-decoration: none;
            font-weight: 500;
            transition: color 0.2s;
        }}

        nav a:hover {{
            color: var(--primary-color);
        }}

        .locale-switcher {{
            position: relative;
        }}

        .locale-switcher select {{
            padding: 0.5rem 1rem;
            border: 1px solid var(--border-color);
            border-radius: 0.375rem;
            background: var(--card-background);
            cursor: pointer;
        }}

        .search-bar {{
            display: flex;
            gap: 0.5rem;
            margin: 1.5rem 0;
        }}

        .search-bar input {{
            flex: 1;
            padding: 0.75rem 1rem;
            border: 1px solid var(--border-color);
            border-radius: 0.375rem;
            font-size: 1rem;
        }}

        .search-bar button {{
            padding: 0.75rem 1.5rem;
            background: var(--primary-color);
            color: white;
            border: none;
            border-radius: 0.375rem;
            cursor: pointer;
            font-weight: 500;
        }}

        .section {{
            background: var(--card-background);
            border-radius: 0.5rem;
            padding: 1.5rem;
            margin-bottom: 1.5rem;
            border: 1px solid var(--border-color);
        }}

        .section-title {{
            font-size: 1.25rem;
            font-weight: 600;
            margin-bottom: 1rem;
            display: flex;
            align-items: center;
            gap: 0.5rem;
        }}

        .loading {{
            text-align: center;
            padding: 2rem;
            color: var(--secondary-color);
        }}

        .no-data {{
            text-align: center;
            padding: 2rem;
            color: var(--secondary-color);
        }}

        .last-updated {{
            font-size: 0.875rem;
            color: var(--secondary-color);
            text-align: right;
            margin-top: 1rem;
        }}

        footer {{
            text-align: center;
            padding: 2rem;
            color: var(--secondary-color);
            font-size: 0.875rem;
        }}

        @media (max-width: 768px) {{
            .header-content {{
                flex-direction: column;
                align-items: flex-start;
            }}

            nav {{
                flex-wrap: wrap;
            }}
        }}
    </style>
</head>
<body>
    <header>
        <div class="container header-content">
            <div>
                <a href="/" class="logo">{app_name}</a>
                <div class="tagline">{tagline}</div>
            </div>
            <nav>
                <a href="/">{nav_home}</a>
                <a href="/trends">{nav_trends}</a>
                <a href="/analysis">{nav_analysis}</a>
                <a href="/settings">{nav_settings}</a>
            </nav>
            <div class="locale-switcher">
                <select id="locale-select" onchange="switchLocale(this.value)">
                    <option value="zh-Hant" {"selected" if locale == "zh-Hant" else ""}>繁體中文</option>
                    <option value="zh-Hans" {"selected" if locale == "zh-Hans" else ""}>简体中文</option>
                    <option value="en" {"selected" if locale == "en" else ""}>English</option>
                </select>
            </div>
        </div>
    </header>

    <main class="container">
        <div class="search-bar">
            <input type="text" placeholder="{search_placeholder}" id="search-input">
            <button onclick="search()">{btn_search}</button>
            <button onclick="filter()">{btn_filter}</button>
        </div>

        <section class="section">
            <h2 class="section-title">🆕 {section_new_items}</h2>
            <div class="loading" id="new-items-loading">{loading}</div>
            <div class="no-data" id="new-items-empty" style="display: none;">{no_data}</div>
            <div id="new-items-content"></div>
        </section>

        <section class="section">
            <h2 class="section-title">🔥 {section_hotlist}</h2>
            <div class="loading" id="hotlist-loading">{loading}</div>
            <div class="no-data" id="hotlist-empty" style="display: none;">{no_data}</div>
            <div id="hotlist-content"></div>
        </section>

        <section class="section">
            <h2 class="section-title">🤖 {section_ai_analysis}</h2>
            <div class="loading" id="analysis-loading">{loading}</div>
            <div class="no-data" id="analysis-empty" style="display: none;">{no_data}</div>
            <div id="analysis-content"></div>
        </section>

        <div class="last-updated">
            {last_updated}: <span id="last-updated-time">-</span>
        </div>
    </main>

    <footer>
        <p>{app_name} &copy; {datetime.now().year}</p>
    </footer>

    <script>
        function switchLocale(locale) {{
            // In a real app, this would redirect to the locale-specific page
            const path = window.location.pathname;
            const newPath = '/' + locale + '/';
            window.location.href = newPath;
        }}

        function search() {{
            const query = document.getElementById('search-input').value;
            console.log('Search:', query);
        }}

        function filter() {{
            console.log('Filter clicked');
        }}

        // Initialize - in a real app, this would fetch data
        document.addEventListener('DOMContentLoaded', function() {{
            document.getElementById('last-updated-time').textContent = new Date().toLocaleString();
        }});
    </script>
</body>
</html>
'''
    return html


def build_locale(
    locale: str,
    output_dir: Path,
    locale_data: dict[str, Any],
) -> bool:
    """Build static site for a single locale."""
    locale_dir = output_dir / locale
    locale_dir.mkdir(parents=True, exist_ok=True)

    # Generate index.html
    index_html = generate_index_html(locale_data, locale)
    index_path = locale_dir / "index.html"
    with open(index_path, "w", encoding="utf-8") as f:
        f.write(index_html)

    print(f"  Generated: {index_path}")
    return True


def build_all_locales(
    locales: list[str],
    output_dir: Path,
    default_locale: str,
    clean: bool = False,
) -> bool:
    """Build static sites for all specified locales."""
    if clean and output_dir.exists():
        print(f"Cleaning: {output_dir}")
        shutil.rmtree(output_dir)

    output_dir.mkdir(parents=True, exist_ok=True)

    success_count = 0

    for locale in locales:
        print(f"\nBuilding: {locale}")
        try:
            locale_data = load_locale(locale)
            if build_locale(locale, output_dir, locale_data):
                success_count += 1
        except FileNotFoundError as e:
            print(f"  ERROR: {e}")
        except Exception as e:
            print(f"  ERROR: {e}")

    # Create root index.html that redirects to configured default locale
    root_index = output_dir / "index.html"
    redirect_html = f'''<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <meta http-equiv="refresh" content="0; url=/{default_locale}/">
    <title>TrendRadar</title>
    <script>
        window.location.href = '/{default_locale}/';
    </script>
</head>
<body>
    <p>Redirecting...</p>
</body>
</html>
'''
    with open(root_index, "w", encoding="utf-8") as f:
        f.write(redirect_html)
    print(f"\nGenerated: {root_index} (redirect -> /{default_locale}/)")

    return success_count == len(locales)


def resolve_default_locale(locales: list[str]) -> str:
    env_locale = (
        os.environ.get("VITE_DEFAULT_LOCALE")
        or os.environ.get("DEFAULT_LOCALE")
        or DEFAULT_LOCALE
    ).strip()

    if env_locale not in AVAILABLE_LOCALES:
        print(
            f"Warning: Unsupported default locale '{env_locale}'. "
            f"Falling back to '{DEFAULT_LOCALE}'."
        )
        env_locale = DEFAULT_LOCALE

    if env_locale in locales:
        return env_locale

    if locales:
        fallback = locales[0]
        print(
            f"Warning: Default locale '{env_locale}' is not in selected locales "
            f"({', '.join(locales)}). Falling back to '{fallback}'."
        )
        return fallback

    return DEFAULT_LOCALE


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Build static sites for multiple locales"
    )
    parser.add_argument(
        "--output-dir",
        type=Path,
        default=DEFAULT_OUTPUT_DIR,
        help=f"Output directory (default: {DEFAULT_OUTPUT_DIR})",
    )
    parser.add_argument(
        "--locales",
        type=str,
        default=",".join(AVAILABLE_LOCALES),
        help=f"Comma-separated locale codes (default: {','.join(AVAILABLE_LOCALES)})",
    )
    parser.add_argument(
        "--clean",
        action="store_true",
        help="Remove output directory before building",
    )
    args = parser.parse_args()

    locales = [l.strip() for l in args.locales.split(",")]
    default_locale = resolve_default_locale(locales)

    print("=" * 60)
    print("TrendRadar Static Site Builder")
    print("=" * 60)
    print()
    print(f"Output directory: {args.output_dir}")
    print(f"Locales: {', '.join(locales)}")
    print(f"Default locale: {default_locale}")
    print()

    success = build_all_locales(locales, args.output_dir, default_locale, args.clean)

    print()
    print("=" * 60)
    if success:
        print("Build complete!")
        return 0
    else:
        print("Build completed with errors")
        return 1


if __name__ == "__main__":
    sys.exit(main())
