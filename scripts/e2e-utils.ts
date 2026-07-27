import { chromium, Page } from 'playwright';

export interface E2EOptions {
    port: number;
    baseUrl: string;
    timeout: number;
}

export const COLLECTION_TASK_DISPATCHED_TOAST_PATTERN = /Collection task dispatched|采集任务已派发|採集任務已派發/i

export const DEFAULT_OPTIONS: E2EOptions = {
    port: 9222,
    baseUrl: 'http://localhost:5173',
    timeout: 30000,
};

export interface WebVitals {
    ttfb: number | null;
    lcp: number | null;
    cls: number | null;
    fcp: number | null;
}

/**
 * Inject PerformanceObserver scripts and collect Core Web Vitals.
 * Must be called BEFORE navigation (observers need `buffered: true` to catch early entries).
 * Call `collect()` after the page has settled to retrieve measured values.
 */
export async function measureWebVitals(page: Page): Promise<{ collect: () => Promise<WebVitals> }> {
    // Set up observers before navigation so they capture all entries
    await page.evaluate(() => {
        const w = window as typeof window & {
            __cwv_ttfb?: number | null;
            __cwv_lcp?: number | null;
            __cwv_cls?: number | null;
            __cwv_fcp?: number | null;
        };
        w.__cwv_ttfb = null;
        w.__cwv_lcp = null;
        w.__cwv_cls = null;
        w.__cwv_fcp = null;

        // TTFB from navigation timing
        new PerformanceObserver((list) => {
            const nav = list.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined;
            if (nav) w.__cwv_ttfb = nav.responseStart - nav.fetchStart;
        }).observe({ type: 'navigation', buffered: true });

        // LCP — last entry wins
        new PerformanceObserver((list) => {
            const entries = list.getEntries();
            if (entries.length > 0) w.__cwv_lcp = entries[entries.length - 1].startTime;
        }).observe({ type: 'largest-contentful-paint', buffered: true });

        // CLS — sum of non-user-input layout shifts
        new PerformanceObserver((list) => {
            let clsSum = 0;
            for (const entry of list.getEntries()) {
                const ls = entry as PerformanceEntry & { hadRecentInput?: boolean; value?: number };
                if (!ls.hadRecentInput && ls.value) clsSum += ls.value;
            }
            w.__cwv_cls = (w.__cwv_cls ?? 0) + clsSum;
        }).observe({ type: 'layout-shift', buffered: true });

        // FCP
        new PerformanceObserver((list) => {
            for (const entry of list.getEntries()) {
                if (entry.name === 'first-contentful-paint') w.__cwv_fcp = entry.startTime;
            }
        }).observe({ type: 'paint', buffered: true });
    });

    return {
        async collect(): Promise<WebVitals> {
            return page.evaluate(() => {
                const w = window as typeof window & {
                    __cwv_ttfb?: number | null;
                    __cwv_lcp?: number | null;
                    __cwv_cls?: number | null;
                    __cwv_fcp?: number | null;
                };
                return {
                    ttfb: w.__cwv_ttfb ?? null,
                    lcp: w.__cwv_lcp ?? null,
                    cls: w.__cwv_cls ?? null,
                    fcp: w.__cwv_fcp ?? null,
                };
            });
        },
    };
}

export interface ConsoleEntry {
    type: string;
    text: string;
}

export function collectConsoleErrors(page: Page): { stop: () => ConsoleEntry[] } {
    const entries: ConsoleEntry[] = [];
    const onConsole = (msg: { type: () => string; text: () => string }) => {
        if (msg.type() === 'error' || msg.type() === 'warning') {
            entries.push({ type: msg.type(), text: msg.text() });
        }
    };
    const onPageError = (err: Error) => {
        entries.push({ type: 'pageerror', text: err.message });
    };
    page.on('console', onConsole);
    page.on('pageerror', onPageError);
    return {
        stop() {
            page.removeListener('console', onConsole);
            page.removeListener('pageerror', onPageError);
            return entries;
        },
    };
}

export async function connectToChrome(options: E2EOptions = DEFAULT_OPTIONS) {
    try {
        const browser = await chromium.connectOverCDP(`http://127.0.0.1:${options.port}`);
        const context = browser.contexts()[0]; // Use the first context (usually the one started by chrome-debug.sh)
        const page = context.pages().find(p => p.url().includes('localhost')) || await context.newPage();

        await page.addInitScript((prefix) => {
            try {
                for (const key of Object.keys(localStorage)) {
                    if (key.startsWith(prefix)) {
                        localStorage.removeItem(key);
                    }
                }
            } catch {
                // Ignore opaque origins such as about:blank; the next same-origin load is the
                // one that needs the storage cleared before the app initializes.
            }
        }, 'trends.resume.');

        await page.goto(options.baseUrl);
        return { browser, context, page };
    } catch (error) {
        console.error('Failed to connect to Chrome on port', options.port);
        console.error('Make sure to run: make chrome-debug');
        throw error;
    }
}

export async function waitForToast(page: Page, text: string | RegExp) {
    const toast = page.getByText(text).first();
    await toast.waitFor({ state: 'visible', timeout: 10000 });
    return toast;
}

export async function clickByText(page: Page, text: string) {
    await page.getByText(text, { exact: true }).click();
}

export async function fillInput(page: Page, label: string, value: string) {
    await page.getByLabel(label).fill(value);
}
