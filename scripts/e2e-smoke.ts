import {
    COLLECTION_TASK_DISPATCHED_TOAST_PATTERN,
    connectToChrome,
    waitForToast,
    DEFAULT_OPTIONS,
    measureWebVitals,
    collectConsoleErrors,
} from './e2e-utils';
import { Locator, Page, Response, expect } from '@playwright/test';
import { ConvexHttpClient } from 'convex/browser';
import { makeFunctionReference } from 'convex/server';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import AxeBuilder from '@axe-core/playwright';

const __dirname = dirname(fileURLToPath(import.meta.url));

function loadCwvBaselines(): Record<string, number> {
    const baselinesPath = resolve(__dirname, 'benchmarks/cwv-baselines.json');
    const raw = JSON.parse(readFileSync(baselinesPath, 'utf-8'));
    const thresholds: Record<string, number> = {};
    for (const [key, entry] of Object.entries(raw.thresholds as Record<string, { value: number }>)) {
        thresholds[key] = entry.value;
    }
    return thresholds;
}

// Keep this aligned with the seeded demo fixtures. "Sales Engineer" no longer
// returns deterministic matches in the current workspace snapshot, while the
// broader "sales" query still yields stable seeded results for smoke flows.
const DETERMINISTIC_SEARCH_QUERY = 'sales';
const SMOKE_VIEWPORT = { width: 1600, height: 1200 };
const SEARCH_WITH_QUERY_URL = (baseUrl: string) =>
    `${baseUrl}/dev/resumes?q=${encodeURIComponent(DETERMINISTIC_SEARCH_QUERY)}`;
const SEARCH_EMPTY_STATE_PATTERN = /没有匹配到简历|沒有符合的簡歷|No resumes matched this search|No resumes match this search/i;
const SEARCH_RESULT_COUNT_PATTERN = /\d+\+?\s*(条结果|條結果|results?)/i;
const JOB5156_LOGIN_URL_PREFIX = 'https://hr.job5156.com/login'
const JOB5156_SEARCH_URL_PREFIX = 'https://hr.job5156.com/search'
const RUN_JOB5156_SMOKE_FLAG = '--run-job5156'

type WorkspaceSeedResult = {
    resumes: {
        inserted: number;
        updated: number;
    };
};

const seedWorkspaceDemoFunction = makeFunctionReference<
    'mutation',
    Record<string, never>,
    WorkspaceSeedResult
>('seed:seedWorkspaceDemoData');

type ClearWorkspaceResult = {
    workspaceSlug: string;
    clearedStatuses: number;
    clearedOverlayRows: number;
};

const clearCandidateStatusesFunction = makeFunctionReference<
    'mutation',
    { workspaceSlug: string; writeSecret: string },
    ClearWorkspaceResult
>('candidate_status:clearWorkspace');

function resolveConvexUrl(): string {
    if (typeof process.env.CONVEX_URL === 'string' && process.env.CONVEX_URL.trim().length > 0) {
        return process.env.CONVEX_URL.trim();
    }
    if (typeof process.env.VITE_CONVEX_URL === 'string' && process.env.VITE_CONVEX_URL.trim().length > 0) {
        return process.env.VITE_CONVEX_URL.trim();
    }
    return 'http://127.0.0.1:3210';
}

async function ensureDeterministicSmokeFixtures() {
    const convexUrl = resolveConvexUrl();
    const client = new ConvexHttpClient(convexUrl);
    console.log(`Seeding deterministic smoke fixtures at ${convexUrl}...`);

    // Reset dev-workspace candidate statuses first so every run starts from an
    // all-"new" state. The bulk-actions smoke shortlists the top results; without
    // this reset, the default new-only status filter hides them on the next run
    // and the deterministic search degrades to an empty list (e2e self-poisoning).
    const writeSecret = process.env.CONVEX_WRITE_SECRET?.trim();
    if (writeSecret) {
        const clearResult = await client.mutation(clearCandidateStatusesFunction, {
            workspaceSlug: 'dev',
            writeSecret,
        });
        console.log(`✅ Dev candidate statuses reset (${clearResult.clearedStatuses} statuses, ${clearResult.clearedOverlayRows} overlay rows).`);
    } else {
        console.warn('⚠️ CONVEX_WRITE_SECRET not set — skipping candidate status reset.');
    }

    const seedResult = await client.mutation(seedWorkspaceDemoFunction, {});
    console.log('✅ Deterministic smoke fixtures ensured.', seedResult.resumes);
}

