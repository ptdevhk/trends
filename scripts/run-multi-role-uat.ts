import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';
import {
    connectToChrome,
    measureWebVitals,
    collectConsoleErrors,
    DEFAULT_OPTIONS,
    type E2EOptions,
    type WebVitals,
    type ConsoleEntry,
    type UatLocale,
    pinLocale,
} from './e2e-utils';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

export type RoleName = 'hr-demo' | 'demo-admin' | 'uat-reviewer';

export interface RoleConfig {
    username: string;
    passwordEnv: string;
    defaultWorkspace: string;
    targetRoutes: string[];
    description: string;
}

export const ROLES: Record<RoleName, RoleConfig> = {
    'hr-demo': {
        username: 'hr-demo',
        passwordEnv: 'AUTH_HR_DEMO_PASSWORD',
        defaultWorkspace: 'hr',
        targetRoutes: ['/hr/resumes'],
        description: 'HR recruiter on workspace hr',
    },
    'demo-admin': {
        username: 'demo-admin',
        passwordEnv: 'AUTH_BOOTSTRAP_PASSWORD',
        defaultWorkspace: 'dev',
        targetRoutes: ['/dev/settings/policies', '/admin/system/settings/industry-verification', '/admin/system/settings/workspace'],
        description: 'System & workspace administrator on workspace dev',
    },
    'uat-reviewer': {
        username: 'uat-reviewer',
        passwordEnv: 'AUTH_BOOTSTRAP_PASSWORD',
        defaultWorkspace: 'dev',
        targetRoutes: ['/dev/system/settings/industry-verification'],
        description: 'Industry verification reviewer on workspace dev',
    },
};

export interface UatCliOptions extends E2EOptions {
    standalone: boolean;
    headless: boolean;
    roles: RoleName[];
    screenshotDir: string;
    outputReportPath: string;
}

export interface RoleUatResult {
    role: RoleName;
    passed: boolean;
    durationMs: number;
    error?: string;
    stepsExecuted: string[];
    cwv: WebVitals;
    consoleErrors: ConsoleEntry[];
    screenshots: string[];
}

export interface UatSummaryReport {
    timestamp: string;
    totalRoles: number;
    passedRoles: number;
    failedRoles: number;
    allPassed: boolean;
    details: RoleUatResult[];
}

export const UAT_REPORT_RELATIVE_PATH = 'output/uat/multi-role-uat-report.json';

export function parseUatCliArgs(argv: string[]): UatCliOptions {
    let port = DEFAULT_OPTIONS.port;
    let baseUrl = DEFAULT_OPTIONS.baseUrl;
    let timeout = DEFAULT_OPTIONS.timeout;
    let standalone = false;
    let headless = false;
    let locale: UatLocale | undefined = undefined;
    let roles: RoleName[] = ['hr-demo', 'demo-admin', 'uat-reviewer'];
    let screenshotDir = resolve(__dirname, '../output/uat/screenshots');
    let outputReportPath = resolve(__dirname, '../', UAT_REPORT_RELATIVE_PATH);

    for (let i = 0; i < argv.length; i++) {
        const arg = argv[i];
        if (arg === '--port' && argv[i + 1]) {
            port = parseInt(argv[++i], 10);
        } else if (arg === '--base-url' && argv[i + 1]) {
            baseUrl = argv[++i];
        } else if (arg === '--timeout' && argv[i + 1]) {
            timeout = parseInt(argv[++i], 10);
        } else if (arg === '--standalone') {
            standalone = true;
        } else if (arg === '--headless') {
            headless = true;
            standalone = true;
        } else if (arg === '--locale' && argv[i + 1]) {
            locale = argv[++i] as UatLocale;
        } else if (arg === '--role' && argv[i + 1]) {
            roles = [argv[++i] as RoleName];
        } else if (arg === '--roles' && argv[i + 1]) {
            roles = argv[++i].split(',').map((r) => r.trim() as RoleName);
        } else if (arg === '--screenshot-dir' && argv[i + 1]) {
            screenshotDir = resolve(argv[++i]);
        } else if (arg === '--output-report' && argv[i + 1]) {
            outputReportPath = resolve(argv[++i]);
        }
    }

    return {
        port,
        baseUrl,
        timeout,
        standalone,
        headless,
        locale,
        roles,
        screenshotDir,
        outputReportPath,
    };
}

