import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { connectToChrome, measureWebVitals, type WebVitals } from './e2e-utils';
import type { Page } from 'playwright';

const __dirname = dirname(fileURLToPath(import.meta.url));

interface Thresholds {
    ttfb: number;
    lcp: number;
    cls: number;
    fcp: number;
}

interface SurfaceResult {
    surface: string;
    url: string;
    cwv: WebVitals;
    pass: boolean;
    skipped: string | null;
}

function loadThresholds(): Thresholds {
    const raw = JSON.parse(
        readFileSync(resolve(__dirname, 'benchmarks/cwv-baselines.json'), 'utf-8'),
    ) as { thresholds: Record<string, { value: number }> };
    return {
        ttfb: raw.thresholds.ttfb.value,
        lcp: raw.thresholds.lcp.value,
        cls: raw.thresholds.cls.value,
        fcp: raw.thresholds.fcp.value,
    };
}

function getFlagValue(flag: string): string | null {
    const index = process.argv.indexOf(flag);
    if (index === -1) return null;
    const value = process.argv[index + 1];
    return value && !value.startsWith('--') ? value : null;
}

const BASE_URL = process.env.E2E_BASE_URL ?? 'http://localhost:5173';
const SEARCH_SURFACE = `${BASE_URL}/dev/resumes?q=${encodeURIComponent('sales')}`;
const SETTINGS_SURFACE = `${BASE_URL}/admin/system/settings/operations`;
const EVIDENCE_DIR = '/tmp/uat-evidence';

async function ensureSession(page: Page) {
    // Mirror of e2e-smoke's ensureDevAdminSession: navigate to the dev
    // workspace first (the connectToChrome goto lands on the root route,
    // which does not prove the search shell renders), then confirm the
    // search input. The shared chrome-debug profile persists whatever role
    // last used it; search and settings surfaces need a dev-admin session.
    await page.goto(`${BASE_URL}/dev/resumes`, { waitUntil: 'domcontentloaded' });
    const isOnDevWorkspace = await page
        .getByTestId('resume-search-input')
        .waitFor({ state: 'visible', timeout: 8000 })
        .then(() => page.url().includes('/dev/resumes'))
        .catch(() => false);
    if (isOnDevWorkspace) {
        console.log('✅ Dev-admin session confirmed.');
        return;
    }

    const password = process.env.AUTH_BOOTSTRAP_PASSWORD?.trim();
    if (!password) {
        throw new Error(
            'AUTH_BOOTSTRAP_PASSWORD is required to ensure the dev-admin session for /admin/* surfaces',
        );
    }
    console.log('⚠️ Dev-admin session missing — logging in as demo-admin.');
    // An authenticated non-dev-admin session bounces /login back to the
    // workspace home, so revoke the session first (e2e-smoke pattern).
    await page.evaluate(async () => {
        const csrf = document.cookie
            .split(';')
            .map((c) => c.trim())
            .find((c) => c.startsWith('trends_csrf='));
        await fetch('/api/auth/logout', {
            method: 'POST',
            headers: {
                ...(csrf ? { 'x-csrf-token': csrf.split('=')[1] } : {}),
                'X-Workspace-Slug': 'dev',
            },
        });
    });
    await page.goto(`${BASE_URL}/login`);
    await page.getByLabel(/用户名|使用者名稱|Username/i).fill('demo-admin');
    await page.getByLabel(/密码|密碼|Password/i).fill(password);
    await page.getByRole('button', { name: /登录|登入|Sign in|Log in/i }).click();
    await page.getByTestId('resume-search-input').waitFor({ state: 'visible', timeout: 15000 });
    console.log('✅ Logged in as demo-admin.');
}