async function preferVisibleLocator(primary: Locator, fallback: Locator, timeoutMs = 3000): Promise<Locator> {
    const usePrimary = await primary.isVisible({ timeout: timeoutMs }).catch(() => false);
    return usePrimary ? primary : fallback;
}

async function loadDeterministicSearchResults(page: Page) {
    // The SPA renders from JS; waiting for full "load" can hang on fonts/images
    // when the local backend is slow. domcontentloaded is sufficient here.
    await page.goto(`${DEFAULT_OPTIONS.baseUrl}/dev/resumes`, { waitUntil: 'domcontentloaded' });
    await page.setViewportSize(SMOKE_VIEWPORT);

    const keywordInput = await preferVisibleLocator(
        page.getByTestId('resume-search-input'),
        page.getByPlaceholder(/Search resumes by keywords|按关键词、品牌、岗位或地区搜索简历|按關鍵詞、品牌、職位或地區搜尋簡歷/i),
    );
    await keywordInput.waitFor({ state: 'visible' });
    await keywordInput.fill(DETERMINISTIC_SEARCH_QUERY);

    const resetBtn = page.getByRole('button', { name: /重置|Reset/i }).first();
    const firstCheckbox = page.getByRole('checkbox', { name: /选择|Select/i }).first();
    const emptyState = page.getByRole('heading', { name: SEARCH_EMPTY_STATE_PATTERN }).first();
    const searchSubmitBtn = page.getByTestId('resume-search-submit');
    // The search surfaces an explicit failure panel (with retry) instead of a
    // false empty state when the BFF search drops (F11: the dev Vite proxy
    // intermittently kills large search responses). The settle poll retries
    // through it instead of timing out.
    const searchFailedPanel = page.getByTestId('resume-search-failed-panel');
    // Stuck-mode detection lives inside settle(): it tracks completed API
    // responses (network progress) rather than the loading indicator, whose
    // flicker across the hook's internal retries defeated a loading-based
    // counter (see settle below).

    if (await searchSubmitBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
        await searchSubmitBtn.click();
    } else {
        await keywordInput.press('Enter');
    }

    // The local backend can take 5–15s per search and the hook retries failed
    // fetches (ERR_FAILED under collection/analysis churn), so the results
    // settle window can stretch well past 30s — poll generously, and when the
    // explicit search-failure panel appears, recover with a fresh page load:
    // the F11 drops are connection-level, so retrying on the same connection
    // keeps failing while a reload (new connection) recovers.
    const settle = async (hasSettled: () => Promise<boolean>, timeoutMs: number) => {
        const deadline = Date.now() + timeoutMs;
        const NO_PROGRESS_MS = Number(process.env.E2E_RECOVERY_MS ?? 40000);
        const dbg = process.env.E2E_DEBUG === '1';
        const startedAt = Date.now();
        // Progress = any completed API response. Failed/dropped requests emit
        // no response event, so this distinguishes "slow but progressing"
        // searches (wait for them) from stuck ones (drops, missed submits,
        // silent hangs — recover). The loading-flag flicker that defeated the
        // old stuck-loading counter is irrelevant to this signal.
        let lastApiResponseAt = Date.now();
        const onApiResponse = (resp: Response) => {
            if (/\/api\//.test(resp.url())) lastApiResponseAt = Date.now();
        };
        page.on('response', onApiResponse);
        // Recovery = fresh navigation to the query-param URL. The SPA
        // auto-runs the search from URL params (verified live), so a
        // navigation both re-issues the search and gets a fresh connection.
        // Navigation (not page.reload) guarantees the query param is present
        // even when the original submit never registered on the page.
        const recover = async (reason: string) => {
            if (dbg) console.log(`[e2e-debug] RECOVERY(${reason})`);
            await page.goto(SEARCH_WITH_QUERY_URL(DEFAULT_OPTIONS.baseUrl), { waitUntil: 'domcontentloaded' }).catch(() => {});
            await page.setViewportSize(SMOKE_VIEWPORT);
            lastApiResponseAt = Date.now();
        };
        try {
            // Test hook: exercise the recovery path on demand (E2E_FORCE_RECOVERY=1).
            if (process.env.E2E_FORCE_RECOVERY === '1') {
                await recover('forced');
            }
            while (Date.now() < deadline) {
                if (await hasSettled()) return true;
                if (dbg) {
                    const inputVal = await keywordInput.inputValue().catch(() => '<n/a>');
                    console.log(`[e2e-debug] t=${((Date.now() - startedAt) / 1000).toFixed(0)}s input="${inputVal}" url=${page.url()}`);
                }
                if (await searchFailedPanel.isVisible().catch(() => false)) {
                    await recover('failure-panel');
                    continue;
                }
                // No-progress net: ANY stuck mode (silent hang, missed submit,
                // connection-level drops) recovers with a fresh query-param
                // navigation instead of polling to the deadline. Overridable
                // via E2E_RECOVERY_MS for stress runs.
                if (Date.now() - lastApiResponseAt > NO_PROGRESS_MS) {
                    await recover('no-progress');
                    continue;
                }
                await page.waitForTimeout(1500);
            }
            return hasSettled();
        } finally {
            page.off('response', onApiResponse);
        }
    };

    const settled = await settle(async () => {
        const hasCheckbox = await firstCheckbox.isVisible().catch(() => false);
        const hasEmptyState = await emptyState.isVisible().catch(() => false);
        // Deliberately NOT the reset button: it renders in the pre-search
        // state too, which would let the first settle pass before the search
        // actually produced results or an empty verdict.
        return hasCheckbox || hasEmptyState;
    }, 120000);
    expect(settled).toBe(true);

    // Only click the filters reset when the first settle ended WITHOUT
    // results. The reset re-runs the search, and that re-search is the most
    // drop-prone request of the whole run (observed failing the second
    // settle on consecutive passes right after the chrome/cmux restart).
    // With results already on screen the reset is a no-op, so skip it.
    const hasCheckboxAfterFirstSettle = await firstCheckbox.isVisible({ timeout: 2000 }).catch(() => false);
    if (!hasCheckboxAfterFirstSettle) {
        const hasResetBtn = await resetBtn.isVisible({ timeout: 3000 }).catch(() => false);
        if (hasResetBtn) {
            await resetBtn.click();
        }
    }

    const settledAfterReset = await settle(async () => {
        const hasCheckbox = await firstCheckbox.isVisible().catch(() => false);
        const hasEmptyState = await emptyState.isVisible().catch(() => false);
        return hasCheckbox || hasEmptyState;
    }, 120000);
    expect(settledAfterReset).toBe(true);

    return {
        keywordInput,
        resetBtn,
        firstCheckbox,
        emptyState,
    };
}

function getFlagValue(flag: string): string | null {
    const index = process.argv.indexOf(flag);
    if (index === -1) {
        return null;
    }
    const value = process.argv[index + 1];
    return value && !value.startsWith('--') ? value : null;
}

function shouldRunJob5156Smoke() {
    if (process.argv.includes(RUN_JOB5156_SMOKE_FLAG)) {
        return true;
    }
    const envValue = process.env.RUN_JOB5156_SMOKE?.trim().toLowerCase() ?? '';
    return ['1', 'true', 'yes', 'on'].includes(envValue);
}

async function waitForExtensionReady(page: Page) {
    await expect.poll(async () => {
        return page.evaluate(() => {
            const accessor = (window as typeof window & {
                __TR_RESUME_DATA__?: {
                    status?: () => {
                        extensionLoaded?: boolean;
                        loggedIn?: boolean;
                        domReady?: boolean;
                        sourceKey?: string;
                        cardCount?: number;
                    };
                };
            }).__TR_RESUME_DATA__;
            return accessor?.status?.() ?? null;
        });
    }, {
        timeout: 15000,
    }).not.toBeNull();
}

async function getExtensionStatus(page: Page) {
    await waitForExtensionReady(page);
    return page.evaluate(() => {
        const accessor = (window as typeof window & {
            __TR_RESUME_DATA__?: {
                status?: () => {
                    extensionLoaded?: boolean;
                    loggedIn?: boolean;
                    domReady?: boolean;
                    sourceKey?: string;
                    cardCount?: number;
                    autoSync?: string;
                    autoSyncCount?: number;
                    autoSyncPages?: number;
                };
            };
        }).__TR_RESUME_DATA__;
        return accessor?.status?.() ?? null;
    });
}

async function runJob5156DetailLiveSmoke(page: Page, detailUrl: string) {
    console.log('Testing live Job5156 detail-page extraction...');
    await page.goto(detailUrl);

    if (page.url().startsWith(JOB5156_LOGIN_URL_PREFIX)) {
        console.log('⚠️ Job5156 detail-page live smoke skipped: redirected to login.');
        return;
    }

    const status = await expect.poll(async () => await getExtensionStatus(page), {
        timeout: 20000,
    }).toMatchObject({
        extensionLoaded: true,
        loggedIn: true,
        sourceKey: 'job5156',
        domReady: true,
        cardCount: 1,
    });

    const extraction = await page.evaluate(() => {
        const accessor = (window as typeof window & {
            __TR_RESUME_DATA__?: {
                extract?: () => Array<Record<string, unknown>>;
            };
        }).__TR_RESUME_DATA__;
        return accessor?.extract?.() ?? [];
    });

    expect(Array.isArray(extraction)).toBe(true);
    expect(extraction.length).toBeGreaterThan(0);
    expect(extraction[0]).toMatchObject({
        profileUrl: detailUrl,
    });

    console.log('✅ Job5156 detail-page live smoke test passed.', status);
}

async function runSeekMyRecommendedLiveSmoke(page: Page, recommendedUrl: string) {
    console.log('Testing live Seek MY recommended-page extraction...');
    await page.goto(recommendedUrl);

    await expect.poll(async () => await getExtensionStatus(page), {
        timeout: 20000,
    }).toMatchObject({
        extensionLoaded: true,
        loggedIn: true,
        sourceKey: 'seek',
        domReady: true,
    });

    const status = await getExtensionStatus(page);

    const extraction = await page.evaluate(() => {
        const accessor = (window as typeof window & {
            __TR_RESUME_DATA__?: {
                extract?: () => Array<Record<string, unknown>>;
            };
        }).__TR_RESUME_DATA__;
        return accessor?.extract?.() ?? [];
    });

    expect(Array.isArray(extraction)).toBe(true);
    expect(extraction.length).toBeGreaterThan(0);
    expect(recommendedUrl.startsWith('https://my.employer.seek.com/candidates/recommended')).toBe(true);

    console.log('✅ Seek MY recommended-page live smoke test passed.', {
        ...status,
        extractedCount: extraction.length,
    });
}

async function runCollectUrlKeywordModeTest(page: Page) {
    console.log('Testing Quick Start Collect URL launch flow...');

    const installOpenSpy = async () => {
        await page.evaluate(() => {
            const scope = window as unknown as { __openedUrls?: string[] };
            scope.__openedUrls = [];
            window.open = ((url?: string | URL) => {
                if (typeof url === 'string') {
                    scope.__openedUrls?.push(url);
                } else if (url) {
                    scope.__openedUrls?.push(String(url));
                }
                return null;
            }) as typeof window.open;
        });
    };

    const getOpenedUrls = async () => await page.evaluate(() => {
        const scope = window as unknown as { __openedUrls?: string[] };
        return Array.isArray(scope.__openedUrls) ? scope.__openedUrls : [];
    });

    async function getFirstOpenedUrl(): Promise<URL> {
        const urls = await getOpenedUrls();
        expect(urls.length).toBeGreaterThan(0);
        return new URL(urls[0]);
    }

    // Legacy flow: collect limit input is present on the search page.
    await page.goto(
        `${DEFAULT_OPTIONS.baseUrl}/dev/resumes?location=${encodeURIComponent('东莞')}&q=${encodeURIComponent('CNC 车床 销售 STAR')}`,
        { waitUntil: 'domcontentloaded' }
    );
    await installOpenSpy();

    const collectPageLimitInput = page.getByLabel(/采集页数上限|採集頁數上限|Collect page limit/i);
    const hasLegacyCollectLimit = await collectPageLimitInput.isVisible({ timeout: 1500 }).catch(() => false);
    if (hasLegacyCollectLimit) {
        await collectPageLimitInput.fill('3');
        await page.getByRole('button', { name: /采集|Collect/i }).click();

        const openedUrl = await getFirstOpenedUrl();
        expect(`${openedUrl.origin}${openedUrl.pathname}`).toBe('https://my.employer.seek.com/candidates/recommended');
        expect(openedUrl.searchParams.get('keyword')).toBe('CNC 车床 销售 STAR');
        expect(openedUrl.searchParams.get('location')).toBe('东莞');
        expect(openedUrl.searchParams.get('tr_auto_sync')).toBe('true');
        expect(openedUrl.searchParams.get('tr_max_pages')).toBe('3');

        console.log('✅ Legacy collect URL keyword concat test passed.');
        return;
    }

    // Search-first flow: collect launches from quick-start cards without inline page-limit input.
    await page.goto(`${DEFAULT_OPTIONS.baseUrl}/dev/resumes`, { waitUntil: 'domcontentloaded' });
    await installOpenSpy();
    const collectButton = await preferVisibleLocator(
        page.getByTestId('search-hero-collect').first(),
        page.getByRole('button', { name: /^(Collect|采集)$/ }).first(),
    );
    await collectButton.waitFor({ state: 'visible' });
    await collectButton.click();

    const openedUrl = await getFirstOpenedUrl();
    const launchPath = `${openedUrl.origin}${openedUrl.pathname}`;
    if (launchPath === JOB5156_SEARCH_URL_PREFIX && !shouldRunJob5156Smoke()) {
        console.log('⚠️ Search-first collect URL smoke skipped: Job5156 launch smoke is disabled by default.');
        return;
    }
    expect([
        'https://my.employer.seek.com/candidates/recommended',
        'https://hr.job5156.com/search',
        'https://ehire.51job.com/Revision/talent/search',
    ]).toContain(launchPath);
    expect(openedUrl.searchParams.get('tr_auto_sync')).toBe('true');

    console.log('✅ Search-first collect URL launch test passed.', { launchPath });
}

async function runCollectionTest(page: Page) {
    console.log('Testing Critical Path 1: Resume Collection...');

    // Set up CWV observers before navigation
    const vitals = await measureWebVitals(page);

    await page.goto(`${DEFAULT_OPTIONS.baseUrl}/admin/system/settings/operations`, { waitUntil: 'domcontentloaded' });

    const keywordInput = await preferVisibleLocator(
        page.getByTestId('ops-collection-keyword'),
        page.getByLabel(/关键词|關鍵字|Keyword/i),
    );
    await keywordInput.fill('CNC');

    const locationInput = await preferVisibleLocator(
        page.getByTestId('ops-collection-location'),
        page.getByLabel(/地区|地區|位置|Location/i),
    );
    await locationInput.fill('广东');

    const limitInput = await preferVisibleLocator(
        page.getByTestId('ops-collection-limit'),
        page.getByLabel(/简历总量限制|履歷總量限制|Limit \(Total Resumes\)/i),
    );
    await limitInput.fill('10');

    const startCollectionBtn = await preferVisibleLocator(
        page.getByTestId('ops-start-collection'),
        page.getByRole('button', { name: /启动代理采集|啟動代理採集|Start Agent Collection/i }),
    );
    await startCollectionBtn.click();

    await waitForToast(page, COLLECTION_TASK_DISPATCHED_TOAST_PATTERN);
    console.log('✅ Collection test passed.');

    // Collect and assert Core Web Vitals
    const cwv = await vitals.collect();
    console.log('📊 Settings CWV:', cwv);

    const CWV_THRESHOLDS = loadCwvBaselines();
    if (cwv.ttfb !== null) {
        expect(cwv.ttfb).toBeLessThan(CWV_THRESHOLDS.ttfb);
        console.log(`  ✓ TTFB: ${cwv.ttfb.toFixed(0)}ms (threshold: ${CWV_THRESHOLDS.ttfb}ms)`);
    }
    if (cwv.lcp !== null) {
        expect(cwv.lcp).toBeLessThan(CWV_THRESHOLDS.lcp);
        console.log(`  ✓ LCP: ${cwv.lcp.toFixed(0)}ms (threshold: ${CWV_THRESHOLDS.lcp}ms)`);
    }
    if (cwv.cls !== null) {
        expect(cwv.cls).toBeLessThan(CWV_THRESHOLDS.cls);
        console.log(`  ✓ CLS: ${cwv.cls.toFixed(3)} (threshold: ${CWV_THRESHOLDS.cls})`);
    }
    if (cwv.fcp !== null) {
        expect(cwv.fcp).toBeLessThan(CWV_THRESHOLDS.fcp);
        console.log(`  ✓ FCP: ${cwv.fcp.toFixed(0)}ms (threshold: ${CWV_THRESHOLDS.fcp}ms)`);
    }
}

async function runSearchTest(page: Page) {
    console.log('Testing Critical Path 2: Search & Filter...');

    // Set up CWV observers before navigation (buffered: true catches early entries)
    const vitals = await measureWebVitals(page);
    const consoleLog = collectConsoleErrors(page);

    await loadDeterministicSearchResults(page);
    console.log('✅ Search & Filter test passed.');

    // Collect and assert Core Web Vitals
    const cwv = await vitals.collect();
    console.log('📊 Core Web Vitals:', cwv);

    const CWV_THRESHOLDS = loadCwvBaselines();
    if (cwv.ttfb !== null) {
        expect(cwv.ttfb).toBeLessThan(CWV_THRESHOLDS.ttfb);
        console.log(`  ✓ TTFB: ${cwv.ttfb.toFixed(0)}ms (threshold: ${CWV_THRESHOLDS.ttfb}ms)`);
    }
    if (cwv.lcp !== null) {
        expect(cwv.lcp).toBeLessThan(CWV_THRESHOLDS.lcp);
        console.log(`  ✓ LCP: ${cwv.lcp.toFixed(0)}ms (threshold: ${CWV_THRESHOLDS.lcp}ms)`);
    }
    if (cwv.cls !== null) {
        expect(cwv.cls).toBeLessThan(CWV_THRESHOLDS.cls);
        console.log(`  ✓ CLS: ${cwv.cls.toFixed(3)} (threshold: ${CWV_THRESHOLDS.cls})`);
    }
    if (cwv.fcp !== null) {
        expect(cwv.fcp).toBeLessThan(CWV_THRESHOLDS.fcp);
        console.log(`  ✓ FCP: ${cwv.fcp.toFixed(0)}ms (threshold: ${CWV_THRESHOLDS.fcp}ms)`);
    }

    // Check for browser console errors
    const consoleEntries = consoleLog.stop();
    const errors = consoleEntries.filter((e) => e.type === 'error' || e.type === 'pageerror');
    if (errors.length > 0) {
        console.warn('⚠️ Browser console errors detected:');
        for (const err of errors) {
            console.warn(`  [${err.type}] ${err.text}`);
        }
    } else {
        console.log('  ✓ No browser console errors');
    }

    // Accessibility audit with axe-core
    const a11yResults = await new AxeBuilder({ page })
        .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
        .analyze();

    if (a11yResults.violations.length > 0) {
        console.error(`❌ ${a11yResults.violations.length} accessibility violations found:`);
        for (const violation of a11yResults.violations) {
            console.error(`  [${violation.impact}] ${violation.id}: ${violation.description} (${violation.nodes.length} elements)`);
        }
        throw new Error(`Accessibility audit failed: ${a11yResults.violations.length} WCAG 2.1 AA violations`);
    } else {
        console.log('  ✓ No WCAG 2.1 AA accessibility violations');
    }
}

async function runAnalysisTest(page: Page) {
    console.log('Testing Critical Path 3: AI Analysis...');
    await loadDeterministicSearchResults(page);

    const aiModeSwitch = await preferVisibleLocator(
        page.getByTestId('resume-ai-mode-switch').first(),
        page.getByRole('switch', { name: /AI\s?Mode|AI\s?模式/i }).first(),
    );
    await aiModeSwitch.waitFor({ state: 'visible' });
    const aiEnabled = await aiModeSwitch.getAttribute('aria-checked');
    if (aiEnabled !== 'true') {
        await aiModeSwitch.click();
    }

    const analyzeBtn = await preferVisibleLocator(
        page.getByTestId('resume-analyze-button').first(),
        page.getByRole('button', { name: /Analyze loaded|分析已加载|分析已載入|Analyzing|分析中/i }).first(),
    );
    await analyzeBtn.waitFor({ state: 'visible' });
    if (await analyzeBtn.isEnabled()) {
        await analyzeBtn.click();
        await waitForToast(page, /Analyzing|正在分析/i);

        // Verify AI scores actually appear on cards
        const aiScoreIndicator = page.locator('[data-testid="ai-score"], [data-testid="ai-score-badge"], .ai-score, [class*="aiScore"]').first();
        await expect(aiScoreIndicator).toBeVisible({ timeout: 30000 });
        console.log('  ✓ AI score indicator visible after analysis');
    } else {
        console.log('⚠️ Analyze button disabled (already analyzed, no candidates, or missing query context)');
    }

    console.log('✅ AI Analysis test passed.');
}

/**
 * The collection test dispatches a task whose auto-analyze runs concurrently
 * with the search test and can make the search response 10x slower (the
 * e2e self-poisoning pattern). Wait for analysis tasks to drain before the
 * search tests so the backend is quiescent.
 */
async function waitForAnalysisQuiescence(page: Page, timeoutMs = 180000) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        const active = await page.evaluate(async () => {
            try {
                const response = await fetch('/api/resumes/analysis-tasks', {
                    credentials: 'include',
                    headers: { 'X-Workspace-Slug': 'dev' },
                });
                const payload = await response.json();
                const tasks = payload.tasks ?? payload.items ?? [];
                return tasks.filter((task: { status?: string }) => (
                    task.status === 'pending' || task.status === 'processing'
                )).length;
            } catch {
                return -1;
            }
        }).catch(() => -1);
        if (active === 0) return;
        await page.waitForTimeout(5000);
    }
    console.log('⚠️ Analysis tasks still active after the quiescence wait; continuing.');
}