export function generateUatSummary(results: RoleUatResult[]): UatSummaryReport {
    const totalRoles = results.length;
    const passedRoles = results.filter((r) => r.passed).length;
    const failedRoles = totalRoles - passedRoles;
    return {
        timestamp: new Date().toISOString(),
        totalRoles,
        passedRoles,
        failedRoles,
        allPassed: failedRoles === 0,
        details: results,
    };
}

export async function authenticateRole(page: Page, roleName: RoleName, baseUrl: string): Promise<void> {
    const config = ROLES[roleName];
    const password = process.env[config.passwordEnv]?.trim() || process.env.AUTH_BOOTSTRAP_PASSWORD?.trim() || 'admin123';

    // 1. Explicitly clear all context cookies so previous persona sessions don't bleed
    await page.context().clearCookies();

    // 2. Navigate to login page
    await page.goto(`${baseUrl}/login`, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('#username, input[type="text"]', { timeout: 10000 });

    // 3. Fill credentials
    await page.locator('#username').fill(config.username);
    await page.locator('#password').fill(password);
    await page.getByRole('button', { name: /登录|登入|Sign in|Log in/i }).click();

    // 4. Wait for redirection away from /login to authorized desk
    await page.waitForURL((url) => !url.pathname.includes('/login'), { timeout: 15000 });
}

async function runHrDemoWalk(
    page: Page,
    options: UatCliOptions,
    screenshots: string[]
): Promise<string[]> {
    const steps: string[] = [];
    const baseUrl = options.baseUrl;

    // Step 1: Login
    await authenticateRole(page, 'hr-demo', baseUrl);
    steps.push('login');

    // Step 2: Navigate to /hr/resumes
    await page.goto(`${baseUrl}/hr/resumes`, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('[data-testid="resume-search-input"], input[type="search"]', { timeout: 10000 });
    steps.push('load-resumes-page');

    const shot1 = resolve(options.screenshotDir, 'hr-demo-resumes-home.png');
    await page.screenshot({ path: shot1, fullPage: true });
    screenshots.push(shot1);

    // Step 3: Search keyword 'sales'
    const searchInput = page.getByTestId('resume-search-input').or(page.locator('input[type="search"]').first());
    await searchInput.fill('sales');
    await searchInput.press('Enter');
    await page.waitForTimeout(1500);
    steps.push('search-sales');

    const shot2 = resolve(options.screenshotDir, 'hr-demo-search-results.png');
    await page.screenshot({ path: shot2, fullPage: true });
    screenshots.push(shot2);

    // Step 4: Negative Admin Gate check — non-admin cannot access admin-only settings
    await page.goto(`${baseUrl}/admin/system/settings/industry-verification`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1000);
    steps.push('negative-admin-gate');

    const shot3 = resolve(options.screenshotDir, 'hr-demo-negative-admin-gate.png');
    await page.screenshot({ path: shot3, fullPage: true });
    screenshots.push(shot3);

    return steps;
}

async function runDemoAdminWalk(
    page: Page,
    options: UatCliOptions,
    screenshots: string[]
): Promise<string[]> {
    const steps: string[] = [];
    const baseUrl = options.baseUrl;

    // Step 1: Login as admin
    await authenticateRole(page, 'demo-admin', baseUrl);
    steps.push('login');

    // Step 2: Policies page
    await page.goto(`${baseUrl}/dev/settings/policies`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1500);
    steps.push('policies-page');

    const shot1 = resolve(options.screenshotDir, 'demo-admin-policies.png');
    await page.screenshot({ path: shot1, fullPage: true });
    screenshots.push(shot1);

    // Step 3: Industry verification admin page
    await page.goto(`${baseUrl}/admin/system/settings/industry-verification`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1500);
    steps.push('industry-verification-admin');

    const shot2 = resolve(options.screenshotDir, 'demo-admin-industry-verification.png');
    await page.screenshot({ path: shot2, fullPage: true });
    screenshots.push(shot2);

    // Step 4: Workspace settings page
    await page.goto(`${baseUrl}/admin/system/settings/workspace`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1000);
    steps.push('workspace-settings');

    const shot3 = resolve(options.screenshotDir, 'demo-admin-workspace-settings.png');
    await page.screenshot({ path: shot3, fullPage: true });
    screenshots.push(shot3);

    return steps;
}

async function runUatReviewerWalk(
    page: Page,
    options: UatCliOptions,
    screenshots: string[]
): Promise<string[]> {
    const steps: string[] = [];
    const baseUrl = options.baseUrl;

    // Step 1: Login as reviewer
    await authenticateRole(page, 'uat-reviewer', baseUrl);
    steps.push('login');

    // Step 2: Workspace-scoped industry verification review queue
    await page.goto(`${baseUrl}/dev/system/settings/industry-verification`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1500);
    steps.push('industry-verification-inbox');

    const shot1 = resolve(options.screenshotDir, 'uat-reviewer-inbox.png');
    await page.screenshot({ path: shot1, fullPage: true });
    screenshots.push(shot1);

    return steps;
}

export async function runRoleWalk(
    page: Page,
    role: RoleName,
    options: UatCliOptions
): Promise<RoleUatResult> {
    const startTime = Date.now();
    const consoleCollector = collectConsoleErrors(page);
    const cwvCollector = await measureWebVitals(page);
    const screenshots: string[] = [];
    let stepsExecuted: string[] = [];
    let error: string | undefined;
    let passed = false;

    console.log(`\n▶ Starting UAT walk for role [${role}]...`);

    try {
        if (options.locale) {
            await pinLocale(page, options.locale);
        }

        switch (role) {
            case 'hr-demo':
                stepsExecuted = await runHrDemoWalk(page, options, screenshots);
                break;
            case 'demo-admin':
                stepsExecuted = await runDemoAdminWalk(page, options, screenshots);
                break;
            case 'uat-reviewer':
                stepsExecuted = await runUatReviewerWalk(page, options, screenshots);
                break;
        }

        passed = true;
        console.log(`✅ Role [${role}] completed successfully (${stepsExecuted.length} steps).`);
    } catch (err) {
        error = err instanceof Error ? err.message : String(err);
        console.error(`❌ Role [${role}] failed:`, error);
    }

    const durationMs = Date.now() - startTime;
    const consoleErrors = consoleCollector.stop();
    const cwv = await cwvCollector.collect();

    return {
        role,
        passed,
        durationMs,
        error,
        stepsExecuted,
        cwv,
        consoleErrors,
        screenshots,
    };
}

export async function main() {
    const options = parseUatCliArgs(process.argv.slice(2));
    mkdirSync(options.screenshotDir, { recursive: true });
    mkdirSync(dirname(options.outputReportPath), { recursive: true });

    let browser: Browser | null = null;
    let context: BrowserContext;
    let page: Page;

    if (options.standalone) {
        console.log(`Launching standalone Chromium (headless: ${options.headless})...`);
        browser = await chromium.launch({ headless: options.headless });
        context = await browser.newContext({ viewport: { width: 1600, height: 1200 } });
        page = await context.newPage();
    } else {
        console.log(`Connecting to Chrome on port ${options.port}...`);
        const cdp = await connectToChrome(options);
        context = cdp.context;
        page = cdp.page;
    }

    const results: RoleUatResult[] = [];

    try {
        for (const role of options.roles) {
            const res = await runRoleWalk(page, role, options);
            results.push(res);
        }
    } finally {
        if (browser) {
            await browser.close();
        }
    }

    const summary = generateUatSummary(results);
    writeFileSync(options.outputReportPath, JSON.stringify(summary, null, 2), 'utf-8');

    console.log('\n========================================');
    console.log('MULTI-ROLE UAT SUITE SUMMARY');
    console.log('========================================');
    console.log(`Total Roles:  ${summary.totalRoles}`);
    console.log(`Passed Roles: ${summary.passedRoles}`);
    console.log(`Failed Roles: ${summary.failedRoles}`);
    console.log(`Report JSON:  ${options.outputReportPath}`);
    console.log('========================================\n');

    if (!summary.allPassed) {
        process.exit(1);
    }
}

if (process.argv[1] && process.argv[1].endsWith('run-multi-role-uat.ts')) {
    main().catch((err) => {
        console.error('Fatal error in multi-role UAT suite:', err);
        process.exit(1);
    });
}
