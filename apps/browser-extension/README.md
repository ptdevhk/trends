# 智通直聘 Resume Collector

Chrome/Edge browser extension to extract resume data from hr.job5156.com (智通直聘企业版).

## Installation

1. Open Chrome and navigate to `chrome://extensions`
2. Enable **Developer mode** (toggle in top-right corner)
3. Click **Load unpacked**
4. Select this directory (`apps/browser-extension`)

## Usage

1. Log in to [hr.job5156.com](https://hr.job5156.com)
2. Navigate to the resume search page (搜索简历)
3. Click the extension icon in the toolbar
4. Use the buttons:
   - **提取当前页** - Preview extracted data
   - **导出 CSV** - Download as CSV file
   - **导出 JSON** - Download as JSON file
5. Optional:
   - 勾选 **每次下载前选择位置** 可弹出“另存为”对话框；不勾选则直接保存到浏览器的默认下载目录（通常是 macOS 的 `~/Downloads`）
6. Troubleshooting (macOS):
   - 点击 **诊断下载** 会生成一个小的测试文件，并显示实际保存路径/错误原因
   - 点击 **下载设置** 打开 `chrome://settings/downloads`（建议关闭“下载前询问每个文件的保存位置”，并确认下载目录）
   - 点击 **显示文件** 尝试在 Finder 中定位最新一次诊断下载的测试文件

## Data Fields Extracted

> 文件名格式：`resumes_YYYY-MM-DD_<randomid>.csv` / `resumes_YYYY-MM-DD_<randomid>.json`

| Field | Description |
|:------|:------------|
| name | Candidate name (e.g., 谢先生) |
| age | Age (e.g., 37岁) |
| experience | Work experience (e.g., 12年) |
| education | Education level |
| location | Current location |
| expectedSalary | Expected salary |
| activityStatus | Last active time |
| jobIntention | Job search intention |
| workHistory | Previous work experience |
| profileUrl | Link to full resume |
| extractedAt | Extraction timestamp |

## Development

```bash
# View extension files
ls -la apps/browser-extension/

# Make changes and reload in chrome://extensions
```

## Debugging with MCP

Debug the extension through Chrome DevTools Protocol (CDP) via MCP.

### macOS / Linux (local development)

```bash
# Start Chrome with remote debugging and the extension loaded
cd apps/browser-extension
npm run debug

# Custom URL
./scripts/debug.sh "https://hr.job5156.com/search?keyword=python"
```

The script prefers Chrome for Testing or Chromium (supports `--load-extension`). If only branded
Chrome 137+ is available, it will warn and you must load the extension manually via
`chrome://extensions`.

### Cmux container environment

Chrome is managed by systemd (`cmux-devtools.service`) and uses a branded build. Since Chrome 137+,
the `--load-extension` flag is removed for branded Chrome.

Option 1: apply a pre-loaded profile (recommended for fresh containers)

```bash
cd apps/browser-extension
npm run setup-profile
sudo systemctl restart cmux-devtools
```

Option 2: manual load once (persists in the profile)

1. Navigate to `chrome://extensions`
2. Enable Developer mode
3. Click "Load unpacked" (file picker requires manual interaction)
4. Select: `/root/workspace/apps/browser-extension`
5. Navigate to `https://hr.job5156.com/search`

### Generate profile seed (one-time)

After loading the extension manually once, capture a minimal profile seed:

```bash
mkdir -p apps/browser-extension/profile-seed
cp /root/.config/chrome/Preferences apps/browser-extension/profile-seed/Preferences
cp /root/.config/chrome/Secure\\ Preferences apps/browser-extension/profile-seed/Secure\\ Preferences 2>/dev/null || true
grep -o '\"path\": \"[^\"]*browser-extension[^\"]*\"' apps/browser-extension/profile-seed/Preferences
```

### MCP commands

Useful MCP commands for verification:

- `list_pages`
- `take_snapshot`
- `list_console_messages`
- `take_screenshot`
- `navigate_page url="https://hr.job5156.com/search"`

## Files

- `manifest.json` - Extension configuration (Manifest v3)
- `content.js` - Injected script for data extraction
- `popup.html/css/js` - Extension popup UI
- `content-styles.css` - Minimal page styles
- `icons/` - Extension icons (16/32/48/128px)

## Integration with Trends

The extracted data can be:
1. Downloaded as CSV/JSON for manual import
2. Extended to POST directly to the Trends API (`/api/resumes`)

---

Part of the [Trends Resume Screening System](../../AGENTS.md)