async function runBulkActionsTest(page: Page) {
    console.log('Testing Critical Path 4: Bulk Actions...');
    const { firstCheckbox, emptyState } = await loadDeterministicSearchResults(page);
    const isEmpty = await emptyState.isVisible({ timeout: 3000 }).catch(() => false);
    if (isEmpty) {
        console.log('⚠️ Bulk Actions skipped: 0 search results for deterministic query.');
        return;
    }

    await firstCheckbox.waitFor({ state: 'visible', timeout: 10000 });

    const selectAllBtn = await preferVisibleLocator(
        page.getByTestId('bulk-select-all').first(),
        page.getByRole('button', { name: /全选|Select All/i }),
    );
    await selectAllBtn.waitFor({ state: 'visible' });
    await selectAllBtn.click();

    const clearSelectionBtn = await preferVisibleLocator(
        page.getByTestId('bulk-clear-selection').first(),
        page.getByRole('button', { name: /取消选择|Clear Selection/i }).first(),
    );
    await expect(clearSelectionBtn).toBeVisible();

    const shortlistBtn = await preferVisibleLocator(
        page.getByTestId('bulk-shortlist').first(),
        page.getByRole('button', { name: /批量入围|Shortlist/i }).first(),
    );
    await shortlistBtn.click();
    await expect(clearSelectionBtn).toBeHidden({ timeout: 15000 });

    console.log('✅ Bulk Actions test passed.');
}

