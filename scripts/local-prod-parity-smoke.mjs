// Local-vs-prod parity smoke: /hr/research + /hr/resumes search parity
// Local (0.4.16 + prod DB) vs prod trends.pt-mes.com, logged in as hr-demo via shared chrome-debug profile.
// Usage: AUTH_HR_DEMO_PASSWORD=... node scripts/local-prod-parity-smoke.mjs
import { chromium } from 'playwright';

const LOCAL = 'http://localhost:5173';
const PROD = 'https://trends.pt-mes.com';
// /health lives on the API (:3000), not the Vite dev server (:5173)
const LOCAL_API = 'http://localhost:3000';
const QUERY = 'location=China&q=CNC+%E9%94%80%E5%94%AE&minRoleYears=1&roleType=sales&minAge=25&maxAge=40';

async function fetchVersion(baseUrl) {
    try {
        const r = await fetch(`${baseUrl}/health`);
        if (!r.ok) return 'unknown';
        const j = await r.json();
        return j.version || 'unknown';
    } catch { return 'unknown'; }
}
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

async function probeResearchPage(browser, baseUrl) {
    const ctx = browser.contexts()[0];
    const page = await ctx.newPage();
    await ensureLogin(page, baseUrl);

    // /hr/research — the page under test
    await page.goto(`${baseUrl}/hr/research`, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForTimeout(6000);
    const ui = await page.evaluate(() => {
        const text = document.body.innerText;
        return {
            title: document.title,
            hasErrorPanel: /失败|重试|error|failed/i.test(text),
            hasResearchSurface: /研究|research|行业|industry/i.test(text),
            snippet: text.slice(0, 400),
        };
    });

    // In-page API responses for the research surfaces
    const apis = await page.evaluate(async () => {
        const get = async (p) => {
            try {
                const r = await fetch(p, { headers: { 'X-Workspace-Slug': 'hr' } });
                if (!r.ok) return { path: p, status: r.status, error: true };
                const j = await r.json();
                const items = Array.isArray(j) ? j : j.data || j.items || [];
                return {
                    path: p,
                    status: r.status,
                    count: items.length,
                    keys: Array.isArray(j) ? [] : Object.keys(j).slice(0, 12),
                    first: JSON.stringify(items[0] || null).slice(0, 300),
                };
            } catch (e) {
                return { path: p, status: 0, error: String(e) };
            }
        };
        const paths = [
            '/api/research/showcase',
            '/api/research/industry',
            '/api/research/pulse',
            '/api/research/companies/search?q=CNC&limit=5',
        ];
        const out = [];
        for (const p of paths) out.push(await get(p));
        return out;
    });

    await page.close();
    return { ui, apis };
}

async function probeResumeSearch(browser, baseUrl) {
    const ctx = browser.contexts()[0];
    const page = await ctx.newPage();
    await ensureLogin(page, baseUrl);
    await page.goto(`${baseUrl}/hr/resumes`, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForTimeout(6000);
    const api = await page.evaluate(async (url) => {
        const r = await fetch(url, { headers: { 'X-Workspace-Slug': 'hr' } });
        if (!r.ok) return { status: r.status, error: true };
        const j = await r.json();
        return {
            status: r.status,
            total: j.summary?.total,
            returned: j.summary?.returned,
            names: (j.data || []).map((d) => d.name || d.originalName || '?'),
        };
    }, `${baseUrl}/api/resumes?source=convex&paged=true&limit=5&${QUERY}`);
    const ui = await page.evaluate(() => {
        const text = document.body.innerText;
        return {
            hasResults: /结果|results/i.test(text) || document.querySelectorAll('li, [class*="card"]').length > 5,
            errorPanel: /失败|重试|error|failed/i.test(text),
        };
    });
    await page.close();
    return { ui, api };
}

const browser = await chromium.connectOverCDP('http://127.0.0.1:9222');
const localVer = await fetchVersion(LOCAL_API);
const prodVer = await fetchVersion(PROD);
const versionMatch = localVer === prodVer && localVer !== 'unknown';
const localResearch = await probeResearchPage(browser, LOCAL);
const prodResearch = await probeResearchPage(browser, PROD);
const localResume = await probeResumeSearch(browser, LOCAL);
const prodResume = await probeResumeSearch(browser, PROD);
await browser.close();

const researchMatch = JSON.stringify(localResearch.apis.map(a => ({ status: a.status, count: a.count, first: a.first })))
    === JSON.stringify(prodResearch.apis.map(a => ({ status: a.status, count: a.count, first: a.first })));
const resumeMatch = localResume.api.total === prodResume.api.total
    && JSON.stringify(localResume.api.names) === JSON.stringify(prodResume.api.names);

const verdict = (researchMatch && resumeMatch && versionMatch) ? 'IDENTICAL' :
    (!versionMatch ? 'VERSION-DIFFERS' : 'DIFFERS');

console.log(JSON.stringify({
    versions: { local: localVer, prod: prodVer, match: versionMatch },
    research: { local: localResearch, prod: prodResearch, identical: researchMatch },
    resumeSearch: {
        local: { total: localResume.api.total, names: localResume.api.names, ui: localResume.ui },
        prod: { total: prodResume.api.total, names: prodResume.api.names, ui: prodResume.ui },
        identical: resumeMatch,
    },
    verdict,
}, null, 2));
