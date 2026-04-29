import { chromium } from 'playwright';

// Deeper scan: page load + interactions that trigger more Convex queries
const SCENARIOS = [
  {
    path: '/dev/resumes', label: 'Resume Search',
    interactions: async (page) => {
      // Try to trigger a search
      const searchInput = await page.locator('input[type="search"], input[placeholder*="搜"], input[placeholder*="search" i]').first();
      if (await searchInput.count() > 0) { await searchInput.fill('engineer').catch(()=>{}); await page.waitForTimeout(2000); }
    }
  },
  {
    path: '/dev/system/archived', label: 'Archived Resumes',
    interactions: async (page) => {
      const searchInput = await page.locator('input[placeholder*="搜"], input[placeholder*="search" i]').first();
      if (await searchInput.count() > 0) { await searchInput.fill('test').catch(()=>{}); await page.waitForTimeout(2000); }
    }
  },
  {
    path: '/dev/review-packets', label: 'Review Packets',
    interactions: async (page) => {
      // Click the exportCard textarea
      const ta = await page.locator('textarea').first();
      if (await ta.count() > 0) { await ta.click().catch(()=>{}); await page.waitForTimeout(1500); }
    }
  },
  {
    path: '/dev/summary-runs', label: 'Summary Runs',
    interactions: async (page) => {
      // Click any "preview" or "send" button if visible
      const btns = await page.locator('button').allTextContents();
      await page.waitForTimeout(2000);
    }
  },
  {
    path: '/dev/jds', label: 'Job Descriptions',
    interactions: async (page) => {
      // Try to click into a JD if any exist
      const firstRow = await page.locator('tr, [role="row"], [class*="card"]').nth(1);
      if (await firstRow.count() > 0) { await firstRow.click({ timeout: 1500 }).catch(()=>{}); await page.waitForTimeout(2000); }
    }
  },
  {
    path: '/dev/settings/profiles', label: 'Search Profiles',
    interactions: async (page) => {
      const firstRow = await page.locator('[class*="card"], [role="row"], button').nth(2);
      if (await firstRow.count() > 0) { await firstRow.click({ timeout: 1500 }).catch(()=>{}); await page.waitForTimeout(2000); }
    }
  },
  {
    path: '/dev/debug-ingest', label: 'Debug Ingest',
    interactions: async (page) => {
      // Scroll to bottom to trigger pagination
      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight)).catch(()=>{});
      await page.waitForTimeout(2500);
    }
  },
  {
    path: '/dev/ai-tagging', label: 'AI Tagging',
    interactions: async (page) => { await page.waitForTimeout(2000); }
  },
  {
    path: '/dev/debug-config/taxonomy', label: 'Taxonomy Config',
    interactions: async (page) => { await page.waitForTimeout(2000); }
  },
  {
    path: '/dev/system/blocked', label: 'Blocked Candidates',
    interactions: async (page) => { await page.waitForTimeout(2000); }
  },
];

const CONVEX_PATTERNS = [
  /ConvexError/i, /Convex.*error/i, /Error.*convex/i,
  /OptimisticConcurrencyControlFailure/i, /TooManyWrites/i, /InvalidDocument/i,
  /FunctionExecutionError/i, /CONVEX/,
];
const I18N_PATTERN = /i18next::translator:missingKey/;

async function runDeepE2E() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ locale: 'zh-Hans' });
  const page = await context.newPage();
  const results = [];

  for (const scenario of SCENARIOS) {
    const r = { path: scenario.path, label: scenario.label, convexErrors: [], i18nMissing: [], consoleErrors: [], navOk: false };
    const msgs = [];
    page.on('console', msg => { let t; try { t = typeof msg.text === 'function' ? msg.text() : msg.text; } catch { t = String(msg); } msgs.push({ type: msg.type(), text: t }); });
    page.on('pageerror', e => r.consoleErrors.push(e.message));
    page.on('requestfailed', req => {
      const url = req.url();
      if (url.includes('convex') || url.includes('/api/')) r.consoleErrors.push(`Req failed: ${url} - ${req.failure()?.errorText || 'unknown'}`);
    });

    try {
      await page.goto(`http://localhost:5173${scenario.path}`, { waitUntil: 'domcontentloaded', timeout: 15000 });
      await page.waitForTimeout(4000);
      await scenario.interactions(page);
      await page.waitForTimeout(2000);
      r.navOk = true;
    } catch (e) { r.consoleErrors.push(`Error: ${e.message}`); }
    page.removeAllListeners('console'); page.removeAllListeners('pageerror'); page.removeAllListeners('requestfailed');

    try { const els = await page.locator('[class*="error"],[class*="Error"],[role="alert"]').allTextContents(); for (const t of els) for (const p of CONVEX_PATTERNS) if (p.test(t)) { r.convexErrors.push(`UI: ${t.substring(0,200)}`); break; } } catch {}
    for (const m of msgs) {
      for (const p of CONVEX_PATTERNS) if (p.test(m.text)) { r.convexErrors.push(m.text.substring(0, 300)); break; }
      if (I18N_PATTERN.test(m.text)) { const x = m.text.match(/missingKey\s+\S+\s+\S+\s+(\S+)/); if (x) r.i18nMissing.push(x[1]); }
      if (m.type === 'error' && !m.text.includes('i18next') && !m.text.includes('DevTools') && !m.text.includes('React DevTools')) r.consoleErrors.push(m.text.substring(0, 300));
    }
    results.push(r);
    const s = r.convexErrors.length ? 'CONVEX ERRORS' : 'OK';
    const errs = r.consoleErrors.length ? ` | errs: ${r.consoleErrors.length}` : '';
    const i = r.i18nMissing.length ? ` | i18n: ${r.i18nMissing.length}` : '';
    console.log(`[${s}] ${r.label} (${r.path})${errs}${i}`);
  }

  console.log('\n' + '='.repeat(60) + '\nDEEP E2E RESULTS\n' + '='.repeat(60));
  let ce = 0; const ui = new Set(); let otherErrs = 0;
  for (const r of results) { ce += r.convexErrors.length; r.i18nMissing.forEach(k => ui.add(k)); otherErrs += r.consoleErrors.length; }
  console.log(`Scenarios: ${results.length} | Nav OK: ${results.filter(r=>r.navOk).length}/${results.length} | Convex errors: ${ce} | Other errors: ${otherErrs} | i18n missing: ${ui.size}`);

  if (ui.size) { console.log('\nMissing i18n keys:'); for (const k of [...ui].sort()) console.log(`  - ${k}`); }
  if (ce) { console.log('\nConvex errors:'); for (const r of results.filter(r=>r.convexErrors.length)) { console.log(`  ${r.label}:`); for (const e of [...new Set(r.convexErrors)]) console.log(`    - ${e}`); } }

  const other = results.filter(r=>r.consoleErrors.length && !r.convexErrors.length);
  if (other.length) { console.log('\nOther console errors:'); for (const r of other) { const f = [...new Set(r.consoleErrors)].filter(e=>!e.includes('beforeunload')); if (f.length) { console.log(`  ${r.label}:`); for (const e of f.slice(0,5)) console.log(`    - ${e}`); } } }

  const clean = ce === 0 && ui.size === 0 && otherErrs === 0;
  console.log(`\nVerdict: ${clean ? 'ALL CLEAN' : 'ISSUES FOUND'}`);
  await browser.close(); process.exit(clean ? 0 : 1);
}
runDeepE2E().catch(e => { console.error('Error:', e); process.exit(2); });