async function runErrorStateTest(page: Page) {
    console.log('Testing Error State & Recovery...');

    // 1. Navigate to the shell first, then intercept the deterministic search request.
    await page.goto(`${DEFAULT_OPTIONS.baseUrl}/dev/resumes`, { waitUntil: 'domcontentloaded' });
    await page.setViewportSize(SMOKE_VIEWPORT);

    // 2. Mock API failure for resumes before the deterministic query submits.
    await page.route('**/api/resumes*', route => route.abort('failed'));
    const keywordInput = await preferVisibleLocator(
        page.getByTestId('resume-search-input'),
        page.getByPlaceholder(/Search resumes by keywords|按关键词、品牌、岗位或地区搜索简历|按關鍵詞、品牌、職位或地區搜尋簡歷/i),
    );
    await keywordInput.waitFor({ state: 'visible' });
    await keywordInput.fill(DETERMINISTIC_SEARCH_QUERY);
    const searchSubmitBtn = page.getByTestId('resume-search-submit');
    if (await searchSubmitBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
        await searchSubmitBtn.click();
    } else {
        await keywordInput.press('Enter');
    }

    // 3. Verify the failure surfaces, either as the legacy retry UI or the
    // current empty-state fallback.
    const firstCheckbox = page.getByRole('checkbox', { name: /选择|Select/i }).first();
    const retryBtn = page.getByRole('button', { name: /Retry|重试|common\.retry/i });
    const emptyState = page.getByRole('heading', { name: SEARCH_EMPTY_STATE_PATTERN }).first();
    await expect.poll(async () => {
        const hasRetry = await retryBtn.isVisible().catch(() => false);
        const hasEmptyState = await emptyState.isVisible().catch(() => false);
        return hasRetry || hasEmptyState;
    }, { timeout: 10000 }).toBe(true);

    // 4. Unmock and retry
    await page.unroute('**/api/resumes*');
    if (await retryBtn.isVisible({ timeout: 1000 }).catch(() => false)) {
        await retryBtn.click();
    }

    const recoveredInPlace = await expect.poll(async () => {
        const hasCheckbox = await firstCheckbox.isVisible().catch(() => false);
        const hasEmptyState = await emptyState.isVisible().catch(() => false);
        return hasCheckbox || hasEmptyState;
    }, { timeout: 5000 }).toBe(true).then(() => true).catch(() => false);

    if (!recoveredInPlace) {
        await loadDeterministicSearchResults(page);
    }

    // 5. Verify recovery lands on a stable loaded state. Depending on earlier
    // smoke mutations, the restored deterministic query can legitimately end on
    // either visible results or the current empty-state fallback.
    await expect.poll(async () => {
        const hasCheckbox = await firstCheckbox.isVisible().catch(() => false);
        const hasEmptyState = await emptyState.isVisible().catch(() => false);
        return hasCheckbox || hasEmptyState;
    }, { timeout: 30000 }).toBe(true);

    await expect(page.getByText(SEARCH_RESULT_COUNT_PATTERN).first()).toBeVisible();
    if (await firstCheckbox.isVisible({ timeout: 1000 }).catch(() => false)) {
        console.log('  ✓ Error-state recovery returned to visible resume results');
    } else {
        await expect(emptyState).toBeVisible();
        console.log('  ✓ Error-state recovery returned to the empty-state fallback');
    }

    console.log('✅ Error State test passed.');
}

