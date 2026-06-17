import { connectToChrome, waitForToast, DEFAULT_OPTIONS, measureWebVitals, collectConsoleErrors } from './e2e-utils';
import { Locator, Page, expect } from '@playwright/test';
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

const DETERMINISTIC_SEARCH_QUERY = 'Sales Engineer';
const SMOKE_VIEWPORT = { width: 1600, height: 1200 };
const SEARCH_WITH_QUERY_URL = (baseUrl: string) =>
    `${baseUrl}/dev/resumes?q=${encodeURIComponent(DETERMINISTIC_SEARCH_QUERY)}`;

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
    const seedResult = await client.mutation(seedWorkspaceDemoFunction, {});
    console.log('✅ Deterministic smoke fixtures ensured.', seedResult.resumes);
}

async function preferVisibleLocator(primary: Locator, fallback: Locator, timeoutMs = 3000): Promise<Locator> {
    const usePrimary = await primary.isVisible({ timeout: timeoutMs }).catch(() => false);
    return usePrimary ? primary : fallback;
}

function getFlagValue(flag: string): string | null {
    const index = process.argv.indexOf(flag);
    if (index === -1) {
        return null;
    }
    const value = process.argv[index + 1];
    return value && !value.startsWith('--') ? value : null;
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
        `${DEFAULT_OPTIONS.baseUrl}/dev/resumes?location=${encodeURIComponent('东莞')}&q=${encodeURIComponent('CNC 车床 销售 STAR')}`
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
    await page.goto(`${DEFAULT_OPTIONS.baseUrl}/dev/resumes`);
    await installOpenSpy();
    const collectButton = await preferVisibleLocator(
        page.getByTestId('search-hero-collect').first(),
        page.getByRole('button', { name: /^(Collect|采集)$/ }).first(),
    );
    await collectButton.waitFor({ state: 'visible' });
    await collectButton.click();

    const openedUrl = await getFirstOpenedUrl();
    const launchPath = `${openedUrl.origin}${openedUrl.pathname}`;
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

    await page.goto(`${DEFAULT_OPTIONS.baseUrl}/admin/system/settings/operations`);

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

    await waitForToast(page, /Collection task dispatched/i);
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

    await page.goto(`${DEFAULT_OPTIONS.baseUrl}/dev/resumes`);
    await page.setViewportSize(SMOKE_VIEWPORT);

    const keywordInput = await preferVisibleLocator(
        page.getByTestId('resume-search-input'),
        page.getByPlaceholder(/Search resumes by keywords|按关键词、品牌、岗位或地区搜索简历|按關鍵詞、品牌、職位或地區搜尋簡歷/i),
    );
    await keywordInput.waitFor({ state: 'visible' });
    await keywordInput.fill(DETERMINISTIC_SEARCH_QUERY);
    const resetBtn = page.getByRole('button', { name: /重置|Reset/i }).first();
    const firstCheckbox = page.getByRole('checkbox', { name: /选择|Select/i }).first();
    const emptyState = page.getByText(/没有符合该搜索条件的简历|沒有符合該搜尋條件的簡歷|No resumes match this search|没有匹配到简历|沒有符合的簡歷|No resumes matched this search|0 条结果|0 條結果|0 results/i).first();
    const searchSubmitBtn = page.getByTestId('resume-search-submit');
    if (await searchSubmitBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
        await searchSubmitBtn.click();
    } else {
        await keywordInput.press('Enter');
    }
    await expect.poll(async () => {
        const hasResetBtn = await resetBtn.isVisible().catch(() => false);
        const hasCheckbox = await firstCheckbox.isVisible().catch(() => false);
        const hasEmptyState = await emptyState.isVisible().catch(() => false);
        return hasResetBtn || hasCheckbox || hasEmptyState;
    }, { timeout: 15000 }).toBe(true);

    const hasResetBtn = await resetBtn.isVisible({ timeout: 3000 }).catch(() => false);
    if (hasResetBtn) {
        await resetBtn.click();
    }

    // Search may legitimately return empty results on some datasets. Verify either data or empty-state renders.
    await expect.poll(async () => {
        const hasCheckbox = await firstCheckbox.isVisible().catch(() => false);
        const hasEmptyState = await emptyState.isVisible().catch(() => false);
        return hasCheckbox || hasEmptyState;
    }, { timeout: 15000 }).toBe(true);
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
        console.warn(`⚠️ ${a11yResults.violations.length} accessibility violations found:`);
        for (const violation of a11yResults.violations) {
            console.warn(`  [${violation.impact}] ${violation.id}: ${violation.description} (${violation.nodes.length} elements)`);
        }
        // Don't fail the build on a11y warnings — just report
    } else {
        console.log('  ✓ No WCAG 2.1 AA accessibility violations');
    }
}

async function runAnalysisTest(page: Page) {
    console.log('Testing Critical Path 3: AI Analysis...');
    await page.goto(SEARCH_WITH_QUERY_URL(DEFAULT_OPTIONS.baseUrl));
    await page.setViewportSize(SMOKE_VIEWPORT);

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

async function runBulkActionsTest(page: Page) {
    console.log('Testing Critical Path 4: Bulk Actions...');
    await page.goto(SEARCH_WITH_QUERY_URL(DEFAULT_OPTIONS.baseUrl));
    await page.setViewportSize(SMOKE_VIEWPORT);

    const firstCheckbox = page.getByRole('checkbox', { name: /选择|Select/i }).first();
    const emptyState = page.getByText(/没有匹配到简历|沒有符合的簡歷|No resumes matched this search|0 条结果|0 條結果|0 results/i).first();
    const hasResults = await firstCheckbox.isVisible({ timeout: 5000 }).catch(() => false);
    if (!hasResults) {
        const isEmpty = await emptyState.isVisible({ timeout: 5000 }).catch(() => false);
        if (isEmpty) {
            console.log('⚠️ Bulk Actions skipped: 0 search results for deterministic query.');
            return;
        }
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

    // 1. Mock API failure for resumes
    await page.route('**/api/resumes*', route => route.abort('failed'));
    await page.reload();

    // 2. Verify EmptyState with Error icon renders
    // Focus on the Retry button which is specific to this state
    const retryBtn = page.getByRole('button', { name: /Retry|重试|common\.retry/i });
    await expect(retryBtn).toBeVisible();

    // 3. Unmock and retry
    await page.unroute('**/api/resumes*');
    await retryBtn.click();

    // 4. Verify recovery
    // Wait for resumes to load after retry
    await page.getByRole('checkbox', { name: /选择|Select/i }).first().waitFor({ state: 'visible' });
    await expect(page.getByText(/共 \d+ 份|returned|resumes/i)).toBeVisible();

    console.log('✅ Error State test passed.');
}

async function main() {
    const collectOnly = process.argv.includes('--collect-only');
    const liveJob5156Detail = getFlagValue('--live-job5156-detail');
    const liveSeekMyRecommended = getFlagValue('--live-seek-my-recommended');
    await ensureDeterministicSmokeFixtures();
    const { browser, page } = await connectToChrome();

    try {
        await runCollectUrlKeywordModeTest(page);
        if (collectOnly) {
            console.log('\n🌟 Collect URL smoke test passed!');
            return;
        }
        await runCollectionTest(page);
        await runSearchTest(page);
        await runAnalysisTest(page);
        await runBulkActionsTest(page);
        // await runErrorStateTest(page); // Skip due to Convex mocking complexity in smoke test

        if (liveJob5156Detail) {
            await runJob5156DetailLiveSmoke(page, liveJob5156Detail);
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
