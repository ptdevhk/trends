import { chromium, Page } from 'playwright';

export interface E2EOptions {
    port: number;
    baseUrl: string;
    timeout: number;
}

export const DEFAULT_OPTIONS: E2EOptions = {
    port: 9222,
    baseUrl: 'http://localhost:5173',
    timeout: 30000,
};

export async function connectToChrome(options: E2EOptions = DEFAULT_OPTIONS) {
    try {
        const browser = await chromium.connectOverCDP(`http://127.0.0.1:${options.port}`);
        const context = browser.contexts()[0]; // Use the first context (usually the one started by chrome-debug.sh)
        const page = context.pages().find(p => p.url().includes('localhost')) || await context.newPage();

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