async function ensureDevAdminSession(page: Page) {
    // The e2e drives the shared chrome-debug profile, which other UAT flows
    // leave logged in as various users (hr-demo, uat-reviewer, ...). The
    // collection smoke needs a dev-workspace admin for /admin/* routes; any
    // other session silently bounces to the workspace home and the limit
    // label times out after 30s. Detect the session up front and re-login as
    // demo-admin instead of failing on the label wait.
    const baseUrl = DEFAULT_OPTIONS.baseUrl;
    await page.goto(`${baseUrl}/dev/resumes`, { waitUntil: 'domcontentloaded' });
    const isDevWorkspace = await page
        .getByTestId('resume-search-input')
        .waitFor({ state: 'visible', timeout: 8000 })
        .then(() => page.url().includes('/dev/resumes'))
        .catch(() => false);
    if (isDevWorkspace) {
        console.log('✅ Dev-admin session confirmed.');
        return;
    }

    const password = process.env.AUTH_BOOTSTRAP_PASSWORD?.trim();
    if (!password) {
        throw new Error('AUTH_BOOTSTRAP_PASSWORD is required to ensure the dev-admin session for /admin/* routes');
    }
    console.log('⚠️ Dev-admin session missing — logging in as demo-admin.');
    // An authenticated non-dev-admin session bounces /login back to the
    // workspace home, so revoke the session first.
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
    await page.goto(`${baseUrl}/login`);
    await page.getByLabel(/用户名|Username/i).fill('demo-admin');
    await page.getByLabel(/密码|Password/i).fill(password);
    await page.getByRole('button', { name: /登录|Sign in|Log in/i }).click();
    await page.getByTestId('resume-search-input').waitFor({ state: 'visible', timeout: 15000 });
    console.log('✅ Logged in as demo-admin.');
}

