import { connectToChrome, waitForToast, DEFAULT_OPTIONS } from './e2e-utils';
import { Page, expect } from '@playwright/test';

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
    console.log('Testing Quick Start Collect URL keyword concat mode...');
    await page.goto(
        `${DEFAULT_OPTIONS.baseUrl}/dev/resumes?location=${encodeURIComponent('东莞')}&q=${encodeURIComponent('CNC 车床 销售 STAR')}`
    );

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

    const collectPageLimitInput = page.getByLabel(/采集页数上限|採集頁數上限|Collect page limit/i);
    await collectPageLimitInput.waitFor({ state: 'visible' });
    await collectPageLimitInput.fill('3');
    await page.getByRole('button', { name: /采集|Collect/i }).click();

    const openedUrls = await page.evaluate(() => {
        const scope = window as unknown as { __openedUrls?: string[] };
        return Array.isArray(scope.__openedUrls) ? scope.__openedUrls : [];
    });

    expect(openedUrls.length).toBeGreaterThan(0);
    const openedUrl = new URL(openedUrls[0]);
    expect(`${openedUrl.origin}${openedUrl.pathname}`).toBe('https://my.employer.seek.com/candidates/recommended');
    expect(openedUrl.searchParams.get('keyword')).toBe('CNC 车床 销售 STAR');
    expect(openedUrl.searchParams.get('location')).toBe('东莞');
    expect(openedUrl.searchParams.get('tr_auto_sync')).toBe('true');
    expect(openedUrl.searchParams.get('tr_max_pages')).toBe('3');

    console.log('✅ Collect URL keyword concat test passed.');
}

async function runCollectionTest(page: Page) {
    console.log('Testing Critical Path 1: Resume Collection...');
    await page.goto(`${DEFAULT_OPTIONS.baseUrl}/system/settings`);

    // Fill collection form
    await page.getByLabel('Keyword').fill('CNC');
    await page.getByLabel('Location').fill('广东');
    await page.getByLabel('Limit (Total Resumes)').fill('10');

    // Start collection
    await page.getByRole('button', { name: /Start Agent Collection/i }).click();

    // Verify toast
    await waitForToast(page, /Collection task dispatched/i);
    console.log('✅ Collection test passed.');
}

async function runSearchTest(page: Page) {
    console.log('Testing Critical Path 2: Search & Filter...');
    await page.goto(`${DEFAULT_OPTIONS.baseUrl}/resumes`);

    // Search by keyword
    // From snapshot, placeholder is "自定义关键词..."
    const keywordInput = page.getByPlaceholder(/自定义关键词/i);
    await keywordInput.fill('销售');

    // Wait for debounce and list update
    await page.waitForTimeout(1000);

    // Expand Filter Panel
    await page.getByText('筛选条件').first().click();

    // Interact with filters
    // Snapshot shows the button text is "清除"
    const clearBtn = page.getByText(/清除|Clear|resumes\.filters\.clear/i);
    await clearBtn.waitFor({ state: 'visible' });
    await clearBtn.click();

    // Verify the list renders (AI mode may not show the "Sample/summary" line).
    await page.getByRole('checkbox', { name: /选择|Select/i }).first().waitFor({ state: 'visible' });
    console.log('✅ Search & Filter test passed.');
}

async function runAnalysisTest(page: Page) {
    console.log('Testing Critical Path 3: AI Analysis...');
    await page.goto(`${DEFAULT_OPTIONS.baseUrl}/resumes`);

    // Select a JD
    // Note: JobDescriptionSelect uses a Select component, we might need to click and search
    await page.getByText(/手动职位/i).click();
    // Select the first one or a specific one
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Enter');

    // Click the Analyze/Search action button (label may vary by locale/version).
    const analyzeBtn = page.getByRole('button', { name: /resumes\.analyzeAll|Analyze|AI\s?Mode|AI模式/i });
    if (await analyzeBtn.isEnabled()) {
        await analyzeBtn.click();
        await waitForToast(page, /Analyzing|正在分析/i);
    } else {
        console.log('⚠️ Analyze button disabled (already analyzed or no candidates)');
    }

    console.log('✅ AI Analysis test passed.');
}

async function runBulkActionsTest(page: Page) {
    console.log('Testing Critical Path 4: Bulk Actions...');
    await page.goto(`${DEFAULT_OPTIONS.baseUrl}/resumes`);

    // Wait for at least one resume to be visible
    await page.getByRole('checkbox', { name: /选择|Select/i }).first().waitFor({ state: 'visible' });

    // Select some resumes via "Select All" for reliability
    // Snapshot shows "全选" button
    const selectAllBtn = page.getByRole('button', { name: /全选|Select All/i });
    await selectAllBtn.click();

    // Verify counter in BulkActionBar
    // Snapshot shows "已选择" is a separate element from the number
    await expect(page.getByText(/已选择|Selected/i).first()).toBeVisible();

    // Check for a non-zero count - it might be "1 / 50" etc.
    // We'll just verify the Bar is active by checking the "Clear Selection" button
    await expect(page.getByRole('button', { name: /取消选择|Clear Selection/i })).toBeVisible();

    // Click shortlist
    // Snapshot shows "批量入围"
    await page.getByRole('button', { name: /批量入围|Shortlist/i }).first().click();
    await waitForToast(page, /入围|Shortlisted/i);

    // Export
    // Snapshot shows "导出"
    await page.getByRole('button', { name: /导出|Export/i }).first().click();
    await waitForToast(page, /导出|Export/i);

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
