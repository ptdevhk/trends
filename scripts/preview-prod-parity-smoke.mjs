// Parity smoke: compare /hr/resumes search results between prod (trends.pt-mes.com)
// and preview (preview.pt-mes.com) using the shared chrome-debug profile.
// Uses the same baseline query as deploy/preview-parity-check.sh.
// Usage: BOOTSTRAP_HR_DEMO_USER=... AUTH_HR_DEMO_PASSWORD=... node scripts/preview-prod-parity-smoke.mjs
import { chromium } from 'playwright';

const PROD = 'https://trends.pt-mes.com';
const PREVIEW = 'https://preview.pt-mes.com';
const QUERY = 'location=China&q=CNC+%E9%94%80%E5%94%AE&minRoleYears=1&roleType=sales&minAge=25&maxAge=40';
const HR_USER = process.env.BOOTSTRAP_HR_DEMO_USER || 'hr-demo';
const HR_PASS = process.env.AUTH_HR_DEMO_PASSWORD || '';

if (!HR_PASS) {
    console.error('AUTH_HR_DEMO_PASSWORD required');
    process.exit(2);
}

async function ensureLogin(page, baseUrl) {
    await page.goto(`${baseUrl}/login`, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForTimeout(2500);
    const url = page.url();
    if (url.includes('/login') && !url.includes('code=')) {
        await page.fill('#username', HR_USER);
        await page.fill('#password', HR_PASS);
        await page.click('button[type="submit"]');
        await page.waitForTimeout(5000);
    }
}

async function probeSite(browser, baseUrl) {
    const ctx = browser.contexts()[0];
    const page = await ctx.newPage();
    await ensureLogin(page, baseUrl);

    // UI: load hr/resumes and confirm the results surface renders
    await page.goto(`${baseUrl}/hr/resumes`, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForTimeout(6000);
    const ui = await page.evaluate(() => {
        const text = document.body.innerText;
        return {
            hasResultsSurface: /结果|结果列表|matches|results/i.test(text) || document.querySelectorAll('li, [class*="card"]').length > 5,
            errorPanel: /失败|重试|error|failed/i.test(text),
            snippet: text.slice(0, 300),
        };
    });

    // API: same parity query, in-page (uses the logged-in session)
    const apiUrl = `${baseUrl}/api/resumes?source=convex&paged=true&limit=5&${QUERY}`;
    const api = await page.evaluate(async (url) => {
        const r = await fetch(url);
        if (!r.ok) return { status: r.status, error: true };
        const j = await r.json();
        const names = (j.data || []).map((d) => d.name || d.originalName || '?');
        return { status: r.status, total: j.summary?.total, returned: j.summary?.returned, names };
    }, apiUrl);

    await page.close();
    return { ui, api };
}

const browser = await chromium.connectOverCDP('http://127.0.0.1:9222');
const prod = await probeSite(browser, PROD);
const preview = await probeSite(browser, PREVIEW);
await browser.close();

const match = (a, b) => {
    const total = a.api.total === b.api.total;
    const names = JSON.stringify(a.api.names) === JSON.stringify(b.api.names);
    return { total, names, verdict: total && names ? 'IDENTICAL' : 'DIFFERS' };
};

console.log(JSON.stringify({ prod, preview, comparison: match(prod, preview) }, null, 2));