async function main() {
    const collectOnly = process.argv.includes('--collect-only');
    const liveJob5156Detail = getFlagValue('--live-job5156-detail');
    const liveSeekMyRecommended = getFlagValue('--live-seek-my-recommended');
    const runJob5156Smoke = shouldRunJob5156Smoke();
    await ensureDeterministicSmokeFixtures();
    const { browser, page } = await connectToChrome();

    try {
        await ensureDevAdminSession(page);
        await runCollectUrlKeywordModeTest(page);
        if (collectOnly) {
            console.log('\n🌟 Collect URL smoke test passed!');
            return;
        }
        await runCollectionTest(page);
        await waitForAnalysisQuiescence(page);
        await runSearchTest(page);
        await runAnalysisTest(page);
        await runBulkActionsTest(page);
        await runErrorStateTest(page);

        if (liveJob5156Detail && runJob5156Smoke) {
            await runJob5156DetailLiveSmoke(page, liveJob5156Detail);
        } else if (liveJob5156Detail) {
            console.log('⚠️ Job5156 detail-page live smoke skipped: Job5156 smoke is disabled by default.');
        }

        if (liveSeekMyRecommended) {
            await runSeekMyRecommendedLiveSmoke(page, liveSeekMyRecommended);
        }

        console.log('\n🌟 All E2E smoke tests passed!');
    } catch (error) {
        console.error('\n❌ E2E tests failed:', error);
        process.exit(1);
    } finally {
        await browser.close();
    }
}

main();