async function settleSearchResults(page: Page) {
    // The deterministic 'sales' query settles on either visible result rows
    // (checkbox) or the explicit empty-state heading; the result-count line
    // confirms the search response completed.
    const firstCheckbox = page.getByRole('checkbox', { name: /选择|選擇|Select/i }).first();
    const emptyState = page.getByRole('heading', {
        name: /没有匹配到简历|沒有符合的簡歷|No resumes matched this search|No resumes match this search/i,
    }).first();
    const countLine = page.getByText(/\d+\+?\s*(条结果|條結果|results?)/i).first();
    await Promise.race([
        firstCheckbox.waitFor({ state: 'visible', timeout: 60000 }),
        emptyState.waitFor({ state: 'visible', timeout: 60000 }),
    ]);
    await countLine.waitFor({ state: 'visible', timeout: 30000 }).catch(() => {});
}

async function measureSurface(
    page: Page,
    surface: string,
    url: string,
    thresholds: Thresholds,
): Promise<SurfaceResult> {
    // The init script registered by the previous measureWebVitals call
    // re-installs observers in this fresh document (per-navigation window
    // flag); the first call happens inside main() before the first goto.
    const vitals = await measureWebVitals(page);
    await page.goto(url, { waitUntil: 'domcontentloaded' });
    if (surface === 'search') {
        await settleSearchResults(page);
    } else {
        await page
            .getByTestId('ops-collection-keyword')
            .first()
            .waitFor({ state: 'visible', timeout: 60000 })
            .catch(() => {});
    }
    // Let late paints / layout shifts land before collecting.
    await page.waitForTimeout(2500);
    const cwv = await vitals.collect();

    const checks: Array<[keyof WebVitals, number | null, number, string]> = [
        ['ttfb', cwv.ttfb, thresholds.ttfb, 'ms'],
        ['lcp', cwv.lcp, thresholds.lcp, 'ms'],
        ['cls', cwv.cls, thresholds.cls, 'score'],
        ['fcp', cwv.fcp, thresholds.fcp, 'ms'],
    ];
    let pass = true;
    let skipped: string | null = null;
    console.log(`📊 ${surface} CWV:`);
    for (const [key, value, threshold, unit] of checks) {
        if (value === null) {
            console.log(`  ⚠️ ${key.toUpperCase()}: <null> (measurement missing)`);
            pass = false;
            continue;
        }
        const ok = value < threshold;
        if (!ok) pass = false;
        console.log(
            `  ${ok ? '✓' : '✗'} ${key.toUpperCase()}: ${value.toFixed(key === 'cls' ? 3 : 0)}${unit} (threshold: ${threshold}${unit})`,
        );
    }
    return { surface, url, cwv, pass, skipped };
}

async function main() {
    const port = Number(getFlagValue('--port') ?? process.env.CDP_PORT ?? 9222);
    const thresholds = loadThresholds();
    const { browser, page } = await connectToChrome({ port, baseUrl: BASE_URL, timeout: 30000 });

    const results: SurfaceResult[] = [];
    try {
        await ensureSession(page);
        // First measurement registers the addInitScript observers; the
        // search and settings surfaces each load a fresh document, so both
        // report timings for their own navigation.
        results.push(await measureSurface(page, 'search', SEARCH_SURFACE, thresholds));
        results.push(await measureSurface(page, 'settings', SETTINGS_SURFACE, thresholds));
    } finally {
        await browser.close();
    }

    const allPass = results.every((r) => r.pass);
    const evidence = {
        tool: 'scripts/measure-cwv.ts',
        measuredAt: new Date().toISOString(),
        baselines: 'scripts/benchmarks/cwv-baselines.json',
        baseUrl: BASE_URL,
        surfaces: results.map((r) => ({
            surface: r.surface,
            url: r.url,
            cwv: r.cwv,
            pass: r.pass,
        })),
        allPass,
    };
    mkdirSync(EVIDENCE_DIR, { recursive: true });
    const evidencePath = resolve(EVIDENCE_DIR, `cwv-${new Date().toISOString().slice(0, 10)}.json`);
    writeFileSync(evidencePath, JSON.stringify(evidence, null, 2));
    console.log(`\n📄 Evidence written to ${evidencePath}`);

    if (!allPass) {
        console.error('\n❌ CWV measurements missing or above baseline thresholds.');
        process.exit(1);
    }
    console.log('\n🌟 CWV measurements within baselines.');
}

main();
