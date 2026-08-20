import { chromium, Page } from 'playwright';

export type UatLocale = 'en' | 'zh-Hant' | 'zh-Hans';

export interface E2EOptions {
    port: number;
    baseUrl: string;
    timeout: number;
    /** Pin the app language via localStorage `i18nextLng` before each role walk. */
    locale?: UatLocale;
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
 * Pin the app language for the rest of a session by setting localStorage
 * `i18nextLng` (the key `apps/web/src/i18n/index.ts` reads on init).
 * Installed via addInitScript so it survives page.goto navigations, with an
 * immediate evaluate for the already-loaded document; a subsequent reload or
 * navigation applies the locale. The tri-lingual locators stay in place —
 * this only makes the initial language deterministic per role run.
 * Opaque origins (about:blank) throw on localStorage access and are ignored;
 * the next same-origin load applies the pin.
 */
export async function pinLocale(page: Page, locale: UatLocale): Promise<void> {
    await page.addInitScript((lng) => {
        try {
            localStorage.setItem('i18nextLng', lng);
        } catch {
            // Opaque origins such as about:blank; the next same-origin load applies it.
        }
    }, locale);
    await page.evaluate((lng) => {
        localStorage.setItem('i18nextLng', lng);
    }, locale).catch(() => {
        // Same opaque-origin guard as above.
    });
}

/**
 * Inject PerformanceObserver scripts and collect Core Web Vitals.
 * Observers are installed via addInitScript so they survive page.goto
 * navigations — evaluate-installed observers die with the old document,
 * which made every CWV measurement return all nulls (the nightly UAT
 * observation). The window flag keeps repeated measureWebVitals calls in
 * one session from stacking duplicate observer sets per document.
 * Call `collect()` after the page has settled to retrieve measured values.
 */
export async function measureWebVitals(page: Page): Promise<{ collect: () => Promise<WebVitals> }> {
    // Runs before page scripts on every navigation; `buffered: true`
    // catches entries emitted before the observer installs.
    await page.addInitScript(() => {
        const w = window as typeof window & {
            __cwv_installed?: boolean;
            __cwv_ttfb?: number | null;
            __cwv_lcp?: number | null;
            __cwv_cls?: number | null;
            __cwv_fcp?: number | null;
        };
        if (w.__cwv_installed) {
            return;
        }
        w.__cwv_installed = true;
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

        if (options.locale) {
            await page.addInitScript((lng) => {
                try {
                    localStorage.setItem('i18nextLng', lng);
                } catch {
                    // Opaque origins such as about:blank; the next same-origin load applies it.
                }
            }, options.locale);
        }

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
